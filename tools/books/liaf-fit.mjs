// Turns map-sheet pixels into lore-roads waypoints (`@lat,lon`): a least-squares affine fit from [place, x, y] anchors (places of
// ours read off the sheet with liaf-grid.mjs, from the same region: a sheet does not fit our map as a whole), its residual per
// anchor in miles, then each [x, y] point as a waypoint. Usage: node tools/books/liaf-fit.mjs anchors.json x,y [x,y ...]
import { readFileSync } from 'node:fs';
import { PLACES } from '../../src/world-data.ts';
const [file, ...pts] = process.argv.slice(2), A = JSON.parse(readFileSync(file, 'utf8')).map(([n, x, y]) => { const p = PLACES.find((q) => q[0] === n && q[1] !== 'road'); if (!p) throw new Error(n); return { n, x, y, lat: p[2], lon: p[3] }; });
const solve = (M, v) => { const n = M[0].length, a = Array.from({ length: n }, (_, i) => [...Array.from({ length: n }, (_, j) => M.reduce((s, r) => s + r[i] * r[j], 0)), M.reduce((s, r, k) => s + r[i] * v[k], 0)]);
  for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r; [a[i], a[p]] = [a[p], a[i]]; for (let r = 0; r < n; r++) if (r !== i) { const f = a[r][i] / a[i][i]; for (let c = i; c <= n; c++) a[r][c] -= f * a[i][c]; } }
  return a.map((r, i) => r[n] / r[i]); };
const M = A.map(({ x, y }) => [x, y, 1]), lat = solve(M, A.map((a) => a.lat)), lon = solve(M, A.map((a) => a.lon));
const f = (x, y) => [lat[0] * x + lat[1] * y + lat[2], lon[0] * x + lon[1] * y + lon[2]];
for (const a of A) { const [la, lo] = f(a.x, a.y); console.log(a.n.padEnd(24), Math.round(Math.hypot((la - a.lat) * 75, (lo - a.lon) * 75 * Math.cos((a.lat * Math.PI) / 180))), 'mi'); }
for (const p of pts) { const [la, lo] = f(...p.split(',').map(Number)); console.log(`${p} -> @${la.toFixed(2)},${lo.toFixed(2)}`); }
