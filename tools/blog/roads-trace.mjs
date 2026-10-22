// Traces the road network off the blog's master map into src/roads.json: { roads, named }, each [{ miles, pts: [[lon, lat], ...] }]:
// `roads` has one entry per stretch between junctions / ends (the network, drawn), `named` one line per road in
// roads-named.json (which carries the name on the globe). Roads are the map's only yellow pixels; thin them to one pixel,
// walk the skeleton, simplify, and place with the fit from roads-fit.mjs (blog px -> flat lon/lat -> globe lon/lat).
// Usage: node tools/blog/roads-trace.mjs   (run roads-fit.mjs first)
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { flatten, unflatten, METRES_PER_DEGREE, MILE } from '../../src/config.ts';
import { PLACES } from '../../src/world-data.ts';
import { IMAGE, FIT } from './roads-fit.mjs';
import { source } from './roads-sources.mjs';

const { fits, split } = JSON.parse(readFileSync(FIT, 'utf8'));
const { data, info } = await sharp(IMAGE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;

// road mask (the source says which pixels are road ink and which are off the map)
let on = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) on[i] = source.road(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) && !source.skip(i % W, (i / W) | 0) ? 1 : 0;
// The map draws a place's dot over its road, which cuts the ink for ~15 px: close such gaps (dilate, then erode, by a square
// of CLOSE px each side) before thinning, so the road stays one piece. Separable, so it is cheap.
const CLOSE = 7;
const slide = (src, horizontal, pick) => { // max (pick = 1) or min (pick = 0) over a window of 2*CLOSE+1 along one axis
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = pick ? 0 : 1;
    for (let k = -CLOSE; k <= CLOSE; k++) {
      const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k;
      const s = xx < 0 || yy < 0 || xx >= W || yy >= H ? (pick ? 0 : 1) : src[yy * W + xx];
      if (pick ? s : !s) { v = pick ? 1 : 0; break; }
    }
    out[y * W + x] = v;
  }
  return out;
};
on = slide(slide(slide(slide(on, true, 1), false, 1), true, 0), false, 0);
/** Globe lon/lat -> pixel of the source image, through its fit. */
const toPx = (lon, lat) => {
  const flat = flatten(lon, lat), f = flat < split ? fits.westeros : fits.east;
  return [f.p[0] * flat + f.p[1], f.p[2] * lat + f.p[3]];
};

// Zhang-Suen thinning
const N = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]; // P2..P9 clockwise from north
for (let changed = true; changed;) {
  changed = false;
  for (const pass of [0, 1]) {
    const kill = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!on[i]) continue;
      const p = N.map(([dx, dy]) => on[i + dy * W + dx]);
      const B = p.reduce((a, v) => a + v, 0);
      if (B < 2 || B > 6) continue;
      let A = 0;
      for (let k = 0; k < 8; k++) A += !p[k] && p[(k + 1) % 8] ? 1 : 0;
      if (A !== 1) continue;
      if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
      kill.push(i);
    }
    for (const i of kill) on[i] = 0;
    changed ||= kill.length > 0;
  }
}

// walk the skeleton: nodes are pixels with != 2 neighbours; an edge is the pixel chain between two nodes
const nb = (i) => N.map(([dx, dy]) => i + dy * W + dx).filter((j) => on[j]);
const isNode = (i) => nb(i).length !== 2;
const seen = new Set();
let edges = [];
const key = (a, b) => (a < b ? a * 1e8 + b : b * 1e8 + a);
for (let i = 0; i < W * H; i++) {
  if (!on[i] || !isNode(i)) continue;
  for (const first of nb(i)) {
    if (seen.has(key(i, first))) continue;
    const chain = [i]; let prev = i, cur = first; seen.add(key(i, first));
    for (;;) {
      chain.push(cur);
      if (isNode(cur)) break;
      const next = nb(cur).find((j) => j !== prev && !seen.has(key(cur, j))); // 2 neighbours: the one we did not come from
      if (next === undefined) break;
      seen.add(key(cur, next)); prev = cur; cur = next;
    }
    edges.push(chain.map((j) => [j % W, (j / W) | 0]));
  }
}

const lengthPx = (s) => s.reduce((n, p, i) => n + (i ? Math.hypot(p[0] - s[i - 1][0], p[1] - s[i - 1][1]) : 0), 0);
const nodeId = (p) => p[0] + p[1] * W;

