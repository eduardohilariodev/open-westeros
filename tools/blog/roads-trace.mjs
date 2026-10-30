// Builds the road network into src/roads.json: { roads, minor, named }. `roads` has one line per stretch between junctions (the
// network, drawn, ends shared exactly at junctions), `minor` the tracks from castles and towns, `named` one line per road of
// tools/books/lore-roads.json (which carries the name on the globe).
// The lore says which places a road runs through; the ground says how it gets there. Each leg between two of a road's places is
// the cheapest way over the baked relief (public/world/relief-h.webp): steep ground, swamp and high passes cost more, sea and
// lakes cannot be crossed, a river costs a crossing (cheap at a town, free at a place the road is named through), its banks
// are cheap. The painted road map (roads-fit.mjs) is only a gentle pull, the lowest source. A stretch already laid is cheap,
// so later roads join it instead of running beside it, and the junctions fall where the roads part.
// Usage: node tools/blog/roads-trace.mjs   (run roads-fit.mjs first)
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { unflatten, METRES_PER_DEGREE, MILE } from '../../src/config.ts';
import { PLACES } from '../../src/world-data.ts';
import { IMAGE, FIT } from './roads-fit.mjs';
import { source } from './roads-sources.mjs';
import { WALL_CASTLES, wallLine } from '../../src/globe/wallLine.ts';

const MILES_PER_DEG = METRES_PER_DEGREE / MILE;

