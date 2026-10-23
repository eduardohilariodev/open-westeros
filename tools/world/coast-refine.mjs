// Refines the hand-drawn coasts of the Known World SVG (assets/world/vector-world.raw.json, from svg-vector.mjs) into
// src/vector-world.json. The drawn vertices are canon points, so the coast keeps passing through them:
//  1. a centripetal Catmull-Rom spline through the vertices rounds the facets (corners sharper than CORNER and long straight
//     edges, the map's cut edges, stay as drawn); an interpolating curve, unlike Chaikin, never shrinks headlands;
//  2. seeded fractal noise along the normal (<= AMP_CAP km) puts fine detail back, faded out near places, river mouths and
//     straight edges so shore claims in tools/books still hold;
//  3. every ring is checked: no new crossings, and no point more than HAUS_CAP km from the drawn coast, else its noise is halved.
// First run copies the current src/vector-world.json to the raw file; svg-vector.mjs writes the raw file from then on.
// Usage: node tools/world/coast-refine.mjs
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { METRES_PER_DEGREE } from '../../src/config.ts';
import { makeNoise } from './noise.mjs';

export const RAW = 'assets/world/vector-world.raw.json', OUT = 'src/vector-world.json';
const KMD = METRES_PER_DEGREE / 1000, RAD = Math.PI / 180;
const SPACING = 4, LONG = 30, CORNER = (100 * Math.PI) / 180; // km between points; km: a straight cut edge; radians: a headland tip
const AMP_CAP = 2.4, HAUS_CAP = 3.2, LAND_AMP = 2, LAKE_AMP = 0.5; // km (1.5 and 2 mi, the shore claims allow 4)
const WAVE = 40, FADE_EDGE = 10, ANCHOR_NEAR = 4, ANCHOR_FAR = 10; // km: longest wavelength, fade from a straight edge, from a place

// sinusoidal km frame: continuous, and distances are right locally
export const proj = ([lon, lat]) => [lon * Math.cos(lat * RAD) * KMD, lat * KMD];
const unproj = ([x, y]) => { const lat = y / KMD; return [x / (KMD * Math.cos(lat * RAD)), lat]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const smooth = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const round4 = (p) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];

/** Centripetal Catmull-Rom (Barry-Goldman) from p1 to p2 at t in 0..1. */
function spline(p0, p1, p2, p3, t) {
  const t1 = Math.sqrt(dist(p0, p1)), t2 = t1 + Math.sqrt(dist(p1, p2)), t3 = t2 + Math.sqrt(dist(p2, p3)), u = t1 + (t2 - t1) * t;
  const mix = (a, b, ta, tb) => (tb === ta ? a : [(a[0] * (tb - u) + b[0] * (u - ta)) / (tb - ta), (a[1] * (tb - u) + b[1] * (u - ta)) / (tb - ta)]);
  const a1 = mix(p0, p1, 0, t1), a2 = mix(p1, p2, t1, t2), a3 = mix(p2, p3, t2, t3);
  return mix(mix(a1, a2, 0, t2), mix(a2, a3, t1, t3), t1, t2);
}

const { fbm } = makeNoise(11);

/**
 * One ring (lon/lat) refined. amp = noise amplitude in km; weight(km point) = 0..1 fades the noise (near places).
 * Returns lon/lat, rounded to 0.0001 degree.
 */
