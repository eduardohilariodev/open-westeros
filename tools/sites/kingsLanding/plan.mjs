// Our own plan of King's Landing: the consensus of the official painting and three fan maps (references.mjs),
// north up, in metres, scaled so the walls enclose SITES.kingsLanding.walledAreaSqMi (the book-based estimate).
// - Flat maps are fitted to the consensus by rotation + scale + shift, the oblique painting by a homography
//   plus a relief correction (hills are painted lifted toward the viewer by height * cot(view angle)).
// - Places shared by 2+ maps are the weighted mean of where each map puts them; the wall is the weighted mean
//   of each map's wall radius around the centre. Iterated until the fits settle (generalised Procrustes).
// - Each map then gets a smooth residual warp so its own points land exactly on the consensus.
// Module: the plan and the painting <-> plan mapping, used by analyze.mjs.
// Run directly: writes assets/sites/kingsLanding/topdown.jpg (the painting unwarped onto the plan) and water.png.
// Usage: node tools/sites/kingsLanding/plan.mjs [debugDir]   -> debugDir gets a fit overlay PNG.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MILE, SITES } from '../../../src/config.ts';
import { MAPS, PAINTING } from './references.mjs';

const DIR = 'assets/sites/kingsLanding';
export const SRC = `${DIR}/kingslanding.jpg`, TOPDOWN = `${DIR}/topdown.jpg`, WATER = `${DIR}/water.png`;
export const M = 2; // metres per pixel of the top-down images
const MARGIN = 900; // m of country kept around the walls
const AREA = SITES.kingsLanding.walledAreaSqMi * MILE ** 2;
const WALL_SAMPLES = 180, RESIDUAL_SIGMA = 500; // m

// ---------- geometry ----------
const centroid = (pts) => pts.reduce(([a, b], [x, y]) => [a + x / pts.length, b + y / pts.length], [0, 0]);
const polyArea = (pts) => Math.abs(pts.reduce((s, [ax, ay], i) => { const [bx, by] = pts[(i + 1) % pts.length]; return s + ax * by - bx * ay; }, 0)) / 2;

/** Least-squares rotation + uniform scale + shift taking src to dst. */
function fitSimilarity(src, dst) {
  const pc = centroid(src), qc = centroid(dst);
  let re = 0, im = 0, d = 0;
  src.forEach(([x, y], i) => {
    const px = x - pc[0], py = y - pc[1], qx = dst[i][0] - qc[0], qy = dst[i][1] - qc[1];
    re += qx * px + qy * py; im += qy * px - qx * py; d += px * px + py * py;
  });
  const ar = re / d, ai = im / d;
  return ([x, y]) => { const dx = x - pc[0], dy = y - pc[1]; return [qc[0] + ar * dx - ai * dy, qc[1] + ai * dx + ar * dy]; };
}

function solve(A, b) { // Gaussian elimination with partial pivoting
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}
const mul = (a, b) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map((v) => v / det);
}
const applyH = (h, [x, y]) => { const w = h[6] * x + h[7] * y + h[8]; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
/** Least-squares homography (DLT on normalised points), as a 3x3 row-major matrix. */
function fitHomography(src, dst) {
  const norm = (pts) => {
    const [cx, cy] = centroid(pts), s = Math.SQRT2 / (pts.reduce((t, [x, y]) => t + Math.hypot(x - cx, y - cy), 0) / pts.length);
    return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
  };
  const Ns = norm(src), Nd = norm(dst), A = Array.from({ length: 8 }, () => Array(8).fill(0)), b = Array(8).fill(0);
  src.forEach((p, i) => {
    const [x, y] = applyH(Ns, p), [u, v] = applyH(Nd, dst[i]);
    for (const [row, t] of [[[x, y, 1, 0, 0, 0, -u * x, -u * y], u], [[0, 0, 0, x, y, 1, -v * x, -v * y], v]])
      for (let r = 0; r < 8; r++) { b[r] += row[r] * t; for (let c = 0; c < 8; c++) A[r][c] += row[r] * row[c]; }
  });
  return mul(inv3(Nd), mul([...solve(A, b), 1], Ns));
}

/** Farthest crossing of the ray from c at angle a with a closed polygon (distance), or NaN. */
function rayHit([cx, cy], a, poly) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let best = NaN;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length], ex = bx - ax, ey = by - ay;
    const den = dx * ey - dy * ex;
    if (!den) continue;
    const t = ((ax - cx) * ey - (ay - cy) * ex) / den, s = ((ax - cx) * dy - (ay - cy) * dx) / den;
    if (t > 0 && s >= 0 && s <= 1 && !(t < best)) best = t;
  }
  return best;
}

