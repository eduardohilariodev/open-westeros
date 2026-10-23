// Prepares the town pictures in public/towns/: the walled town as is (resized), the village with its baked-in checkerboard cut away.
// usage: node tools/world/towns-assets.mjs <walled.png> <village.png>
import sharp from 'sharp';

const [walled, village] = process.argv.slice(2);
await sharp(walled).resize(1024).webp({ quality: 88 }).toFile('public/towns/walled.webp');

const { data, info } = await sharp(village).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info, bg = new Uint8Array(W * H), stack = [];
const isBg = (i) => { const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]; return Math.min(r, g, b) >= 205 && Math.max(r, g, b) - Math.min(r, g, b) <= 8; };
const push = (i) => { if (!bg[i] && isBg(i)) { bg[i] = 1; stack.push(i); } };
for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
while (stack.length) { const i = stack.pop(), x = i % W; if (x) push(i - 1); if (x < W - 1) push(i + 1); if (i >= W) push(i - W); if (i < W * (H - 1)) push(i + W); }
const mask = await sharp(Buffer.from(bg.map((v) => (v ? 0 : 255))), { raw: { width: W, height: H, channels: 1 } }).blur(1.5).toColourspace("b-w").raw().toBuffer(); // a soft edge, the checker's rim dropped by the threshold below
for (let i = 0; i < W * H; i++) data[i * 4 + 3] = Math.max(0, Math.min(255, (mask[i] - 90) * 2));
await sharp(data, { raw: { width: W, height: H, channels: 4 } }).resize(1024).webp({ quality: 88 }).toFile('public/towns/village.webp');
