// Analyses the top-down city map (plan.mjs output) and writes public/sites/kingsLanding/{city.json, ground.png}.
// Positions of the wall, gates and places come from the consensus plan; houses, trees and streets are read off the
// unwarped painting; heights from terrain.mjs. Run plan.mjs first.
// Usage: node tools/sites/kingsLanding/analyze.mjs [debugDir]   -> debugDir gets an alignment overlay PNG.
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { MILE } from '../../../src/config.ts';
import { GATES, M, PLAN, TOPDOWN as SRC, WATER as WATER_MASK, paintToPx as P, scaleAt, toMetres, toPx } from './plan.mjs';
import { CELL, cols as tCols, heights, rows as tRows } from './terrain.mjs';
import { PAINTING } from './references.mjs';

const OUT = 'public/sites/kingsLanding';
const debugDir = process.argv[2];
mkdirSync(OUT, { recursive: true });

const { data: rgb, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels, N = W * H;
const waterMask = await sharp(WATER_MASK).greyscale().raw().toBuffer();

// Places to model or label: [name, kind, footprint radius in painting px (2000-wide copy)]; positions from the plan.
// kind: castle | sept | pit | hall | square | place | district | hill | tower | street | road | water
const LANDMARKS = [
  ['The Red Keep', 'castle', 90], ['Great Sept of Baelor', 'sept', 45], ['Dragonpit', 'pit', 38],
  ['Guildhall of the Alchemists', 'hall', 18], ['West Barracks', 'hall', 18], ['East Barracks', 'hall', 18], ['Fishmarket', 'hall', 12],
  ["Cobbler's Square", 'square', 22], ["Fishmonger's Square", 'square', 16], ['Plaza of the Sept', 'square', 30],
  ["Chataya's", 'place', 0], ["Shae's Manse", 'place', 0], ["Littlefinger's Brothel", 'place', 0], ['Shop of Tobho Mott', 'place', 0],
  ['Tourney Grounds', 'place', 0], ['Flea Bottom', 'district', 0],
  ["Visenya's Hill", 'hill', 0], ["Rhaenys's Hill", 'hill', 0], ["Aegon's High Hill", 'hill', 0], ['Winch Towers', 'tower', 0],
  ['Street of Steel', 'street', 0], ['Street of the Sisters', 'street', 0], ['Street of Silk', 'street', 0], ['Muddy Way', 'street', 0],
  ['The Hook', 'street', 0], ['River Row', 'street', 0],
  ['Kingsroad', 'road', 0], ['Goldroad', 'road', 0], ['Rosby road', 'road', 0],
  ['Blackwater Rush', 'water', 0], ['Blackwater Bay', 'water', 0],
];

// ---------- per-pixel features ----------
const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), L = new Float32Array(N), S = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const r = rgb[i * C], g = rgb[i * C + 1], b = rgb[i * C + 2];
  R[i] = r; G[i] = g; B[i] = b;
  L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  S[i] = mx ? (mx - mn) / mx : 0;
}

// Box blur via summed-area table (radius r, clamped at edges).
function blur(src, w, h, r) {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += src[y * w + x]; sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

const Lm = blur(L, W, H, 4);
const L2 = blur(L.map((v) => v * v), W, H, 4);
const tex = Lm.map((m, i) => Math.sqrt(Math.max(0, L2[i] - m * m))); // local contrast
const Sb = blur(S, W, H, 6), Bb = blur(B, W, H, 6), Rb = blur(R, W, H, 6), Gb = blur(G, W, H, 6), Lb = blur(L, W, H, 6);
const Lwide = blur(L, W, H, 10);

// ---------- classes ----------
const WATER = 1, COUNTRY = 2, BUILT = 3, STREET = 4, TREE = 5;
const cls = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const yellow = (Rb[i] + Gb[i]) / 2 - Bb[i];
  if (waterMask[i] > 127) cls[i] = WATER;
  else if (Lb[i] > 165 && yellow > 55 && tex[i] < 14) cls[i] = COUNTRY;
  else if (L[i] - Lwide[i] > 10 && tex[i] < 30) cls[i] = STREET;
  else cls[i] = BUILT;
}
// Trees: green-dominant clumps (forests outside, gardens inside).
const Gs = blur(G, W, H, 3), Rs = blur(R, W, H, 3), Bs = blur(B, W, H, 3);
for (let i = 0; i < N; i++) if (cls[i] !== WATER && Gs[i] > Rs[i] + 2 && Gs[i] - Bs[i] > 45) cls[i] = TREE;

// Margins and title cartouche: countryside.
{
  const m = 30, title = PLAN.title.map(toPx);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (x < m || y < m || x >= W - m || y >= H - m || inPoly(x, y, title)) {
      const i = y * W + x; if (cls[i] !== WATER) cls[i] = COUNTRY;
    }
}

