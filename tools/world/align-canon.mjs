// Registers the old (raster-derived) lat/lon frame to the SVG frame, by matching land/sea masks:
//   svgLon = a * oldLon + b,  svgLat = c * oldLat + d
// Old land mask = the classified political atlas on the old frame (assets/world/terrain/terrain_geo.png, from
// terrain-classify.mjs run with the old src/world-data.ts); SVG land = src/vector-world.json.
// Prints the CANON values for src/config.ts.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const meta = JSON.parse(readFileSync('assets/world/terrain/terrain_geo.json', 'utf8'));
const { data: old, info: oi } = await sharp('assets/world/terrain/terrain_geo.png').greyscale().raw().toBuffer({ resolveWithObject: true });
if (oi.channels !== 1) throw new Error('expected a 1-channel mask');
const oldLand = (lon, lat) => {
  const x = Math.floor((lon - meta.lon0) / meta.step), y = Math.floor((meta.lat1 - lat) / meta.step);
  return x < 0 || y < 0 || x >= meta.width || y >= meta.height ? 0 : old[y * meta.width + x] > 1 ? 1 : 0;
};
// SVG land mask at 0.1 deg over lon -30..84, lat -2..74, drawn with an svg renderer
const world = JSON.parse(readFileSync('src/vector-world.json', 'utf8'));
const S = 0.1, LON0 = -30, LAT1 = 74, GW = Math.round(114 / S), GH = Math.round(76 / S);
const d = world.land.map((r) => 'M' + r.map(([lon, lat]) => `${((lon - LON0) / S).toFixed(2)},${((LAT1 - lat) / S).toFixed(2)}`).join('L') + 'Z').join('');
const { data: svg } = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${GW}" height="${GH}"><rect width="100%" height="100%" fill="#000"/><path d="${d}" fill="#fff"/></svg>`)).greyscale().raw().toBuffer({ resolveWithObject: true });
const cells = [];
for (let y = 0; y < GH; y += 2) for (let x = 0; x < GW; x += 2) cells.push([LON0 + (x + 0.5) * S, LAT1 - (y + 0.5) * S, svg[y * GW + x] > 127 ? 1 : 0]);

// IoU between SVG land and old land mapped into the SVG frame
const score = ([a, b, c, dd]) => {
  let inter = 0, uni = 0;
  for (const [lon, lat, land] of cells) {
    const o = oldLand((lon - b) / a, (lat - dd) / c);
    if (land && o) inter++; if (land || o) uni++;
  }
  return inter / uni;
};
// start: the old frame stretches longitude by ~1/cos(39 deg) (true ground distances); the SVGs are plain degrees
let best = [0.79, -7.7, 1, -1.2], bs = score(best);
for (let a = 0.7; a <= 0.9; a += 0.01) for (let b = -10; b <= -5; b += 0.5) for (let dd = -3; dd <= 1; dd += 0.5) { const s = score([a, b, 1, dd]); if (s > bs) { bs = s; best = [a, b, 1, dd]; } }
console.log('coarse', bs.toFixed(3), best.map((v) => +v.toFixed(3)));
for (const step of [0.5, 0.25, 0.1, 0.05, 0.02]) for (let improved = true; improved;) {
  improved = false;
  for (let i = 0; i < 4; i++) for (const dir of [-1, 1]) {
    const q = [...best]; q[i] += dir * step * (i % 2 === 0 ? 0.01 : 1);
    const s = score(q); if (s > bs + 1e-5) { bs = s; best = q; improved = true; }
  }
}
const [a, b, c, dd] = best;
console.log('iou', bs.toFixed(4));
console.log(`CANON = { lonScale: ${a.toFixed(5)}, lonOffset: ${b.toFixed(3)}, latScale: ${c.toFixed(5)}, latOffset: ${dd.toFixed(3)} }`);