// Thinning leaves a knot of nodes where lines meet (they draw as little triangles) and short stubs. Merge nodes within
// 6 px into one at their centre, drop the stubs between them, and drop spurs under 8 px that end in nothing.
{
  const pts = new Map(edges.flatMap((e) => [e[0], e.at(-1)]).map((p) => [nodeId(p), p])), ids = [...pts.keys()];
  const parent = new Map(ids.map((i) => [i, i])), find = (a) => { while (parent.get(a) !== a) a = parent.get(a); return a; };
  for (const a of ids) for (const b of ids) if (a < b && Math.max(Math.abs(pts.get(a)[0] - pts.get(b)[0]), Math.abs(pts.get(a)[1] - pts.get(b)[1])) <= 6) parent.set(find(a), find(b));
  const sum = new Map();
  for (const i of ids) { const r = find(i), s = sum.get(r) ?? [0, 0, 0]; s[0] += pts.get(i)[0]; s[1] += pts.get(i)[1]; s[2]++; sum.set(r, s); }
  const cluster = (p) => find(nodeId(p)), centre = (p) => { const s = sum.get(cluster(p)); return [Math.round(s[0] / s[2]), Math.round(s[1] / s[2])]; };
  const merged = [];
  for (const e of edges) {
    if (cluster(e[0]) === cluster(e.at(-1)) && lengthPx(e) < 12) continue;
    const m = [...e]; m[0] = centre(e[0]); m[m.length - 1] = centre(e.at(-1));
    merged.push(m);
  }
  const deg = new Map();
  for (const e of merged) for (const p of [e[0], e.at(-1)]) deg.set(nodeId(p), (deg.get(nodeId(p)) ?? 0) + 1);
  edges = merged.filter((e) => !(lengthPx(e) < 8 && (deg.get(nodeId(e[0])) === 1) !== (deg.get(nodeId(e.at(-1))) === 1)));
}

if (process.env.DBG === '7') writeFileSync(`${process.env.DBGDIR}/dbg.json`, JSON.stringify({ edges, bridges: [] })); // before the warp, to lay over the source image
// The two affine fits leave the map tens of px off our coasts in places; roads-fit.mjs matched windows of it to our coast.
// Move every road point by the distance-weighted mean shift of the nearest windows (Shepard), so roads sit where our land is.
{
  const { warp: windows } = JSON.parse(readFileSync(FIT, 'utf8'));
  const shift = ([x, y]) => {
    const near = windows.map((w) => ({ w, d: Math.hypot(w.x - x, w.y - y) })).sort((a, b) => a.d - b.d).slice(0, 6);
    let sw = 0, sx = 0, sy = 0;
    for (const { w, d } of near) { const k = 1 / (d * d + 2500); sw += k; sx += k * w.dx; sy += k * w.dy; }
    return [Math.round(x + sx / sw), Math.round(y + sy / sw)];
  };
  edges = edges.map((e) => e.map(shift));
}

// A road drawn twice between the same two nodes (parallel strands) is one road: keep the shortest, unless the others are a
// real detour. And a road that loops back to its own start is a knot, not a road.
{
  const key = (e) => { const a = nodeId(e[0]), b = nodeId(e.at(-1)); return a < b ? `${a}-${b}` : `${b}-${a}`; }, best = new Map();
  for (const e of edges) if (!best.has(key(e)) || lengthPx(e) < lengthPx(best.get(key(e)))) best.set(key(e), e);
  edges = edges.filter((e) => e === best.get(key(e)) || lengthPx(e) > 1.6 * lengthPx(best.get(key(e)))).filter((e) => nodeId(e[0]) !== nodeId(e.at(-1)));
}

