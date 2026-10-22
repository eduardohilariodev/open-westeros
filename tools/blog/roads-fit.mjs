// Registers the blog's master map (roads, forests, mountains; 3588x2980) to our vector land, the way vegetation.mjs does for
// the vegetation map: land/sea overlap (IoU), Westeros and the east fitted apart, in flat lon/lat (config.ts flatten).
//   x = ax * flatLon + bx,  y = ay * lat + by   -> tools/blog/roads-fit.json
// Usage: node tools/blog/roads-fit.mjs
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { flatten } from '../../src/config.ts';
import { source } from './roads-sources.mjs';

export const IMAGE = source.image, FIT = source.fit;
const SPLIT = 0; // flat lon between Westeros and Essos; the two halves of the master map were stitched at different scales
const REGIONS = { westeros: (lon) => lon < SPLIT, east: (lon) => lon >= SPLIT };

/** Image land mask: whatever is not the sea fill, off the title bars and scale box. */
export async function imageLand() {
  const { data, info } = await sharp(IMAGE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info, land = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) land[i] = !source.sea(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) && !source.skip(i % W, (i / W) | 0) ? 1 : 0;
  return { W, H, land };
}

/** Our land in flat lon/lat at `res` degrees per cell, with a "within ~2 degrees of our land" mask. */
function ourLand(res) {
  const world = JSON.parse(readFileSync('src/vector-world.json', 'utf8'));
  const LON0 = -60, LAT1 = 80, w = Math.round(180 / res), h = Math.round(90 / res);
  const d = world.land.map((ring) => 'M' + ring.map(([lon, lat]) => `${((flatten(lon, lat) - LON0) / res).toFixed(2)} ${((LAT1 - lat) / res).toFixed(2)}`).join('L') + 'Z').join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="${d}" fill="#fff" fill-rule="evenodd"/></svg>`))
    .ensureAlpha().extractChannel(3).raw().toBuffer().then((buf) => {
      const land = (x, y) => buf[y * w + x] > 127, near = new Uint8Array(w * h), r = Math.round(2 / res);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!land(x, y)) continue;
        for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) near[yy * w + xx] = 1;
        }
      }
      return { w, h, lon: (x) => LON0 + (x + 0.5) * res, lat: (y) => LAT1 - (y + 0.5) * res, land, near: (x, y) => near[y * w + x] === 1 };
    });
}

function overlap(img, ours, [ax, bx, ay, by], step, region) {
  let both = 0, either = 0;
  for (let y = 0; y < ours.h; y += step) for (let x = 0; x < ours.w; x += step) {
    if (!ours.near(x, y) || !region(ours.lon(x))) continue;
    const px = Math.floor(ax * ours.lon(x) + bx), py = Math.floor(ay * ours.lat(y) + by);
    if (px < 0 || py < 0 || px >= img.W || py >= img.H) continue;
    const a = ours.land(x, y), b = img.land[py * img.W + px] === 1;
    both += a && b; either += a || b;
  }
  return both / Math.max(1, either);
}

function fitRegion(img, ours, region, seed) {
  let best = { score: -1, p: null };
  for (let sx = seed.sx[0]; sx <= seed.sx[1]; sx += 1) for (let sy = seed.sy[0]; sy <= seed.sy[1]; sy += 1)
    for (let dx = -200; dx <= 200; dx += 20) for (let dy = -200; dy <= 200; dy += 20) {
      const p = [sx, seed.x + dx + seed.lon * sx, -sy, seed.y + dy + seed.lat * sy], score = overlap(img, ours, p, 4, region);
      if (score > best.score) best = { score, p };
    }
  let p = best.p, score = overlap(img, ours, p, 1, region);
  for (let step = [0.5, 8, 0.5, 8]; step[0] > 0.002; step = step.map((v) => v / 2)) {
    for (let improved = true; improved;) {
      improved = false;
      for (let k = 0; k < 4; k++) for (const sgn of [-1, 1]) {
        const q = p.slice(); q[k] += sgn * step[k];
        const sq = overlap(img, ours, q, 1, region);
        if (sq > score) { p = q; score = sq; improved = true; }
      }
    }
  }
  return { p, score };
}

if (process.argv[1].endsWith('roads-fit.mjs')) {
  const img = await imageLand(), ours = await ourLand(0.25), fits = {};
  // seed: King's Landing at the source's pixel, flat lon -7.8, lat 35.1 (y = -sy * lat + by, so by = y + lat * sy)
  const seed = { ...source.seed, lon: 7.8, lat: 35.1 };
  for (const [name, region] of Object.entries(REGIONS)) {
    const { p, score } = fitRegion(img, ours, region, seed);
    fits[name] = { p, overlap: +score.toFixed(4) };
    console.log(`${name}: x = ${p[0].toFixed(3)}·lon + ${p[1].toFixed(1)}, y = ${p[2].toFixed(3)}·lat + ${p[3].toFixed(1)}; land overlap ${(score * 100).toFixed(1)}%`);
  }
  const warp = await localWarp(img, fits);
  console.log(`local registration: ${warp.length} windows, median shift ${Math.round(median(warp.map((w) => Math.hypot(w.dx, w.dy))))} px`);
  writeFileSync(FIT, JSON.stringify({ image: IMAGE, split: SPLIT, fits, warp }, null, 2) + '\n');
}

function median(a) { return [...a].sort((x, y) => x - y)[a.length >> 1]; }

/**
 * The two affine fits leave the map tens of px off our coasts in places (King's Landing is ~40 px out). Slide windows of
 * the image over our land (drawn in the map's pixel frame by the fits) to find, where there is coast, the shift that
 * matches best. roads-trace.mjs moves every road point by the distance-weighted mean of these. Done at a quarter of the
 * resolution. Each entry is where the window sits and how far its image points must move (dx, dy, px) to be on our map.
 */
async function localWarp(img, fits) {
  const Q = 4, w = Math.floor(img.W / Q), h = Math.floor(img.H / Q);
  const world = JSON.parse(readFileSync('src/vector-world.json', 'utf8'));
  const d = world.land.map((ring) => 'M' + ring.map(([lon, lat]) => {
    const flat = flatten(lon, lat), f = flat < SPLIT ? fits.westeros : fits.east;
    return `${((f.p[0] * flat + f.p[1]) / Q).toFixed(1)} ${((f.p[2] * lat + f.p[3]) / Q).toFixed(1)}`;
  }).join('L') + 'Z').join('');
  const ours = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="${d}" fill="#fff" fill-rule="evenodd"/></svg>`))
    .ensureAlpha().extractChannel(3).raw().toBuffer();
  const mine = (x, y) => ours[y * w + x] > 127, theirs = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? false : img.land[y * Q * img.W + x * Q] === 1);
  const WIN = 48, STRIDE = 24, REACH = 12, out = [];
  for (let wy = 0; wy + WIN <= h; wy += STRIDE) for (let wx = 0; wx + WIN <= w; wx += STRIDE) {
    let land = 0;
    for (let y = wy; y < wy + WIN; y += 2) for (let x = wx; x < wx + WIN; x += 2) land += mine(x, y) ? 1 : 0;
    land /= (WIN / 2) ** 2;
    if (land < 0.08 || land > 0.92) continue; // no coast in the window: nothing to register on
    const score = (sx, sy) => { let n = 0; for (let y = wy; y < wy + WIN; y += 2) for (let x = wx; x < wx + WIN; x += 2) n += mine(x, y) === theirs(x + sx, y + sy) ? 1 : 0; return n; };
    let best = [0, 0], bs = -1, zero = score(0, 0);
    for (let sy = -REACH; sy <= REACH; sy++) for (let sx = -REACH; sx <= REACH; sx++) {
      const s = score(sx, sy) - 0.02 * Math.hypot(sx, sy); // a slight pull to stay put when it is a tie
      if (s > bs) { bs = s; best = [sx, sy]; }
    }
    if (score(...best) - zero < 6) best = [0, 0]; // no real gain: leave it
    out.push({ x: (wx + WIN / 2) * Q, y: (wy + WIN / 2) * Q, dx: -best[0] * Q, dy: -best[1] * Q });
  }
  return out;
}
