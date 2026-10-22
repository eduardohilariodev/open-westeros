// Vegetation of the Known World, from a fan "Vegetation Map of an Alternate Known World" (assets/world/vegetation-map.png,
// 1441×901, flat colours keyed by its legend). The map is flat art, linear in the painted lon/lat (config.ts flatten), so
// it is fitted to our coastline: x = ax·lon + bx, y = ay·lat + by, by searching for the most land overlap. The fit is kept
// in tools/world/vegetation.json; `node tools/world/vegetation.mjs [preview.png]` refits it and reports the overlap.
// relief-bake.mjs reads the biome at each pixel through biomeAt() and colours the ground by it.
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { flatten } from '../../src/config.ts';

const IMAGE = 'assets/world/vegetation-map.png', FIT = 'tools/world/vegetation.json', MAP_W = 1186; // the legend is right of x = 1186
// The legend's classes with the map's exact colours, and how each looks from orbit: albedo (sRGB 0–1) and tree cover (0–1).
// The last three are not in the legend: glacier ice (white), Valyria's ruin (black) and, as -1, sea.
export const BIOMES = [
  ['barren desert', [255, 255, 63], [0.84, 0.7, 0.48], 0],
  ['desert with plants', [216, 255, 63], [0.76, 0.66, 0.44], 0.05],
  ['dead grassland', [216, 216, 63], [0.66, 0.6, 0.38], 0],
  ['dry grassland', [196, 216, 63], [0.57, 0.55, 0.31], 0.05],
  ['light grassland', [172, 216, 63], [0.47, 0.5, 0.26], 0.1],
  ['grassland', [144, 216, 63], [0.38, 0.46, 0.21], 0.15],
  ['mild bush forest', [64, 216, 63], [0.31, 0.41, 0.18], 0.4],
  ['light forest', [24, 196, 63], [0.25, 0.37, 0.15], 0.6],
  ['forest', [24, 144, 48], [0.19, 0.31, 0.12], 0.8],
  ['heavy forest', [24, 128, 48], [0.15, 0.27, 0.1], 0.9],
  ['semi-rainforest', [24, 108, 48], [0.13, 0.26, 0.1], 0.95],
  ['rainforest', [24, 80, 48], [0.1, 0.22, 0.08], 1],
  ['dense rainforest', [24, 100, 64], [0.08, 0.19, 0.08], 1],
  ['swamp', [24, 80, 64], [0.21, 0.27, 0.17], 0.5],
  ['highland forest', [96, 144, 64], [0.21, 0.3, 0.16], 0.75],
  ['mountain grassland', [108, 132, 64], [0.41, 0.43, 0.27], 0.1],
  ['barren mountain grassland', [128, 128, 64], [0.5, 0.47, 0.33], 0.05],
  ['barren dirt', [128, 96, 48], [0.56, 0.43, 0.29], 0],
  ['barren mountain', [132, 96, 64], [0.52, 0.43, 0.34], 0],
  ['semi-rocky mountain', [132, 128, 108], [0.54, 0.52, 0.47], 0],
  ['rocks', [144, 144, 144], [0.6, 0.59, 0.56], 0],
  ['snow rockland', [196, 196, 196], [0.8, 0.82, 0.85], 0],
  ['permafrost', [216, 216, 216], [0.86, 0.88, 0.9], 0],
  ['mediterranean', [248, 164, 32], [0.6, 0.55, 0.32], 0.3],
  ['tundra', [140, 204, 189], [0.5, 0.52, 0.42], 0.05],
  ['glacier', [245, 255, 255], [0.92, 0.94, 0.96], 0],
  ['volcanic ruin', [0, 0, 0], [0.17, 0.15, 0.14], 0],
];
const isSea = (r, g, b) => (r === 182 && g === 220 && b === 244) || (b > 100 && r < 60); // pale sea, and the navy polar sea