export function refineRing(raw, amp, weight = () => 1) {
  const P = raw.map(proj).filter((p, i, a) => !i || dist(p, a[i - 1]) > 1e-6);
  const n = P.length;
  if (n < 4) return raw;
  const at = (i) => P[(i + n) % n], L = P.map((p, i) => dist(p, at(i + 1)));
  const turn = P.map((p, i) => {
    const a = [p[0] - at(i - 1)[0], p[1] - at(i - 1)[1]], b = [at(i + 1)[0] - p[0], at(i + 1)[1] - p[1]];
    return Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
  });
  const out = []; // { p, fixed }: a point of the straight cut edges is fixed
  P.forEach((p1, i) => {
    out.push({ p: p1, fixed: L[i] > LONG || L[(i - 1 + n) % n] > LONG });
    if (L[i] > LONG) return;
    const p2 = at(i + 1), p0 = turn[i] > CORNER ? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]] : at(i - 1);
    const p3 = turn[(i + 1) % n] > CORNER ? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] : at(i + 2);
    for (let j = 1, k = Math.max(1, Math.round(L[i] / SPACING)); j < k; j++) out.push({ p: spline(p0, p1, p2, p3, j / k), fixed: false });
  });
  // arc length to the nearest fixed point, both ways round the ring
  const m = out.length, run = new Float64Array(m).fill(Infinity);
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < m; i++) { const a = out[(i + m - 1) % m]; run[i] = out[i].fixed ? 0 : Math.min(run[i], run[(i + m - 1) % m] + dist(a.p, out[i].p)); }
  for (let pass = 0; pass < 2; pass++) for (let i = m - 1; i >= 0; i--) run[i] = out[i].fixed ? 0 : Math.min(run[i], run[(i + 1) % m] + dist(out[(i + 1) % m].p, out[i].p));
  return out.map(({ p }, i) => {
    if (!amp) return round4(unproj(p));
    const a = out[(i + m - 1) % m].p, b = out[(i + 1) % m].p, tx = b[0] - a[0], ty = b[1] - a[1], len = Math.hypot(tx, ty) || 1;
    const w = smooth(0, FADE_EDGE, run[i]) * weight(p);
    const d = Math.max(-AMP_CAP, Math.min(AMP_CAP, amp * w * fbm(p[0] / WAVE, p[1] / WAVE)));
    return round4(unproj([p[0] - (ty / len) * d, p[1] + (tx / len) * d]));
  });
}

// ---- checks ----
const CELL = 20;
const cellsOf = (a, b, cell, f) => {
  for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++)
    for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) f(x + ',' + y);
};
const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const cross = (a, b, c, d) => side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;

/** Pairs of rings (by index, "i|j") whose outlines cross, themselves included. */
export function crossings(rings) {
  const grid = new Map(), segs = [], hit = new Set();
  rings.forEach((r, ri) => {
    const P = r.map(proj);
    P.forEach((a, i) => {
      const b = P[(i + 1) % P.length], id = segs.length; segs.push([a, b, ri, i, P.length]);
      cellsOf(a, b, CELL, (c) => (grid.get(c) ?? grid.set(c, []).get(c)).push(id));
    });
  });
  for (const ids of grid.values()) for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
    const [a, b, ri, i, n] = segs[ids[x]], [c, d, rj, j, m] = segs[ids[y]];
    if (ri === rj && (Math.abs(i - j) === 1 || Math.abs(i - j) === n - 1)) continue;
    if (cross(a, b, c, d)) hit.add(Math.min(ri, rj) + '|' + Math.max(ri, rj));
  }
  return hit;
}

const toSeg = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
};
/** Farthest any vertex of one ring is from the other ring's outline, either way round, in km. */
export function deviation(rawRing, ring) {
  const far = (A, B) => {
    const grid = new Map(), PB = B.map(proj), PA = A.map(proj);
    PB.forEach((a, i) => cellsOf(a, PB[(i + 1) % PB.length], CELL, (c) => (grid.get(c) ?? grid.set(c, []).get(c)).push(i)));
    let worst = 0;
    for (const p of PA) {
      let best = Infinity;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
        for (const i of grid.get(Math.floor(p[0] / CELL) + dx + ',' + (Math.floor(p[1] / CELL) + dy)) ?? []) best = Math.min(best, toSeg(p, PB[i], PB[(i + 1) % PB.length]));
      worst = Math.max(worst, best);
    }
    return worst;
  };
  return Math.max(far(ring, rawRing), far(rawRing, ring));
}