// ---- the painted roads, as lon/lat lines (the pull) ----
const painted = await (async () => {
  const { fits, split, warp: windows } = JSON.parse(readFileSync(FIT, 'utf8'));
  const { data, info } = await sharp(IMAGE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  let on = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) on[i] = source.road(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) && !source.skip(i % W, (i / W) | 0) ? 1 : 0;
  // close the gaps a place's dot or a name plate cuts in the ink (dilate, then erode)
  const CLOSE = 7;
  const slide = (src, horizontal, pick) => {
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
  // Zhang-Suen thinning, so the pull is the road's middle and not its width
  const N = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
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
  // each skeleton pixel, moved by the coast registration (Shepard over the nearest windows) and placed with the fit
  const shift = (x, y) => {
    const near = windows.map((w) => ({ w, d: Math.hypot(w.x - x, w.y - y) })).sort((a, b) => a.d - b.d).slice(0, 6);
    let sw = 0, sx = 0, sy = 0;
    for (const { w, d } of near) { const k = 1 / (d * d + 2500); sw += k; sx += k * w.dx; sy += k * w.dy; }
    return [x + sx / sw, y + sy / sw];
  };
  const toGlobe = ([x, y]) => {
    let f = fits.westeros, flat = (x - f.p[1]) / f.p[0];
    if (flat >= split) { f = fits.east; flat = (x - f.p[1]) / f.p[0]; }
    const lat = (y - f.p[3]) / f.p[2];
    return [unflatten(flat, lat), lat];
  };
  const pts = [];
  for (let i = 0; i < W * H; i++) if (on[i]) pts.push(toGlobe(shift(i % W, (i / W) | 0)));
  return pts;
})();

// ---- the grid: the relief bake's own cells (~0.035 degrees, 2-3 miles) ----
const B = JSON.parse(readFileSync('src/globe/relief-bounds.json', 'utf8'));
const relief = await sharp('public/world/relief-h.webp').raw().toBuffer({ resolveWithObject: true });
const GW = relief.info.width, GH = relief.info.height, CH = relief.info.channels;
const DLON = (B.lon1 - B.lon0) / GW, DLAT = (B.lat1 - B.lat0) / GH;
const height = new Float32Array(GW * GH); // km
for (let i = 0; i < GW * GH; i++) height[i] = ((relief.data[i * CH] * 256 + relief.data[i * CH + 1]) / 65535) * B.heightMax;
const cellOf = (lon, lat) => { const x = Math.floor((lon - B.lon0) / DLON), y = Math.floor((B.lat1 - lat) / DLAT); return x < 0 || y < 0 || x >= GW || y >= GH ? -1 : y * GW + x; };
const centre = (i) => [B.lon0 + ((i % GW) + 0.5) * DLON, B.lat1 - (((i / GW) | 0) + 0.5) * DLAT];
const svgXY = ([lon, lat]) => `${((lon - B.lon0) / DLON).toFixed(1)} ${((B.lat1 - lat) / DLAT).toFixed(1)}`;
/** An SVG drawn over the grid, read back as one byte a cell. */
const raster = async (body) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${GW}" height="${GH}"><rect width="100%" height="100%" fill="#000"/>${body}</svg>`)).greyscale().raw().toBuffer();
const rings = (rs) => rs.map((r) => 'M' + r.map(svgXY).join('L') + 'Z').join('');
const polyline = (pts) => 'M' + pts.map(svgXY).join('L');

const world = JSON.parse(readFileSync('src/vector-world.json', 'utf8'));
// land is the drawn coast less the lakes; a road keeps to cells that are mostly land, so it never touches the sea
const land = await raster(`<path d="${rings(world.land)}" fill="#fff" fill-rule="evenodd"/><path d="${rings(world.lakes.flatMap((l) => l.rings))}" fill="#000" fill-rule="evenodd"/>`);
const COVER = { forest: 1, swamp: 2, desert: 3, snow: 4 }, COVER_COST = [1, 1.25, 3, 1.4, 2]; // plains, forest, swamp (the Neck), desert, snow
const { features: cover } = JSON.parse(readFileSync('src/terrain.json', 'utf8'));
const ground = await raster(cover.filter((f) => COVER[f.properties.c]).map((f) => `<path d="${f.geometry.coordinates.map(rings).join('')}" fill="rgb(${COVER[f.properties.c] * 50},0,0)" fill-rule="evenodd" shape-rendering="crispEdges"/>`).join(''));
// rivers, as cells (the size, 0..1) and as banks two cells either side: the relief's (lon, lat, size triples) and the flat
// map's canon lines (which lie a few miles off them, and a road drawn on one would look like it runs in the river)
const bakedRivers = JSON.parse(readFileSync('public/world/relief-rivers.json', 'utf8')).map((l) => Array.from({ length: l.length / 3 }, (_, k) => [l[k * 3], l[k * 3 + 1], l[k * 3 + 2]]));
const riverBody = (w) => [...bakedRivers, ...world.rivers.map((l) => l.map(([lon, lat]) => [lon, lat, 0.5]))]
  .map((l) => `<path d="${polyline(l)}" stroke="rgb(${Math.round(255 * Math.max(...l.map((p) => p[2])))},0,0)" stroke-width="${w}" fill="none" shape-rendering="crispEdges"/>`).join('');
const river = await raster(riverBody(1.6)), bank = await raster(riverBody(5));
const pull = new Uint8Array(GW * GH); // cells the painted roads cross, and their neighbours
for (const [lon, lat] of painted) { const i = cellOf(lon, lat); if (i >= 0) for (const d of [0, 1, -1, GW, -GW]) pull[i + d] = 1; }

/** What a mile of a cell costs before its slope and the painted road's pull: high ground, cover, a river bank. */
const cellCost = new Float32Array(GW * GH);
for (let i = 0; i < GW * GH; i++) cellCost[i] = (1 + 0.12 * height[i]) * COVER_COST[Math.round(ground[i] / 50)] * (bank[i] && !river[i] ? 0.9 : 1);
// How the road being laid weighs the ground. A road follows the lie of the land (a 5% grade is already a burden) and leans to the
// painted road. A Valyrian road (lore-roads.json `straight`: "straight as a Dothraki arrow", AGOT) was cut through it: it shrugs off
// grades up to ~15% and owes nothing to the painted line.
let GRADE = 0.05, PULL = 0.75;
// A road the lore and the maps run along a river (lore-roads.json `along`: the river road "followed the course of the Red Fork",
// AFFC) finds that river's banks half price: ALONG is the band for the road being laid, null for the others. A river is the canon
// line nearest the spot of its name, as the globe letters it.
let ALONG = null;
const bands = new Map();
const bandOf = async (name) => {
  if (bands.has(name)) return bands.get(name);
  const p = PLACES.find((q) => q[0] === name && q[1] === 'river');
  if (!p) throw new Error(`no river "${name}"`);
  let best = [Infinity, null];
  for (const r of world.rivers) for (const [lon, lat] of r) { const d = Math.hypot(lon - p[3], lat - p[2]); if (d < best[0]) best = [d, r]; }
  const band = await raster(`<path d="${polyline(best[1])}" stroke="#fff" stroke-width="5" fill="none"/>`);
  bands.set(name, band);
  return band;
};
// a road keeps to cells that are mostly land; by a place on the shore (a port) it may use the cells round it that are partly land
const harbour = new Set();
// The Wall is no way through, but at its gates: "All tunnels have been sealed except for those at Castle Black, Eastwatch, and the Shadow Tower" (wiki Wall)
const wall = await raster(`<path d="${polyline(wallLine())}" stroke="#fff" stroke-width="2.5" fill="none"/>`);
for (const g of ['Castle Black', 'Eastwatch-by-the-Sea', 'Shadow Tower']) { const [lat, lon] = WALL_CASTLES[g], c = cellOf(lon, lat); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) wall[c + dy * GW + dx] = 0; }
const passable = (i) => (land[i] > 200 || harbour.has(i)) && !wall[i];
const moor = (i) => { for (const d of [0, 1, -1, GW, -GW, GW + 1, GW - 1, -GW + 1, -GW - 1]) if (land[i + d] > 60) harbour.add(i + d); };

