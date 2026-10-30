// Coast fit of the reference house map: lon/lat -> poster pixel, a cubic found by a grid search of an axis-aligned affine on
// land/sea agreement, then trimmed ICP of our coastline onto the poster's coast (degree 1, 2, 3). About a minute.
// Writes LON0, LAT0, SC, cx, cy into tools/world/house-poster.json (keeps the anchors). Usage: node tools/world/house-poster-fit.mjs
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = 'tools/world/house-poster.json', prev = JSON.parse(readFileSync(OUT, 'utf8')), POSTER = prev.poster;
const D = 4;
const meta = await sharp(POSTER).metadata();
const { data, info } = await sharp(POSTER).removeAlpha().resize(Math.round(meta.width / D)).raw().toBuffer({ resolveWithObject: true });
const w = info.width, h = info.height;
const isSea = (i) => { const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2]; return Math.max(r, g, b) - Math.min(r, g, b) < 55 && b > r + 12 && b < 160 && r < 125; };
const sea = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) sea[i] = isSea(i);
// ROI: Westeros below the Wall, west of Essos
const X1 = 1960 / D, Y0 = 700 / D, Y1 = 3760 / D;
const coast = [];
for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
  const i = y * w + x; if (sea[i] || x > X1 || y < Y0 || y > Y1) continue;
  if (sea[i - 1] || sea[i + 1] || sea[i - w] || sea[i + w]) coast.push([x, y]);
}
// nearest coast pixel map by multi-source BFS
const near = new Int32Array(w * h).fill(-1); const q = [];
coast.forEach(([x, y], k) => { near[y * w + x] = k; q.push(y * w + x); });
for (let qi = 0; qi < q.length; qi++) { const i = q[qi]; for (const j of [i - 1, i + 1, i - w, i + w]) if (j >= 0 && j < w * h && near[j] < 0) { near[j] = near[i]; q.push(j); } }

const world = JSON.parse(readFileSync('src/vector-world.json', 'utf8'));
const ours = [];
for (const ring of world.land) for (const [lon, lat] of ring) if (lat > 22 && lat < 62 && lon < 3 && lon > -30) ours.push([lon, lat]);
// normalise
const LON0 = -14, LAT0 = 42, SC = 20;
const basis = (lon, lat, deg) => { const u = (lon - LON0) / SC, v = (lat - LAT0) / SC; const b = [1, u, v]; if (deg > 1) b.push(u * u, u * v, v * v); if (deg > 2) b.push(u * u * u, u * u * v, u * v * v, v * v * v); return b; };
function solve(A, y) { // least squares via normal equations
  const n = A[0].length, M = Array.from({ length: n }, () => new Float64Array(n + 1));
  A.forEach((r, k) => { for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) M[i][j] += r[i] * r[j]; M[i][n] += r[i] * y[k]; } });
  for (let i = 0; i < n; i++) M[i][i] += 1e-9;
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
  return M.map((r, i) => r[n] / r[i]);
}
const apply = (cx, cy, lon, lat) => { const b = basis(lon, lat, cx.length > 6 ? 3 : cx.length > 3 ? 2 : 1); let x = 0, y = 0; b.forEach((v, i) => { x += v * cx[i]; y += v * cy[i]; }); return [x, y]; };

// coarse grid search of an axis-aligned affine maximising land/sea agreement
const samp = [];
for (let k = 0; k < 3000; k++) { const lon = -30 + 33 * Math.random(), lat = 22 + 40 * Math.random(); samp.push([lon, lat, 0]); }
{ // label samples land/sea with our polygons (even-odd)
  const inside = (lon, lat) => { let odd = false; for (const ring of world.land) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) odd = !odd; } return odd; };
  for (const s of samp) s[2] = inside(s[0], s[1]) ? 1 : 0;
}
const score = (tx, sx, ty, sy) => { let ok = 0, n = 0; for (const [lon, lat, l] of samp) { const x = Math.round(tx + sx * (lon - LON0)), y = Math.round(ty - sy * (lat - LAT0)); if (x < 0 || y < Y0 || x > X1 || y > Y1) { n++; continue; } n++; if ((sea[y * w + x] ? 0 : 1) === l) ok++; } return ok / n; };
let best = [0, 0, 0, 0, -1];
for (let sx = 8; sx <= 24; sx += 1) for (let sy = 8; sy <= 24; sy += 1) for (let tx = 150; tx <= 500; tx += 10) for (let ty = 350; ty <= 700; ty += 10) {
  const s = score(tx, sx, ty, sy); if (s > best[4]) best = [tx, sx, ty, sy, s];
}
for (const step of [5, 2, 1, 0.5]) { const [tx0, sx0, ty0, sy0] = best; for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) for (let d = -2; d <= 2; d++) { const p = [tx0 + a * step, sx0 + b * step * 0.1, ty0 + c * step, sy0 + d * step * 0.1]; const s = score(...p); if (s > best[4]) best = [...p, s]; } }
console.log('grid best', best);
let cx = [best[0], SC * best[1], 0], cy = [best[2], 0, -SC * best[3]];
for (const [deg, iters, keep] of [[1, 40, 0.6], [1, 20, 0.75], [2, 30, 0.8], [3, 30, 0.85]]) {
  while (cx.length < (deg === 1 ? 3 : deg === 2 ? 6 : 10)) { cx.push(0); cy.push(0); }
  let err = 0;
  for (let it = 0; it < iters; it++) {
    const m = [];
    for (const [lon, lat] of ours) {
      const [x, y] = apply(cx, cy, lon, lat), xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
      const k = near[yi * w + xi]; if (k < 0) continue;
      const [tx, ty] = coast[k]; m.push([lon, lat, tx, ty, Math.hypot(tx - x, ty - y)]);
    }
    m.sort((a, b) => a[4] - b[4]); const use = m.slice(0, Math.floor(m.length * keep));
    err = use.reduce((s, r) => s + r[4], 0) / use.length;
    const A = use.map(([lon, lat]) => basis(lon, lat, deg));
    cx = solve(A, use.map((r) => r[2])); cy = solve(A, use.map((r) => r[3]));
  }
  console.log('deg', deg, 'mean err px(/4)', err.toFixed(2));
}
const round = (a) => a.map((v) => Math.round(v * D * 1e4) / 1e4);
writeFileSync(OUT, JSON.stringify({ ...prev, LON0, LAT0, SC, cx: round(cx), cy: round(cy) }, null, 1));