// The map breaks its roads where it draws a place's dot or a road's name plate over them. Join a road's loose end to the
// nearest other piece of the network that lies ahead of it: within GAP px (~170 miles, a plate is ~60 px) and no more than
// 30 degrees off the way the road was heading (45 for a short hop). Another loose end must face back at it. The join is a
// straight edge; an end that meets the side of a road cuts it there. Nearest first, until none is left.
const par = new Map(), degree = new Map();
const root = (a) => { while (par.get(a) !== a) a = par.get(a); return a; };
const endDir = (e, atStart) => { // the way a road runs out of its end, as a unit vector
  const a = atStart ? e[0] : e.at(-1), b = atStart ? e[Math.min(12, e.length - 1)] : e[Math.max(e.length - 13, 0)], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  return [(a[0] - b[0]) / d, (a[1] - b[1]) / d];
};
const angle = (u, v) => (Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) * 180) / Math.PI;
const bridges = [];
// first loose ends facing each other (a dot or a plate between them), then loose ends running into the side of a road, near and then further off at a sharper angle
for (const [looseOnly, gap, turn] of [[true, 100, 50], [true, 60, 75], [false, 40, 30], [false, 60, 60]]) for (;;) {
  par.clear(); degree.clear();
  for (const e of edges) for (const p of [e[0], e.at(-1)]) { par.set(nodeId(p), nodeId(p)); degree.set(nodeId(p), (degree.get(nodeId(p)) ?? 0) + 1); }
  for (const e of edges) par.set(root(nodeId(e[0])), root(nodeId(e.at(-1))));
  const dirs = new Map(); // loose ends: node -> outward direction
  for (const e of edges) for (const [p, s] of [[e[0], true], [e.at(-1), false]]) if (degree.get(nodeId(p)) === 1) dirs.set(nodeId(p), endDir(e, s));
  let best = null;
  for (const [id, dir] of dirs) {
    const ax = id % W, ay = (id / W) | 0, ra = root(id);
    edges.forEach((e, k) => e.forEach((q, i) => {
      if (nodeId(e[0]) === id || nodeId(e.at(-1)) === id) return; // (two loose ends facing each other are a gap whatever else joins them)
      const dx = q[0] - ax, dy = q[1] - ay, d = Math.hypot(dx, dy);
      if (d > gap || d < 1) return;
      const a = angle(dir, [dx / d, dy / d]);
      if (a > (d < 20 ? 45 : turn)) return;
      const end = i === 0 || i === e.length - 1, qd = end && degree.get(nodeId(q)) === 1 ? dirs.get(nodeId(q)) : null;
      if (looseOnly && !qd) return;
      if (qd && angle(qd, [-dx / d, -dy / d]) > 65) return; // the other loose end must face this way
      const score = d * (1 + a / 45);
      if (!best || score < best.score) best = { score, id, k, i, q, d };
    }));
  }
  if (!best) break;
  const e = edges[best.k], q = best.q;
  if (best.i > 0 && best.i < e.length - 1) edges.splice(best.k, 1, e.slice(0, best.i + 1), e.slice(best.i)); // meets a road's side: cut it there
  edges.push([[best.id % W, (best.id / W) | 0], [q[0], q[1]]]);
  bridges.push(best);
}
console.log(`${bridges.length} gaps bridged`);

// Strands that run side by side between the same places are spaghetti, and a small ring is a knot: a short road that has a
// way round of about its own length (<= 1.4x), or that closes a ring under 150 px round, is dropped, longest first. (Bigger
// rings, a real circuit of roads, stay.)
{
  const dead = new Set(), len = edges.map(lengthPx);
  const reach = (from, to, skip, cap) => { // is `to` within `cap` px of `from` without edge `skip`? (Dijkstra, bounded)
    const dist = new Map([[from, 0]]), todo = [from];
    while (todo.length) {
      todo.sort((a, b) => dist.get(b) - dist.get(a));
      const u = todo.pop();
      if (u === to) return true;
      for (let k = 0; k < edges.length; k++) {
        if (k === skip || dead.has(k)) continue;
        const a = nodeId(edges[k][0]), b = nodeId(edges[k].at(-1)), v = a === u ? b : b === u ? a : null;
        if (v === null) continue;
        const d = dist.get(u) + len[k];
        if (d <= cap && d < (dist.get(v) ?? Infinity)) { dist.set(v, d); todo.push(v); }
      }
    }
    return false;
  };
  for (const k of edges.map((_, i) => i).filter((i) => len[i] <= 100).sort((i, j) => len[j] - len[i])) {
    if (reach(nodeId(edges[k][0]), nodeId(edges[k].at(-1)), k, Math.max(len[k] * 1.4, 150 - len[k]))) dead.add(k);
  }
  edges = edges.filter((_, k) => !dead.has(k));
  console.log(`${dead.size} parallel strands dropped`);
}
if (process.env.DBG === '6') writeFileSync(`${process.env.DBGDIR}/dbg.json`, JSON.stringify({ edges, bridges: bridges.map((b) => [b.id % W, (b.id / W) | 0, b.q[0], b.q[1]]) }));
if (process.env.DBG === '3') { // the separate pieces of the network, biggest first
  const comp = new Map(), f = (a) => { while (comp.get(a) !== a) a = comp.get(a); return a; };
  for (const e of edges) for (const p of [e[0], e.at(-1)]) if (!comp.has(nodeId(p))) comp.set(nodeId(p), nodeId(p));
  for (const e of edges) comp.set(f(nodeId(e[0])), f(nodeId(e.at(-1))));
  const g = new Map();
  for (const e of edges) { const c = f(nodeId(e[0])), s = g.get(c) ?? { px: 0, n: 0, b: [1e9, 0, 1e9, 0] }; s.px += lengthPx(e); s.n++; for (const [x, y] of e) { s.b = [Math.min(s.b[0], x), Math.max(s.b[1], x), Math.min(s.b[2], y), Math.max(s.b[3], y)]; } g.set(c, s); }
  for (const s of [...g.values()].sort((a, b) => b.px - a.px).slice(0, 25)) console.log(Math.round(s.px), 'px', s.n, 'edges', 'x', s.b[0], s.b[1], 'y', s.b[2], s.b[3]);
}