// fords: a river crossing is cheap by a settlement (a bridge, a ferry) and free at a place a road is named through
const ford = new Float32Array(GW * GH).fill(1);
const stamp = (i, r, v) => { const x = i % GW, y = (i / GW) | 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const j = (y + dy) * GW + x + dx; if (j >= 0 && j < GW * GH) ford[j] = Math.min(ford[j], v); } };
// a waypoint read off a map, where the road bends at no place of ours, is `@lat,lon` (a pseudo-place, kind `waypoint`)
const placeAt = (name) => { if (name.startsWith('@')) { const [lat, lon] = name.slice(1).split(',').map(Number); return [name, 'waypoint', lat, lon]; } const p = PLACES.find((q) => q[0] === name && q[1] !== 'road'); if (!p) throw new Error(`no place "${name}"`); return p; };
for (const p of PLACES) if (['capital', 'city', 'town', 'castle'].includes(p[1])) stamp(cellOf(p[3], p[2]), 2, 0.2);
const spec = JSON.parse(readFileSync('tools/books/lore-roads.json', 'utf8'));
for (const n of new Set(spec.flatMap((r) => r.via))) stamp(cellOf(placeAt(n)[3], placeAt(n)[2]), 3, 0);

// ---- the network: cell -> (neighbour cell -> { cls, name }); cls 2 a road, 1 a track ----
const net = new Map();
const linked = (a, b) => net.get(a)?.has(b);
const link = (path, cls, name) => {
  for (let k = 1; k < path.length; k++) for (const [a, b] of [[path[k - 1], path[k]], [path[k], path[k - 1]]]) {
    const m = net.get(a) ?? net.set(a, new Map()).get(a), e = m.get(b) ?? m.set(b, { cls, name, uses: 0 }).get(b);
    e.cls = Math.max(e.cls, cls); e.uses++;
  }
};

// king's and knight's moves, so a road can run at any of 16 headings and not only in 45 degree steps
const MOVES = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
const crossed = (dx, dy) => (Math.abs(dx) === 2 ? [[dx / 2, 0], [dx / 2, dy]] : Math.abs(dy) === 2 ? [[0, dy / 2], [dx, dy / 2]] : []);
const ROAD_DISCOUNT = 0.35;
/** The cost of one step u -> v (Infinity where it cannot go), and its length in miles. */
const step = (u, x, y, dx, dy) => {
  const vx = x + dx, vy = y + dy;
  if (vx < 0 || vy < 0 || vx >= GW || vy >= GH) return Infinity;
  const v = vy * GW + vx;
  if (!passable(v)) return Infinity;
  let wet = river[v] && !river[u] ? river[v] : 0;
  for (const [cx, cy] of crossed(dx, dy)) {
    const c = (y + cy) * GW + x + cx;
    if (!passable(c)) return Infinity;
    if (river[c] && !river[u]) wet = Math.max(wet, river[c]);
  }
  const lat = B.lat1 - (y + 0.5) * DLAT, miles = Math.hypot(dx * DLON * Math.cos((lat * Math.PI) / 180), dy * DLAT) * MILES_PER_DEG;
  const grade = Math.abs(height[v] - height[u]) / (miles * 1.609), slope = Math.min(40, 1 + (grade / GRADE) ** 2);
  let c = miles * slope * (cellCost[u] * (pull[u] ? PULL : 1) + cellCost[v] * (pull[v] ? PULL : 1)) / 2 * (river[u] && river[v] ? 3 : 1); // along a river's bed is no road
  if (linked(u, v)) c *= ROAD_DISCOUNT;
  if (ALONG && ALONG[u] && ALONG[v] && !river[v]) c *= 0.5;
  if (wet) c += (15 + 40 * (wet / 255)) * Math.min(ford[v], ...crossed(dx, dy).map(([cx, cy]) => ford[(y + cy) * GW + x + cx]));
  return c;
};
const MIN_MULT = ROAD_DISCOUNT * 0.75 * 0.9 * 0.5; // the cheapest a mile can be: the A* bound

