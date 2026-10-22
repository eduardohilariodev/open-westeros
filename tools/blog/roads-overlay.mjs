// Draws src/roads.json (all stretches red, named roads blue) over our land and the places, for checking a trace by eye.
// Usage: node tools/blog/roads-overlay.mjs out.png [lon0 lon1 lat0 lat1 pxPerDegree]   (default: Westeros)
import sharp from 'sharp';
import { existsSync, readFileSync } from 'node:fs';
import { PLACES } from '../../src/world-data.ts';

const [out, ...rest] = process.argv.slice(2);
const [L0, L1, A0, A1, S] = rest.length ? rest.map(Number) : [-24, 2, 24, 63, 32];
const world = JSON.parse(readFileSync('src/vector-world.json', 'utf8')), { roads, named, minor = [] } = JSON.parse(readFileSync('src/roads.json', 'utf8'));
const dbg = process.env.DBGDIR && existsSync(process.env.DBGDIR + '/ends.json') ? JSON.parse(readFileSync(process.env.DBGDIR + '/ends.json', 'utf8')) : { ends: [], bridges: [] };
const X = (lo) => (lo - L0) * S, Y = (la) => (A1 - la) * S;
const path = (pts) => 'M' + pts.map(([lo, la]) => `${X(lo).toFixed(1)},${Y(la).toFixed(1)}`).join('L');
const kinds = new Set(['capital', 'city', 'town', 'castle']);
const dots = PLACES.filter((p) => kinds.has(p[1]) && p[3] > L0 && p[3] < L1 && p[2] > A0 && p[2] < A1)
  .map((p) => `<circle cx="${X(p[3])}" cy="${Y(p[2])}" r="3" fill="#000"/><text x="${X(p[3]) + 5}" y="${Y(p[2]) + 3}" font-size="10" fill="#000">${p[0]}</text>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(L1 - L0) * S}" height="${(A1 - A0) * S}"><rect width="100%" height="100%" fill="#9bb7d4"/>
  <path d="${world.land.map(path).join('')}Z" fill="#eee" stroke="#888"/>
  ${roads.map((r) => `<path d="${path(r.pts)}" fill="none" stroke="#c00" stroke-width="2"/>`).join('')}
  ${minor.map((r) => `<path d="${path(r.pts)}" fill="none" stroke="#2a2" stroke-width="1.5"/>`).join(``)}${named.map((r) => `<path d="${path(r.pts)}" fill="none" stroke="#06f" stroke-width="1.5" opacity=".7"/>`).join('')}${dbg.bridges.map(([a, b]) => `<path d="${path([a, b])}" stroke="#f80" stroke-width="3"/>`).join(``)}${dbg.ends.map(([x, y]) => `<circle cx="${X(x)}" cy="${Y(y)}" r="4" fill="#f0f"/>`).join(``)}${dots}</svg>`;
await sharp(Buffer.from(svg)).png().toFile(out);
