// The terrain bake as a list of stages (run by tools/world/terrain-cli.mjs, which shows progress). The stage bodies are the
// former tools/world/relief-bake.mjs, unchanged in what they compute; they share one closure.
//  inputs -> base-height -> carve-corridors -> erosion -> flow-accumulation -> river-fields -> shader-bakes -> encode -> checks
// Output: public/world/relief-{a,b,c,d,e,h,v}.webp, relief-rivers.json (the drawn rivers as lines) and src/globe/relief-bounds.json (grid extent and encodings).
// Rivers come from the terrain: carve-corridors only lowers the ground along each canon river (a graded valley, the lore says where the big valleys are);
// flow-accumulation then lets the water find its own way (priority-flood, D8, rain); river-fields reads the network off the flow. No line is drawn as a river.
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { METRES_PER_DEGREE } from '../../../src/config.ts';
import { PLACES } from '../../../src/world-data.ts';
import { BIOMES, loadBiomes } from '../vegetation.mjs';
import { fileHash, hash } from './cache.mjs';
import { erosionFilter } from './erosion-filter.mjs';
import { accumulate, bedProfile, nearestOwner, pathPixels, priorityFlood } from './hydrology.mjs';
import { makeSinks, orientLine } from '../river-orient.mjs';

export const WORLD = [-56, 110, -5, 77]; // the Known World plus a margin: lon0, lon1, lat0, lat1

