// Bakes the globe's terrain relief from the canon map (src/vector-world.json + src/terrain.json) for src/globe/relief.ts.
//  1. Educated guesses at height: land rises inland from the coasts; hills swell; mountain ranges peak along the middle of
//     their polygons (the canon maps draw ranges, so the spine is the medial axis), with ridged noise for peaks; the
//     Lands of Always Winter are an ice plateau; swamps and lakes sit low and flat; rivers lie in valleys; the sea shelves
//     off into deep water.
//  2. Particle hydraulic erosion (after Sebastian Lague's droplet model) cuts gullies and valley networks and records
//     where water flows and where sediment settles.
//     Geology traced from a geologic map of Westeros (tools/world/geology.json, docs/geology.md) sets how hard the rock
//     is, lifts ridges along thrust faults, and shapes karst, cliffs, mesas and salt pans.
//  3. Baked for a fixed sun in the north-west: slope, cast shadow, ambient occlusion; plus flow, erosion, class masks
//     and bare-rock colour.
//  4. Ground colour and tree cover by biome, from a fan vegetation map (tools/world/vegetation.mjs).
// Output: public/world/relief-{a,b,c,d,h,v}.webp and src/globe/relief-bounds.json (grid extent and encodings).
// Usage: node tools/world/relief-bake.mjs [degrees per pixel = 0.035 (~4.2 km)] [preview.png]
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { METRES_PER_DEGREE } from '../../src/config.ts';
import { PLACES } from '../../src/world-data.ts';
import { BIOMES, loadBiomes } from './vegetation.mjs';

const RES = +(process.argv[2] ?? 0.035), PREVIEW = process.argv[3];
// the Known World plus a margin; BOUNDS="lon0,lon1,lat0,lat1" bakes a part of it, for quick tuning
const [LON0, LON1, LAT0, LAT1] = process.env.BOUNDS?.split(',').map(Number) ?? [-56, 110, -5, 77];
const W = Math.round((LON1 - LON0) / RES), H = Math.round((LAT1 - LAT0) / RES), N = W * H;
const KM = (METRES_PER_DEGREE / 1000) * RES; // km per pixel, north-south
const cosRow = Float32Array.from({ length: H }, (_, y) => Math.cos(((LAT1 - (y + 0.5) * RES) * Math.PI) / 180));
// shared with the shader (relief-bounds.json)
const EXAGGERATION = 6, GRAD_MAX = 0.6, HEIGHT_MAX = 5, ERO_MAX = 0.15, SEA_MAX = 600;
const SUN = { east: -Math.SQRT1_2, north: Math.SQRT1_2, elevation: (32 * Math.PI) / 180 };
const t0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
log(`grid ${W}×${H}, ${KM.toFixed(2)} km/px`);

// ---------- helpers ----------
const rand = ((s) => () => ((s = (s + 0x6d2b79f5) | 0), (s = Math.imul(s ^ (s >>> 15), s | 1)), (s ^= s + Math.imul(s ^ (s >>> 7), s | 61)), ((s ^ (s >>> 14)) >>> 0) / 4294967296))(7);

// 2D simplex noise (Gustavson), seeded
const perm = new Uint8Array(512);
{ const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]], F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
function noise(x, y) {
  const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t), i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  const c = [[x0, y0, 0, 0], [x0 - i1 + G2, y0 - j1 + G2, i1, j1], [x0 - 1 + 2 * G2, y0 - 1 + 2 * G2, 1, 1]];
  let n = 0;
  for (const [cx, cy, di, dj] of c) {
    let q = 0.5 - cx * cx - cy * cy;
    if (q > 0) { const g = G[perm[((i + di) & 255) + perm[(j + dj) & 255]] & 7]; q *= q; n += q * q * (g[0] * cx + g[1] * cy); }
  }
  return 70 * n; // -1..1
}
const fbm = (x, y, oct = 5) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++, a *= 0.5, f *= 2.03) s += a * noise(x * f + i * 17.3, y * f - i * 9.1); return s; };
const ridged = (x, y, oct = 5) => {
  let s = 0, a = 0.5, f = 1, carry = 1;
  for (let i = 0; i < oct; i++, a *= 0.5, f *= 2.07) { let v = 1 - Math.abs(noise(x * f + i * 31.7, y * f + i * 5.3)); v *= v; s += a * v * carry; carry = Math.min(1, v * 1.4); }
  return s;
};

