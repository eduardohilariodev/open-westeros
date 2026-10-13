// Ground heights for the plan: the river and bay from water.png, land rising gently inland, and the three hills
// (PLAN.hills, from Sinclair's contours). Replaces the painting's heightmap, which reads painted walls and
// houses as ridges and Rhaenys's Hill as a pit. Grid nodes sit every CELL m from the top-down image's corner.
import sharp from 'sharp';
import { H, M, PLAN, W, WATER, toMetres } from './plan.mjs';

export const CELL = 8; // m
const SEA = -4, SHORE = 4, RISE = 1 / 100, RISE_MAX = 10; // m, m, m per m inland, m
const k = CELL / M;
export const cols = Math.floor(W / k) + 1, rows = Math.floor(H / k) + 1;
const wet = await sharp(WATER).greyscale().resize(cols, rows, { fit: 'fill' }).raw().toBuffer();

// Distance to water in cells (two-pass chamfer).
const N = cols * rows, dist = new Float32Array(N).fill(1e9);
for (let i = 0; i < N; i++) if (wet[i] > 127) dist[i] = 0;
const relax = (i, j, w) => { if (dist[j] + w < dist[i]) dist[i] = dist[j] + w; };
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const i = r * cols + c;
  if (c) relax(i, i - 1, 1);
  if (r) { relax(i, i - cols, 1); if (c) relax(i, i - cols - 1, Math.SQRT2); if (c < cols - 1) relax(i, i - cols + 1, Math.SQRT2); }
}
for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
  const i = r * cols + c;
  if (c < cols - 1) relax(i, i + 1, 1);
  if (r < rows - 1) { relax(i, i + cols, 1); if (c < cols - 1) relax(i, i + cols + 1, Math.SQRT2); if (c) relax(i, i + cols - 1, Math.SQRT2); }
}

// A hill: a broad dome filling its outer contour ellipse plus a rounded summit.
const hills = Object.values(PLAN.hills).map(({ centre, u, v, summit, height }) => {
  const det = u[0] * v[1] - u[1] * v[0], sigma = 0.45 * Math.hypot(...v);
  return ([x, y]) => {
    const dx = x - centre[0], dy = y - centre[1], s = (dx * v[1] - dy * v[0]) / det, t = (u[0] * dy - u[1] * dx) / det;
    const ds = (x - summit[0]) ** 2 + (y - summit[1]) ** 2;
    return height * (0.55 * Math.exp(-2.3 * (s * s + t * t)) + 0.45 * Math.exp(-ds / (2 * sigma * sigma)));
  };
});

/** Heights (m) at the grid nodes, row by row from the north. */
export const heights = new Float32Array(N);
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const i = r * cols + c, p = toMetres([c * k, r * k]), f = wet[i] / 255;
  const land = SHORE + Math.min(RISE_MAX, dist[i] * CELL * RISE) + hills.reduce((h, hill) => h + hill(p), 0);
  heights[i] = land * (1 - f) + SEA * f;
}

/** Height (m) at a top-down pixel, bilinear between grid nodes. */
export function heightAtPx([px, py]) {
  const fx = Math.min(cols - 1.001, Math.max(0, px / k)), fy = Math.min(rows - 1.001, Math.max(0, py / k));
  const c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r, i = r * cols + c, h = heights;
  return (h[i] * (1 - tx) + h[i + 1] * tx) * (1 - ty) + (h[i + cols] * (1 - tx) + h[i + cols + 1] * tx) * ty;
}