/**
 * The cheapest path from cell `from` to a cell where goal(cell) holds, within `pad` cells of the box round from and `to`
 * (A* toward `to` when given). Gives the cells in order, or null (none within `cap` cost).
 */
const route = (from, goal, to, pad, cap = Infinity) => {
  const fx = from % GW, fy = (from / GW) | 0, tx = to >= 0 ? to % GW : fx, ty = to >= 0 ? (to / GW) | 0 : fy;
  const x0 = Math.max(0, Math.min(fx, tx) - pad), y0 = Math.max(0, Math.min(fy, ty) - pad), x1 = Math.min(GW - 1, Math.max(fx, tx) + pad), y1 = Math.min(GH - 1, Math.max(fy, ty) + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, local = (i) => ((i / GW) | 0) * w - y0 * w + (i % GW) - x0;
  const dist = new Float64Array(w * h).fill(Infinity), prev = new Int32Array(w * h).fill(-1);
  const heur = (x, y) => (to < 0 ? 0 : Math.hypot((x - tx) * DLON * Math.cos(((B.lat1 - y * DLAT) * Math.PI) / 180), (y - ty) * DLAT) * MILES_PER_DEG * MIN_MULT);
  const heap = []; // [f, cell], a binary heap
  const push = (f, c) => { heap.push([f, c]); for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; for (let i = 0; ;) { let m = i; for (const c of [2 * i + 1, 2 * i + 2]) if (c < heap.length && heap[c][0] < heap[m][0]) m = c; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  dist[local(from)] = 0; push(heur(fx, fy), from);
  while (heap.length) {
    const [f, u] = pop(), x = u % GW, y = (u / GW) | 0, du = dist[local(u)];
    if (f - heur(x, y) > du + 1e-9) continue; // stale
    if (du > cap) return null;
    if (goal(u)) { const out = [u]; for (let c = prev[local(u)]; c >= 0; c = prev[local(c)]) out.unshift(c); return out; }
    for (const [dx, dy] of MOVES) {
      const vx = x + dx, vy = y + dy;
      if (vx < x0 || vy < y0 || vx > x1 || vy > y1) continue;
      const c = step(u, x, y, dx, dy);
      if (c === Infinity) continue;
      const v = vy * GW + vx, lv = local(v), d = du + c;
      if (d < dist[lv]) { dist[lv] = d; prev[lv] = u; push(d + heur(vx, vy), v); }
    }
  }
  return null;
};
const pathMiles = (path) => path.slice(1).reduce((n, c, k) => { const a = centre(path[k]), b = centre(c); return n + Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * MILES_PER_DEG; }, 0);

// pins: a cell where a place is drawn at the place itself, not the cell's centre
const pins = new Map(), terminals = new Set();
const pin = (p) => { const i = cellOf(p[3], p[2]); if (!pins.has(i)) pins.set(i, [p[3], p[2]]); terminals.add(i); moor(i); return i; };

/** The cells of the straight line a-b, or null where it leaves the land (or crosses the Wall) between its ends. */
const ruled = (a, b) => {
  const [ax, ay, bx, by] = [a % GW, (a / GW) | 0, b % GW, (b / GW) | 0], n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)), out = [];
  for (let k = 0; k <= n; k++) {
    const c = Math.round(ay + ((by - ay) * k) / n) * GW + Math.round(ax + ((bx - ax) * k) / n);
    if (k && k < n && !passable(c)) return null;
    if (c !== out.at(-1)) out.push(c);
  }
  return out;
};

// ---- named roads, in the file's order (the Kingsroad first: the others join it) ----
// A Valyrian road (`straight`) is a ruled line from place to place: "straight as a Dothraki arrow" (AGOT, Daenerys), "straight
// as a spear to the horizon" (ADWD, Tyrion), and drawn so on The Lands of Ice and Fire. Only a leg whose line would cross water
// is routed, and then with slope a small matter to it.
const namedCells = [];
for (const { name, via, straight, joins, along } of spec) {
  [GRADE, PULL] = straight ? [0.15, 1] : [0.05, 0.75];
  ALONG = null;
  for (const n of along ?? []) { const b = await bandOf(n); ALONG ??= new Uint8Array(GW * GH); for (let i = 0; i < GW * GH; i++) if (b[i] > 127) ALONG[i] = 1; }
  const cells = via.map((n) => pin(placeAt(n)));
  for (const [k, c] of cells.entries()) if (!passable(c)) console.warn(`${name}: ${via[k]} is not on land at the grid's scale`);
  let seq = [cells[0]], ok = true;
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1], b = cells[k], span = Math.max(Math.abs((a % GW) - (b % GW)), Math.abs(((a / GW) | 0) - ((b / GW) | 0)));
    const path = (straight && ruled(a, b)) || route(a, (c) => c === b, b, Math.max(30, Math.round(span * 0.6)));
    if (!path) { console.warn(`${name}: no way over land from ${via[k - 1]} to ${via[k]}, left out`); ok = false; break; }
    if (straight && path.length && !ruled(a, b)) console.log(`  ${name}: ${via[k - 1]} to ${via[k]} would cross water, routed`);
    link(path, 2, name);
    seq.push(...path.slice(1));
  }
  // a branch (`joins`) runs from its last place to the road it leaves, where no text names the junction: a straight road by the
  // nearest ruled line that stays on land, any other the cheapest way
  if (ok && joins) {
    const road = namedCells.find((n) => n.name === joins)?.cells ?? [], from = seq.at(-1), [fx, fy] = [from % GW, (from / GW) | 0];
    const near = straight && road.map((c) => [c, Math.hypot((c % GW) - fx, ((c / GW) | 0) - fy)]).sort((p, q) => p[1] - q[1]).map(([c]) => ruled(from, c)).find(Boolean);
    const path = near || route(from, (c) => road.includes(c), -1, 80);
    if (path) { link(path, 2, name); seq.push(...path.slice(1)); } else { console.warn(`${name}: does not reach ${joins}, left out`); ok = false; }
  }
  if (!ok) continue;
  // a road that runs out to a place and back the same way passes it by: the out-and-back is not part of the named line
  const out = [];
  for (const c of seq) { if (out.length > 1 && out.at(-2) === c) out.pop(); else out.push(c); }
  namedCells.push({ name, cells: out });
}
[GRADE, PULL, ALONG] = [0.05, 0.75, null];
const STRAIGHT = new Set(spec.filter((r) => r.straight).map((r) => r.name));