// ---------- heights (metres) on the painting ----------
const HW = 2000, HH = Math.round((2000 * 2149) / 3222);
const grey = await sharp(`${DIR}/heightmap.png`).greyscale().resize(HW, HH, { fit: 'fill' }).blur(3).raw().toBuffer();
// The heightmap reads the painter's shadow on Rhaenys's Hill as a pit; lift it back up.
const RHAENYS = [1530, 450, 34, 170, 1.5]; // x, y, m, sigma, x stretch
export function paintHeight(x, y) {
  const fx = Math.min(HW - 1.001, Math.max(0, x)), fy = Math.min(HH - 1.001, Math.max(0, y));
  const c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r, i = r * HW + c;
  const g = (grey[i] * (1 - tx) + grey[i + 1] * tx) * (1 - ty) + (grey[i + HW] * (1 - tx) + grey[i + HW + 1] * tx) * ty;
  const [hx, hy, hh, s, sx] = RHAENYS;
  return 3 + Math.max(0, g - 45) * 0.3 + hh * Math.exp(-(((x - hx) / sx) ** 2 + (y - hy) ** 2) / (2 * s * s));
}

// ---------- consensus ----------
const SOURCES = { painting: PAINTING, ...MAPS };
const shared = Object.keys(PAINTING.points).filter((n) => Object.values(SOURCES).filter((s) => s.points[n]).length >= 2);

let Hp = null, cot = 0; // painting -> plan homography, cot(view angle); no relief until the first fit
const mppAlong = (x, y) => { const a = applyH(Hp, [x, y - 0.5]), b = applyH(Hp, [x, y + 0.5]); return Math.hypot(b[0] - a[0], b[1] - a[1]); };
const lift = (x, y) => (Hp ? (paintHeight(x, y) * cot) / mppAlong(x, y) : 0); // painting px a point is raised by
const relief = ([x, y]) => [x, y + lift(x, y)]; // painted point -> its foot on the ground (painting px)
const base = {}; // source -> (its px -> plan m), before the residual warp

// Start from Sinclair's map (same orientation as the painting), scaled to the target area.
let C, wall;
{
  const s = Math.sqrt(AREA / polyArea(MAPS.sinclair.wall)), c = centroid(MAPS.sinclair.wall);
  const f = ([x, y]) => [(x - c[0]) * s, (y - c[1]) * s];
  C = Object.fromEntries(Object.entries(MAPS.sinclair.points).map(([n, p]) => [n, f(p)]));
  wall = MAPS.sinclair.wall.map(f);
}
const REF = { ...C };

for (let it = 0; it < 12; it++) {
  for (const [id, s] of Object.entries(SOURCES)) {
    const names = shared.filter((n) => s.points[n] && C[n]);
    if (id === 'painting') {
      Hp = fitHomography(names.map((n) => relief(s.points[n])), names.map((n) => C[n]));
      const [cx, cy] = centroid(PAINTING.wall), a = applyH(Hp, [cx - 0.5, cy]), b = applyH(Hp, [cx + 0.5, cy]);
      cot = 1 / Math.tan(Math.asin(Math.min(1, Math.hypot(b[0] - a[0], b[1] - a[1]) / mppAlong(cx, cy))));
      base.painting = (p) => applyH(Hp, relief(p));
    } else base[id] = fitSimilarity(names.map((n) => s.points[n]), names.map((n) => C[n]));
  }
  // weighted means
  const next = {};
  for (const n of shared) {
    let x = 0, y = 0, w = 0;
    for (const [id, s] of Object.entries(SOURCES)) if (s.points[n]) {
      const [px, py] = base[id](s.points[n]); x += px * s.weight; y += py * s.weight; w += s.weight;
    }
    next[n] = [x / w, y / w];
  }
  const c = centroid(wall), walls = Object.entries(SOURCES).map(([id, s]) => [s.weight, s.wall.map(base[id])]);
  let nextWall = [];
  for (let k = 0; k < WALL_SAMPLES; k++) {
    const a = (k / WALL_SAMPLES) * 2 * Math.PI;
    let r = 0, w = 0;
    for (const [sw, poly] of walls) { const t = rayHit(c, a, poly); if (t === t) { r += t * sw; w += sw; } }
    nextWall.push([c[0] + (Math.cos(a) * r) / w, c[1] + (Math.sin(a) * r) / w]);
  }
  // gauge: keep Sinclair's orientation, the target area, origin at the wall's centre
  const g = fitSimilarity(Object.keys(REF).map((n) => next[n]), Object.values(REF));
  nextWall = nextWall.map(g);
  const k = Math.sqrt(AREA / polyArea(nextWall)), o = centroid(nextWall), fix = ([x, y]) => [(x - o[0]) * k, (y - o[1]) * k];
  wall = nextWall.map(fix);
  C = Object.fromEntries(shared.map((n) => [n, fix(g(next[n]))]));
}

