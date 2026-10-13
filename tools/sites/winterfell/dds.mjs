// Decodes the DDS variants used by the mod (DXT1, DXT5, uncompressed 32-bit) to RGBA8 (top mip only).
import { readFileSync } from 'node:fs';

/** Decode a DDS (path or Buffer). */
export function decodeDDS(src) {
  const b = Buffer.isBuffer(src) ? src : readFileSync(src);
  if (b.toString('latin1', 0, 4) !== 'DDS ') throw new Error('not a DDS file');
  const height = b.readUInt32LE(12), width = b.readUInt32LE(16);
  const pfFlags = b.readUInt32LE(80), fourCC = b.toString('latin1', 84, 88);
  const out = new Uint8Array(width * height * 4);
  let p = 128;
  if (pfFlags & 0x4) { // compressed
    const dxt5 = fourCC === 'DXT5' || fourCC === 'DXT3';
    if (!dxt5 && fourCC !== 'DXT1') throw new Error(`unsupported DDS format ${fourCC}`);
    for (let by = 0; by < Math.ceil(height / 4); by++) for (let bx = 0; bx < Math.ceil(width / 4); bx++) {
      let alpha = null;
      if (dxt5) { alpha = fourCC === 'DXT5' ? dxt5Alpha(b, p) : dxt3Alpha(b, p); p += 8; }
      const c = colorBlock(b, p, !dxt5); p += 8;
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
        if (x >= width || y >= height) continue;
        const o = (y * width + x) * 4;
        out.set(c[i], o);
        if (alpha) out[o + 3] = alpha[i];
      }
    }
  } else { // uncompressed, assume 32-bit with channel masks
    const bits = b.readUInt32LE(88), masks = [92, 96, 100, 104].map((o) => b.readUInt32LE(o));
    if (bits !== 32) throw new Error(`unsupported uncompressed DDS (${bits} bpp)`);
    const sh = masks.map((m) => 31 - Math.clz32(m & -m)); // bit offset of each channel mask
    for (let i = 0; i < width * height; i++, p += 4) {
      const v = b.readUInt32LE(p);
      for (let c = 0; c < 4; c++) out[i * 4 + c] = masks[c] ? (v & masks[c]) >>> sh[c] : 255;
    }
  }
  return { width, height, data: out };
}

function rgb565(v) { return [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31]; }
function colorBlock(b, p, dxt1) {
  const c0 = b.readUInt16LE(p), c1 = b.readUInt16LE(p + 2), bits = b.readUInt32LE(p + 4);
  const a = rgb565(c0), z = rgb565(c1), pal = [[...a, 255], [...z, 255]];
  if (c0 > c1 || !dxt1) {
    pal.push([...a.map((v, i) => (2 * v + z[i]) / 3), 255], [...a.map((v, i) => (v + 2 * z[i]) / 3), 255]);
  } else {
    pal.push([...a.map((v, i) => (v + z[i]) / 2), 255], [0, 0, 0, 0]);
  }
  return Array.from({ length: 16 }, (_, i) => pal[(bits >>> (2 * i)) & 3]);
}
function dxt5Alpha(b, p) {
  const a0 = b[p], a1 = b[p + 1], pal = [a0, a1];
  if (a0 > a1) for (let i = 1; i < 7; i++) pal.push(((7 - i) * a0 + i * a1) / 7);
  else { for (let i = 1; i < 5; i++) pal.push(((5 - i) * a0 + i * a1) / 5); pal.push(0, 255); }
  let bits = 0n;
  for (let i = 0; i < 6; i++) bits |= BigInt(b[p + 2 + i]) << BigInt(8 * i);
  return Array.from({ length: 16 }, (_, i) => pal[Number((bits >> BigInt(3 * i)) & 7n)]);
}
function dxt3Alpha(b, p) {
  return Array.from({ length: 16 }, (_, i) => ((b[p + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17);
}
