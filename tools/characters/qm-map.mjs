// Adapts quartermaester.info character points (docs/sources/quartermaester/qm-paths.json) to our map.
// qm's lat/lng are Google-Mercator on its own tile art; ours are globe degrees.
//   1. match qm location keys to PLACES by name (ambiguous names resolve to the nearest candidate),
//   2. fit a quadratic (lng, mercator y) -> (lon, lat), dropping mismatches until the fit is steady,
//   3. correct it with an inverse-distance residual so every kept place lands exactly on its canon spot.
// A place key always takes our canonical coordinate; only bends and unmatched spots use the transform.
// usage: node tools/characters/qm-map.mjs   (writes docs/sources/quartermaester/qm-mapped.json, prints the review list)
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const KM_DEG = 120.7;
const MILE_KM = 1.609344;
export const REVIEW_MILES = 60;

export const mercY = (lat) => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
const basis = (x, y) => [1, x, y, x * x, x * y, y * y];

export function miles(a, b) {
  const dl = a[1] - b[1];
  const dn = (a[0] - b[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return (Math.hypot(dl, dn) * KM_DEG) / MILE_KM;
}

/** least squares through the normal equations; rows are basis vectors. */
export function solve(rows, b) {
  const n = rows[0].length;
  const M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const v = Array.from({ length: n }, (_, i) => rows.reduce((s, r, k) => s + r[i] * b[k], 0));
  for (let i = 0; i < n; i++) {
    let m = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[m][i])) m = r;
    [M[i], M[m]] = [M[m], M[i]];
    [v[i], v[m]] = [v[m], v[i]];
    for (let r = i + 1; r < n; r++) {
      const f = M[r][i] / M[i][i];
      for (let c = i; c < n; c++) M[r][c] -= f * M[i][c];
      v[r] -= f * v[i];
    }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) x[i] = (v[i] - M[i].slice(i + 1).reduce((s, m, j) => s + m * x[i + 1 + j], 0)) / M[i][i];
  return x;
}

/** pairs: [{x: lng, y: mercY, lon, lat}] -> quadratic predict(x, y) = [lon, lat] */
export function fitQuad(pairs) {
  const rows = pairs.map((p) => basis(p.x, p.y));
  const cLon = solve(rows, pairs.map((p) => p.lon));
  const cLat = solve(rows, pairs.map((p) => p.lat));
  return (x, y) => {
    const r = basis(x, y);
    return [r.reduce((s, v, i) => s + v * cLon[i], 0), r.reduce((s, v, i) => s + v * cLat[i], 0)];
  };
}

/** drops the worst pair while it is far off the rest; returns the steady fit, the kept and the dropped pairs */
export function robustFit(pairs) {
  let kept = pairs.slice();
  const dropped = [];
  for (let it = 0; it < 80 && kept.length > 12; it++) {
    const f = fitQuad(kept);
    const res = kept.map((p) => ({ p, m: miles(f(p.x, p.y), [p.lon, p.lat]) })).sort((a, b) => b.m - a.m);
    const med = res[res.length >> 1].m;
    if (res[0].m <= Math.max(REVIEW_MILES, 3 * med)) return { fit: f, kept, dropped };
    dropped.push({ ...res[0].p, miles: res[0].m });
    kept = kept.filter((p) => p !== res[0].p);
  }
  return { fit: fitQuad(kept), kept, dropped };
}

/** quadratic plus inverse-distance residual of the kept pairs (power 2, nearest 6): exact at every kept pair */
export function makeTransform(kept, fit) {
  const anchors = kept.map((p) => {
    const q = fit(p.x, p.y);
    return { x: p.x, y: p.y, dlon: p.lon - q[0], dlat: p.lat - q[1] };
  });
  return (lng, lat) => {
    const x = lng;
    const y = mercY(lat);
    const q = fit(x, y);
    const near = anchors
      .map((a) => ({ a, d: Math.hypot(a.x - x, a.y - y) }))
      .sort((s, t) => s.d - t.d)
      .slice(0, 6);
    if (near[0].d < 1e-9) return [q[0] + near[0].a.dlon, q[1] + near[0].a.dlat];
    let w = 0;
    let dlon = 0;
    let dlat = 0;
    for (const { a, d } of near) {
      const k = 1 / (d * d);
      w += k;
      dlon += k * a.dlon;
      dlat += k * a.dlat;
    }
    return [q[0] + dlon / w, q[1] + dlat / w];
  };
}