export const area = (ring) => { const P = ring.map(proj); return Math.abs(P.reduce((s, p, i) => s + (p[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * p[1]), 0)) / 2; }; // km2

/** Refines a set of rings, halving the noise of any ring that crosses something new or strays too far, until they pass. */
export function refineSet(rings, amp, weight, tick = () => {}) {
  const base = crossings(rings), scale = rings.map(() => 1), out = rings.map((r, i) => (tick(i, rings.length), refineRing(r, amp, weight)));
  const stats = { retried: 0, raw: 0 };
  for (let it = 0; it < 8; it++) {
    const bad = new Set();
    for (const k of crossings(out)) if (!base.has(k)) k.split('|').forEach((i) => bad.add(+i));
    rings.forEach((r, i) => { if (!bad.has(i) && deviation(r, out[i]) > HAUS_CAP) bad.add(i); });
    if (!bad.size) return { out, stats, scale };
    for (const i of bad) {
      scale[i] /= 2; stats.retried++;
      if (scale[i] < 0.1) scale[i] = 0;
      out[i] = refineRing(rings[i], amp * scale[i], weight);
      if (!scale[i] && (bad.has(i) && (crossings([out[i]]).size || deviation(rings[i], out[i]) > HAUS_CAP))) { out[i] = rings[i]; stats.raw++; } // the spline alone fails: keep the drawn ring
    }
  }
  throw new Error('rings still crossing after 8 passes');
}

// ---- main ----
async function main() {
  const t0 = Date.now(), tty = process.stdout.isTTY;
  const say = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
  const bar = (label) => { let last = -1; return (i, n) => { const pc = Math.floor((100 * (i + 1)) / n / (tty ? 1 : 10)); if (pc !== last) { last = pc; process.stdout.write(tty ? `\r  ${label} ${i + 1}/${n} (${Math.floor((100 * (i + 1)) / n)}%)  ${i + 1 === n ? '\n' : ''}` : `  ${label} ${i + 1}/${n}\n`); } }; };

  if (!existsSync(RAW)) { copyFileSync(OUT, RAW); say(`first run: kept the drawn coast as ${RAW}`); }
  const world = JSON.parse(readFileSync(RAW, 'utf8'));
  const { PLACES } = await import('../../src/world-data.ts');
  // places and river ends: the noise fades out near them (cell grid in km)
  const anchors = new Map(), key = (p) => Math.floor(p[0] / 25) + ',' + Math.floor(p[1] / 25);
  for (const p of [...PLACES.map((x) => [x[3], x[2]]), ...world.rivers.flatMap((r) => [r[0], r.at(-1)])].map(proj)) (anchors.get(key(p)) ?? anchors.set(key(p), []).get(key(p))).push(p);
  const weight = (p) => {
    let d = Infinity; const [cx, cy] = key(p).split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const a of anchors.get(cx + dx + ',' + (cy + dy)) ?? []) d = Math.min(d, dist(p, a));
    return smooth(ANCHOR_NEAR, ANCHOR_FAR, d);
  };
  say(`${PLACES.length} places and ${world.rivers.length} rivers keep the noise off their shores`);

  say('land: spline and noise');
  const land = refineSet(world.land, LAND_AMP, weight, bar('land ring'));
  say(`land: ${land.stats.retried} ring retries, ${land.stats.raw} left as drawn`);
  const lakeRings = world.lakes.flatMap((l) => l.rings), counts = world.lakes.map((l) => l.rings.length);
  say('lakes: spline and noise');
  const lakes = refineSet(lakeRings, LAKE_AMP, weight, bar('lake ring'));
  let k = 0;
  const lakesOut = world.lakes.map((l, i) => ({ ...l, rings: lakes.out.slice(k, (k += counts[i])) }));

  say('measuring');
  const devs = world.land.map((r, i) => deviation(r, land.out[i])), big = world.land.map((r, i) => i).sort((a, b) => world.land[b].length - world.land[a].length).slice(0, 4);
  const pts = (rs) => rs.reduce((s, r) => s + r.length, 0);
  console.log(`  land points ${pts(world.land)} -> ${pts(land.out)}; lake points ${pts(lakeRings)} -> ${pts(lakes.out)}`);
  console.log(`  farthest from the drawn coast: ${Math.max(...devs).toFixed(2)} km (cap ${HAUS_CAP})`);
  for (const i of big) console.log(`  ring ${i}: ${world.land[i].length} -> ${land.out[i].length} pts, area ${(((area(land.out[i]) - area(world.land[i])) / area(world.land[i])) * 100).toFixed(3)}%, off by ${devs[i].toFixed(2)} km`);

  writeFileSync(OUT, JSON.stringify({ ...world, land: land.out, lakes: lakesOut }));
  say(`wrote ${OUT} (${(statSync(OUT).size / 1024).toFixed(0)} KB; the drawn coast is ${(statSync(RAW).size / 1024).toFixed(0)} KB). Next: node tools/books/sea-sweep.mjs && npm run lore -- roads`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