/** opts: { res = 0.035 (degrees per pixel, ~4.2 km), bounds = WORLD, write = true (public/world), outDir (write there instead, bounds json too: a test bake the globe loads with ?bake=), previewDir, previewFile } */
export function buildPipeline(opts = {}) {
  const RES = opts.res ?? 0.035, [LON0, LON1, LAT0, LAT1] = opts.bounds ?? WORLD;
  const W = Math.round((LON1 - LON0) / RES), H = Math.round((LAT1 - LAT0) / RES), N = W * H;
  const KM = (METRES_PER_DEGREE / 1000) * RES; // km per pixel, north-south
  const cosRow = Float32Array.from({ length: H }, (_, y) => Math.cos(((LAT1 - (y + 0.5) * RES) * Math.PI) / 180));
  // shared with the shader (relief-bounds.json)
  const EXAGGERATION = 6, GRAD_MAX = 0.6, HEIGHT_MAX = 9, ERO_MAX = 0.15, SEA_MAX = 600; // HEIGHT_MAX: the highest peak is ~8.15 km, 8 clipped it
  const MOUNTAIN_HEIGHT = +(process.env.MOUNTAIN_HEIGHT ?? 1.9); // scales every range before erosion; tuned for the heights logged below
  const SUN = { east: -Math.SQRT1_2, north: Math.SQRT1_2, elevation: (32 * Math.PI) / 180 };
  const HS = 1 / KM; // erosion units: km × HS, so a 1 km rise over one cell is slope 1/KM
  let T = { task() {}, note() {} }; // the running stage's reporter hooks

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
  const enc = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

  // ---------- shared state, filled stage by stage ----------
  let world, terrain, landRaw, land, lake, river, mountain, hills, forest, swamp, desert, snow;
  let UNITS, unitOf, erodibility, uplift, rockRGB, karst, cliffs, sandstone, salt, alluvium, granite, thrustD;
  let coastIn, coastOut, mountIn, mountOut, riverD, hillsB, snowB, swampB, desertB, lakeB;
  let canonFit = null, lakeLevel = [];
  let h, flow, change, ridge; // height (km), flow accumulation (rain cells), the filter's height change and its ridge map
  let A, B, C, D, V, Hh;
  // named ranges (tools/books/range-heights.json): a mask per range of the drawn mountain polygons that belong to it
  let heightsTable, ranges = [], rangeMask = [], rangeW = null, floorRegion = new Map();

  // ---------- stages ----------
  async function inputs() {
    T.task('masks', 0);
    world = JSON.parse(readFileSync('src/vector-world.json', 'utf8'));
    terrain = JSON.parse(readFileSync('src/terrain.json', 'utf8'));
    const classRings = (c) => terrain.features.filter((f) => f.properties.c === c)
      .flatMap((f) => (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]).flat());
    const lakeRings = world.lakes.flatMap((l) => l.rings);
    [landRaw, lake, river, mountain, hills, forest, swamp, desert, snow] = await Promise.all([
      raster([{ d: pathD(world.land, true) }]), raster([{ d: pathD(lakeRings, true) }]),
      raster([{ d: pathD(world.rivers, false), stroke: 1.2 }]),
      ...['mountains', 'hills', 'forest', 'swamp', 'desert', 'snow'].map((c) => raster([{ d: pathD(classRings(c), true) }])),
    ]);
    land = landRaw.map((v, i) => (v > 0.5 && lake[i] < 0.5 ? 1 : 0));
    const cover = (m) => (m.reduce((s, v) => s + (v > 0.5), 0) / N * 100).toFixed(1) + '%';
    T.note('masks ' + Object.entries({ land, lake, river, mountain, hills, forest, swamp, desert, snow }).map(([k, m]) => `${k} ${cover(m)}`).join(', '));

    // which drawn mountain polygons belong to each named range: the polygon holding the range's anchor place, else the nearest within 4°
    T.task('ranges', 0.12);
    heightsTable = JSON.parse(readFileSync('tools/books/range-heights.json', 'utf8'));
    const polys = terrain.features.filter((f) => f.properties.c === 'mountains')
      .flatMap((f) => (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]));
    const inRing = (ring, x, y) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > y) !== (ring[j][1] > y) && x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c; return c; };
    const owner = (lon, lat) => {
      let best = -1, bd = 4;
      for (const [k, p] of polys.entries()) {
        if (inRing(p[0], lon, lat)) return k;
        for (const [x, y] of p[0]) { const d = Math.hypot((x - lon) * Math.cos((lat * Math.PI) / 180), y - lat); if (d < bd) { bd = d; best = k; } }
      }
      return best;
    };
    const where = Object.fromEntries(PLACES.map(([name, , lat, lon]) => [name, [lon, lat]]));
    ranges = []; rangeMask = []; rangeW = null;
    for (const r of heightsTable.ranges) {
      const owned = new Set(r.anchors.map((a) => (where[a] ? owner(...where[a]) : -1)).filter((k) => k >= 0));
      if (!owned.size) { T.note(`range ${r.name}: no mountain polygon near its anchors, left to the geology heights`); continue; }
      const m = await raster([{ d: pathD([...owned].flatMap((k) => polys[k]), true) }]);
      ranges.push(r); rangeMask.push(Uint8Array.from(m, (v) => +(v > 0.5)));
    }
    T.note(`ranges: ${ranges.map((r, k) => `${r.name} ${rangeMask[k].reduce((s, v) => s + v, 0)} px`).join(', ')}`);
    floorRegion = new Map(); // the region each valley floor lies in
    for (const f of heightsTable.floors) {
      const region = world.regions.find((r) => r.name === f.region);
      if (region) floorRegion.set(f.name, await raster([{ d: pathD(region.polygons, true) }])); else T.note(`floor ${f.name}: no region "${f.region}"`);
    }

    // geology (tools/world/geology.json, traced from the geologic map; see docs/geology.md)
    // Affine fit, image px -> lon/lat, through towns labelled on both maps.
    T.task('geology', 0.15);
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
      T.note(`geology fit: mean ${(err.reduce((a, b) => a + b) / err.length).toFixed(2)}°, worst ${Math.max(...err).toFixed(2)}° (${geo.controlPoints[err.indexOf(Math.max(...err))][0]})`);
      return f;
    })();
    UNITS = Object.keys(geo.units); unitOf = new Uint8Array(N).fill(UNITS.indexOf(geo.default));
    for (const [k, [u, ring]] of geo.areas.entries()) {
      T.task('geology areas', 0.15 + 0.3 * (k / geo.areas.length));
      const m = await raster([{ d: pathD([ring.map(fit)], true) }]);
      for (let i = 0; i < N; i++) if (m[i] > 0.5) unitOf[i] = UNITS.indexOf(u);
    }
    T.task('rock units', 0.45);
    const unitMask = (u) => blur(Float32Array.from(unitOf, (v) => +(UNITS[v] === u)), 10);
    erodibility = blur(Float32Array.from(unitOf, (v) => geo.units[UNITS[v]].erodibility), 8); // how readily the ground wears away
    // young rock: high ranges; old rock: worn down (the power makes old ranges fall off faster than the raw factor)
    uplift = blur(Float32Array.from(unitOf, (v) => (geo.units[UNITS[v]].uplift ?? 1) ** 1.6), 25);
    rockRGB = [0, 1, 2].map((c) => blur(Float32Array.from(unitOf, (v) => geo.units[UNITS[v]].rock_rgb[c]), 6));
    [karst, cliffs, sandstone, salt, alluvium, granite] = ['P', 'D', 'O', 'salt', 'Q', null].map((u) => u
      ? unitMask(u) : blur(Float32Array.from(unitOf, (v) => +(UNITS[v] === 'gK' || UNITS[v] === 'gC' || UNITS[v] === 'pC')), 8));
    T.task('faults', 0.65);
    const thrust = await raster(geo.faults.filter((f) => f.kind === 'thrust').map((f) => ({ d: pathD([f.line.map(fit)], false), stroke: 1.5 })));
    thrustD = distance((i) => thrust[i] > 0.3);

    T.task('distances: coast', 0.75);
    coastIn = distance((i) => !land[i]); coastOut = distance((i) => land[i] === 1);
    T.task('distances: mountains, rivers', 0.82);
    mountIn = distance((i) => mountain[i] < 0.5); mountOut = distance((i) => mountain[i] >= 0.5); riverD = distance((i) => river[i] > 0.3);
    T.task('class blurs', 0.9);
    hillsB = blur(hills, 25); snowB = blur(snow, 30); swampB = blur(swamp, 12); desertB = blur(desert, 25); lakeB = blur(lake, 6);
    T.note(`grid ${W}×${H}, ${KM.toFixed(2)} km/px`);
  }

  /** Educated guesses at height, in km (the geology-driven bake; range-heights then calibrates the named ranges against the books). */
  function baseHeight() {
    h = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      if (y % 8 === 0) T.task('rows', y / H);
      for (let x = 0; x < W; x++) {
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
        const t = mountIn[i] - mountOut[i], foot = smooth(-45, 10, t), spine = smooth(-5, 30, t) ** 0.8; // the drawn ranges are narrow (tens of km across)
        // Heights are real: young ranges (Cretaceous, uplift 1) crest at 4-5 km with peaks to ~6.5, like the Alps, Rockies and
        // Andes; ranges on old rock (Cambrian to Devonian, uplift 0.5-0.65) are worn down to 2-3 km, like the Appalachians.
        const up = MOUNTAIN_HEIGHT * uplift[i];
        e += up * (0.3 * foot + 1.3 * spine) * (0.75 + 0.5 * (0.5 + 0.5 * fbm(wx / 160, wy / 160, 3)));
        e += up * 2.2 * foot * ridged(wx / 32, wy / 32, 6) * (0.3 + 0.7 * spine);
        e += snowB[i] * (0.55 + 0.1 * fbm(wx / 120, wy / 120, 3));                              // ice plateau
        e += desertB[i] * 0.06 * ridged(wx / 9, wy / 30, 2);                                     // dune fields
        // geology: ridges along the thrust fronts, granite peaks, karst plateaus, limestone sea cliffs, sandstone mesas,
        // flat salt pans, low alluvium
        e += 0.45 * Math.exp(-((thrustD[i] / 35) ** 2)) * (0.6 + 0.4 * ridged(wx / 20, wy / 20, 4)) * coastal;
        e += granite[i] * 0.5 * uplift[i] * ridged(wx / 15, wy / 15, 5);
        e += (0.45 + 0.08 * fbm(wx / 50, wy / 50, 3) - e) * karst[i] * 0.6;
        e += cliffs[i] * 0.35 * smooth(0, 12, coastIn[i]);
        if (sandstone[i] > 0.05) { const tz = e * 8; e += ((Math.floor(tz) + smooth(0.75, 1, tz % 1)) / 8 - e) * sandstone[i] * 0.8; }
        e += (0.02 - e) * salt[i];
        e *= 1 - 0.4 * alluvium[i];
        e = e * (1 - 0.35 * Math.exp(-riverD[i] / 30)) - 0.12 * Math.exp(-((riverD[i] / 5) ** 2)); // river valleys
        e = e + (0.02 - e) * Math.max(swampB[i] * 0.9, lakeB[i]);                               // swamps and lakes: low, flat
        h[i] = Math.max(0.005, e * smooth(0, 8, coastIn[i] + 2));                                 // beaches meet the sea
      }
    }
    T.note(`NaN ${h.filter(Number.isNaN).length}, max ${h.reduce((a, b) => Math.max(a, b), -9).toFixed(2)} km`);
  }

  // ---------- the named ranges: calibration against tools/books/range-heights.json ----------
  /** Per range, how far its drawn polygons reach: a blurred mask, so a range's height fades out over its foothills. */
  const weights = () => (rangeW ??= ranges.map((_, k) => { T.task(`range weights ${k + 1}/${ranges.length}`); return blur(Float32Array.from(rangeMask[k]), 40); }));
  /** The 99th percentile of a range's land cells (its ridge line), NaN where the grid holds too few. */
  const crestOf = (k) => {
    const v = []; for (let i = 0; i < N; i++) if (rangeMask[k][i] && land[i]) v.push(h[i]);
    if (v.length < 30) return NaN;
    const a = Float32Array.from(v).sort(); return a[Math.floor(a.length * 0.99)];
  };
  /** The valley floor: the median height of the floor's region, well away from the drawn ranges; NaN where the grid holds too few cells. */
  const floorMedian = (name) => {
    const m = floorRegion.get(name), v = [];
    if (m) for (let i = 0; i < N; i++) if (land[i] && m[i] > 0.5 && mountIn[i] - mountOut[i] < -45) v.push(h[i]);
    return v.length < 30 ? NaN : Float32Array.from(v).sort()[v.length >> 1];
  };
  /** ω: 0 outside a range, 1 well inside it; each range's own weight, thresholded. */
  const omega = (w) => smooth(0.15, 0.6, w);

  async function rangeHeights() { // calibrate the ranges, then valley floors, ceilings and the hard peaks (the tall ones the books give a figure for)
    const weights_ = ranges.length ? weights() : [];
    // 0. calibration, closed loop on whatever the stages before made (the droplet erosion lowers crests and wears peaks down, so this
    // runs after it): measure each range's crest, scale its heights toward the table's target, measure again. The scale fades over the
    // foothills with the range's blurred mask.
    if (ranges.length) {
      const h0 = Float32Array.from(h), s = ranges.map(() => 1);
      for (let pass = 0; pass < 4; pass++) {
        T.task(`calibrating ranges, pass ${pass + 1}/4`, 0.05 + 0.1 * pass);
        for (let i = 0; i < N; i++) {
          if (!land[i]) continue;
          let sw = 0, sd = 0; for (let k = 0; k < weights_.length; k++) { sw += weights_[k][i]; sd += weights_[k][i] * (s[k] - 1); }
          h[i] = h0[i] * (1 + sd / Math.max(1, sw));
        }
        ranges.forEach((r, k) => { const c = crestOf(k); if (c > 0) s[k] = Math.min(4, Math.max(0.2, s[k] * (r.crest / c))); });
      }
      for (let i = 0; i < N; i++) { // the last correction, applied
        if (!land[i]) continue;
        let sw = 0, sd = 0; for (let k = 0; k < weights_.length; k++) { sw += weights_[k][i]; sd += weights_[k][i] * (s[k] - 1); }
        h[i] = h0[i] * (1 + sd / Math.max(1, sw));
      }
      T.note(`range multipliers: ${ranges.map((r, k) => `${r.name.replace('The ', '')} ×${s[k].toFixed(2)}`).join(', ')}`);
    }
    // 1. floors: a large fertile basin sits low, whatever the foothills of the ranges around it would make of it
    const floors = [];
    for (const f of heightsTable.floors) {
      T.task(`floor ${f.name}`, 0.1);
      if (!floorRegion.has(f.name)) continue;
      const mask = blur(floorRegion.get(f.name), 12);
      let n = 0;
      for (let i = 0; i < N; i++) {
        if (!land[i] || mask[i] < 0.02) continue;
        const t = mountIn[i] - mountOut[i], lowland = 1 - smooth(-45, -5, t), wv = mask[i] * lowland; // away from the drawn range, inside the region
        if (wv > 0.02 && h[i] > f.elevation) { h[i] = f.elevation + (h[i] - f.elevation) * (1 - 0.88 * Math.min(1, wv * 1.3)); n++; }
      }
      floors.push({ name: f.name, median: floorMedian(f.name) });
      T.note(`floor ${f.name}: ${n} cells lowered toward ${f.elevation} km, median now ${floors.at(-1).median.toFixed(2)} km`);
    }
    // 2. ceilings: every range tops out at its table summit; ground in no named range at the default (so only the named tall ranges stand higher)
    T.task('ceilings', 0.4);
    const cap0 = heightsTable.default.summitCap, soft = 0.6;
    for (let i = 0; i < N; i++) {
      if (!land[i] || h[i] < 1.5) continue;
      let so = 0, sd = 0;
      for (let k = 0; k < weights_.length; k++) { const o = omega(weights_[k][i]); so += o; sd += o * (ranges[k].summit - cap0); }
      const cap = cap0 + sd / Math.max(1, so);
      if (h[i] > cap - soft) h[i] = cap - soft + soft * (1 - Math.exp(-(h[i] - cap + soft) / soft)); // saturates at cap
    }
    // 3. peaks: a cone to the figure the book states, on top of the terrain
    for (const p of heightsTable.peaks) {
      T.task(`peak ${p.name}`, 0.7);
      const at = PLACES.find((q) => q[0] === p.place), floor = floors.find((f) => f.name === p.aboveFloor);
      if (!at || !floor || Number.isNaN(floor.median)) { T.note(`peak ${p.name}: needs place "${p.place}" and floor "${p.aboveFloor}" in the grid`); continue; }
      const [lat, lon] = [at[2], at[3]], cx = Math.round((lon - LON0) / RES), cy = Math.round((LAT1 - lat) / RES);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const target = floor.median + p.km, R = p.radiusKm, X0 = kmX(cx, cy), Y0 = kmY(cy), r = Math.ceil((3 * R) / KM) + 2;
      for (let y = Math.max(0, cy - r); y < Math.min(H, cy + r); y++) for (let x = Math.max(0, cx - Math.ceil(r / cosRow[y])); x < Math.min(W, cx + Math.ceil(r / cosRow[y])); x++) {
        const d = Math.hypot(kmX(x, y) - X0, kmY(y) - Y0), cone = Math.exp(-((d / R) ** 1.5));
        if (cone < 0.02) continue;
        const jag = 1 - 0.1 * smooth(0, R, d) * (0.5 - 0.5 * noise(kmX(x, y) / 9, kmY(y) / 9)); // a jagged peak, not a smooth bump
        h[y * W + x] = Math.max(h[y * W + x], target * cone * jag);
      }
      T.note(`peak ${p.name}: ${target.toFixed(2)} km (${floor.median.toFixed(2)} floor + ${p.km})`);
    }
    for (let i = 0; i < N; i++) if (land[i] && h[i] < 0.003) h[i] = 0.003; // scaling a range's foothills must not sink the shore below the land floor
  }

  // ---------- rivers: the canon polylines are corridors; the terrain is carved around them, water collects in them ----------
  const GRID = { W, H, KM, cosRow };
  const RIVER_CELLS = Math.round(90 * (0.035 / RES) ** 2); // flow accumulation, in rain cells, that makes a river: ~1,300 km² of catchment at any resolution
  const SMOOTH_KM = 10;                                    // km of low-pass on a canon line before the valley is carved along it
  const RIVER_SMOOTH_KM = 6;                               // km of low-pass on each river's traced line before the distance field is taken
  const BRANCH_CELLS = RIVER_CELLS * 4;                    // a river off the canon needs ~5,000 km² of catchment to be drawn: few branches, the books' rivers lead
  const MIN_CHAIN_KM = 30;                                 // a branch shorter than this that no other river joins is a stub on the canon river: dropped
  const MIN_SPUR = 4;                                      // river cells: a source branch shorter than this, hanging off a river, is a spike and is dropped
  const DIST_MAX = 40;                                     // km the distance-to-river field reaches; the shader reads it from relief-bounds.json
  const RIVER_WIDTH_KM = [0.12, 1.6], RIVER_DEPTH_KM = [0.003, 0.02]; // headwater to the largest river; shared with the shader the same way
  let canon = [], pathId = null, corridor = null, netMask = null, RE = null, riverLines = [], riverStats = null, flowUnresolved = 0, recvMap = null;

  /**
   * The canon line, relaxed: the SVG draws a river as straight segments with sharp corners, and a valley carved along those corners makes the water zigzag.
   * Resampled every km and low-passed (Gaussian, sigma SMOOTH_KM), the ends held by reflecting the line through them; the books say where the river runs
   * to within a few km, not how it bends. Returns lon/lat.
   */
  function smoothLine(line) {
    const lat0 = line.reduce((m, p) => m + p[1], 0) / line.length, kx = (METRES_PER_DEGREE / 1000) * Math.cos((lat0 * Math.PI) / 180), ky = METRES_PER_DEGREE / 1000;
    const xy = line.map(([lo, la]) => [lo * kx, la * ky]), pts = [xy[0]];
    for (let i = 1; i < xy.length; i++) { const [ax, ay] = pts[pts.length - 1], [bx, by] = xy[i], d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(d)); for (let k = 1; k <= n; k++) pts.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]); }
    const n = pts.length, R = Math.ceil(3 * SMOOTH_KM), wgt = Float64Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-0.5 * ((k - R) / SMOOTH_KM) ** 2));
    const at = (i) => (i < 0 ? [2 * pts[0][0] - pts[-i < n ? -i : n - 1][0], 2 * pts[0][1] - pts[-i < n ? -i : n - 1][1]] : i >= n ? [2 * pts[n - 1][0] - pts[Math.max(0, 2 * (n - 1) - i)][0], 2 * pts[n - 1][1] - pts[Math.max(0, 2 * (n - 1) - i)][1]] : pts[i]);
    const out = pts.map((_, i) => { let sx = 0, sy = 0, sw = 0; for (let k = -R; k <= R; k++) { const q = at(i + k), w = wgt[k + R]; sx += q[0] * w; sy += q[1] * w; sw += w; } return [sx / sw / kx, sy / sw / ky]; });
    out[0] = line[0]; out[n - 1] = line[line.length - 1];
    return out.filter((_, i) => i % 2 === 0 || i === n - 1); // every 2 km is plenty for 4 km pixels
  }

  /** The canon rivers (src/vector-world.json) as pixel paths from source to mouth, each with a bed that never rises downstream, and the valleys carved around them. */
  function carveCorridors() {
    T.task('canon river paths', 0);
    const toPx = ([lon, lat]) => [(lon - LON0) / RES, (LAT1 - lat) / RES];
    T.task('which way each canon river flows', 0.02); // the lines are stored mouth -> source: tools/world/river-orient.mjs
    const sinks = makeSinks(world), raw = world.rivers.map((_, i) => pathPixels(smoothLine(orientLine(world, i, sinks).line).map(toPx), W, H)).filter((p) => p.length >= 3);
    const hs = blur(h, 6), maxLen = raw.reduce((m, p) => Math.max(m, p.length), 1);
    canon = []; pathId = new Int32Array(N).fill(-1);
    const src = new Uint8Array(N), bedAt = new Float32Array(N).fill(1e9), qAt = new Float32Array(N);
    for (const [k, p0] of raw.entries()) {
      let p = [], seen = new Map(); // a polyline that comes back over its own pixels (a ring) would be a flow loop: cut it where it closes
      for (const i of p0) { if (seen.has(i)) { p.length = seen.get(i) + 1; for (const [kk, v] of seen) if (v >= p.length) seen.delete(kk); } else { seen.set(i, p.length); p.push(i); } }
      if (p.length < 3) continue;
      const n = p.length, qr = Math.sqrt(n / maxLen); // a river's size: its length against the longest, growing toward the mouth
      const q = Float32Array.from(p, (_, j) => qr * (0.15 + 0.85 * Math.pow(j / (n - 1), 0.7)));
      const ground = Float32Array.from(p, (_, j) => { let s = 0, c = 0; for (let t = -2; t <= 2; t++) if (j + t >= 0 && j + t < n) { s += hs[p[j + t]]; c++; } return s / c; });
      const bed = bedProfile(ground, Float32Array.from(q, (v) => 0.006 + 0.03 * v), 0.001);
      p.forEach((i, j) => { if (pathId[i] < 0) pathId[i] = k; src[i] = 1; bedAt[i] = Math.min(bedAt[i], bed[j]); qAt[i] = Math.max(qAt[i], q[j]); });
      canon.push({ path: Int32Array.from(p), q, bed, qr });
    }
    T.task('distance to the rivers', 0.4);
    const { d, own } = nearestOwner(GRID, src);
    corridor = { d, own, bedAt, qAt };
    reincise();
    T.note(`${canon.length} canon rivers, ${src.reduce((s, v) => s + v, 0)} pixels; valleys carved (wide and shallow on the big ones, narrow and steep at the headwaters)`);
  }
  /** Lower the ground toward each river's bed: a valley of half-width Wv with sides rising Wv-wide to G, then 25% slopes (gorges through the high ground).
   *  Blended with a smooth minimum, and the ground's own small relief kept on the floor: a hard min left a flat band with a terrace edge, seen from orbit as a margin. */
  function reincise() {
    const { d, own, bedAt, qAt } = corridor, K = 0.04, hs = blur(h, 3);
    for (let i = 0; i < N; i++) {
      if (!land[i] || d[i] > 60 || own[i] < 0) continue;
      const o = own[i], bed = bedAt[o], q = qAt[o], Wv = 2 + 10 * q ** 0.8, G = 0.02 + 0.10 * (1 - Math.sqrt(q));
      const hv = d[i] < Wv ? bed + G * (d[i] / Wv) ** 1.2 : bed + G + 0.25 * (d[i] - Wv);
      const a = h[i], t = Math.min(1, Math.max(0, 0.5 + (0.5 * (a - hv)) / K)); if (t <= 0) continue;
      const m = a + (hv - a) * t - K * t * (1 - t); // smooth min(a, hv)
      const keep = 0.6 * (a - hs[i]) * t * Math.min(1, d[i] / 1.5); // the swells and gullies, faded out on the bed itself so it never rises
      h[i] = Math.max(0.003, Math.min(a, m + keep));
    }
  }

  // ---------- the erosion filter (Rune Skovbo Johansen), plains swells included ----------
  const FILTER = { scale: 30, octaves: 4, lacunarity: 2, gain: 0.5, cellScale: 0.7, normalization: 0.5, gullyWeight: 0.55, detail: 1.5,
    rounding: [0.1, 0, 0.1, 2], assumedSlope: [0.15, 1], strengthMountain: 0.035, strengthPlain: 0.0016, onsetMountain: 5, onsetPlain: 150 };
  function erosionFilterStage() {
    const F = FILTER; ridge = new Float32Array(N); change = new Float32Array(N);
    // low, long swells on the plains: 10-60 m of relief at 20 km wavelengths, so lowland is never a ruled surface
    T.task('plains swells', 0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!land[i]) continue;
      const low = (1 - smooth(-60, 10, mountIn[i] - mountOut[i])) * (1 - 0.7 * hillsB[i]) * smooth(5, 50, coastIn[i]) * (1 - Math.max(swampB[i] * 0.9, lakeB[i]));
      if (low < 0.01) continue;
      const X = kmX(x, y), Y = kmY(y);
      h[i] += low * (0.04 * fbm(X / 24 + 11, Y / 24, 3) + 0.012 * fbm(X / 9 - 5, Y / 9, 2));
    }
    T.task('slopes', 0.05);
    const hs = blur(h, 5), hd = blur(h, 14), hb = blur(h, 25), dev = blur(Float32Array.from(h, (v, i) => Math.abs(v - hb[i])), 25);
    const grad = (a, x, y, cx) => {
      const xl = Math.max(0, x - 1), xr = Math.min(W - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
      return [(a[y * W + xr] - a[y * W + xl]) / ((xr - xl) * cx), (a[yu * W + x] - a[yd * W + x]) / ((yd - yu) * KM)]; // east, north: km per km
    };
    const out = Float32Array.from(h);
    for (let y = 0; y < H; y++) {
      if (y % 8 === 0) T.task('gullies', 0.1 + 0.88 * (y / H));
      const cx = KM * cosRow[y];
      for (let x = 0; x < W; x++) {
        const i = y * W + x; if (!land[i]) continue;
        const [gx, gy] = grad(hs, x, y, cx), [dx, dy] = grad(hd, x, y, cx), m = smooth(0.03, 0.22, Math.hypot(gx, gy));
        const strength = (F.strengthPlain + (F.strengthMountain - F.strengthPlain) * m) * Math.min(1.4, Math.max(0.5, 0.6 + 0.5 * erodibility[i]));
        const o0 = F.onsetPlain + (F.onsetMountain - F.onsetPlain) * m;
        const fade = Math.max(-1, Math.min(1, (h[i] - hb[i]) / (1.2 * dev[i] + 0.03)));
        const r = erosionFilter(kmX(x, y), kmY(y), hs[i], gx, gy, dx, dy, fade, strength, F.gullyWeight, F.detail, F.rounding,
          [o0, o0, o0 * 2, o0 * 1.2], F.assumedSlope, F.scale, F.octaves, F.lacunarity, F.gain, F.cellScale, F.normalization);
        const offset = (-0.3 + (-r.fade + 0.3) * 0.7) * r.magnitude; // raises valleys, lowers peaks: the extremes stay put
        const dh = (r.dh + offset) * smooth(0, 15, coastIn[i]);   // beaches meet the sea
        out[i] = Math.max(0.003, h[i] + dh); change[i] = (out[i] - h[i]) * HS; ridge[i] = r.ridge;
      }
    }
    h = out;
    const top = h.reduce((m, v, i) => (land[i] && v > h[m] ? i : m), 0);
    T.note(`filter: scale ${F.scale} km, ${F.octaves} octaves; highest point ${h[top].toFixed(2)} km at ${(LON0 + (top % W) * RES).toFixed(1)}°, ${(LAT1 - Math.floor(top / W) * RES).toFixed(1)}°`);
  }

  // ---------- flow accumulation: where the water of the final terrain goes ----------
  /**
   * Lakes are bowls under a flat surface. The filter and the shaping stages leave bumps inside a lake mask, and the globe lays the water over the
   * terrain a few metres above it, so a bump shows as land inside the lake with a moat of water at the shore. Each lake (a connected piece of the lake
   * mask) gets one level, the 10th percentile of the ground on its shore (so it never stands above all the shore, and a low spill side is where it
   * would run out), and a smooth floor below it that deepens with the distance from the shore: 5 m at the edge, 1.2 m more per km, 40 m at most
   * (assumption: lowland lakes; canon gives no depths, see decisions/0001).
   */
  function lakeBasins() {
    T.task('lake levels', 0);
    const label = new Int32Array(N).fill(-1), levels = []; let n = 0;
    const stack = new Int32Array(N);
    for (let i0 = 0; i0 < N; i0++) {
      if (lake[i0] < 0.5 || label[i0] >= 0) continue;
      let sp = 0; stack[sp++] = i0; label[i0] = n;
      const shore = new Set();
      while (sp > 0) {
        const c = stack[--sp], x = c % W, y = (c / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy; if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (lake[j] >= 0.5) { if (label[j] < 0) { label[j] = n; stack[sp++] = j; } } else if (land[j]) shore.add(j);
        }
      }
      const hs = [...shore].map((j) => h[j]).sort((a, b) => a - b);
      levels.push(hs.length ? Math.max(0.003, hs[Math.floor(hs.length * 0.1)]) : 0.003); n++;
    }
    T.task('lake floors', 0.5);
    const shoreMask = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (land[i]) { const x = i % W, y = (i / W) | 0; if ((x > 0 && lake[i - 1] >= 0.5) || (x < W - 1 && lake[i + 1] >= 0.5) || (y > 0 && lake[i - W] >= 0.5) || (y < H - 1 && lake[i + W] >= 0.5)) shoreMask[i] = 1; }
    const { d } = nearestOwner(GRID, shoreMask);
    for (let i = 0; i < N; i++) if (label[i] >= 0) h[i] = Math.max(0.0005, levels[label[i]] - Math.min(0.04, 0.005 + 0.0012 * d[i]));
    lakeLevel = levels;
    T.note(`${n} lakes levelled (${levels.length ? `levels ${Math.min(...levels).toFixed(3)} to ${Math.max(...levels).toFixed(3)} km` : 'none'})`);
  }
  function flowAccumulation() {
    T.task('carving the valleys again', 0);
    reincise(); // the filter and the range scaling must not lift a bed or leave a river on a slope
    lakeBasins();
    T.task('filling depressions', 0.1);
    const { recv } = priorityFlood({ W, H }, h, land);
    { // The canon valleys drain into their river: on a canon path each cell drains to the next one, and on the valley floor (reincise's Wv) each cell
      // steps toward the river as the carved floor slopes. After the fill a floor is nearly flat, and D8 left the water wandering beside the canon line:
      // twins, and tributaries that ended in them. A step that closes a loop goes back to the fill's own receiver.
      T.task('canon valleys drain into their rivers', 0.3);
      const fill = Int32Array.from(recv), { d, own, qAt } = corridor;
      const pinned = new Uint8Array(N); // where two canon paths share a cell, the first one routes it
      for (const c of canon) for (let j = 0; j + 1 < c.path.length; j++) { const a = c.path[j], b = c.path[j + 1]; if (land[a] && land[b] && !pinned[a]) { recv[a] = b; pinned[a] = 1; } }
      for (let i = 0; i < N; i++) {
        if (!land[i] || pathId[i] >= 0 || own[i] < 0 || d[i] >= 2 + 10 * qAt[own[i]] ** 0.8) continue;
        const x = i % W, y = (i / W) | 0; let best = -1, bd = d[i];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, k = yy * W + xx;
          if ((dx || dy) && xx >= 0 && yy >= 0 && xx < W && yy < H && land[k] && d[k] < bd) { bd = d[k]; best = k; }
        }
        if (best >= 0) recv[i] = best;
      }
      const state = new Uint8Array(N); let undone = 0; // 0 new, 1 on the walk, 2 known to reach an outlet
      for (let s = 0; s < N; s++) {
        if (state[s]) continue;
        const walk = []; let c = s;
        while (c >= 0 && land[c] && state[c] === 0) { state[c] = 1; walk.push(c); c = recv[c]; }
        if (c >= 0 && land[c] && state[c] === 1) { // a loop: revert its cells to the fill's receivers (which never loop) and walk again
          const at = walk.indexOf(c); for (const q of walk.slice(at)) { recv[q] = fill[q]; undone++; }
          for (const q of walk) state[q] = 0; s--; continue;
        }
        for (const q of walk) state[q] = 2;
      }
      T.note(`canon valleys drain into their rivers (${undone} cells kept the fill's way, to close no loop)`);
    }
    // Each canon river gets a spring
    // at its source (and again where it leaves a lake), as big as it is drawn, so a small river of the books is not lost to a threshold.
    const inject = new Map();
    for (const c of canon) {
      const p = c.path;
      for (let j = 0; j < p.length; j++) if (land[p[j]] && (j === 0 || !land[p[j - 1]])) inject.set(p[j], Math.max(inject.get(p[j]) ?? 0, RIVER_CELLS * (1.2 + 6 * c.qr)));
    }
    T.task('accumulating', 0.7);
    const rain = new Float32Array(N);
    for (let i = 0; i < N; i++) if (land[i]) rain[i] = cosRow[(i / W) | 0] * (1 - 0.75 * desertB[i]);
    for (const [i, v] of inject) rain[i] += v;
    const acc = accumulate(recv, rain, land);
    flow = acc.Q; flowUnresolved = acc.unresolved; recvMap = recv;
    let rivers = 0, big = 0; for (let i = 0; i < N; i++) if (land[i] && flow[i] >= RIVER_CELLS) { rivers++; if (flow[i] > RIVER_CELLS * 30) big++; }
    T.note(`${rivers} river cells (${big} large); ${flowUnresolved} cells left in a flow cycle`);
  }

  /** The river network from the flow: every cell above the river threshold plus every canon path; the distance to the nearest one and its size, for the shader (relief-e). */
  function riverFields() {
    T.task('river cells', 0);
    const canonMask = new Uint8Array(N); for (let i = 0; i < N; i++) if (pathId[i] >= 0 && land[i]) canonMask[i] = 1;
    { // how closely the simulated water follows the books: km from each canon path pixel to the nearest cell of the sim's own network
      const sim = new Uint8Array(N); for (let i = 0; i < N; i++) if (land[i] && flow[i] >= RIVER_CELLS) sim[i] = 1;
      const { d } = nearestOwner(GRID, sim), ds = []; for (const c of canon) for (const i of c.path) if (land[i]) ds.push(d[i]);
      ds.sort((x, y) => x - y); const at = (f) => ds[Math.min(ds.length - 1, Math.floor(ds.length * f))] ?? 0;
      canonFit = { n: ds.length, within8: ds.filter((v) => v <= 8).length / Math.max(1, ds.length), within16: ds.filter((v) => v <= 16).length / Math.max(1, ds.length), median: at(0.5), p90: at(0.9) };
    }
    // What is drawn: the canon rivers on their own paths (below), and off them the sim's big rivers, each down its own drainage until it reaches
    // another river or the sea (the canon valleys drain into their river: flowAccumulation), so nothing runs beside a canon river or stops short of it
    const QrefSim = (() => { const a = []; for (let i = 0; i < N; i++) if (land[i] && flow[i] >= RIVER_CELLS) a.push(flow[i]); return Float32Array.from(a).sort()[Math.floor(a.length * 0.999)] || RIVER_CELLS; })();
    netMask = new Uint8Array(N); let cells = 0;
    for (let i = 0; i < N; i++) if (land[i] && flow[i] >= BRANCH_CELLS && !canonMask[i]) { netMask[i] = 1; cells++; }
    { // a source branch only a few cells long that joins a river is a spike, not a tributary: drop it (a canon river's own source is kept)
      const donors = new Uint8Array(N); for (let i = 0; i < N; i++) if (netMask[i]) { const r = recvMap[i]; if (r >= 0 && netMask[r]) donors[r]++; }
      const spring = new Set(canon.map((c) => c.path[0])); let dropped = 0;
      for (let i = 0; i < N; i++) {
        if (!netMask[i] || donors[i] > 0 || spring.has(i)) continue;
        const run = []; let c = i;
        while (c >= 0 && netMask[c] && donors[c] <= 1 && run.length <= MIN_SPUR) { run.push(c); c = recvMap[c]; }
        if (run.length <= MIN_SPUR && c >= 0 && netMask[c] && donors[c] >= 2) { for (const q of run) netMask[q] = 0; donors[c]--; dropped++; cells -= run.length; }
      }
      T.note(`${dropped} spikes dropped (source branches of at most ${MIN_SPUR} cells)`);
    }
    T.task('distance and size', 0.3);
    const Qref = QrefSim; // sizes against the sim's whole network
    T.task('packing relief-e', 0.7);
    // The network as lines. The D8 drainage steps along rows and diagonals (on a flat plain that is a zigzag of long horizontal runs and 45 degree turns),
    // so each river is traced from its source down to the junction or the sea, resampled every km and low-passed (Gaussian, RIVER_SMOOTH_KM, the ends held),
    // and the distance field is to those lines. The water is where the drainage put it, the line it is drawn along is only the smooth version.
    T.task('tracing and smoothing the rivers', 0.5);
    const donors = new Uint8Array(N); for (let i = 0; i < N; i++) if (netMask[i]) { const r = recvMap[i]; if (r >= 0 && netMask[r]) donors[r]++; }
    const visited = new Uint8Array(N), SX0 = [], SY0 = [], SX1 = [], SY1 = [], SC = [], SQ = [], SCH = [], segOf = new Int32Array(N).fill(-1), src = new Uint8Array(N);
    const R = Math.ceil(3 * RIVER_SMOOTH_KM), wgt = Float64Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-0.5 * ((k - R) / RIVER_SMOOTH_KM) ** 2));
    const chains = [], cellChain = new Int32Array(N).fill(-1);
    const smoothChain = (cells, fl, host) => {
      const cs = cosRow[(cells[Math.floor(cells.length / 2)] / W) | 0], kx = KM * cs;
      const xy = cells.map((q) => [((q % W) + 0.5) * kx, -(((q / W) | 0) + 0.5) * KM]);
      const pts = [xy[0]], pq = [fl[0]];
      for (let i = 1; i < xy.length; i++) { const [ax, ay] = pts[pts.length - 1], [bx, by] = xy[i], d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(d)); for (let k = 1; k <= n; k++) { pts.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]); pq.push(fl[i - 1] + ((fl[i] - fl[i - 1]) * k) / n); } }
      const n = pts.length, at = (i) => (i < 0 ? [2 * pts[0][0] - pts[Math.min(n - 1, -i)][0], 2 * pts[0][1] - pts[Math.min(n - 1, -i)][1]] : i >= n ? [2 * pts[n - 1][0] - pts[Math.max(0, 2 * (n - 1) - i)][0], 2 * pts[n - 1][1] - pts[Math.max(0, 2 * (n - 1) - i)][1]] : pts[i]);
      const sm = pts.map((_, i) => { if (i === 0 || i === n - 1) return [...pts[i]]; let sx = 0, sy = 0, sw = 0; for (let k = -R; k <= R; k++) { const q = at(i + k), w = wgt[k + R]; sx += q[0] * w; sy += q[1] * w; sw += w; } return [sx / sw, sy / sw]; });
      return { sm, pq, cs, kx, host };
    };
    // The canon rivers first, on their own paths (source to mouth, cut at the sea), never smaller than the flow the sim gathered there nor than their
    // place among the books' rivers (q: length against the longest)
    // A path through a lake is split there and goes on below it (each piece reaches one cell into the water), so the river below a lake is drawn
    // and the tributaries that join it there have a river to join.
    const joinAt = new Map(); // canon chain -> the canon cell its end flowed into
    canon.forEach((c) => {
      let cells = [], fl = [], run = BRANCH_CELLS, wet = -1, stop = -1;
      const close = () => {
        if (cells.length >= 2) { for (const i of cells) if (land[i] && i !== stop) { visited[i] = 1; cellChain[i] = chains.length; } chains.push(smoothChain(cells, fl, -1)); }
        cells = []; fl = [];
      };
      for (let j = 0; j < c.path.length; j++) {
        const i = c.path[j];
        if (!land[i]) { if (cells.length) { cells.push(i); fl.push(run); close(); } wet = i; continue; }
        if (wet >= 0 && !cells.length) { cells.push(wet); fl.push(run); } // out of the water: start from it
        wet = -1; run = Math.max(run, flow[i], QrefSim * c.q[j] * c.q[j]); cells.push(i); fl.push(run);
      }
      // A book's line that stops on land (a few km short of the river it feeds, as drawn) goes on down the sim's own drainage until it meets
      // another canon river: the water keeps flowing, it is not pinned to the other line. Which chain that is is known once all are built.
      if (cells.length && land[cells[cells.length - 1]]) {
        let k = recvMap[cells[cells.length - 1]], steps = 0;
        while (k >= 0 && land[k] && pathId[k] < 0 && steps++ < 200) { cells.push(k); fl.push(Math.max(run, flow[k])); k = recvMap[k]; }
        if (k >= 0 && land[k] && pathId[k] >= 0) { cells.push(k); fl.push(run); joinAt.set(chains.length, stop = k); }
      }
      close();
    });
    for (const [b, k] of joinAt) if (chains[b] && cellChain[k] >= 0 && cellChain[k] !== b) chains[b].host = cellChain[k];
    const nCanon = chains.length;
    const ends = { joined: 0, water: 0, canonUndrawn: 0, landUndrawn: 0, noReceiver: 0 }; // how each traced river ends (status line)
    for (let h0 = 0; h0 < N; h0++) {
      if (!netMask[h0] || donors[h0] > 0) continue;
      const cells = [], id = chains.length; let c = h0, host = -1;
      while (c >= 0) {
        cells.push(c);
        if (visited[c] || !netMask[c]) {
          if (visited[c] && cellChain[c] !== id) host = cellChain[c]; // it flowed into a river (a canon one on its own path, or another branch)
          ends[host >= 0 ? 'joined' : !land[c] ? 'water' : pathId[c] >= 0 ? 'canonUndrawn' : 'landUndrawn']++;
          break;
        }
        visited[c] = 1; cellChain[c] = id; c = recvMap[c];
        if (c < 0) ends.noReceiver++;
      }
      if (cells.length < 2) continue;
      chains.push(smoothChain(cells, cells.map((q) => flow[q] || RIVER_CELLS), host));
    }
    T.note(`river ends: ${Object.entries(ends).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    { // stubs: short branches no other river joins (canon chains come first and are kept)
      const hosted = new Uint8Array(chains.length); for (const b of chains) if (b.host >= 0) hosted[b.host] = 1;
      let stubs = 0; chains.forEach((b, k) => { if (k >= nCanon &&!hosted[k] && b.sm.length < MIN_CHAIN_KM) { chains[k] = null; stubs++; } });
      T.note(`${stubs} stubs dropped (branches under ${MIN_CHAIN_KM} km)`);
    }
    // A tributary ends on the cell where it joined, but the river it joins has been smoothed away from that cell. Move the tributary's end onto the nearest
    // point of the host's smoothed line and fade the shift in over the last RIVER_SMOOTH_KM * 2 km, so the two meet instead of leaving a gap and a hook.
    for (const b of chains) {
      if (!b || b.host < 0 || !chains[b.host]) continue;
      const hc = chains[b.host], E = b.sm[b.sm.length - 1]; let best = 1e18, P = E;
      for (let i = 0; i + 1 < hc.sm.length; i++) { // the host's segments in this river's frame
        const ax = (hc.sm[i][0] / hc.kx) * b.kx, ay = hc.sm[i][1], ex = (hc.sm[i + 1][0] / hc.kx) * b.kx - ax, ey = hc.sm[i + 1][1] - ay, len2 = ex * ex + ey * ey || 1e-9;
        if (Math.abs(ax - E[0]) > 40 && Math.abs(ax + ex - E[0]) > 40) continue;
        const u = Math.min(1, Math.max(0, ((E[0] - ax) * ex + (E[1] - ay) * ey) / len2)), qx = ax + u * ex, qy = ay + u * ey, d2 = (qx - E[0]) ** 2 + (qy - E[1]) ** 2;
        if (d2 < best) { best = d2; P = [qx, qy]; }
      }
      const dx = P[0] - E[0], dy = P[1] - E[1], span = Math.min(b.sm.length - 1, 2 * RIVER_SMOOTH_KM);
      for (let k = 0; k <= span; k++) { const wt = (1 - k / span) ** 2, i = b.sm.length - 1 - k; b.sm[i][0] += dx * wt; b.sm[i][1] += dy * wt; }
    }
    chains.forEach((b, chainId) => {
      if (!b) return;
      const { sm, pq, cs, kx } = b;
      for (let i = 0; i + 1 < sm.length; i++) {
        const id = SX0.length; SX0.push(sm[i][0]); SY0.push(sm[i][1]); SX1.push(sm[i + 1][0]); SY1.push(sm[i + 1][1]); SC.push(cs); SQ.push(pq[i]); SCH.push(chainId);
        const px = Math.floor(sm[i][0] / kx), py = Math.floor(-sm[i][1] / KM); if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const pi = py * W + px; if (segOf[pi] < 0 || SQ[segOf[pi]] < pq[i]) segOf[pi] = id; src[pi] = 1;
      }
    });
    // The same lines for the globe to draw as vector lines up close (relief-rivers.json): from 600 km a 4.2 km texel of the distance field is
    // ~6 px, and where two rivers meet inside one the field's blend makes forks and hooks. Lon, lat (0.001°, ~100 m) and size qn, every 2 km.
    const qOf = (f) => Math.min(1, Math.log1p(f / RIVER_CELLS) / Math.log1p(QrefSim / RIVER_CELLS));
    riverLines = chains.filter(Boolean).map(({ sm, pq, kx }) => sm.flatMap(([x, y], i) => (i % 2 && i !== sm.length - 1 ? [] : [
      +(LON0 + (x / kx) * RES).toFixed(3), +(LAT1 + (y / KM) * RES).toFixed(3), +qOf(pq[i]).toFixed(2)])));
    T.task('distance and size', 0.7);
    const near = nearestOwner(GRID, src);
    RE = new Uint8Array(N * 4);
    // Signed distance: positive on the left of the river's flow, negative on the right. A river between two texels then reads +a on one and -b on the
    // other, so bilinear filtering puts the centre line where it is, at a fraction of a texel (an unsigned distance would read a and b, never 0).
    for (let i = 0; i < N; i++) {
      const o = near.own[i], sg = o >= 0 ? segOf[o] : -1;
      let sd = DIST_MAX, qn = 0;
      if (sg >= 0) {
        const kx = KM * SC[sg], vx = ((i % W) + 0.5) * kx, vy = -(((i / W) | 0) + 0.5) * KM; let dist = 1e9, side = 1, qs = SQ[sg];
        for (let t = Math.max(0, sg - 3); t <= sg + 3 && t < SX0.length; t++) { // the nearest segment among the few either side along the same river
          if (SCH[t] !== SCH[sg]) continue;
          const ex = SX1[t] - SX0[t], ey = SY1[t] - SY0[t], len2 = ex * ex + ey * ey || 1e-9, u = Math.min(1, Math.max(0, ((vx - SX0[t]) * ex + (vy - SY0[t]) * ey) / len2));
          const dd = Math.hypot(vx - SX0[t] - u * ex, vy - SY0[t] - u * ey);
          if (dd < dist) { dist = dd; side = ex * (vy - SY0[t]) - ey * (vx - SX0[t]) >= 0 ? 1 : -1; qs = SQ[t]; }
        }
        sd = Math.min(DIST_MAX, dist) * side;
        qn = Math.min(1, Math.log1p(qs / RIVER_CELLS) / Math.log1p(Qref / RIVER_CELLS));
      }
      const v = Math.round(((sd / DIST_MAX + 1) / 2) * 65535);
      RE.set([v >> 8, v & 255, enc(qn), enc(0.5 + 0.5 * ridge[i])], i * 4);
    }
    riverStats = { cells, Qref };
    T.note(`${cells} river cells; canon paths: ${(canonFit.within8 * 100).toFixed(0)}% within 8 km of a river cell, median ${canonFit.median.toFixed(1)} km, 90th percentile ${canonFit.p90.toFixed(1)} km; Qref ${Qref.toFixed(0)} cells`);
  }

  async function shaderBakes() { // slope, cast shadow, ambient occlusion, flow, erosion, class masks, ground colour
    T.task('blurs', 0);
    const hb = (r) => blur(h, r);
    const [hb4, hb16, hb60] = [hb(4 * KM / 4.2), hb(16), hb(60)];
    const landFlow = flow.filter((_, i) => land[i]).sort(), flowMax = Math.log1p(landFlow[Math.floor(landFlow.length * 0.995)]); // 99.5th percentile
    const tanE = Math.tan(SUN.elevation), steps = []; for (let s = 1; s < 400; s = s < 8 ? s + 1 : s * 1.2) steps.push(s * KM);
    A = new Uint8Array(N * 4); B = new Uint8Array(N * 4); C = new Uint8Array(N * 4);
    for (let y = 0; y < H; y++) {
      if (y % 8 === 0) T.task('slope, shadow, occlusion', 0.1 + 0.6 * (y / H));
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
    T.task('moisture', 0.72);
    const moist = blur(Float32Array.from({ length: N }, (_, i) => (desert[i] > 0.5 ? 0 : swamp[i] > 0.5 ? 1 : forest[i] > 0.5 ? 0.75 : 0.5)), 30);
    // vegetation (tools/world/vegetation.mjs): each pixel's biome from the fan vegetation map, for the ground's colour and tree cover
    T.task('vegetation', 0.78);
    const biomeAt = await loadBiomes(), biome = new Int16Array(N).fill(-1), named = (n) => BIOMES.findIndex((b) => b[0] === n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (landRaw[y * W + x] > 0.02) biome[y * W + x] = biomeAt(LON0 + (x + 0.5) * RES, LAT1 - (y + 0.5) * RES);
    for (let pass = 0, changed = true; pass < 12 && changed; pass++) { // where the coasts differ a little: the nearest biome, ~50 km at most
      T.task('vegetation: filling gaps', 0.82 + 0.06 * (pass / 12));
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
    T.task('ground colour', 0.9);
    const albedo = [0, 1, 2].map((c) => blur(Float32Array.from(biome, (b) => BIOMES[b][2][c]), 2)), canopy = blur(Float32Array.from(biome, (b) => BIOMES[b][3]), 3);
    V = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) V.set([enc(albedo[0][i]), enc(albedo[1][i]), enc(albedo[2][i]), 255], i * 4);
    const snowC = blur(snow, 6);
    for (let i = 0; i < N; i++) C.set([enc(canopy[i]), enc(moist[i]), enc(snowC[i]), 255], i * 4); // opaque: resizing premultiplies by alpha
    D = new Uint8Array(N * 4); // bare-rock colour from the geology, and erodibility
    for (let i = 0; i < N; i++) D.set([enc(rockRGB[0][i]), enc(rockRGB[1][i]), enc(rockRGB[2][i]), enc(erodibility[i] / 2)], i * 4);
    // for the displaced mesh (reliefMesh.ts): 16-bit height (R high byte, G low byte) and antialiased land cover (B, lakes
    // count as land: they are drawn over the mesh), whose 0.5 contour is the coast to within a fraction of a pixel
    Hh = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) { const v = Math.round((Math.min(HEIGHT_MAX, Math.max(0, h[i])) / HEIGHT_MAX) * 65535); Hh.set([v >> 8, v & 255, enc(landRaw[i]), 255], i * 4); }
  }

  async function encode() {
    const dir = opts.outDir ?? 'public/world';
    mkdirSync(dir, { recursive: true });
    const files = [['relief-a', A, 1], ['relief-b', B, 1], ['relief-c', C, 0.5], ['relief-d', D, 0.5], ['relief-v', V, 0.5], ['relief-h', Hh, 1], ['relief-e', RE, 1]];
    for (const [k, [name, data, scale]] of files.entries()) {
      T.task(`${name}.webp`, k / files.length);
      let img = sharp(data, { raw: { width: W, height: H, channels: 4 }, limitInputPixels: false });
      if (scale !== 1) img = sharp(await img.resize(Math.round(W * scale), Math.round(H * scale)).raw().toBuffer(), { raw: { width: Math.round(W * scale), height: Math.round(H * scale), channels: 4 } });
      const out = await img.webp({ lossless: true, exact: true }).toBuffer(); // exact: keep the RGB of transparent pixels (alpha is data here)
      writeFileSync(`${dir}/${name}.webp`, out);
      T.note(`${name}.webp ${(out.length / 1e6).toFixed(2)} MB`);
    }
    writeFileSync(`${dir}/relief-rivers.json`, JSON.stringify(riverLines)); // [[lon, lat, q, ...] per river]: the globe's vector rivers
    writeFileSync(opts.outDir ? `${dir}/relief-bounds.json` : 'src/globe/relief-bounds.json', JSON.stringify({
      lon0: LON0, lon1: LON1, lat0: LAT0, lat1: LAT1, exaggeration: EXAGGERATION, gradMax: GRAD_MAX, heightMax: HEIGHT_MAX, seaMax: SEA_MAX,
      riverSigned: true, riverDistMax: DIST_MAX, riverWidthKm: RIVER_WIDTH_KM, riverDepthKm: RIVER_DEPTH_KM, riverCells: RIVER_CELLS, // relief-e: R,G distance to the nearest river (16 bit), B its size, A the filter's ridge map
      sun: [SUN.east * Math.cos(SUN.elevation), SUN.north * Math.cos(SUN.elevation), Math.sin(SUN.elevation)],
    }, null, 2) + '\n');
  }

  // ---------- checks (each returns {name, state: 'ok' | 'fail' | 'pending', detail}) ----------
  function terrainChecks() {
    let nan = 0, max = -9, lowLand = 0, wetSea = 0;
    for (let i = 0; i < N; i++) {
      const v = h[i];
      if (Number.isNaN(v)) nan++; else if (v > max) max = v;
      if (land[i] && v < 0.003) lowLand++;
      if (!land[i] && lake[i] < 0.5 && v >= 0) wetSea++;
    }
    const ok = (c) => (c ? 'ok' : 'fail');
    return [
      { name: `max height ≤ ${HEIGHT_MAX} km`, state: ok(max <= HEIGHT_MAX), detail: `${max.toFixed(2)} km` },
      { name: 'no NaN heights', state: ok(nan === 0), detail: `${nan}` },
      { name: 'land ≥ 0.003 km', state: ok(lowLand === 0), detail: `${lowLand} cells below` },
      { name: 'sea cells at or above 0 (info)', state: 'ok', detail: `${wetSea} (shelf noise; the mesh hides them by land cover)` },
      ...riverChecks(),
      ...rangeChecks(),
    ];
  }

  /** The rivers: canon corridors are pinned, so they stay within a pixel (4.2 km, under the 4 mi shore and 6 mi river tolerances) of the drawn line. */
  function riverChecks() {
    if (!riverStats) return [{ name: 'rivers: the water follows the books', state: 'pending', detail: 'the river stages have not run' }];
    const f = canonFit;
    let rises = 0; for (const c of canon) for (let j = 1; j < c.bed.length; j++) if (c.bed[j] > c.bed[j - 1] + 1e-6) rises++;
    return [
      { name: 'rivers: canon rivers are followed (90% of path pixels within 16 km of a river cell)', state: f.within16 >= 0.9 ? 'ok' : 'fail', detail: `${(f.within8 * 100).toFixed(1)}% within 8 km, ${(f.within16 * 100).toFixed(1)}% within 16 km, median ${f.median.toFixed(1)} km, 90th percentile ${f.p90.toFixed(1)} km, of ${f.n} pixels` },
      { name: 'rivers: beds never rise downstream', state: rises === 0 ? 'ok' : 'fail', detail: `${rises} rising steps` },
      { name: 'rivers: no flow cycles', state: flowUnresolved === 0 ? 'ok' : 'fail', detail: `${flowUnresolved} cells` },
      { name: 'rivers: network size (info)', state: 'ok', detail: `${riverStats.cells} river cells` },
    ];
  }

  /** Heights against tools/books/range-heights.json: lore claims fail the run, assumptions only warn when they drift. */
  function rangeChecks() {
    if (!heightsTable) return [];
    const tol = heightsTable.tolerance, out = [];
    const stat = (k) => {
      const v = []; let top = -9; for (let i = 0; i < N; i++) if (rangeMask[k][i] && land[i]) { v.push(h[i]); if (h[i] > top) top = h[i]; }
      if (v.length < 30) return null;
      return { crest: Float32Array.from(v).sort()[Math.floor(v.length * 0.99)], summit: top };
    };
    const rows = ranges.map((r, k) => ({ r, s: stat(k) }));
    for (const { r, s } of rows) {
      if (!s) { out.push({ name: `${r.name} (${r.basis})`, state: 'pending', detail: 'outside this window' }); continue; }
      const off = Math.abs(s.crest - r.crest) / r.crest, over = s.summit > r.summit * (1 + tol.summit);
      out.push({ name: `${r.name} (${r.basis})`, state: off <= tol.crest && !over ? 'ok' : 'warn', detail: `crest ${s.crest.toFixed(2)} km (aim ${r.crest}), summit ${s.summit.toFixed(2)} (cap ${r.summit})` });
    }
    // lore: the Bones are the tallest range of the known world
    const bones = rows.find(({ r }) => r.name === 'The Bone Mountains');
    if (bones?.s) {
      let worst = null;
      for (const { r, s } of rows) if (s && r !== bones.r && (!worst || s.summit > worst.s.summit)) worst = { r, s };
      let top = -9; for (let i = 0; i < N; i++) if (land[i] && h[i] > top) top = h[i];
      const ok = top <= bones.s.summit + 0.01 && (!worst || worst.s.summit < bones.s.summit);
      out.push({ name: 'lore: the Bones are the tallest range', state: ok ? 'ok' : 'fail', detail: `Bones ${bones.s.summit.toFixed(2)} km; highest elsewhere ${top > bones.s.summit + 0.01 ? top.toFixed(2) + ' km' : worst ? `${worst.r.name} ${worst.s.summit.toFixed(2)} km` : 'none'}` });
    } else out.push({ name: 'lore: the Bones are the tallest range', state: 'pending', detail: 'outside this window' });
    // lore: the Giant's Lance is 3.5 miles above the valley floor
    for (const p of heightsTable.peaks) {
      const at = PLACES.find((q) => q[0] === p.place);
      const cx = at ? Math.round((at[3] - LON0) / RES) : -1, cy = at ? Math.round((LAT1 - at[2]) / RES) : -1;
      if (!at || cx < 3 || cy < 3 || cx >= W - 3 || cy >= H - 3) { out.push({ name: `lore: ${p.name} above the valley floor`, state: 'pending', detail: 'outside this window' }); continue; }
      let top = -9; for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) top = Math.max(top, h[(cy + j) * W + cx + i]);
      const floor = floorMedian(p.aboveFloor);
      if (Number.isNaN(floor)) { out.push({ name: `lore: ${p.name} above the valley floor`, state: 'pending', detail: 'the floor is outside this window' }); continue; }
      const above = top - floor;
      out.push({ name: `lore: ${p.name} ${p.km} km above the ${p.aboveFloor.replace('The ', '')}`, state: Math.abs(above - p.km) <= tol.peak ? 'ok' : 'fail', detail: `${above.toFixed(2)} km (summit ${top.toFixed(2)}, floor ${floor.toFixed(2)})` });
    }
    return out;
  }

  // ---------- previews ----------
  /** Hillshade of the current height, a rough stand-in for the shader: coloured by height, sea and lakes in blue. */
  async function hillshade(file, mode) {
    mkdirSync(opts.previewDir, { recursive: true });
    const P = new Uint8Array(N * 3), sx = SUN.east * Math.cos(SUN.elevation), sy = SUN.north * Math.cos(SUN.elevation), sz = Math.sin(SUN.elevation);
    const ramp = (k, a, b) => a.map((v, j) => v + (b[j] - v) * Math.min(1, Math.max(0, k)));
    for (let y = 0; y < H; y++) {
      const cx = KM * cosRow[y];
      for (let x = 0; x < W; x++) {
        const i = y * W + x, xl = Math.max(0, x - 1), xr = Math.min(W - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
        const ge = (h[y * W + xr] - h[y * W + xl]) / ((xr - xl) * cx), gn = (h[yu * W + x] - h[yd * W + x]) / ((yd - yu) * KM);
        const nx = -ge * EXAGGERATION, ny = -gn * EXAGGERATION, l = Math.max(0, (nx * sx + ny * sy + sz) / Math.hypot(nx, ny, 1));
        let col;
        if (!land[i] && lake[i] < 0.5) col = ramp(-h[i] / 3, [0.16, 0.3, 0.45], [0.04, 0.1, 0.22]);
        else if (lake[i] >= 0.5) col = [0.25, 0.45, 0.65];
        else { const hk = h[i]; col = ramp(smooth(0.8, 2.2, hk), ramp(smooth(0.1, 0.8, hk), [0.32, 0.45, 0.22], [0.55, 0.5, 0.33]), ramp(smooth(2.2, 3.4, hk), [0.5, 0.45, 0.4], [0.95, 0.95, 0.97])); }
        if (land[i]) { // the river stages draw what they made: the canon paths, then the simulated rivers by size
          if (mode === 'carve-corridors' && pathId && pathId[i] >= 0) col = [0.1, 0.3, 0.8];
          else if ((mode === 'flow-accumulation' || mode === 'river-fields') && flow && flow[i] >= RIVER_CELLS) col = ramp(Math.log1p(flow[i] / RIVER_CELLS) / 6, [0.35, 0.6, 0.9], [0.05, 0.2, 0.65]);
        }
        const shade = land[i] || lake[i] >= 0.5 ? 0.3 + 0.95 * l : 0.8 + 0.3 * l;
        P.set(col.map((c) => Math.min(255, c * shade * 255)), i * 3);
      }
    }
    await sharp(P, { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
  }
  /** The fuller quick look after shader-bakes (slope, shadow, occlusion, flow, rock colour), as the old bake wrote with a preview argument. */
  async function bakePreview(file) {
    mkdirSync(opts.previewDir, { recursive: true });
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
    await sharp(P, { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
  }

  // ---------- the stage list ----------
  const params = { RES, bounds: [LON0, LON1, LAT0, LAT1], MOUNTAIN_HEIGHT, FILTER, RIVER_CELLS, DIST_MAX, RIVER_WIDTH_KM, RIVER_DEPTH_KM };
  const baseKey = hash(JSON.stringify(params), fileHash(new URL(import.meta.url)), fileHash('src/vector-world.json'), fileHash('src/terrain.json'), fileHash('tools/world/geology.json'), fileHash('tools/books/range-heights.json'));
  const stages = [
    { name: 'inputs', weight: 20, run: inputs, info: () => `${W}×${H} px, ${KM.toFixed(2)} km/px` },
    { name: 'base-height', weight: 25, run: baseHeight, preview: 'base-height',
      cache: { get: () => ({ arrays: { h } }), set: ({ h: v }) => { h = v; } } },
    { name: 'carve-corridors', weight: 10, run: carveCorridors, preview: 'carve-corridors', info: () => `${canon.length} canon rivers` }, // not cached: it fills the corridor state the later stages read
    { name: 'erosion-filter', weight: 40, run: erosionFilterStage, preview: 'erosion-filter',
      cache: { get: () => ({ arrays: { h, change, ridge } }), set: ({ h: a, change: c, ridge: r }) => { h = a; change = c; ridge = r; } } },
    { name: 'range-heights', weight: 40, run: rangeHeights, preview: 'range-heights',
      cache: { get: () => ({ arrays: { h } }), set: ({ h: v }) => { h = v; } } },
    { name: 'flow-accumulation', weight: 25, run: flowAccumulation, preview: 'flow-accumulation',
      cache: { get: () => ({ arrays: { h, flow, recv: Float32Array.from(recvMap) } }), set: ({ h: a, flow: f, recv: r }) => { h = a; flow = f; recvMap = Int32Array.from(r); } } },
    { name: 'river-fields', weight: 12, run: riverFields, preview: 'river-fields' },
    { name: 'shader-bakes', weight: 30, run: shaderBakes, preview: 'shader-bakes' },
    { name: 'encode', weight: 10, run: encode, off: () => (opts.write === false && !opts.outDir ? 'window: nothing written to public/world' : null) },
  ];
  let key = baseKey;
  for (const s of stages) { key = hash(key, s.name); s.key = key; }

  return {
    stages, size: { W, H, KM }, checks: terrainChecks,
    setReporter: (r) => { T = r; },
    async preview(name, dir) {
      opts.previewDir = dir;
      const file = `${dir}/${name}.png`;
      if (name === 'shader-bakes') await bakePreview(file); else await hillshade(file, name);
      if (opts.previewFile && name === 'shader-bakes') await bakePreview(opts.previewFile);
      return file;
    },
  };
}