// ---- tracks: each castle, town and city to the nearest road or track, biggest first, so the tracks branch like a tree ----
// Canon names few roads; every seat still has a way to the realm's roads. A track that several places share is a road.
const REACH_MI = { capital: 900, city: 700, town: 350, castle: 350, ruin: 60, minor: 60 };
const RANK = ['capital', 'city', 'town', 'castle', 'ruin', 'minor'];
const SHARED = 3; // places whose track runs over a stretch before it is drawn as a road
let tracks = 0;
const why = { on: 0, wet: 0, none: 0, far: 0 };
for (const p of PLACES.filter((q) => REACH_MI[q[1]] && !WALL_CASTLES[q[0]]).sort((a, b) => RANK.indexOf(a[1]) - RANK.indexOf(b[1]))) {
  const at = cellOf(p[3], p[2]);
  if (at >= 0 && net.has(at)) { why.on++; continue; }
  if (at >= 0) moor(at);
  const say = (why) => process.env.DBG && console.log(`  ${p[0]} (${p[1]}): ${why}`); // DBG=1 lists the places left without a track
  if (at < 0 || !passable(at)) { why.wet++; say('in the sea'); continue; } // in the sea at this scale: an island the land lacks
  const reach = REACH_MI[p[1]], path = route(at, (c) => net.has(c), -1, Math.ceil(reach / 1.6), reach * 6);
  // no road in reach (an island, Yi Ti): the place seeds a network of its own, and the places round it join it
  if (!path || pathMiles(path) > reach) { why[path ? 'far' : 'none']++; say(path ? `${Math.round(pathMiles(path))} mi to a road` : 'no road in reach'); pin(p); net.set(at, new Map()); continue; }
  pin(p);
  link(path, p[1] === 'capital' ? 2 : 1, p[0]); // a city's own track is a track: the maps draw no Pentos-Myr road
  tracks++;
}
console.log(`tracks: ${tracks} places joined; not joined: ${why.on} already on a road, ${why.wet} in the sea at the grid's scale, ${why.none} with no road in reach and ${why.far} too far (these seed local networks)`);

