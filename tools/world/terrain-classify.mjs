// Classifies the political atlas by colour into terrain (sea, plains, forest, swamp, desert, hills, mountains, snow) and
// resamples it onto a lat/lon grid with the consensus georeference (tools/world/georef.mjs ATLAS_FIT).
// Output: <out>/terrain_geo.png (1 band, class ids) — vectorised next in QGIS (tools/world/terrain-vectorize.py).
// Usage: node tools/world/terrain-classify.mjs <out-dir>
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ATLAS as M, ATLAS_FIT as F } from './georef.mjs';
import { flatten } from '../../src/config.ts';

const out = process.argv[2] ?? 'assets/world/terrain';
mkdirSync(out, { recursive: true });

// Class colours as printed on the atlas. Hills = the pale brown foothills, mountains = the dark brown (and its ridge lines).
export const CLASSES = {
  1: { name: 'sea', rgb: [[165, 192, 222], [168, 195, 226], [160, 186, 216], [174, 201, 233], [157, 175, 196], [131, 150, 164]] },
  2: { name: 'plains', rgb: [[201, 228, 177], [208, 235, 187], [166, 187, 152]] },
  3: { name: 'forest', rgb: [[56, 130, 26], [59, 131, 21]] },
  4: { name: 'swamp', rgb: [[0, 126, 71]] },
  5: { name: 'desert', rgb: [[217, 199, 133], [220, 205, 140]] },
  6: { name: 'hills', rgb: [[203, 168, 138], [207, 180, 137]] },
  7: { name: 'mountains', rgb: [[181, 134, 94], [140, 100, 70], [92, 65, 53]] },
  8: { name: 'snow', rgb: [[255, 255, 255], [240, 240, 240]] },
};
const SCALE = 0.5, W = Math.round(M.source.width * SCALE), H = Math.round(M.source.height * SCALE);
const { data } = await sharp('assets/world/known-world-atlas.jpg').resize(W, H, { kernel: 'nearest' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });

const flat = Object.entries(CLASSES).flatMap(([id, c]) => c.rgb.map((rgb) => [+id, rgb]));
let cls = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
  let best = 0, bd = 38 * 38;
  for (const [id, c] of flat) { const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2; if (d < bd) { bd = d; best = id; } }
  cls[i] = best;
}
// the legend box and credits: sea
for (const [x0, y0, x1, y1] of M.cover) for (let y = Math.round(y0 * SCALE); y < Math.min(H, Math.round(y1 * SCALE)); y++) for (let x = Math.round(x0 * SCALE); x < Math.min(W, Math.round(x1 * SCALE)); x++) cls[y * W + x] = 1;
// unclassified pixels (labels, rivers, borders, symbols, coast lines) take the nearest class: multi-source BFS
const queue = []; for (let i = 0; i < W * H; i++) if (cls[i]) queue.push(i);
for (let head = 0; head < queue.length; head++) {
  const i = queue[head], x = i % W;
  for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < W * H && !cls[j] && !((j % W === 0 && x === W - 1) || (j % W === W - 1 && x === 0))) { cls[j] = cls[i]; queue.push(j); }
}
// speckle removal: a pixel that disagrees with 7+ of its 8 neighbours takes their class (twice)
for (let pass = 0; pass < 2; pass++) {
  const next = cls.slice();
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, count = new Uint8Array(9);
    for (const j of [i - W - 1, i - W, i - W + 1, i - 1, i + 1, i + W - 1, i + W, i + W + 1]) count[cls[j]]++;
    const top = count.indexOf(Math.max(...count));
    if (count[top] >= 7 && top !== cls[i]) next[i] = top;
  }
  cls = next;
}

// resample onto the lat/lon grid: 0.05 deg cells over the atlas extent once unflattened (wider in the north)
const STEP = 0.05, LON0 = -70, LON1 = 150, LAT1 = 85, LAT0 = -6;
const GW = Math.round((LON1 - LON0) / STEP), GH = Math.round((LAT1 - LAT0) / STEP), geo = new Uint8Array(GW * GH);
for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
  const lat = LAT1 - (gy + 0.5) * STEP, lon = flatten(LON0 + (gx + 0.5) * STEP, lat);
  const px = Math.round(((lon - F.lon0) / F.lonPerPx) * SCALE), py = Math.round(((lat - F.lat0) / F.latPerPx) * SCALE);
  const m = M.crop * SCALE; // the atlas's dashed frame border
  geo[gy * GW + gx] = px < m || py < m || px >= W - m || py >= H - m ? 0 : cls[py * W + px];
}
await sharp(Buffer.from(geo), { raw: { width: GW, height: GH, channels: 1 } }).png().toFile(`${out}/terrain_geo.png`);
writeFileSync(`${out}/terrain_geo.json`, JSON.stringify({ lon0: LON0, lat1: LAT1, step: STEP, width: GW, height: GH, classes: Object.fromEntries(Object.entries(CLASSES).map(([k, v]) => [k, v.name])) }));
const counts = {}; for (const v of geo) counts[CLASSES[v]?.name ?? 'none'] = (counts[CLASSES[v]?.name ?? 'none'] ?? 0) + 1;
console.log(GW, GH, counts);
// colour preview
const pal = { 0: [0, 0, 0], 1: [170, 218, 255], 2: [238, 240, 216], 3: [136, 190, 110], 4: [100, 170, 150], 5: [242, 226, 181], 6: [212, 190, 150], 7: [160, 125, 95], 8: [255, 255, 255] };
const prev = Buffer.alloc(GW * GH * 3); for (let i = 0; i < GW * GH; i++) prev.set(pal[geo[i]], i * 3);
await sharp(prev, { raw: { width: GW, height: GH, channels: 3 } }).resize({ width: 1500 }).jpeg().toFile(`${out}/terrain_preview.jpg`);