// lon/lat -> pixel, and a local km frame for noise (sinusoidal around 25°E: continuous, nearly isotropic)
const px = ([lon, lat]) => `${((lon - LON0) / RES).toFixed(2)} ${((LAT1 - lat) / RES).toFixed(2)}`;
const pathD = (rings, close) => rings.map((r) => 'M' + r.map(px).join('L') + (close ? 'Z' : '')).join('');
const kmX = (x, y) => (LON0 + (x + 0.5) * RES - 25) * cosRow[y] * (KM / RES), kmY = (y) => (LAT1 - (y + 0.5) * RES) * (KM / RES);

/** Coverage 0..1 of SVG paths drawn white. */
async function raster(paths) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${paths.map((p) => p.stroke
    ? `<path d="${p.d}" fill="none" stroke="#fff" stroke-width="${p.stroke}" stroke-linejoin="round" stroke-linecap="round"/>`
    : `<path d="${p.d}" fill="#fff" fill-rule="evenodd"/>`).join('')}</svg>`;
  const buf = await sharp(Buffer.from(svg), { unlimited: true, limitInputPixels: false }).ensureAlpha().extractChannel(3).raw().toBuffer();
  return Float32Array.from(buf, (v) => v / 255);
}

/** Distance in km to the nearest pixel where `source` is true (two-pass chamfer with each row's true pixel width). */
function distance(source) {
  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) d[i] = source(i) ? 0 : 1e9;
  const relax = (i, j, c) => { if (d[j] + c < d[i]) d[i] = d[j] + c; };
  for (let y = 0; y < H; y++) {
    const cx = KM * cosRow[y], cd = Math.hypot(cx, KM);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x > 0) relax(i, i - 1, cx);
      if (y > 0) { relax(i, i - W, KM); if (x > 0) relax(i, i - W - 1, cd); if (x < W - 1) relax(i, i - W + 1, cd); }
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    const cx = KM * cosRow[y], cd = Math.hypot(cx, KM);
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (x < W - 1) relax(i, i + 1, cx);
      if (y < H - 1) { relax(i, i + W, KM); if (x < W - 1) relax(i, i + W + 1, cd); if (x > 0) relax(i, i + W - 1, cd); }
    }
  }
  return d;
}

/** Gaussian-ish blur (3 box passes) of radius rKm, returned as a new array. */
function blur(src, rKm) {
  const a = Float32Array.from(src), tmp = new Float32Array(Math.max(W, H));
  const run = (start, stride, n, r) => {
    if (r < 1) return;
    for (let i = 0; i < n; i++) tmp[i] = a[start + i * stride];
    const at = (i) => tmp[Math.min(n - 1, Math.max(0, i))];
    let s = 0;
    for (let i = -r; i <= r; i++) s += at(i);
    for (let i = 0; i < n; i++) { a[start + i * stride] = s / (2 * r + 1); s += at(i + r + 1) - at(i - r); }
  };
  const ry = Math.round(rKm / KM / 1.7);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) run(y * W, 1, W, Math.round(rKm / (KM * cosRow[y]) / 1.7));
    for (let x = 0; x < W; x++) run(x, W, H, ry);
  }
  return a;
}
const smooth = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ---------- 1. canon masks ----------
const world = JSON.parse(readFileSync('src/vector-world.json', 'utf8'));
const terrain = JSON.parse(readFileSync('src/terrain.json', 'utf8'));
const classRings = (c) => terrain.features.filter((f) => f.properties.c === c)
  .flatMap((f) => (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]).flat());
const lakeRings = world.lakes.flatMap((l) => l.rings);
const [landRaw, lake, river, mountain, hills, forest, swamp, desert, snow] = await Promise.all([
  raster([{ d: pathD(world.land, true) }]), raster([{ d: pathD(lakeRings, true) }]),
  raster([{ d: pathD(world.rivers, false), stroke: 1.2 }]),
  ...['mountains', 'hills', 'forest', 'swamp', 'desert', 'snow'].map((c) => raster([{ d: pathD(classRings(c), true) }])),
]);
const land = landRaw.map((v, i) => (v > 0.5 && lake[i] < 0.5 ? 1 : 0));
const cover = (m) => (m.reduce((s, v) => s + (v > 0.5), 0) / N * 100).toFixed(1) + '%';
log('masks', Object.entries({ land, lake, river, mountain, hills, forest, swamp, desert, snow }).map(([k, m]) => `${k} ${cover(m)}`).join(', '));

// ---------- 1b. geology (tools/world/geology.json, traced from the geologic map; see docs/geology.md) ----------
// Affine fit, image px -> lon/lat, through towns labelled on both maps.
const geo = JSON.parse(readFileSync('tools/world/geology.json', 'utf8'));
const placeAt = Object.fromEntries(PLACES.map(([name, , lat, lon]) => [name, [lon, lat]]));
const fit = (() => {
  const rows = geo.controlPoints.map(([n, x, y]) => [x, y, ...placeAt[n]]);
  const solve = (k) => { // least squares v = a + b x + c y
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
    for (const p of rows) { const v = [1, p[0], p[1]]; for (let a = 0; a < 3; a++) { r[a] += v[a] * p[k]; for (let b = 0; b < 3; b++) M[a][b] += v[a] * v[b]; } }
    for (let c = 0; c < 3; c++) for (let a = c + 1; a < 3; a++) { const f = M[a][c] / M[c][c]; for (let b = c; b < 3; b++) M[a][b] -= f * M[c][b]; r[a] -= f * r[c]; }
    const s = [0, 0, 0];
    for (let a = 2; a >= 0; a--) { let t = r[a]; for (let b = a + 1; b < 3; b++) t -= M[a][b] * s[b]; s[a] = t / M[a][a]; }
    return s;
  };
  const [lon, lat] = [solve(2), solve(3)];
  const f = ([x, y]) => [lon[0] + lon[1] * x + lon[2] * y, lat[0] + lat[1] * x + lat[2] * y];
  const err = rows.map((p) => Math.hypot(f(p)[0] - p[2], f(p)[1] - p[3]));
  log(`geology fit: mean ${(err.reduce((a, b) => a + b) / err.length).toFixed(2)}°, worst ${Math.max(...err).toFixed(2)}° (${geo.controlPoints[err.indexOf(Math.max(...err))][0]})`);
  return f;
})();
const UNITS = Object.keys(geo.units), unitOf = new Uint8Array(N).fill(UNITS.indexOf(geo.default));
for (const [u, ring] of geo.areas) {
  const m = await raster([{ d: pathD([ring.map(fit)], true) }]);
  for (let i = 0; i < N; i++) if (m[i] > 0.5) unitOf[i] = UNITS.indexOf(u);
}
const unitMask = (u) => blur(Float32Array.from(unitOf, (v) => +(UNITS[v] === u)), 10);
const erodibility = blur(Float32Array.from(unitOf, (v) => geo.units[UNITS[v]].erodibility), 8); // how readily the ground wears away
const rockRGB = [0, 1, 2].map((c) => blur(Float32Array.from(unitOf, (v) => geo.units[UNITS[v]].rock_rgb[c]), 6));
const [karst, cliffs, sandstone, salt, alluvium, granite] = ['P', 'D', 'O', 'salt', 'Q', null].map((u) => u
  ? unitMask(u) : blur(Float32Array.from(unitOf, (v) => +(UNITS[v] === 'gK' || UNITS[v] === 'gC' || UNITS[v] === 'pC')), 8));
const thrust = await raster(geo.faults.filter((f) => f.kind === 'thrust').map((f) => ({ d: pathD([f.line.map(fit)], false), stroke: 1.5 })));
const thrustD = distance((i) => thrust[i] > 0.3);
log('geology');

const coastIn = distance((i) => !land[i]), coastOut = distance((i) => land[i] === 1);
const mountIn = distance((i) => mountain[i] < 0.5), mountOut = distance((i) => mountain[i] >= 0.5), riverD = distance((i) => river[i] > 0.3);
const hillsB = blur(hills, 25), snowB = blur(snow, 30), swampB = blur(swamp, 12), desertB = blur(desert, 25), lakeB = blur(lake, 6);
log('distances');

// ---------- 2. height guesses (km) ----------
const h = new Float32Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, X = kmX(x, y), Y = kmY(y);
  if (!land[i] && lake[i] < 0.5) { // sea: shelf, slope, deep floor
    const d = coastOut[i];
    h[i] = -0.04 - 0.25 * smooth(0, 80, d) - 3.2 * smooth(60, 450, d) + 0.15 * fbm(X / 300, Y / 300, 3);
    continue;
  }
  // domain warp so nothing looks like a blob of noise
  const wx = X + 60 * fbm(X / 400 + 3.1, Y / 400, 3), wy = Y + 60 * fbm(X / 400, Y / 400 + 7.7, 3);
  const inland = 1 - Math.exp(-coastIn[i] / 220), coastal = smooth(0, 40, coastIn[i]);
  let e = 0.04 + 0.32 * inland * (0.7 + 0.6 * (0.5 + 0.5 * fbm(wx / 700, wy / 700, 3)));  // lowland rising inland
  e += coastal * (0.25 * (0.5 + 0.5 * fbm(wx / 120, wy / 120, 4)) + 0.3 * ridged(wx / 40, wy / 40, 5)); // rolling ground
  e += hillsB[i] * (0.25 + 0.8 * ridged(wx / 30, wy / 30, 5) + 0.2 * fbm(wx / 70, wy / 70, 3)); // hills
  // ranges: foothills reach ~45 km beyond the drawn outline; the crest rises towards the middle (medial axis), more
  // where the range is wide; ridged noise carries most of the height so tops are peaks and ridges, not plateaus
  const t = mountIn[i] - mountOut[i], foot = smooth(-45, 10, t), spine = smooth(0, 70, t) ** 0.8;
  e += (0.3 * foot + 1.3 * spine) * (0.75 + 0.5 * (0.5 + 0.5 * fbm(wx / 160, wy / 160, 3)));
  e += 2.2 * foot * ridged(wx / 32, wy / 32, 6) * (0.3 + 0.7 * spine);
  e += snowB[i] * (0.55 + 0.1 * fbm(wx / 120, wy / 120, 3));                              // ice plateau
  e += desertB[i] * 0.06 * ridged(wx / 9, wy / 30, 2);                                     // dune fields
  // geology: ridges along the thrust fronts, granite peaks, karst plateaus, limestone sea cliffs, sandstone mesas,
  // flat salt pans, low alluvium
  e += 0.45 * Math.exp(-((thrustD[i] / 35) ** 2)) * (0.6 + 0.4 * ridged(wx / 20, wy / 20, 4)) * coastal;
  e += granite[i] * 0.5 * ridged(wx / 15, wy / 15, 5);
  e += (0.45 + 0.08 * fbm(wx / 50, wy / 50, 3) - e) * karst[i] * 0.6;
  e += cliffs[i] * 0.35 * smooth(0, 12, coastIn[i]);
  if (sandstone[i] > 0.05) { const tz = e * 8; e += ((Math.floor(tz) + smooth(0.75, 1, tz % 1)) / 8 - e) * sandstone[i] * 0.8; }
  e += (0.02 - e) * salt[i];
  e *= 1 - 0.4 * alluvium[i];
  e = e * (1 - 0.35 * Math.exp(-riverD[i] / 30)) - 0.12 * Math.exp(-((riverD[i] / 5) ** 2)); // river valleys
  e = e + (0.02 - e) * Math.max(swampB[i] * 0.9, lakeB[i]);                               // swamps and lakes: low, flat
  h[i] = Math.max(0.005, e * smooth(0, 8, coastIn[i] + 2));                                 // beaches meet the sea
}
log('heights', `NaN ${h.filter(Number.isNaN).length}, max ${h.reduce((a, b) => Math.max(a, b), -9).toFixed(2)} km`);

// ---------- 3. hydraulic erosion (droplets) ----------
// Heights in "erosion units" = km × HS, so slopes per cell match the model's tuning.
const HS = 1 / KM; // a 1 km rise over one cell = slope 1/KM
const E = { inertia: 0.05, capacity: 6, minCapacity: 0.002, erode: 0.35, deposit: 0.3, evaporate: 0.015, gravity: 4, life: 48, radius: 3 };
const hu = Float32Array.from(h, (v) => v * HS), flow = new Float32Array(N), change = new Float32Array(N);const brush = []; // offsets and weights within the radius
for (let dy = -E.radius; dy <= E.radius; dy++) for (let dx = -E.radius; dx <= E.radius; dx++) {
  const d = Math.hypot(dx, dy); if (d < E.radius) brush.push([dx, dy, 1 - d / E.radius]);
}
const bw = brush.reduce((s, b) => s + b[2], 0);
const brushOff = Int32Array.from(brush, ([bx, by]) => by * W + bx), brushW = Float32Array.from(brush, (b) => b[2] / bw);
let sh = 0, sgx = 0, sgy = 0; // sample() results, kept out of the heap
const sample = (x, y) => { // bilinear height and gradient (per cell)
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, i = iy * W + ix;
  const a = hu[i], b = hu[i + 1], c = hu[i + W], d = hu[i + W + 1];
  sh = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  sgx = (b - a) * (1 - fy) + (d - c) * fy; sgy = (c - a) * (1 - fx) + (d - b) * fx;
};
const landCells = []; for (let i = 0; i < N; i++) if (land[i] && h[i] > 0.02) landCells.push(i);
const DROPS = Math.round(landCells.length * +(process.env.DROPS ?? 3));
for (let n = 0; n < DROPS; n++) {
  const start = landCells[Math.floor(rand() * landCells.length)];
  let x = (start % W) + rand(), y = Math.floor(start / W) + rand(), dx = 0, dy = 0, speed = 1, water = 1, sed = 0;
  for (let life = 0; life < E.life; life++) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, i = iy * W + ix, cs = cosRow[iy];
    sample(x, y);
    const hh = sh, gx = sgx, gy = sgy;
    // move downhill with inertia, directions in true distances (x cells are cs as wide as y cells); the step is at
    // most one cell along either axis, so no cell is skipped
    dx = dx * E.inertia - (gx / cs) * (1 - E.inertia); dy = dy * E.inertia - gy * (1 - E.inertia);
    const len = Math.hypot(dx, dy); if (len < 1e-9) break;
    dx /= len; dy /= len;
    const step = 1 / Math.max(Math.abs(dx / cs), Math.abs(dy), 1e-9);
    x += (dx / cs) * Math.min(1, step); y += dy * Math.min(1, step);
    flow[i] += water;
    if (x < 1 || y < 1 || x >= W - 2 || y >= H - 2) break;
    sample(x, y);
    const nh = sh, dh = nh - hh;
    const cap = Math.max(-dh * speed * water * E.capacity, E.minCapacity);
    if (sed > cap || dh > 0) { // deposit where it is (bilinear)
      const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * E.deposit;
      sed -= amt;
      const a0 = amt * (1 - fx) * (1 - fy), a1 = amt * fx * (1 - fy), a2 = amt * (1 - fx) * fy, a3 = amt * fx * fy;
      hu[i] += a0; hu[i + 1] += a1; hu[i + W] += a2; hu[i + W + 1] += a3;
      change[i] += a0; change[i + 1] += a1; change[i + W] += a2; change[i + W + 1] += a3;
    } else { // erode around it (brush)
      const amt = Math.min((cap - sed) * E.erode * erodibility[i], -dh);
      for (let k = 0; k < brushOff.length; k++) {
        const j = i + brushOff[k]; if (j < 0 || j >= N) continue;
        const take = Math.min(amt * brushW[k], Math.max(0, hu[j])); hu[j] -= take; change[j] -= take; sed += take;
      }
    }
    if (nh < 0) break; // reached the sea
    speed = Math.sqrt(Math.max(0, speed * speed - dh * E.gravity));
    water *= 1 - E.evaporate;
  }
  if (n % 2_000_000 === 0) log(`erosion ${((n / DROPS) * 100).toFixed(0)}%`);
}
for (let i = 0; i < N; i++) if (land[i]) h[i] = Math.max(0.003, hu[i] / HS);
log(`erosion done (${DROPS} droplets)`);

// ---------- 4. bakes for the shader ----------
const hb = (r) => blur(h, r);
const [hb4, hb16, hb60] = [hb(4 * KM / 4.2), hb(16), hb(60)];
const flowMax = Math.log1p(flow.filter((_, i) => land[i]).sort()[Math.floor(landCells.length * 0.995)]); // 99.5th percentile
const tanE = Math.tan(SUN.elevation), steps = []; for (let s = 1; s < 400; s = s < 8 ? s + 1 : s * 1.2) steps.push(s * KM);
const A = new Uint8Array(N * 4), B = new Uint8Array(N * 4), C = new Uint8Array(N * 4);
const enc = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
for (let y = 0; y < H; y++) {
  const cx = KM * cosRow[y];
  for (let x = 0; x < W; x++) {
    const i = y * W + x, xl = Math.max(0, x - 1), xr = Math.min(W - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
    const ge = (h[y * W + xr] - h[y * W + xl]) / ((xr - xl) * cx), gn = (h[yu * W + x] - h[yd * W + x]) / ((yd - yu) * KM);
    const sq = (g) => 0.5 + 0.5 * Math.sign(g) * Math.sqrt(Math.min(1, Math.abs(g) / GRAD_MAX));
    // cast shadow: highest angle to the terrain towards the sun (exaggerated heights)
    let lit = 1;
    if (land[i]) {
      let maxA = -1;
      for (const s of steps) {
        const sx = Math.round(x + (SUN.east * s) / cx), sy = Math.round(y - (SUN.north * s) / KM);
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) break;
        const a = (EXAGGERATION * (h[sy * W + sx] - h[i])) / s;
        if (a > maxA) maxA = a;
      }
      lit = smooth(-0.12, 0.12, Math.atan(tanE) - Math.atan(maxA));
    }
    // ambient occlusion: how far below its surroundings a point sits, at three scales
    const cav = (EXAGGERATION * (Math.max(0, hb4[i] - h[i]) / 4 + Math.max(0, hb16[i] - h[i]) / 16 + Math.max(0, hb60[i] - h[i]) / 60));
    const ao = land[i] ? Math.max(0.25, 1 - 1.6 * cav) : 1;
    A.set([enc(sq(ge)), enc(sq(gn)), enc(lit), enc(ao)], i * 4);
    B.set([enc(Math.max(0, h[i]) / HEIGHT_MAX), enc(land[i] ? Math.log1p(flow[i]) / flowMax : 0), enc(0.5 + 0.5 * Math.max(-1, Math.min(1, change[i] / HS / ERO_MAX))), enc(Math.sqrt(Math.min(1, coastOut[i] / SEA_MAX)))], i * 4); // sqrt: fine steps near the coast
  }
}
const moist = blur(Float32Array.from({ length: N }, (_, i) => (desert[i] > 0.5 ? 0 : swamp[i] > 0.5 ? 1 : forest[i] > 0.5 ? 0.75 : 0.5)), 30);
// vegetation (tools/world/vegetation.mjs): each pixel's biome from the fan vegetation map, for the ground's colour and tree cover
const biomeAt = await loadBiomes(), biome = new Int16Array(N).fill(-1), named = (n) => BIOMES.findIndex((b) => b[0] === n);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (landRaw[y * W + x] > 0.02) biome[y * W + x] = biomeAt(LON0 + (x + 0.5) * RES, LAT1 - (y + 0.5) * RES);
for (let pass = 0, changed = true; pass < 12 && changed; pass++) { // where the coasts differ a little: the nearest biome, ~50 km at most
  changed = false;
  const next = biome.slice();
  for (let i = 0; i < N; i++) {
    if (biome[i] >= 0) continue;
    const x = i % W, k = [x > 0 ? biome[i - 1] : -1, x < W - 1 ? biome[i + 1] : -1, i >= W ? biome[i - W] : -1, i < N - W ? biome[i + W] : -1].find((v) => v >= 0);
    if (k !== undefined) { next[i] = k; changed = true; }
  }
  biome.set(next);
}
for (let i = 0; i < N; i++) if (biome[i] < 0) biome[i] = named( // beyond the fan map (far Essos): from our own terrain classes
  snow[i] > 0.5 ? 'permafrost' : desert[i] > 0.5 ? 'barren desert' : swamp[i] > 0.5 ? 'swamp' : mountain[i] > 0.5 ? 'rocks'
    : forest[i] > 0.5 ? 'forest' : hills[i] > 0.5 ? 'mountain grassland' : 'grassland');
const albedo = [0, 1, 2].map((c) => blur(Float32Array.from(biome, (b) => BIOMES[b][2][c]), 2)), canopy = blur(Float32Array.from(biome, (b) => BIOMES[b][3]), 3);
const V = new Uint8Array(N * 4);
for (let i = 0; i < N; i++) V.set([enc(albedo[0][i]), enc(albedo[1][i]), enc(albedo[2][i]), 255], i * 4);
log('vegetation');
const snowC = blur(snow, 6);
for (let i = 0; i < N; i++) C.set([enc(canopy[i]), enc(moist[i]), enc(snowC[i]), 255], i * 4); // opaque: resizing premultiplies by alpha
const D = new Uint8Array(N * 4); // bare-rock colour from the geology, and erodibility
for (let i = 0; i < N; i++) D.set([enc(rockRGB[0][i]), enc(rockRGB[1][i]), enc(rockRGB[2][i]), enc(erodibility[i] / 2)], i * 4);
log('bakes');

// ---------- 5. write ----------
mkdirSync('public/world', { recursive: true });
const write = async (name, data, opts, scale = 1) => {
  let img = sharp(data, { raw: { width: W, height: H, channels: 4 }, limitInputPixels: false });
  if (scale !== 1) img = sharp(await img.resize(Math.round(W * scale), Math.round(H * scale)).raw().toBuffer(), { raw: { width: Math.round(W * scale), height: Math.round(H * scale), channels: 4 } });
  const out = await img.webp({ ...opts, exact: true }).toBuffer(); // exact: keep the RGB of transparent pixels (alpha is data here)
  writeFileSync(`public/world/${name}.webp`, out);
  log(`${name}.webp ${(out.length / 1e6).toFixed(2)} MB`);
};
if (!process.env.BOUNDS) await write('relief-a', A, { lossless: true });
if (!process.env.BOUNDS) await write('relief-b', B, { lossless: true });
if (!process.env.BOUNDS) await write('relief-c', C, { lossless: true }, 0.5);
if (!process.env.BOUNDS) await write('relief-d', D, { lossless: true }, 0.5);
if (!process.env.BOUNDS) await write('relief-v', V, { lossless: true }, 0.5);
// for the displaced mesh (reliefMesh.ts): 16-bit height (R high byte, G low byte) and antialiased land cover (B, lakes
// count as land: they are drawn over the mesh), whose 0.5 contour is the coast to within a fraction of a pixel
const Hh = new Uint8Array(N * 4);
for (let i = 0; i < N; i++) { const v = Math.round((Math.min(HEIGHT_MAX, Math.max(0, h[i])) / HEIGHT_MAX) * 65535); Hh.set([v >> 8, v & 255, enc(landRaw[i]), 255], i * 4); }
if (!process.env.BOUNDS) await write('relief-h', Hh, { lossless: true });
if (!process.env.BOUNDS) writeFileSync('src/globe/relief-bounds.json', JSON.stringify({
  lon0: LON0, lon1: LON1, lat0: LAT0, lat1: LAT1, exaggeration: EXAGGERATION, gradMax: GRAD_MAX, heightMax: HEIGHT_MAX, seaMax: SEA_MAX,
  sun: [SUN.east * Math.cos(SUN.elevation), SUN.north * Math.cos(SUN.elevation), Math.sin(SUN.elevation)],
}, null, 2) + '\n');
if (PREVIEW) { // quick look: hillshade × shadow × ao, coloured by height
  const P = new Uint8Array(N * 3);
  for (let i = 0; i < N; i++) {
    const ge = (A[i * 4] / 255 - 0.5) * 2, gn = (A[i * 4 + 1] / 255 - 0.5) * 2, g = (v) => Math.sign(v) * v * v * GRAD_MAX * EXAGGERATION;
    const nx = -g(ge), ny = -g(gn), l = (nx * SUN.east * Math.cos(SUN.elevation) + ny * SUN.north * Math.cos(SUN.elevation) + Math.sin(SUN.elevation)) / Math.hypot(nx, ny, 1);
    // rough stand-in for the shader: green in valleys and flow lines, cream on steep ground, snow up high
    const v = land[i] ? (Math.max(0, l) * (A[i * 4 + 2] / 255) * 0.85 + 0.2) * (A[i * 4 + 3] / 255) : 0.1;
    const slope = Math.hypot(g(ge), g(gn)) / EXAGGERATION, flowV = B[i * 4 + 1] / 255, hk = (B[i * 4] / 255) * HEIGHT_MAX;
    let col = [0.3, 0.42, 0.18];
    const mix = (c, k) => { col = col.map((a, j) => a + (c[j] - a) * Math.min(1, Math.max(0, k))); };
    mix([rockRGB[0][i], rockRGB[1][i], rockRGB[2][i]], smooth(0.035, 0.12, slope) * (1 - flowV));
    mix([0.2, 0.3, 0.12], flowV * 0.8);
    mix([0.95, 0.96, 0.98], smooth(2.2, 2.8, hk));
    P.set((land[i] ? col.map((c) => c * v * 1.6) : [0.05, 0.1, 0.2]).map((c) => Math.min(255, c * 255)), i * 3);
  }
  await sharp(P, { raw: { width: W, height: H, channels: 3 } }).png().toFile(PREVIEW);
  log(`preview ${PREVIEW}`);
}
