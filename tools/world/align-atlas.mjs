// Registers the political atlas map to the atlas outline map (and so to the painted map, which the outline is aligned to
// in KNOWN_WORLD.outline) by matching their land/sea masks. The two are different drawings of the same coasts, so the
// match is a per-axis scale + offset (atlasPx -> paintedPx), not a pixel-perfect copy.
// Usage: node tools/world/align-atlas.mjs   (reads assets/world/known-world-atlas.jpg, known-world-outline.webp)
// Prints ATLAS_MAP.toPainted for src/config.ts: paintedPx = scale * atlasPx + offset, per axis.
import sharp from 'sharp';
import { KNOWN_WORLD as K } from '../../src/config.ts';
import { readPlaces } from './places-table.mjs';

const ATLAS = 'assets/world/known-world-atlas.jpg', OUTLINE = 'assets/world/known-world-outline.webp', O = K.outline;
const W = 2000, k = W / 10000; // working width; working px = full-res px * k

// Starting point: least squares on the places that are on both maps (axis-aligned).
function fit(pairs) {
  const n = pairs.length, sx = pairs.reduce((s, [x]) => s + x, 0), sy = pairs.reduce((s, [, y]) => s + y, 0);
  const sxx = pairs.reduce((s, [x]) => s + x * x, 0), sxy = pairs.reduce((s, [x, y]) => s + x * y, 0);
  const s = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return [s, (sy - s * sx) / n];
}
const both = readPlaces().filter((e) => e.p && e.a && e.kind !== 'ocean' && e.kind !== 'sea' && e.kind !== 'region');
const [sx0, tx0] = fit(both.map((e) => [e.a[0], e.p[0]])), [sy0, ty0] = fit(both.map((e) => [e.a[1], e.p[1]]));
console.log('from places: x', sx0.toFixed(4), tx0.toFixed(1), ' y', sy0.toFixed(4), ty0.toFixed(1));

async function mask(file, width, isLand) {
  const { data, info } = await sharp(file).resize(width).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const m = new Uint8Array(info.width * info.height);
  for (let i = 0; i < m.length; i++) m[i] = isLand(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) ? 1 : 0;
  return { m, w: info.width, h: info.height };
}
const atlasLand = (r, g, b) => !(Math.abs(r - 165) < 22 && Math.abs(g - 192) < 22 && Math.abs(b - 222) < 22);
const outlineLand = (r, g, b) => !(Math.abs(r - 179) < 28 && Math.abs(g - b) < 12 && r < 217);
const a = await mask(ATLAS, W, atlasLand), meta = await sharp(OUTLINE).metadata(), o = await mask(OUTLINE, meta.width * k, outlineLand);
const ok = o.w / meta.width; // = k

// p = [sx, tx, sy, ty]: atlas px -> painted px. Then painted -> outline px: O.scale * p + offset.
const toOutline = ([sx, tx, sy, ty]) => [O.scale * sx, O.scale * tx + O.offsetX, O.scale * sy, O.scale * ty + O.offsetY];
function score(p) {
  const [ax, bx, ay, by] = toOutline(p); // full-res atlas px -> full-res outline px
  let agree = 0, n = 0;
  for (let y = 8; y < a.h - 8; y += 3) for (let x = 8; x < a.w - 8; x += 3) {
    const ox = Math.round((ax * (x / k) + bx) * ok), oy = Math.round((ay * (y / k) + by) * ok);
    if (ox < 2 || oy < 2 || ox >= o.w - 2 || oy >= o.h - 2) continue;
    n++; if (a.m[y * a.w + x] === o.m[oy * o.w + ox]) agree++;
  }
  return n > 20000 ? agree / n : 0;
}

let p = [sx0, tx0, sy0, ty0], best = score(p);
console.log('start agreement', best.toFixed(4));
// coordinate descent on (scale x, offset x, scale y, offset y), shrinking steps
for (let step of [1, 0.5, 0.25, 0.12]) {
  for (let improved = true; improved;) {
    improved = false;
    for (let i = 0; i < 4; i++) for (const dir of [-1, 1]) {
      const q = [...p]; q[i] += dir * step * (i % 2 === 0 ? 0.004 : 20);
      const s = score(q); if (s > best + 1e-5) { best = s; p = q; improved = true; }
    }
  }
}
console.log('political -> painted px:', { agreement: +best.toFixed(4), scaleX: +p[0].toFixed(4), offsetX: +p[1].toFixed(1), scaleY: +p[2].toFixed(4), offsetY: +p[3].toFixed(1) });