const dp = (pts, tol) => { // Douglas-Peucker
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts.at(-1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let m = 0, k = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[1] - a[1]) * pts[i][0] - (b[0] - a[0]) * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / L;
    if (d > m) { m = d; k = i; }
  }
  return m > tol ? [...dp(pts.slice(0, k + 1), tol).slice(0, -1), ...dp(pts.slice(k), tol)] : [a, b];
};
const MILES_PER_DEG = METRES_PER_DEGREE / MILE;
const toGlobe = ([x, y]) => {
  let f = fits.westeros, flat = (x - f.p[1]) / f.p[0];
  if (flat >= split) { f = fits.east; flat = (x - f.p[1]) / f.p[0]; }
  const lat = (y - f.p[3]) / f.p[2];
  return [+unflatten(flat, lat).toFixed(3), +lat.toFixed(3)];
};
const pxMiles = MILES_PER_DEG / -fits.east.p[2]; // the map is drawn at one scale: miles per pixel
/** Chaikin corner cutting: rounds the traced pixel steps into curves (the ends stay). */
const chaikin = (pts, rounds) => {
  for (let k = 0; k < rounds; k++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    out.push(pts.at(-1));
    pts = out;
  }
  return pts;
};
const densify = (pts, step) => pts.flatMap((a, i) => {
  if (!i) return [a];
  const b = pts[i - 1], n = Math.max(1, Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1]) / step));
  return Array.from({ length: n }, (_, k) => [b[0] + ((a[0] - b[0]) * (k + 1)) / n, b[1] + ((a[1] - b[1]) * (k + 1)) / n]);
});