export const fold = (s) =>
  decodeURIComponent(s)
    .replace(/_/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .toLowerCase()
    .trim();

/** every PLACES row a qm key could mean: exact, without a "(...)" tail, or with a leading "the " */
export function candidates(key, byName) {
  const n = fold(key);
  const bare = n.replace(/\s*\(.*\)$/, '');
  return byName.get(n) ?? byName.get(bare) ?? byName.get('the ' + bare) ?? [];
}

export function buildMap(qm, places, aliases = {}) {
  const byName = new Map();
  for (const p of places) {
    const k = fold(p[0]);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }
  const cand = (key) => (aliases[key] ? byName.get(fold(aliases[key])) ?? [] : candidates(key, byName));
  const toPair = (key, p) => ({ key, name: p[0], x: qm.locations[key].lng, y: mercY(qm.locations[key].lat), lat: p[2], lon: p[3] });

  const keys = Object.keys(qm.locations);
  const sure = keys.filter((k) => cand(k).length === 1).map((k) => toPair(k, cand(k)[0]));
  let { fit } = robustFit(sure);
  // ambiguous names: the candidate closest to where the fit puts the qm point
  const all = sure.slice();
  for (const k of keys.filter((k) => cand(k).length > 1)) {
    const at = fit(qm.locations[k].lng, mercY(qm.locations[k].lat));
    const best = cand(k).map((p) => ({ p, m: miles(at, [p[3], p[2]]) })).sort((a, b) => a.m - b.m)[0];
    all.push(toPair(k, best.p));
  }
  const { fit: fit2, kept, dropped } = robustFit(all);
  fit = fit2;
  const transform = makeTransform(kept, fit);
  const canon = new Map(all.map((p) => [p.key, p]));
  const review = dropped.map((p) => ({ key: p.key, name: p.name, why: `qm and our map differ by ${p.miles.toFixed(0)} miles` }));
  return { transform, canon, kept, dropped, review, unmatched: keys.filter((k) => !canon.has(k)) };
}

/** a waypoint (place key or [lat, lng]) -> { ll: [lon, lat], src, key?, name? } */
export function mapPoint(wp, qm, m) {
  if (Array.isArray(wp)) return { ll: m.transform(wp[1], wp[0]), src: 'bend' };
  const c = m.canon.get(wp);
  if (c) return { ll: [c.lon, c.lat], src: 'place', key: wp, name: c.name };
  const q = qm.locations[wp] ?? qm.locations[decodeURIComponent(wp)];
  if (!q) return { ll: null, src: 'missing', key: wp };
  return { ll: m.transform(q.lng, q.lat), src: 'adhoc', key: wp };
}

/**
 * A whole leg. Bends keep qm's shape but follow the legs' stops: where qm and our map disagree about a stop,
 * the stop's offset (canon minus the transform of its qm point) is blended along the bends between stops,
 * so the line still leaves and reaches the stops it is drawn between.
 */
export function mapLine(path, qm, m) {
  const pts = path.map((wp) => mapPoint(wp, qm, m));
  const qmAt = (wp) => {
    if (Array.isArray(wp)) return [wp[1], wp[0]];
    const q = qm.locations[wp] ?? qm.locations[decodeURIComponent(wp)];
    return q ? [q.lng, q.lat] : null;
  };
  const offset = pts.map((p, i) => {
    const q = p.src === 'place' ? qmAt(path[i]) : null;
    if (!q) return null;
    const t = m.transform(q[0], q[1]);
    return [p.ll[0] - t[0], p.ll[1] - t[1]];
  });
  const stops = offset.map((o, i) => (o ? i : -1)).filter((i) => i >= 0);
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + (pts[i].ll && pts[i - 1].ll ? miles(pts[i].ll, pts[i - 1].ll) : 0));
  pts.forEach((p, i) => {
    if (p.src !== 'bend' || !stops.length) return;
    const a = stops.filter((s) => s < i).pop();
    const b = stops.find((s) => s > i);
    const oa = a === undefined ? offset[b] : offset[a];
    const ob = b === undefined ? offset[a] : offset[b];
    const t = a === undefined || b === undefined ? 0 : (len[i] - len[a]) / Math.max(1e-9, len[b] - len[a]);
    p.ll = [p.ll[0] + (1 - t) * oa[0] + t * ob[0], p.ll[1] + (1 - t) * oa[1] + t * ob[1]];
  });
  return pts;
}

function run() {
  const qm = JSON.parse(fs.readFileSync('docs/sources/quartermaester/qm-paths.json', 'utf8'));
  const aliasFile = 'tools/characters/qm-aliases.json';
  const aliases = fs.existsSync(aliasFile) ? JSON.parse(fs.readFileSync(aliasFile, 'utf8')) : {};
  return import('../../src/world-data.ts').then(({ PLACES }) => {
    const m = buildMap(qm, PLACES, aliases);
    const mapped = {};
    const adhoc = new Set();
    for (const [name, segs] of Object.entries(qm.characters)) {
      mapped[name] = segs.map((s) => {
        const o = { kind: s.kind, chapters: s.chapters, episodes: s.episodes };
        if (s.kind === 'line') {
          o.color = s.color;
          o.pts = mapLine(s.path, qm, m);
        } else if (s.kind === 'arrow') {
          o.pts = [mapPoint(s.coord, qm, m)];
          o.heading = s.heading;
        } else {
          o.icon = s.icon;
          o.pts = [mapPoint(s.key ?? s.coord, qm, m)];
        }
        for (const p of o.pts) if (p.src === 'adhoc' || p.src === 'missing') adhoc.add(p.key);
        return o;
      });
    }
    const rms = Math.sqrt(m.kept.reduce((s, p) => s + miles(m.transform(p.x, qmLat(p)), [p.lon, p.lat]) ** 2, 0) / m.kept.length);
    fs.writeFileSync('docs/sources/quartermaester/qm-mapped.json', JSON.stringify({ review: m.review, adhoc: [...adhoc], characters: mapped }, null, 1));
    console.log(`matched ${m.canon.size}/${Object.keys(qm.locations).length}; anchors ${m.kept.length}; flagged ${m.dropped.length}; ad-hoc spots ${adhoc.size}; anchor error ${rms.toFixed(2)} miles`);
    console.log('flagged (qm vs ours differ):', m.review.map((r) => `${r.key} (${r.why.replace(/\D+/g, '')} mi)`).join(', '));
    console.log('ad-hoc (not on our map, placed by transform):', [...adhoc].join(', '));
  });
}
const qmLat = (p) => (Math.atan(Math.sinh((p.y * Math.PI) / 180)) * 180) / Math.PI;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
