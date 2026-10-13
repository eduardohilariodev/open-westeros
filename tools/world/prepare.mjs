// Builds the globe texture and the per-site surroundings from the Known World map.
// Usage: node tools/world/prepare.mjs   (reads assets/world/known-world.jpg, writes public/world/*)
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { KNOWN_WORLD as K, SITES } from '../../src/config.ts';

const SRC = 'assets/world/known-world.jpg', OUT = 'public/world';
mkdirSync(OUT, { recursive: true });

const { width, height } = await sharp(SRC).metadata();
if (width !== K.source.width || height !== K.source.height)
  throw new Error(`expected ${K.source.width}x${K.source.height}, got ${width}x${height}: update KNOWN_WORLD in src/config.ts`);

await sharp(SRC)
  .extract({ left: K.crop, top: K.crop, width: width - 2 * K.crop, height: height - 2 * K.crop })
  .resize(K.textureWidth).jpeg({ quality: 85 }).toFile(`${OUT}/known-world.jpg`);

// Outline (atlas) style: same lat/lon extent as the painted texture, recoloured.
{
  const O = K.outline, OUTLINE = 'assets/world/known-world-outline.webp';
  const om = await sharp(OUTLINE).metadata();
  const x0 = Math.round(O.scale * K.crop + O.offsetX), y0 = Math.round(O.scale * K.crop + O.offsetY);
  const w = Math.round(O.scale * (width - 2 * K.crop)), h = Math.round(O.scale * (height - 2 * K.crop));
  const pad = Math.max(0, -x0, -y0, x0 + w - om.width, y0 + h - om.height); // painted area reaches past the outline map: pad with sea
  const padded = await sharp(OUTLINE).removeAlpha()
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#b3b3b3' }).png().toBuffer();
  const { data, info } = await sharp(padded).extract({ left: x0 + pad, top: y0 + pad, width: w, height: h })
    .resize(K.textureWidth).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const sea = rgb(O.sea), land = rgb(O.land), line = rgb(O.line), out = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i++) {
    const v = data[i];
    const c = v < 150 ? line : v > 217 ? land : sea; // grey 179 = sea, white = land, dark = rivers/coasts
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).jpeg({ quality: 88 }).toFile(`${OUT}/known-world-outline.jpg`);
}

// Fill masked pixels from their known neighbours, ring by ring (diffusion inpainting).
function inpaint(px, w, h, masked) {
  let todo = [];
  for (let i = 0; i < w * h; i++) if (masked[i]) todo.push(i);
  while (todo.length) {
    const next = [], fills = [];
    for (const i of todo) {
      const x = i % w, y = (i / w) | 0, sum = [0, 0, 0];
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, j = yy * w + xx;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || masked[j]) continue;
        for (let c = 0; c < 3; c++) sum[c] += px[j * 3 + c];
        n++;
      }
      n ? fills.push([i, sum.map((v) => v / n)]) : next.push(i);
    }
    if (!fills.length) break;
    for (const [i, c] of fills) { px.set(c, i * 3); masked[i] = 0; }
    todo = next;
  }
}

// Map crop around each site, with the map's own icon and label painted out (the 3D model replaces them).
const s = K.surroundings;
for (const [id, site] of Object.entries(SITES)) {
  const left = site.map.x - s, top = site.map.y - s, w = 2 * s, h = 2 * s;
  const px = await sharp(SRC).extract({ left, top, width: w, height: h }).removeAlpha().raw().toBuffer();
  const masked = new Uint8Array(w * h);
  const [x0, y0, x1, y1] = site.erase.label;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = x + left, gy = y + top;
    if (Math.hypot(gx - site.map.x, gy - site.map.y) < site.erase.icon || (gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1)) masked[y * w + x] = 1;
  }
  inpaint(px, w, h, masked);
  await sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toFile(`${OUT}/surroundings-${id}.jpg`);
}
console.log('wrote', OUT);