// Our land, rasterised, so a road that the painted map puts in the sea (its coasts differ from ours) is moved to the nearest
// ground at least a cell inland. Globe lon/lat, 0.02 degrees (~2.3 km) a cell; lakes are not ground.
const RES = 0.02, LON0 = -56, LAT1 = 76, GW = Math.round(168 / RES), GH = Math.round(80 / RES);
const ring = (r) => 'M' + r.map(([lon, lat]) => `${((lon - LON0) / RES).toFixed(1)} ${((LAT1 - lat) / RES).toFixed(1)}`).join('L') + 'Z';
const world = JSON.parse(readFileSync('src/vector-world.json', 'utf8'));
const ground = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${GW}" height="${GH}"><rect width="100%" height="100%" fill="#000"/>
  <path d="${world.land.map(ring).join('')}" fill="#fff" fill-rule="evenodd"/><path d="${world.lakes.flatMap((l) => l.rings.map(ring)).join('')}" fill="#000" fill-rule="evenodd"/></svg>`))
  .greyscale().raw().toBuffer();
const isLand = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && ground[y * GW + x] > 127;
const isCore = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isLand(x + dx, y + dy)) return false; return true; };
const onGround = ([lon, lat]) => {
  const cx = Math.floor((lon - LON0) / RES), cy = Math.floor((LAT1 - lat) / RES);
  if (isLand(cx, cy)) return [lon, lat];
  for (let r = 1; r <= 100; r++) { // rings of cells outwards: the nearest inland cell
    let best = null;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !isCore(cx + dx, cy + dy)) continue;
      const d = dx * dx + dy * dy;
      if (!best || d < best.d) best = { d, x: cx + dx, y: cy + dy };
    }
    if (best) return [+(LON0 + (best.x + 0.5) * RES).toFixed(3), +(LAT1 - (best.y + 0.5) * RES).toFixed(3)];
  }
  return [lon, lat];
};
const cellOf = ([lon, lat]) => [Math.floor((lon - LON0) / RES), Math.floor((LAT1 - lat) / RES)];
/** Does the straight line a-b leave our land? (checked every ~1 km) */
const wet = (a, b) => {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01));
  for (let k = 0; k <= n; k++) if (!isLand(...cellOf([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]))) return true;
  return false;
};
/**
 * Where the painted road runs well off our coast, neighbouring samples land far apart on the shore, and a straight line
 * between them would cut across a bay: the way between them over inland cells instead (A*), without its ends. If there is
 * none (a strait between two lands) the straight line stays.
 */
const overLand = (a, b) => {
  const [ax, ay] = cellOf(a), [bx, by] = cellOf(b), PAD = 40;
  const x0 = Math.min(ax, bx) - PAD, y0 = Math.min(ay, by) - PAD, w = Math.abs(ax - bx) + 2 * PAD + 1, h = Math.abs(ay - by) + 2 * PAD + 1;
  const cost = new Float64Array(w * h).fill(Infinity), from = new Int32Array(w * h).fill(-1), open = [[0, ax - x0 + (ay - y0) * w]];
  const heur = (i) => Math.hypot((i % w) + x0 - bx, ((i / w) | 0) + y0 - by);
  cost[ax - x0 + (ay - y0) * w] = 0;
  const goal = bx - x0 + (by - y0) * w;
  while (open.length) { // a binary heap on [priority, cell]
    let top = open[0]; const last = open.pop();
    if (open.length) { open[0] = last; for (let i = 0; ;) { let m = i; for (const c of [2 * i + 1, 2 * i + 2]) if (c < open.length && open[c][0] < open[m][0]) m = c; if (m === i) break; [open[i], open[m]] = [open[m], open[i]]; i = m; } }
    const u = top[1];
    if (u === goal) break;
    if (top[0] - heur(u) > cost[u] + 1e-9) continue; // stale entry
    const ux = u % w, uy = (u / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const vx = ux + dx, vy = uy + dy;
      if ((!dx && !dy) || vx < 0 || vy < 0 || vx >= w || vy >= h || !(isCore(vx + x0, vy + y0) || vx + vy * w === goal)) continue;
      const v = vx + vy * w, c = cost[u] + Math.hypot(dx, dy);
      if (c >= cost[v]) continue;
      cost[v] = c; from[v] = u;
      open.push([c + heur(v), v]);
      for (let i = open.length - 1; i > 0;) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; }
    }
  }
  if (from[goal] < 0) return [];
  const out = [];
  for (let u = from[goal]; u >= 0 && u !== ax - x0 + (ay - y0) * w; u = from[u]) out.unshift([+(LON0 + (u % w + x0 + 0.5) * RES).toFixed(3), +(LAT1 - (((u / w) | 0) + y0 + 0.5) * RES).toFixed(3)]);
  return out;
};
/** Where segments a-b and c-d cross: the point, or null. */
const crossing = (a, b, c, d) => {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (!den) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
};
/** A road does not cross itself: where it does, the loop between the crossings is cut out (no circles, no knots). */
const unknot = (pts) => {
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < pts.length - 1 && !again; i++) for (let j = i + 2; j < pts.length - 1; j++) {
      const x = crossing(pts[i], pts[i + 1], pts[j], pts[j + 1]);
      if (x) { pts = [...pts.slice(0, i + 1), x, ...pts.slice(j + 1)]; again = true; break; }
    }
  }
  return pts;
};
/** A road does not hook back on itself either: a bulb (the line leaves a point, wanders 0.1+ degrees, and comes back within a fifth of that) is cut off. */
const cutBulbs = (pts) => {
  for (let i = 0; i < pts.length - 3; i++) {
    let run = 0;
    for (let j = i + 1; j < pts.length && run < 1.5; j++) {
      run += Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
      if (j > i + 2 && run > 0.1 && Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]) < run / 5) { pts = [...pts.slice(0, i + 1), ...pts.slice(j)]; i--; break; }
    }
  }
  return pts;
};
/** A road as a smooth line on the ground: simplified, curved, dense enough to follow the clamp, then kept on land. */
const line = (px) => {
  const s = densify(chaikin(dp(px, 1), 3), 0.5), pts = [];
  for (const p of s.map(toGlobe).map(onGround)) {
    if (pts.length && p[0] === pts.at(-1)[0] && p[1] === pts.at(-1)[1]) continue;
    if (pts.length && wet(pts.at(-1), p)) pts.push(...overLand(pts.at(-1), p));
    pts.push(p);
  }
  // sampled every ~2 km so the clamp follows the coast; thinned again to what a 0.7 km tolerance keeps
  // and rounded once more, since the inland path steps from cell to cell (it was a cell clear of the sea, which the rounding eats into)
  const out = cutBulbs(unknot(chaikin(cutBulbs(unknot(dp(pts, 0.006))), 2))).map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]);
  return { miles: +(lengthPx(s) * pxMiles).toFixed(1), pts: out };
};

// Named roads (roads-named.json): the shortest way along the network through each road's places, as one line, so the name
// can ride on it like a river's. Each place is snapped to the nearest point of the network, which becomes a junction there
// (the edge is split), so a road can start at a castle it only passes.
const SNAP_PX = 45; // ~105 miles: a place the painted road passes by, or a city its road stops short of
const spec = JSON.parse(readFileSync('tools/blog/roads-named.json', 'utf8'));
const cut = new Map(); // place -> pixel of the network nearest it
for (const name of new Set(spec.flatMap((r) => r.via))) {
  const p = PLACES.find((q) => q[0] === name && q[1] !== 'road');
  if (!p) throw new Error(`no place "${name}"`);
  const [x, y] = toPx(p[3], p[2]);
  let best = [null, Infinity];
  for (const e of edges) for (const [qx, qy] of e) { const d = Math.hypot(qx - x, qy - y); if (d < best[1]) best = [qx + qy * W, d]; }
  if (best[1] > SNAP_PX) throw new Error(`"${name}" is ${Math.round(best[1])} px from any road`);
  cut.set(name, best[0]);
}
const at = new Set(cut.values());
for (let k = 0; k < edges.length; k++) { // split edges at the cut pixels
  const e = edges[k], i = e.findIndex((p, j) => j > 0 && j < e.length - 1 && at.has(p[0] + p[1] * W));
  if (i > 0) edges.splice(k, 1, e.slice(0, i + 1), e.slice(i)), k--;
}
const roads = edges.map(line); // short edges stay: they join the pixels of one junction
const adj = new Map();
edges.forEach((e, k) => {
  const a = e[0][0] + e[0][1] * W, b = e.at(-1)[0] + e.at(-1)[1] * W, w = lengthPx(e);
  for (const [u, v] of [[a, b], [b, a]]) (adj.get(u) ?? adj.set(u, []).get(u)).push({ v, w, k, rev: u === b });
});
const route = (from, to) => { // Dijkstra over junctions; the edges walked, in order
  const dist = new Map([[from, 0]]), via = new Map(), todo = new Set([from]);
  while (todo.size) {
    let u = null;
    for (const n of todo) if (u === null || dist.get(n) < dist.get(u)) u = n;
    todo.delete(u);
    if (u === to) break;
    for (const a of adj.get(u)) if (dist.get(u) + a.w < (dist.get(a.v) ?? Infinity)) { dist.set(a.v, dist.get(u) + a.w); via.set(a.v, { u, a }); todo.add(a.v); }
  }
  if (!via.has(to) && from !== to) throw new Error('not connected');
  const walk = [];
  for (let n = to; n !== from; n = via.get(n).u) walk.unshift(via.get(n).a);
  return walk;
};
const named = spec.flatMap(({ name, via, blog }) => {
  const px = [], nodes = via.map((v) => cut.get(v));
  for (let i = 1; i < nodes.length; i++) {
    let walk;
    try { walk = route(nodes[i - 1], nodes[i]); } catch { console.warn(`${name}: no road from ${via[i - 1]} to ${via[i]}, left out`); return []; }
    for (const a of walk) px.push(...(a.rev ? [...edges[a.k]].reverse() : edges[a.k]));
    if (process.env.DBG === '5') {
      console.log(`  ${name}: ${via[i - 1]} -> ${via[i]} ${Math.round(walk.reduce((n, a) => n + a.w, 0) * pxMiles)} mi over ${walk.length} stretches`);
      for (const a of walk) console.log('    ', Math.round(a.w * pxMiles), 'mi', edges[a.k][0].join(','), '->', edges[a.k].at(-1).join(','), a.rev ? 'rev' : '');
    }
  }
  const r = line(px.filter((p, i) => !i || p[0] !== px[i - 1][0] || p[1] !== px[i - 1][1]));
  console.log(`${name}: ${Math.round(r.miles)} mi${blog ? ` (blog ${blog})` : ''}, midpoint ${r.pts[r.pts.length >> 1]}`);
  return [{ name, ...r }];
});

if (process.env.DBG === '8') { // loose ends and bridges, for roads-overlay.mjs
  const deg = new Map();
  for (const e of edges) for (const p of [e[0], e.at(-1)]) deg.set(nodeId(p), (deg.get(nodeId(p)) ?? 0) + 1);
  writeFileSync(`${process.env.DBGDIR}/ends.json`, JSON.stringify({ ends: [...deg].filter(([, d]) => d === 1).map(([id]) => toGlobe([id % W, (id / W) | 0])), bridges: bridges.map((b) => [toGlobe([b.id % W, (b.id / W) | 0]), toGlobe(b.q)]) }));
}

// Medieval roads pass near places, they do not run through them. A place gets a minor road to the nearest point of the main
// roads when that is near enough for its size (and not already on it), over land. A road that ends close to a place ends at
// it this way too.
const REACH_MI = { capital: 110, city: 110, town: 70, castle: 55, ruin: 55, minor: 30 };
const segs = roads.flatMap((r) => r.pts.slice(1).map((p, i) => [r.pts[i], p]));
const minor = [];
for (const p of PLACES) {
  const reach = REACH_MI[p[1]], at = [p[3], p[2]], k = Math.cos((p[2] * Math.PI) / 180);
  if (!reach) continue;
  let best = { mi: Infinity, q: null };
  for (const [a, b] of segs) {
    const dx = (b[0] - a[0]) * k, dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, (((at[0] - a[0]) * k) * dx + (at[1] - a[1]) * dy) / len2)) : 0;
    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], mi = Math.hypot((q[0] - at[0]) * k, q[1] - at[1]) * MILES_PER_DEG;
    if (mi < best.mi) best = { mi, q };
  }
  if (best.mi > reach || best.mi < 1.5) continue;
  const q = best.q, near = [at[0] + (q[0] - at[0]) * 0.15, at[1] + (q[1] - at[1]) * 0.15];
  if (wet(near, q)) continue; // it would cross water
  // a gentle bend, to one side or the other by the name, so a minor road is a track and not a ruler line
  const side = [...p[0]].reduce((n, c) => n + c.charCodeAt(0), 0) % 2 ? 1 : -1, mid = [(at[0] + q[0]) / 2 - (q[1] - at[1]) * 0.12 * side / k, (at[1] + q[1]) / 2 + (q[0] - at[0]) * 0.12 * side * k];
  minor.push({ name: p[0], miles: +best.mi.toFixed(1), pts: chaikin([at, mid, q], 2).map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]) });
}
console.log(`${minor.length} minor roads to places`);
writeFileSync('src/roads.json', JSON.stringify({ roads, minor, named }));
// check: samples along the finished lines (every ~1 km) that are not on land
let offLand = 0, all = 0;
for (const r of roads) for (const [a, b] of r.pts.slice(1).map((p, i) => [r.pts[i], p])) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01));
  let here = 0;
  for (let k = 0; k <= n; k++, all++) here += isLand(Math.floor((a[0] + ((b[0] - a[0]) * k) / n - LON0) / RES), Math.floor((LAT1 - (a[1] + ((b[1] - a[1]) * k) / n)) / RES)) ? 0 : 1;
  if (here && process.env.DBG) console.log('wet segment', a, b, here, 'of', n + 1);
  offLand += here;
}
console.log(`${offLand} of ${all} samples along the roads are off land`);
console.log(`${roads.length} road stretches, ${roads.reduce((n, r) => n + r.miles, 0)} miles, ${pxMiles.toFixed(3)} mi/px`);