// ---- the network as stretches between junctions, each smoothed once ----
const degree = (c) => net.get(c).size;
const isNode = (c) => degree(c) !== 2 || terminals.has(c);
const chains = new Map(); // `${a}>${second cell}` -> stretch index (and the reverse key from its other end)
const stretches = [];
const walk = (a, b) => {
  const cells = [a, b];
  for (let prev = a, cur = b; !isNode(cur);) { const next = [...net.get(cur).keys()].find((n) => n !== prev); cells.push(next); prev = cur; cur = next; if (cur === a) break; }
  return cells;
};
for (const a of net.keys()) {
  if (!isNode(a)) continue;
  for (const b of net.get(a).keys()) {
    if (chains.has(`${a}>${b}`)) continue;
    const cells = walk(a, b), k = stretches.length;
    chains.set(`${a}>${b}`, k); chains.set(`${cells.at(-1)}>${cells.at(-2)}`, k);
    let cls = 0, name = null;
    for (let i = 1; i < cells.length; i++) { const e = net.get(cells[i - 1]).get(cells[i]), c = e.uses >= SHARED ? 2 : e.cls; if (c > cls) { cls = c; name = e.name; } }
    stretches.push({ cells, cls, name });
  }
}

const coverAt = ([lon, lat]) => { const i = cellOf(lon, lat); return i < 0 ? 0 : land[i]; };
const dp = (pts, tol) => { // Douglas-Peucker on [lon * cos(lat), lat]
  if (pts.length < 3) return pts;
  const k = Math.cos((pts[0][1] * Math.PI) / 180), [a, b] = [pts[0], pts.at(-1)], L = Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) || 1e-9;
  let m = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[1] - a[1]) * (pts[i][0] - a[0]) * k - (b[0] - a[0]) * k * (pts[i][1] - a[1])) / L;
    if (d > m) { m = d; at = i; }
  }
  return m > tol ? [...dp(pts.slice(0, at + 1), tol).slice(0, -1), ...dp(pts.slice(at), tol)] : [a, b];
};
const chaikin = (pts, rounds) => {
  for (let r = 0; r < rounds; r++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]]; out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); }
    out.push(pts.at(-1)); pts = out;
  }
  return pts;
};
/** Does the line stay on land? (sampled every ~0.5 mile) */
const dry = (pts) => pts.slice(1).every((b, i) => {
  const a = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.007));
  for (let k = 0; k <= n; k++) if (coverAt([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]) <= 127) return false;
  return true;
});
const lineMiles = (pts) => pts.slice(1).reduce((n, b, i) => n + Math.hypot((b[0] - pts[i][0]) * Math.cos((b[1] * Math.PI) / 180), b[1] - pts[i][1]) * MILES_PER_DEG, 0);
let fallbacks = 0;
for (const s of stretches) {
  const raw = s.cells.map((c) => pins.get(c) ?? centre(c));
  // straightened to within half a cell (a Valyrian road to a cell and a half), then rounded; where that would touch water, a tighter fit, and at worst the cells
  const tries = [...(STRAIGHT.has(s.name) ? [[1.5, 2]] : []), [0.5, 3], [0.25, 2], [0, 1]].map(([tol, r]) => chaikin(dp(raw, tol * DLAT), r));
  const pts = tries.find(dry) ?? raw;
  if (pts !== tries[0] && pts !== tries[1]) fallbacks++;
  s.pts = pts.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]);
  s.miles = +lineMiles(s.pts).toFixed(1);
}

const roads = stretches.filter((s) => s.cls === 2).map(({ miles, pts }) => ({ miles, pts }));
const minor = stretches.filter((s) => s.cls === 1).map(({ name, miles, pts }) => ({ name, miles, pts }));
const named = namedCells.map(({ name, cells }) => {
  const pts = [];
  for (let i = 0; i < cells.length - 1;) { // the stretches the road walks, end to end
    const k = chains.get(`${cells[i]}>${cells[i + 1]}`), s = stretches[k], fwd = s.cells[0] === cells[i];
    pts.push(...(fwd ? s.pts : [...s.pts].reverse()).slice(pts.length ? 1 : 0));
    i += s.cells.length - 1;
  }
  const r = { name, miles: +lineMiles(pts).toFixed(1), pts };
  const stated = spec.find((q) => q.name === name).miles;
  console.log(`${name}: ${Math.round(r.miles)} mi${stated ? ` (stated ${stated})` : ''}`);
  return r;
});

writeFileSync('src/roads.json', JSON.stringify({ roads, minor, named }));
console.log(`${roads.length} road stretches (${Math.round(roads.reduce((n, r) => n + r.miles, 0))} mi), ${minor.length} track stretches from ${tracks} places, ${fallbacks} stretches kept tighter to stay off water`);
