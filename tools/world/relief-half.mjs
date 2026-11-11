// Half-size relief maps for phones and for the first load (relief.ts loads relief-<x>-half.webp, then the full map on zoom).
// The maps are data, not pictures, so each is halved by what its channels hold:
//   relief-a, relief-b  plain 8-bit channels           -> 2x2 mean of every channel
//   relief-h            R,G 16-bit height, B cover      -> 2x2 mean of the decoded height, mean cover
//   relief-e            R,G 16-bit SIGNED distance       -> the top-left pixel, no blend: a blend across a sign flip far from
//                                                          any river reads as distance ~0, a river that isn't there
// Run: node tools/world/relief-half.mjs [dir]   (default public/world; the bake calls halve() itself, pipeline.mjs encode())
import sharp from 'sharp';
import { existsSync, writeFileSync } from 'node:fs';

export const HALVED = ['relief-a', 'relief-b', 'relief-e', 'relief-h'];

/** RGBA `data` (W x H) of map `name` at half size (ceil), as RGBA bytes. */
export function halve(name, data, W, H) {
  const w = Math.ceil(W / 2), h = Math.ceil(H / 2), out = new Uint8Array(w * h * 4);
  const at = (x, y) => (Math.min(H - 1, y) * W + Math.min(W - 1, x)) * 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, ps = [at(2 * x, 2 * y), at(2 * x + 1, 2 * y), at(2 * x, 2 * y + 1), at(2 * x + 1, 2 * y + 1)];
    if (name === 'relief-e') { out.set(data.subarray(ps[0], ps[0] + 4), o); continue; }
    const mean = (c) => Math.round(ps.reduce((s, p) => s + data[p + c], 0) / 4);
    if (name === 'relief-h') {
      const v = Math.round(ps.reduce((s, p) => s + data[p] * 256 + data[p + 1], 0) / 4);
      out.set([v >> 8, v & 255, mean(2), mean(3)], o);
    } else out.set([mean(0), mean(1), mean(2), mean(3)], o);
  }
  return { data: out, w, h };
}

/** Writes `${dir}/${name}-half.webp` from RGBA bytes; returns its size in bytes. */
export async function writeHalf(dir, name, data, W, H) {
  const { data: d, w, h } = halve(name, data, W, H);
  const buf = await sharp(d, { raw: { width: w, height: h, channels: 4 } }).webp({ lossless: true, exact: true }).toBuffer();
  writeFileSync(`${dir}/${name}-half.webp`, buf);
  return buf.length;
}

if (process.argv[1]?.endsWith('relief-half.mjs')) {
  const dir = process.argv[2] ?? 'public/world';
  for (const name of HALVED) {
    const file = `${dir}/${name}.webp`;
    if (!existsSync(file)) { console.log(`${file}: missing, skipped`); continue; }
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const n = await writeHalf(dir, name, data, info.width, info.height);
    console.log(`${name}-half.webp ${(n / 1e6).toFixed(2)} MB`);
  }
  // self-check: the 16-bit height is averaged as a number, not byte by byte (255,0 and 0,255 average to 127,128, not 127,127)
  const t = halve('relief-h', new Uint8Array([1, 0, 0, 0, 0, 255, 0, 0, 1, 0, 0, 0, 0, 255, 0, 0]), 2, 2).data;
  if (t[0] * 256 + t[1] !== Math.round((256 + 255 + 256 + 255) / 4)) throw new Error('relief-h halve: 16-bit mean broken');
  const e = halve('relief-e', new Uint8Array([9, 9, 9, 9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), 2, 2).data;
  if (e[0] !== 9) throw new Error('relief-e halve: must not blend');
}