/** Image pixels as biome ids (-1 sea). Rivers, borders and outlines drawn over the map take the biome around them. */
async function classify() {
  const { data, info } = await sharp(IMAGE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, id = new Int8Array(W * H).fill(-2); // -2: not yet known
  for (let i = 0; i < W * H; i++) {
    const x = i % W, r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    if (x >= MAP_W || isSea(r, g, b)) { id[i] = -1; continue; }
    const k = BIOMES.findIndex(([, c]) => c[0] === r && c[1] === g && c[2] === b);
    // ponytail: black is Valyria only inside its box; elsewhere black is outline ink. Box by eye on this image.
    if (k === BIOMES.length - 1 && !(x > 790 && x < 890 && i / W > 515 && i / W < 645)) continue;
    if (k >= 0) id[i] = k;
  }
  // fill the ink from the nearest classified land, ring by ring
  for (let left = true; left;) {
    left = false;
    const next = id.slice();
    for (let i = 0; i < W * H; i++) {
      if (id[i] !== -2) continue;
      const x = i % W, around = [x > 0 ? id[i - 1] : -2, x < W - 1 ? id[i + 1] : -2, i >= W ? id[i - W] : -2, i < W * H - W ? id[i + W] : -2].filter((v) => v >= 0);
      if (around.length) next[i] = around[0]; else left = true;
    }
    if (next.every((v, i) => v === id[i])) { for (let i = 0; i < W * H; i++) if (next[i] === -2) next[i] = -1; left = false; }
    id.set(next);
  }
  return { W, H, id };
}

/** Our land in flat lon/lat, at `res` degrees per cell. */
async function ourLand(res) {
  const world = JSON.parse(readFileSync('src/vector-world.json', 'utf8'));
  const LON0 = -60, LAT1 = 80, w = Math.round(180 / res), h = Math.round(90 / res);
  const d = world.land.map((ring) => 'M' + ring.map(([lon, lat]) => `${((flatten(lon, lat) - LON0) / res).toFixed(2)} ${((LAT1 - lat) / res).toFixed(2)}`).join('L') + 'Z').join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="${d}" fill="#fff" fill-rule="evenodd"/></svg>`;
  const buf = await sharp(Buffer.from(svg)).ensureAlpha().extractChannel(3).raw().toBuffer();
  const land = (x, y) => buf[y * w + x] > 127;
  // within ~2° of our land
  const near = new Uint8Array(w * h), r = Math.round(2 / res);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!land(x, y)) continue;
    for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) near[yy * w + xx] = 1;
    }
  }
  return { w, h, lon: (x) => LON0 + (x + 0.5) * res, lat: (y) => LAT1 - (y + 0.5) * res, land, near: (x, y) => near[y * w + x] === 1 };
}

// Westeros and the lands east of the Narrow Sea are fitted apart (the fan map draws them at slightly different scales),
// split at this flat longitude
const SPLIT = 0;
const REGIONS = { westeros: (lon) => lon < SPLIT, east: (lon) => lon >= SPLIT };

/** Overlap of our land and the map's land (intersection over union), near our land in one region, for a fit. The map
 * has continents ours lacks; those, far from our coasts, don't count against it. */
function overlap(veg, ours, [ax, bx, ay, by], step, region) {
  let both = 0, either = 0;
  for (let y = 0; y < ours.h; y += step) for (let x = 0; x < ours.w; x += step) {
    if (!ours.near(x, y) || !region(ours.lon(x))) continue;
    const px = Math.floor(ax * ours.lon(x) + bx), py = Math.floor(ay * ours.lat(y) + by);
    if (px < 0 || py < 0 || px >= MAP_W || py >= veg.H) continue;
    const a = ours.land(x, y), b = veg.id[py * veg.W + px] >= 0;
    both += a && b; either += a || b;
  }
  return both / Math.max(1, either);
}

function fitRegion(veg, ours, region) {
  // seed: Sunspear's tip (flat -2.7°, 23.9°) sits near (640, 505) on the image, at some 6–12 px a degree
  let best = { score: -1, p: null };
  for (let s = 5; s <= 12; s += 0.5) for (let t = 5; t <= 12; t += 0.5) for (let dx = -80; dx <= 80; dx += 10) for (let dy = -80; dy <= 80; dy += 10) {
    const p = [s, 640 + dx + 2.7 * s, -t, 505 + dy + 23.9 * t], score = overlap(veg, ours, p, 4, region);
    if (score > best.score) best = { score, p };
  }
  // then refine every parameter by halving steps
  let p = best.p, score = overlap(veg, ours, p, 1, region);
  for (let step = [0.25, 5, 0.25, 5]; step[0] > 0.002; step = step.map((v) => v / 2)) {
    for (let improved = true; improved;) {
      improved = false;
      for (let k = 0; k < 4; k++) for (const sgn of [-1, 1]) {
        const q = p.slice(); q[k] += sgn * step[k];
        const sq = overlap(veg, ours, q, 1, region);
        if (sq > score) { p = q; score = sq; improved = true; }
      }
    }
  }
  return { p, score };
}

/** The biome id at a globe lon/lat (-1 sea or off the map), from the saved fits. */
export async function loadBiomes() {
  const fits = JSON.parse(readFileSync(FIT, 'utf8')).fits;
  const veg = await classify();
  return (lon, lat) => {
    const f = flatten(lon, lat), [ax, bx, ay, by] = fits[f < SPLIT ? 'westeros' : 'east'].p;
    const px = Math.floor(ax * f + bx), py = Math.floor(ay * lat + by);
    return px < 0 || py < 0 || px >= MAP_W || py >= veg.H ? -1 : veg.id[py * veg.W + px];
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const veg = await classify(), ours = await ourLand(0.25), fits = {};
  for (const [name, region] of Object.entries(REGIONS)) {
    const { p, score } = fitRegion(veg, ours, region);
    fits[name] = { p, overlap: +score.toFixed(4) };
    console.log(`${name}: x = ${p[0].toFixed(3)}·lon + ${p[1].toFixed(1)}, y = ${p[2].toFixed(3)}·lat + ${p[3].toFixed(1)}; land overlap ${(score * 100).toFixed(1)}%`);
  }
  writeFileSync(FIT, JSON.stringify({ image: IMAGE, split: SPLIT, fits }, null, 2) + '\n');
  const fitOf = (lon) => fits[lon < SPLIT ? 'westeros' : 'east'].p;
  const counts = new Map();
  for (const v of veg.id) if (v >= 0) counts.set(v, (counts.get(v) ?? 0) + 1);
  console.log([...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${BIOMES[k][0]} ${n}`).join(', '));
  if (process.argv[2]) { // our coast (white) over the map's biomes, in the map's frame
    const out = Buffer.alloc(veg.W * veg.H * 3);
    for (let i = 0; i < veg.W * veg.H; i++) out.set(veg.id[i] >= 0 ? BIOMES[veg.id[i]][2].map((c) => c * 255) : [20, 40, 70], i * 3);
    for (let y = 1; y < ours.h - 1; y++) for (let x = 1; x < ours.w - 1; x++) {
      if (ours.land(x, y) === ours.land(x + 1, y) && ours.land(x, y) === ours.land(x, y + 1)) continue;
      const p = fitOf(ours.lon(x)), px = Math.floor(p[0] * ours.lon(x) + p[1]), py = Math.floor(p[2] * ours.lat(y) + p[3]);
      if (px >= 0 && py >= 0 && px < veg.W && py < veg.H) out.set([255, 255, 255], (py * veg.W + px) * 3);
    }
    await sharp(out, { raw: { width: veg.W, height: veg.H, channels: 3 } }).png().toFile(process.argv[2]);
  }
}