const mask = (k) => Float32Array.from(cls, (c) => (c === k ? 1 : 0));
const builtF = blur(mask(BUILT), W, H, 3);
const streetF = blur(mask(STREET), W, H, 5);
const treeF = blur(mask(TREE), W, H, 3);
const waterF = blur(mask(WATER), W, H, 8);

// Street orientation via structure tensor of the street-density gradient.
const gxx = new Float32Array(N), gxy = new Float32Array(N), gyy = new Float32Array(N);
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const i = y * W + x, gx = streetF[i + 1] - streetF[i - 1], gy = streetF[i + W] - streetF[i - W];
  gxx[i] = gx * gx; gxy[i] = gx * gy; gyy[i] = gy * gy;
}
const Jxx = blur(gxx, W, H, 12), Jxy = blur(gxy, W, H, 12), Jyy = blur(gyy, W, H, 12);
const streetAngle = (i) => 0.5 * Math.atan2(2 * Jxy[i], Jxx[i] - Jyy[i]) + Math.PI / 2; // along the street

// ---------- geometry helpers ----------
const wallPx = PLAN.wall.map(toPx), noBuildPx = PLAN.noBuild.map(toPx);
const texF = blur(tex, W, H, 6);
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distToWall(x, y) {
  let d = Infinity;
  for (let i = 0; i < wallPx.length; i++) {
    const [ax, ay] = wallPx[i], [bx, by] = wallPx[(i + 1) % wallPx.length];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    d = Math.min(d, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)));
  }
  return d;
}
let seed = 1337;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// ---------- terrain ----------
// terrain.mjs's grid, every other node (16 m) to keep city.json and the mesh small.
const SKIP = 2, STEP = (CELL / M) * SKIP, cols = Math.floor((tCols - 1) / SKIP) + 1, rows = Math.floor((tRows - 1) / SKIP) + 1;
const terrain = new Float32Array(cols * rows);
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) terrain[r * cols + c] = heights[r * SKIP * tCols + c * SKIP];
function heightAt(x, y) { // bilinear on the terrain grid, so buildings sit exactly on the rendered ground
  const fx = Math.min(cols - 1.001, Math.max(0, x / STEP)), fy = Math.min(rows - 1.001, Math.max(0, y / STEP));
  const c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r, i = r * cols + c;
  return (terrain[i] * (1 - tx) + terrain[i + 1] * tx) * (1 - ty) + (terrain[i + cols] * (1 - tx) + terrain[i + cols + 1] * tx) * ty;
}

// ---------- placement ----------
const toWorld = (x, y) => toMetres([x, y]).map((v) => +v.toFixed(1));
const landmarkPx = LANDMARKS.map(([name, kind, rad]) => ({ name, kind, p: toPx(PLAN.places[name]), rad: rad * scaleAt(PAINTING.points[name]) }));
const gatePx = GATES.map((name) => ({ name, p: toPx(PLAN.places[name]) }));
const blocked = (x, y) =>
  landmarkPx.some((l) => l.rad && Math.hypot(x - l.p[0], y - l.p[1]) < l.rad) ||
  gatePx.some((g) => Math.hypot(x - g.p[0], y - g.p[1]) < 34 / M) ||
  distToWall(x, y) < 24 / M;

const rich = [[1465, 760, 1.0, 330], [655, 618, 0.6, 260], [500, 380, 0.35, 300]].map(([x, y, a, s]) => [...P([x, y]), a, s * scaleAt([x, y])]);
const poor = P([1330, 535]), poorSigma = 250 * scaleAt([1330, 535]);

const ROOFS = [[158, 74, 47], [138, 90, 60], [112, 106, 102], [168, 118, 63], [125, 63, 42], [150, 96, 70]];
const buildings = []; // x, z, y, w, d, h, rot, roofColor, wallColor, inside(1/0)
const trees = [];     // x, z, y, scale
const GRID = Math.round(16 / M); // one house per ~16 m cell
for (let gy = GRID; gy < H - GRID; gy += GRID) for (let gx = GRID; gx < W - GRID; gx += GRID) {
  const x = gx + (rnd() - 0.5) * 4, y = gy + (rnd() - 0.5) * 4, i = Math.round(y) * W + Math.round(x);
  if (waterF[i] > 0.05 || blocked(x, y)) continue;
  const inside = inPoly(x, y, wallPx);
  if (treeF[i] > 0.45 && rnd() < 0.8) {
    trees.push(...toWorld(x, y), +heightAt(x, y).toFixed(1), +(0.7 + rnd() * 0.6).toFixed(2));
    continue;
  }
  if (builtF[i] < (inside ? 0.6 : 0.75) || streetF[i] > 0.35) continue;
  if (!inside && (texF[i] < 12 || inPoly(x, y, noBuildPx))) continue; // paper stains, cliffs
  const [wx, wz] = toWorld(x, y);
  let wealth = 0;
  for (const [rx, ry, a, s] of rich) wealth += a * Math.exp(-((x - rx) ** 2 + (y - ry) ** 2) / (2 * s * s));
  wealth -= 0.5 * Math.exp(-((x - poor[0]) ** 2 + (y - poor[1]) ** 2) / (2 * poorSigma ** 2));
  if (!inside) wealth -= 0.3;
  const floors = Math.max(1, Math.round(1 + rnd() * 1.6 + wealth * 2.5));
  const len = 10.5 + rnd() * 6 + wealth * 4.5, dep = 7.5 + rnd() * 4.5; // m
  // Roof: painting colour pulled toward tile / slate / thatch so it reads as roofs; walls: light plaster.
  const tone = ROOFS[Math.floor(rnd() * ROOFS.length)], src = [Rs[i], Gs[i], Bs[i]];
  const rc = src.map((v, k) => v * 0.45 + tone[k] * 0.55);
  const wc = src.map((v, k) => v * 0.2 + [236, 226, 204][k] * 0.8 - rnd() * 18);
  const hex = (c) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
  buildings.push(wx, wz, +heightAt(x, y).toFixed(1), +len.toFixed(1), +dep.toFixed(1), +(2.5 + floors * 3.2).toFixed(1),
    +(-streetAngle(i)).toFixed(3), hex(rc), hex(wc), inside ? 1 : 0);
}

