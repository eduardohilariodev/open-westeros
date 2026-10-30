// House territories, traced from the reference house map (assets/world/houses/poster.png, local only; decision 0005).
// ASSUMPTION (canon gives no borders between houses, only seats and who holds of whom): the poster's borders are the visual
// spec. Seats stay where the lore put them (src/houses.json, src/world-data.ts); the poster is warped onto them, never the reverse.
// Method: rasterise land and regions; warp the poster onto our grid (coast fit plus a thin-plate spline pinning each seat onto
// its house's label in the poster: tools/world/house-poster.json); flood from all seats at once, a step costing more where the
// poster's colour changes, within the seat's region; then trace the cell edges into house outlines (fills) and shared border
// lines (one line per pair of neighbours, drawn once).
// Writes src/house-territories.json: { cell, houses: { id: [ring...] }, borders: [[a, b, [[lon, lat]...]]] }, [lon, lat].
// Usage: node tools/world/house-territories.mjs (the coast fit: node tools/world/house-poster-fit.mjs)
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { wallLine } from '../../src/globe/wallLine.ts';
import { METRES_PER_DEGREE, MILE } from '../../src/config.ts';

const S = 0.05; // cell size, degrees
const EDGE = 25; // extra cost of a step across a full colour change in the poster, in cells

// Thin-plate spline through [u, v, dx, dy] points (lambda smooths); returns (u, v) -> [dx, dy].
export function solveTps(pts, lambda) {
  const n = pts.length, m = n + 3, U = (r) => (r > 0 ? r * r * Math.log(r) : 0);
  const A = Array.from({ length: m }, () => new Float64Array(m + 2));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = U(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])) + (i === j ? lambda : 0);
    A[i][n] = A[n][i] = 1; A[i][n + 1] = A[n + 1][i] = pts[i][0]; A[i][n + 2] = A[n + 2][i] = pts[i][1];
    A[i][m] = pts[i][2]; A[i][m + 1] = pts[i][3];
  }
  for (let c = 0; c < m; c++) { // Gauss-Jordan, partial pivoting, two right-hand sides
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < m; r++) if (r !== c && A[r][c]) { const f = A[r][c] / A[c][c]; for (let k = c; k < m + 2; k++) A[r][k] -= f * A[c][k]; }
  }
  const wx = A.map((r, i) => r[m] / r[i]), wy = A.map((r, i) => r[m + 1] / r[i]);
  return (u, v) => {
    let x = wx[n] + wx[n + 1] * u + wx[n + 2] * v, y = wy[n] + wy[n + 1] * u + wy[n + 2] * v;
    for (let i = 0; i < n; i++) { const k = U(Math.hypot(u - pts[i][0], v - pts[i][1])); x += wx[i] * k; y += wy[i] * k; }
    return [x, y];
  };
}

class MinHeap { // of [cost, cell, seed]
  a = [];
  get size() { return this.a.length; }
  push(...e) {
    const a = this.a; let i = a.push(e) - 1;
    while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < a.length && a[l][0] < a[s][0]) s = l; if (r < a.length && a[r][0] < a[s][0]) s = r; if (s === i) break; [a[s], a[i]] = [a[i], a[s]]; i = s; }
    }
    return top;
  }
}

export function rasterise(rings, W, H, lon0, lat0, out, value) {
  // even-odd fill of one polygon (its rings together) into out
  const spans = Array.from({ length: H }, () => []);
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi === yj) continue;
    const a = (Math.min(yi, yj) - lat0) / S - 0.5, b = (Math.max(yi, yj) - lat0) / S - 0.5;
    for (let y = Math.max(0, Math.ceil(a)); y <= Math.min(H - 1, Math.floor(b)); y++) {
      const lat = lat0 + (y + 0.5) * S;
      if (lat < Math.min(yi, yj) || lat >= Math.max(yi, yj)) continue;
      spans[y].push(xi + ((lat - yi) * (xj - xi)) / (yj - yi));
    }
  }
  spans.forEach((xs, y) => {
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil((xs[k] - lon0) / S - 0.5)); x <= Math.min(W - 1, Math.floor((xs[k + 1] - lon0) / S - 0.5)); x++) out[y * W + x] = value;
    }
  });
}