// Gates sit on the wall: snap each to the nearest point of the averaged wall.
function nearestOnWall([x, y]) {
  let best = null, d = Infinity;
  wall.forEach(([ax, ay], i) => {
    const [bx, by] = wall[(i + 1) % wall.length], ex = bx - ax, ey = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey))), p = [ax + t * ex, ay + t * ey];
    const dd = Math.hypot(p[0] - x, p[1] - y);
    if (dd < d) { d = dd; best = p; }
  });
  return best;
}
export const GATES = ['Gate of the Gods', 'Old Gate', 'Dragon Gate', 'Iron Gate', 'Lion Gate', "King's Gate", 'River Gate'];
for (const n of GATES) C[n] = nearestOnWall(C[n]);

// Residual warp per source: a Gaussian-weighted blend of its misfits at the shared points.
const warp = {}, residual = {};
for (const [id, s] of Object.entries(SOURCES)) {
  const pts = shared.filter((n) => s.points[n]).map((n) => { const b = base[id](s.points[n]); return [b, [C[n][0] - b[0], C[n][1] - b[1]]]; });
  residual[id] = Math.sqrt(pts.reduce((t, [, [dx, dy]]) => t + dx * dx + dy * dy, 0) / pts.length);
  const corr = ([x, y]) => {
    let w = 0.02, dx = 0, dy = 0;
    for (const [[px, py], [rx, ry]] of pts) {
      const k = Math.exp(-((x - px) ** 2 + (y - py) ** 2) / (2 * RESIDUAL_SIGMA ** 2));
      w += k; dx += k * rx; dy += k * ry;
    }
    return [dx / w, dy / w];
  };
  warp[id] = { corr, to: (p) => { const b = base[id](p), [dx, dy] = corr(b); return [b[0] + dx, b[1] + dy]; } };
}

// ---------- the plan (metres, x east, y south, origin at the centre of the walls) ----------
export const PLAN = {
  wall,
  places: Object.fromEntries(Object.keys(PAINTING.points).map((n) => [n, C[n] ?? warp.painting.to(PAINTING.points[n])])),
  streets: Object.fromEntries(Object.entries(PAINTING.streets).map(([n, pts]) => [n, pts.map(warp.painting.to)])),
  roads: Object.fromEntries(Object.entries(PAINTING.roads).map(([n, pts]) => [n, pts.map(warp.painting.to)])),
  // Hills: the contour ellipse's centre and semi-axis vectors (m), carried over from Sinclair's map.
  hills: Object.fromEntries(Object.entries(MAPS.sinclair.hills).map(([n, { centre: [cx, cy], axes: [a, b], angle, summit, height }]) => {
    const t = (angle * Math.PI) / 180, c = warp.sinclair.to([cx, cy]), d = (p) => { const q = warp.sinclair.to(p); return [q[0] - c[0], q[1] - c[1]]; };
    return [n, { centre: c, u: d([cx + a * Math.cos(t), cy + a * Math.sin(t)]), v: d([cx - b * Math.sin(t), cy + b * Math.cos(t)]), summit: warp.sinclair.to(summit), height }];
  })),
  noBuild: PAINTING.noBuild.map(warp.painting.to),
  title: PAINTING.title.map(warp.painting.to),
  viewAngle: Math.atan(1 / cot),
};

// ---------- pixel frame of the top-down images ----------
const xs = wall.map((p) => p[0]), ys = wall.map((p) => p[1]);
const x0 = Math.min(...xs) - MARGIN, y0 = Math.min(...ys) - MARGIN;
export const W = Math.round((Math.max(...xs) + MARGIN - x0) / M), H = Math.round((Math.max(...ys) + MARGIN - y0) / M);
export const toPx = ([x, y]) => [(x - x0) / M, (y - y0) / M];
/** Top-down pixel -> metres in the site frame (origin at the centre of the walls). */
export const toMetres = ([px, py]) => [px * M + x0, py * M + y0];
/** Painting (2000-scale) -> top-down pixel. */
export const paintToPx = (p) => toPx(warp.painting.to(p));
const HpInv = inv3(Hp);
/** Top-down pixel -> painting (2000-scale), inverting the residual warp and the relief by iteration. */
export function pxToPaint(q) {
  const [qx, qy] = toMetres(q);
  let g = [qx, qy];
  for (let k = 0; k < 4; k++) { const [dx, dy] = warp.painting.corr(g); g = [qx - dx, qy - dy]; }
  const [bx, by] = applyH(HpInv, g);
  let y = by;
  for (let k = 0; k < 5; k++) y = by - lift(bx, y);
  return [bx, y];
}
/** Top-down px per painting px (horizontally) at a painting point: converts painted sizes. */
export const scaleAt = ([x, y]) => { const a = paintToPx([x - 0.5, y]), b = paintToPx([x + 0.5, y]); return Math.hypot(b[0] - a[0], b[1] - a[1]); };