const city = {
  metresPerPixel: M, size: [W * M, H * M],
  terrain: { cols, rows, step: STEP * M, h: Array.from(terrain, (v) => Math.round(v * 10) / 10) },
  wall: wallPx.map(([x, y]) => [...toWorld(x, y), +heightAt(x, y).toFixed(1)]),
  gates: gatePx.map(({ name, p }) => ({ name, kind: 'gate', pos: [...toWorld(...p), +heightAt(...p).toFixed(1)] })),
  landmarks: landmarkPx.map(({ name, kind, p, rad }) => ({ name, kind, pos: [...toWorld(...p), +heightAt(...p).toFixed(1)], radius: +(rad * M).toFixed(1) })),
  buildings: { stride: 10, data: buildings },
  trees: { stride: 4, data: trees },
};
writeFileSync(`${OUT}/city.json`, JSON.stringify(city));
console.log(`buildings ${buildings.length / 10}, trees ${trees.length / 4}, terrain ${cols}x${rows}`);
{ // check against the book-based estimates: ~10-20 sq mi inside the walls, ~12-16 mi of wall
  const pts = wallPx.map((p) => toMetres(p));
  let area = 0, len = 0;
  pts.forEach(([ax, ay], i) => { const [bx, by] = pts[(i + 1) % pts.length]; area += ax * by - bx * ay; len += Math.hypot(bx - ax, by - ay); });
  const inside = buildings.filter((_, k) => k % 10 === 9 && buildings[k]).length;
  console.log(`walls: ${(Math.abs(area) / 2 / MILE ** 2).toFixed(1)} sq mi enclosed, ${(len / MILE).toFixed(1)} mi long; ` +
    `${inside} houses inside (~${Math.round(400_000 / inside)} people each for 400,000)`);
}

// Ground texture from the classes.
{
  const pal = { [WATER]: [70, 95, 105], [COUNTRY]: [176, 178, 112], [BUILT]: [150, 132, 104], [STREET]: [196, 182, 150], [TREE]: [92, 120, 62] };
  const img = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) img.set(pal[cls[i]], i * 3);
  await sharp(img, { raw: { width: W, height: H, channels: 3 } }).blur(1.2).resize(2048).png().toFile(`${OUT}/ground.png`);
}

if (debugDir) {
  mkdirSync(debugDir, { recursive: true });
  const img = Buffer.from(rgb.filter((_, k) => C === 3 || k % C < 3));
  const dot = (x, y, c, r = 1) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = Math.round(x) + dx, yy = Math.round(y) + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) img.set(c, (yy * W + xx) * 3); } };
  for (let k = 0; k < buildings.length; k += 10) dot(buildings[k] / M + W / 2, buildings[k + 1] / M + H / 2, [255, 0, 255]);
  for (let k = 0; k < trees.length; k += 4) dot(trees[k] / M + W / 2, trees[k + 1] / M + H / 2, [0, 255, 0]);
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${wallPx.map((p) => p.join(',')).join(' ')}" fill="none" stroke="red" stroke-width="5"/>
    ${gatePx.map(({ p }) => `<circle cx="${p[0]}" cy="${p[1]}" r="14" fill="blue"/>`).join('')}
    ${landmarkPx.map(({ p, rad }) => `<circle cx="${p[0]}" cy="${p[1]}" r="${Math.max(rad, 8)}" fill="none" stroke="cyan" stroke-width="5"/>`).join('')}
  </svg>`;
  const full = await sharp(img, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  await sharp(full).resize(2000).toFile(`${debugDir}/overlay.png`);
  console.log('debug written to', debugDir);
}