const key = (x, y, W1) => y * W1 + x;
function dp(pts, tol, closed) {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1, wi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > tol) { keep[wi] = true; stack.push([a, wi], [wi, b]); }
  }
  const out = pts.filter((_, i) => keep[i]);
  return closed && out.length < 4 ? pts : out;
}
function chaikin(pts, closed, n = 2) {
  for (let r = 0; r < n; r++) {
    const out = [];
    const m = pts.length;
    if (!closed) out.push(pts[0]);
    for (let i = 0; i < (closed ? m : m - 1); i++) {
      const p = pts[i], q = pts[(i + 1) % m];
      out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    if (!closed) out.push(pts[m - 1]);
    pts = out;
  }
  return pts;
}
const round = (pts) => pts.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);

if (process.argv[1]?.endsWith('house-territories.mjs')) {
  const houses = JSON.parse(readFileSync('src/houses.json', 'utf8'));
  const world = JSON.parse(readFileSync('src/vector-world.json', 'utf8'));
  const P = JSON.parse(readFileSync('tools/world/house-poster.json', 'utf8'));
  const src = readFileSync('src/world-data.ts', 'utf8');
  const PLACES = eval(src.slice(src.indexOf('= [[') + 2).replace(/\]\];[\s\S]*/, ']]'));
  const at = Object.fromEntries(PLACES.map(([n, , lat, lon]) => [n, [lat, lon]]));

  const lon0 = -54, lat0 = 22, W = Math.ceil((4 - lon0) / S), H = Math.ceil((74.5 - lat0) / S);
  const land = new Uint8Array(W * H);
  for (const ring of world.land) rasterise([ring], W, H, lon0, lat0, land, 1);
  for (const ring of world.lakes ?? []) rasterise([ring], W, H, lon0, lat0, land, 0);
  const region = new Int16Array(W * H); // 0 none, else index + 1
  world.regions.forEach((r, i) => rasterise(r.polygons, W, H, lon0, lat0, region, i + 1));

  // Seeds: the primary houses (a house sharing a seat draws no territory of its own) whose seat is on the map.
  const primaries = houses.filter((h) => !h.seatOf && at[h.seat]);
  const cellAt = (lat, lon) => [Math.floor((lon - lon0) / S), Math.floor((lat - lat0) / S)];
  const seeds = primaries.map((h) => {
    const [lat, lon] = at[h.seat], [cx, cy] = cellAt(lat, lon);
    // a seat drawn just off the land (Ryamsport on the Arbor) floods from the nearest land cell, in that cell's region
    let start = cy * W + cx;
    for (let r = 1; !land[start] && r <= 10; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (land[start] === 0 && land[(cy + dy) * W + cx + dx]) start = (cy + dy) * W + cx + dx;
    return { id: h.id, lat, lon, cx, cy, start, reg: region[start] };
  });
  const byRegion = new Map();
  seeds.forEach((s, i) => { if (!byRegion.has(s.reg)) byRegion.set(s.reg, []); byRegion.get(s.reg).push(i); });

  // The poster: lon/lat -> poster pixel is the coast fit (polynomial) plus a thin-plate spline that pins each anchored seat
  // onto its house's label in the poster and keeps the coast where the fit put it.
  const { data: px, info } = await sharp(P.poster).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const base = (lon, lat) => {
    const u = (lon - P.LON0) / P.SC, v = (lat - P.LAT0) / P.SC, b = [1, u, v, u * u, u * v, v * v, u ** 3, u * u * v, u * v * v, v ** 3];
    let x = 0, y = 0;
    P.cx.forEach((c, i) => { x += c * b[i]; y += P.cy[i] * b[i]; });
    return [x, y];
  };
  const K = 0.75; // longitude squeeze at Westeros' middle latitude, so the spline works in near-isotropic units
  const ctrl = []; // [u, v, dx, dy]
  for (const s of seeds) if (P.anchors[s.id]) { const [bx, by] = base(s.lon, s.lat); ctrl.push([s.lon * K, s.lat, P.anchors[s.id][0] - bx, P.anchors[s.id][1] - by]); }
  const pinned = ctrl.slice();
  const bins = new Set();
  for (const ring of world.land) for (const [lon, lat] of ring) {
    if (lat < 22 || lat > 62 || lon < -30 || lon > 3) continue;
    const b = `${Math.round(lon * 2)},${Math.round(lat * 2)}`; // one coast point per half degree
    if (bins.has(b) || pinned.some(([u, v]) => Math.hypot(u - lon * K, v - lat) < 0.75)) continue;
    bins.add(b); ctrl.push([lon * K, lat, 0, 0]);
  }
  const tps = solveTps(ctrl, 0.01);
  // the spline on a 0.2-degree lattice over Westeros, read bilinearly (every cell against every control point is minutes)
  const G = 0.2, glon0 = -32, glat0 = 21, GW = 190, GH = 230, gd = new Float64Array(GW * GH * 2);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) gd.set(tps((glon0 + i * G) * K, glat0 + j * G), (j * GW + i) * 2);
  const posterAt = (lon, lat) => {
    const [bx, by] = base(lon, lat), fi = (lon - glon0) / G, fj = (lat - glat0) / G;
    const i = Math.max(0, Math.min(GW - 2, Math.floor(fi))), j = Math.max(0, Math.min(GH - 2, Math.floor(fj))), a = fi - i, b = fj - j;
    const g = (ii, jj, k) => gd[(jj * GW + ii) * 2 + k], f = (k) => (1 - b) * ((1 - a) * g(i, j, k) + a * g(i + 1, j, k)) + b * ((1 - a) * g(i, j + 1, k) + a * g(i + 1, j + 1, k));
    return [bx + f(0), by + f(1)];
  };
  console.log(`${pinned.length} anchored seats, ${ctrl.length - pinned.length} coast pins`);

  // Each land cell takes the poster's fill colour under it (per-channel median of a 7x7 pixel block, which drops the line art).
  const col = new Uint8Array(W * H * 3), seen = new Uint8Array(W * H), blk = [[], [], []];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x;
    const lon = lon0 + (x + 0.5) * S, lat = lat0 + (y + 0.5) * S;
    if (!land[c] || lon < glon0 || lat > glat0 + GH * G) continue;
    const [X, Y] = posterAt(lon, lat);
    if (X < 3 || Y < 3 || X >= info.width - 3 || Y >= info.height - 3) continue;
    blk.forEach((a) => (a.length = 0));
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const i = ((Math.round(Y) + dy) * info.width + Math.round(X) + dx) * 3; for (let ch = 0; ch < 3; ch++) blk[ch].push(px[i + ch]); }
    for (let ch = 0; ch < 3; ch++) col[c * 3 + ch] = blk[ch].sort((p, q) => p - q)[24];
    seen[c] = 1;
  }
  // The Gift belongs to the Night's Watch, no house: "double the size of their lands, to fifty leagues" (ASOS, Bran), 150 miles
  // south of the Wall. Colour cannot tell it apart (its parchment medians match pale territories such as Woolfield).
  const wall = wallLine(), giftDeg = (150 * MILE) / METRES_PER_DEGREE;
  const inGift = (lon, lat) => {
    const k = Math.cos((lat * Math.PI) / 180);
    let d = Infinity;
    for (let i = 1; i < wall.length; i++) {
      const [ax, ay] = wall[i - 1], [bx, by] = wall[i], ux = (bx - ax) * k, uy = by - ay, px = (lon - ax) * k, py = lat - ay;
      const t = Math.max(0, Math.min(1, (px * ux + py * uy) / (ux * ux + uy * uy)));
      d = Math.min(d, Math.hypot(px - t * ux, py - t * uy));
    }
    return d < giftDeg;
  };
  const wallSouth = Math.min(...wall.map(([, lat]) => lat)) - giftDeg - 0.1;
  const gift = new Uint8Array(W * H);
  const north = world.regions.findIndex((r) => r.name === 'The North') + 1; // the mainland: Skagos, off every region, is no Gift
  for (let y = 0; y < H; y++) { const lat = lat0 + (y + 0.5) * S; if (lat > wallSouth) for (let x = 0; x < W; x++) if (region[y * W + x] === north && inGift(lon0 + (x + 0.5) * S, lat)) gift[y * W + x] = 1; }

  // Flood from every seat at once (Dijkstra); a step costs more the more the poster's colour changes, so borders settle on
  // the poster's borders, and a territory whose house we lack goes to the neighbour that reaches it cheapest.
  const label = new Int16Array(W * H); // 0 none, else seed index + 1
  const best = new Float64Array(W * H).fill(Infinity);
  const heap = new MinHeap();
  seeds.forEach((s, i) => { const c = s.start; if (best[c] > 0) { best[c] = 0; label[c] = i + 1; heap.push(0, c, i); } });
  const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.size) {
    const [d, c, i] = heap.pop();
    if (d > best[c] || label[c] !== i + 1) continue;
    const x = c % W, y = (c - x) / W, s = seeds[i];
    for (const [dx, dy, len] of STEPS) {
      const nx = x + dx, ny = y + dy, n = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !land[n] || region[n] !== s.reg) continue;
      if (gift[n]) continue;
      let step = len;
      if (seen[n] && seen[c]) {
        const e = Math.hypot(col[n * 3] - col[c * 3], col[n * 3 + 1] - col[c * 3 + 1], col[n * 3 + 2] - col[c * 3 + 2]);
        step *= 1 + EDGE * Math.min(1, Math.max(0, (e - 18) / 40));
      }
      const nd = d + step;
      if (!s.reg && nd > 50) continue; // off every region (an island chain): not far from the seat
      if (nd < best[n]) { best[n] = nd; label[n] = i + 1; heap.push(nd, n, i); }
    }
  }
  for (const [i, s] of seeds.entries()) label[s.cy * W + s.cx] = i + 1; // a seat is always in its own territory
  // A seat with next to no land of its own (an islet such as Serry or Pryor, or a small house a great lord swallows, Stout) gets a small round holding, up to ISLE
  // degrees around the seat over other houses' cells too (not their seats), so it has a shape to draw and click. ASSUMPTION: about 22 miles across.
  const ISLE = 0.15, counts = new Int32Array(seeds.length + 1), seedCell = new Set(seeds.flatMap((s) => [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => (s.cy + dy) * W + s.cx + dx)))); // each seat and its eight neighbours stay as they are
  for (const l of label) counts[l]++;
  seeds.forEach((s, i) => {
    if (counts[i + 1] >= 40 && land[s.cy * W + s.cx]) return; // plenty of land, and the seat on it
    const r = Math.ceil(ISLE / S), k = Math.cos((s.lat * Math.PI) / 180);
    // never closer than the bisector to the nearest other seat, or a swallowed house would take its lord's own seat
    const near = Math.min(...seeds.filter((o) => o !== s).map((o) => Math.hypot((o.lon - s.lon) * k, o.lat - s.lat)));
    const reach = Math.max(0.1, Math.min(ISLE, 0.45 * near)); // at least two cells: Royce and Stout sit four miles from their lords
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = s.cx + dx, y = s.cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || (seedCell.has(y * W + x) && label[y * W + x] !== 0 && label[y * W + x] !== i + 1 && !(dx === 0 && dy === 0))) continue;
      if (Math.hypot(dx * S * k, dy * S) <= reach) label[y * W + x] = i + 1;
    }
  });

  // Edges between cells of different labels.
  const W1 = W + 1;
  const directed = new Map(); // label -> Map(startVertex -> [endVertex...])
  const pairs = new Map(); // "a|b" -> [[v0, v1]...]
  const addDir = (l, v0, v1) => {
    if (!l) return;
    if (!directed.has(l)) directed.set(l, new Map());
    const m = directed.get(l);
    if (!m.has(v0)) m.set(v0, []);
    m.get(v0).push(v1);
  };
  const addPair = (a, b, v0, v1) => {
    if (!a || !b) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push([v0, v1]);
  };
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const a = label[y * W + x], r = label[y * W + x + 1], t = label[(y + 1) * W + x];
    if (a !== r) { const v0 = key(x + 1, y, W1), v1 = key(x + 1, y + 1, W1); addDir(a, v0, v1); addDir(r, v1, v0); addPair(a, r, v0, v1); }
    if (a !== t) { const v0 = key(x, y + 1, W1), v1 = key(x + 1, y + 1, W1); addDir(a, v1, v0); addDir(t, v0, v1); addPair(a, t, v0, v1); }
  }
  const pt = (v) => [lon0 + (v % W1) * S, lat0 + Math.floor(v / W1) * S];

  // [lon, lat] of each seat (a house sharing a seat is shown on the primary's), for the sigils
  const out = { cell: S, houses: {}, seats: Object.fromEntries(houses.filter((h) => at[h.seat]).map((h) => [h.id, [at[h.seat][1], at[h.seat][0]]])), borders: [] };
  for (const [l, m] of directed) {
    const rings = [];
    for (const [start0, ends0] of m) {
      while (ends0.length) {
        const ring = [start0]; let v = ends0.pop();
        while (v !== start0) { ring.push(v); const ends = m.get(v); v = ends.pop(); }
        const pts = chaikin(dp(ring.map(pt), S * 0.7, true), true, 2);
        let area = 0;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
        if (pts.length >= 4 && Math.abs(area) > S * S * 2) rings.push(round(pts));
      }
    }
    out.houses[seeds[l - 1].id] = rings;
  }
  for (const [k, edges] of pairs) {
    const [a, b] = k.split('|').map(Number);
    const adj = new Map();
    for (const [v0, v1] of edges) { for (const [p, q] of [[v0, v1], [v1, v0]]) { if (!adj.has(p)) adj.set(p, []); adj.get(p).push(q); } }
    const used = new Set();
    const ek = (p, q) => (p < q ? `${p},${q}` : `${q},${p}`);
    const walk = (start, first) => {
      const path = [start]; let prev = start, v = first; used.add(ek(prev, v));
      for (;;) {
        path.push(v);
        const next = adj.get(v);
        if (next.length !== 2) break;
        const n = next.find((q) => !used.has(ek(v, q)));
        if (n === undefined) break;
        used.add(ek(v, n)); prev = v; v = n;
      }
      return path;
    };
    const emit = (path) => {
      const closed = path[0] === path[path.length - 1];
      const pts = chaikin(dp(path.map(pt), S * 0.7, closed), closed, 2);
      if (pts.length >= 2) out.borders.push([seeds[a - 1].id, seeds[b - 1].id, round(pts)]);
    };
    for (const [v, ns] of adj) if (ns.length !== 2) for (const n of ns) if (!used.has(ek(v, n))) emit(walk(v, n));
    for (const [v, ns] of adj) for (const n of ns) if (!used.has(ek(v, n))) emit(walk(v, n));
  }
  writeFileSync('src/house-territories.json', JSON.stringify(out));

  const covered = Object.keys(out.houses).length;
  console.log(`${seeds.length} seeds, ${covered} with a territory, ${out.borders.length} border lines, ${Object.values(out.houses).reduce((n, r) => n + r.length, 0)} rings`);
  console.log(`without territory: ${seeds.filter((s) => !out.houses[s.id]).map((s) => s.id).join(', ') || 'none'}`);
}
