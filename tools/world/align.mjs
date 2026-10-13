// Finds how another Known World map lines up with the painted one (scale + offset), by matching land/sea masks.
// Usage: node tools/world/align.mjs <other-map>
// Prints values for KNOWN_WORLD.outline in src/config.ts: otherPx = scale * paintedPx + offset (full-res pixels).
import sharp from 'sharp';
import { KNOWN_WORLD as K } from '../../src/config.ts';

const [other] = process.argv.slice(2);
if (!other) throw new Error('usage: node tools/world/align.mjs <other-map>');
const meta = await sharp(other).metadata();

async function mask(file, width, isSea) {
  const { data, info } = await sharp(file).resize(width).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const m = new Uint8Array(info.width * info.height);
  for (let i = 0; i < m.length; i++) m[i] = isSea(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) ? 0 : 1;
  return { m, w: info.width, h: info.height };
}
const paintedSea = (r, g, b) => b > r + 18 && b >= g; // blue seas
const otherSea = (r, g, b) => Math.abs(r - 179) < 25 && Math.abs(g - b) < 10 && r < 215; // flat grey seas

/** Grid search at working width W; offsets in working px. Returns full-res scale/offset. */
async function search(W, scales, offsets) {
  const s0 = W / K.source.width, painted = await mask('assets/world/known-world.jpg', W, paintedSea);
  let best = { score: -1 };
  for (const scale of scales) {
    const o = await mask(other, Math.round(meta.width * s0 / scale), otherSea);
    for (const [dx, dy] of offsets(s0, scale)) {
      let agree = 0, n = 0;
      for (let y = 10; y < painted.h - 10; y += 2) for (let x = 10; x < painted.w - 10; x += 2) {
        const ox = x + dx, oy = y + dy;
        if (ox < 0 || oy < 0 || ox >= o.w || oy >= o.h) continue;
        n++;
        if (painted.m[y * painted.w + x] === o.m[oy * o.w + ox]) agree++;
      }
      const score = n > 5000 ? agree / n : 0;
      if (score > best.score) best = { score, scale, offsetX: (dx / s0) * scale, offsetY: (dy / s0) * scale };
    }
  }
  return best;
}
const range = (a, b, step) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => a + i * step);
const grid = (cx, cy, r, step) => range(-r, r, step).flatMap((dx) => range(-r, r, step).map((dy) => [Math.round(cx + dx), Math.round(cy + dy)]));

// Coarse at 450 px, then fine at 1200 px around the coarse result.
const c = await search(450, range(0.9, 1.35, 0.01), () => grid(0, 0, 60, 2));
const f = await search(1200, range(c.scale - 0.012, c.scale + 0.012, 0.002), (s0, scale) =>
  grid((c.offsetX * s0) / scale, (c.offsetY * s0) / scale, 6, 1));
console.log({ agreement: +f.score.toFixed(4), scale: +f.scale.toFixed(4), offsetX: Math.round(f.offsetX), offsetY: Math.round(f.offsetY) });