// ---------- unwarp the painting ----------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [id, r] of Object.entries(residual)) console.log(`${id.padEnd(9)} fits the consensus to ${r.toFixed(0)} m rms`);
  console.log(`view angle ${(PLAN.viewAngle * 180 / Math.PI).toFixed(1)} deg; walls ${(polyArea(wall) / MILE ** 2).toFixed(2)} sq mi`);

  const { data: rgb, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const SW = info.width, SH = info.height, K = SW / 2000, e = 25 * K; // e: skip the paper's own border
  const FILL = [226, 214, 138]; // painted countryside, for ground beyond the painting
  // The mapping is smooth: evaluate it on a coarse grid and interpolate.
  const G = 8, gw = Math.ceil(W / G) + 1, gh = Math.ceil(H / G) + 1, grid = new Float64Array(gw * gh * 2);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) grid.set(pxToPaint([i * G, j * G]), (j * gw + i) * 2);
  const out = Buffer.alloc(W * H * 3);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const fx = (px + 0.5) / G, fy = (py + 0.5) / G, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, g = (j * gw + i) * 2;
    const at = (k) => (grid[g + k] * (1 - tx) + grid[g + 2 + k] * tx) * (1 - ty) + (grid[g + gw * 2 + k] * (1 - tx) + grid[g + gw * 2 + 2 + k] * tx) * ty;
    const sx = at(0) * K - 0.5, sy = at(1) * K - 0.5, o = (py * W + px) * 3;
    if (sx < e || sy < e || sx > SW - 2 - e || sy > SH - 2 - e) { out.set(FILL, o); continue; }
    const c = Math.floor(sx), r = Math.floor(sy), u = sx - c, v = sy - r, s = (r * SW + c) * 3;
    for (let k = 0; k < 3; k++)
      out[o + k] = (rgb[s + k] * (1 - u) + rgb[s + 3 + k] * u) * (1 - v) + (rgb[s + SW * 3 + k] * (1 - u) + rgb[s + SW * 3 + 3 + k] * u) * v;
  }
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 92 }).toFile(TOPDOWN);
  console.log(`${TOPDOWN}: ${W}x${H} px at ${M} m/px`);

  // Water: the painted river and bay are grey-blue (unsaturated, not yellow). Keep big connected regions only.
  {
    const N = W * H, blur = await sharp(out, { raw: { width: W, height: H, channels: 3 } }).blur(4).raw().toBuffer();
    const m = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const r = blur[i * 3], g = blur[i * 3 + 1], b = blur[i * 3 + 2], mx = Math.max(r, g, b);
      if (mx && (mx - Math.min(r, g, b)) / mx < 0.2 && (r + g) / 2 - b < 30) m[i] = 1;
    }
    const stack = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (m[s] !== 1) continue;
      const comp = [s]; let sp = 0; stack[sp++] = s; m[s] = 2;
      while (sp) {
        const i = stack[--sp], x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && m[j] === 1) { m[j] = 2; stack[sp++] = j; comp.push(j); }
      }
      if (comp.length < 40000) for (const i of comp) m[i] = 0;
    }
    await sharp(Buffer.from(m.map((v) => (v ? 255 : 0))), { raw: { width: W, height: H, channels: 1 } }).png().toFile(WATER);
    console.log(`${WATER}: water mask`);
  }

  const debugDir = process.argv[2];
  if (debugDir) { // every map's wall and points as fitted (colours) over the consensus (white / red)
    mkdirSync(debugDir, { recursive: true });
    const col = { painting: '#ff00ff', sinclair: '#00a0ff', cziegler: '#00d000', wiki: '#ff8000' };
    const path = (pts, stroke, w) => `<polygon points="${pts.map((p) => toPx(p).join(',')).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${w}"/>`;
    const dot = (p, fill, r) => { const [x, y] = toPx(p); return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="black" stroke-width="2"/>`; };
    let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
    for (const [id, s] of Object.entries(SOURCES)) {
      svg += path(s.wall.map(base[id]), col[id], 6);
      for (const n of shared) if (s.points[n]) svg += dot(base[id](s.points[n]), col[id], 10);
    }
    svg += path(wall, 'red', 12);
    for (const n of shared) svg += dot(C[n], 'white', 16);
    for (const pts of Object.values(PLAN.streets)) svg += `<polyline points="${pts.map((p) => toPx(p).join(',')).join(' ')}" fill="none" stroke="yellow" stroke-width="8"/>`;
    const full = await sharp(TOPDOWN).composite([{ input: Buffer.from(svg + '</svg>') }]).png().toBuffer();
    await sharp(full).resize(1600).toFile(`${debugDir}/fit.png`);
    console.log('debug written to', debugDir);
  }
}
