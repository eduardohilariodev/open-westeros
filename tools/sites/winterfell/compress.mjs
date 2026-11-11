// Shrinks what a visitor downloads: GLB geometry -> EXT_meshopt_compression, PNG textures -> WebP.
// Used by glb.mjs (every GLB the import writes) and, standalone, to convert an existing public/sites/winterfell:
//   node tools/sites/winterfell/compress.mjs [dir]      (default public/sites/winterfell; idempotent)
// The view must register MeshoptDecoder on its GLTFLoader (WinterfellView.ts does).
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

await MeshoptEncoder.ready;

/** Re-encode a GLB whose bufferViews are 1:1 with accessors (our writer): vertex views and index views through meshopt. */
export function compressGLB(glb) {
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jl = glb.readUInt32LE(12), json = JSON.parse(glb.subarray(20, 20 + jl).toString('utf8'));
  if (json.extensionsUsed?.includes('EXT_meshopt_compression')) return glb;
  const bin = glb.subarray(28 + jl, 28 + jl + glb.readUInt32LE(20 + jl));
  const out = [];
  let off = 0;
  const accOf = new Map(json.accessors.map((a) => [a.bufferView, a]));
  json.bufferViews.forEach((bv, bi) => {
    const a = accOf.get(bi);
    const raw = new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength);
    const isIdx = bv.target === 34963, size = isIdx ? (a.componentType === 5123 ? 2 : 4) : bv.byteLength / a.count;
    const enc = isIdx ? MeshoptEncoder.encodeIndexBuffer(raw, a.count, size) : MeshoptEncoder.encodeVertexBuffer(raw, a.count, size);
    const pad = (4 - (enc.length % 4)) % 4;
    out.push(Buffer.from(enc), Buffer.alloc(pad));
    bv.extensions = { EXT_meshopt_compression: { buffer: 0, byteOffset: off, byteLength: enc.length, byteStride: size, count: a.count, mode: isIdx ? 'TRIANGLES' : 'ATTRIBUTES' } };
    bv.buffer = 1; bv.byteOffset = bv.byteOffset || 0; // fallback (uncompressed) buffer, never fetched
    delete bv.target; // decoder-side buffers; targets are optional
    off += enc.length + pad;
  });
  json.buffers = [{ byteLength: off }, { byteLength: bin.length, extensions: { EXT_meshopt_compression: { fallback: true } } }];
  json.extensionsUsed = [...(json.extensionsUsed || []), 'EXT_meshopt_compression'];
  json.extensionsRequired = [...(json.extensionsRequired || []), 'EXT_meshopt_compression'];
  let jb = Buffer.from(JSON.stringify(json));
  jb = Buffer.concat([jb, Buffer.alloc((4 - (jb.length % 4)) % 4, 0x20)]);
  const nb = Buffer.concat(out), head = Buffer.alloc(12), ch = (len, t) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(t, 4); return b; };
  head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jb.length + 8 + nb.length, 8);
  return Buffer.concat([head, ch(jb.length, 'JSON'), jb, ch(nb.length, 'BIN\0'), nb]);
}

/** Alpha PNG -> WebP (alpha kept, near-lossless colour: masks and normals are not in this set). Returns the new name. */
export async function pngToWebp(src, dst) {
  await sharp(src).webp({ quality: 88, alphaQuality: 100, effort: 5 }).toFile(dst);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || 'public/sites/winterfell';
  let before = 0, after = 0;
  for (const f of readdirSync(`${dir}/textures`).filter((n) => n.endsWith('.png'))) {
    before += readFileSync(`${dir}/textures/${f}`).length;
    const dst = `${dir}/textures/${f.replace(/\.png$/, '.webp')}`;
    await pngToWebp(`${dir}/textures/${f}`, dst);
    after += readFileSync(dst).length;
  }
  console.log(`textures png ${(before / 1e6).toFixed(1)} MB -> webp ${(after / 1e6).toFixed(1)} MB`);
  before = after = 0;
  for (const f of readdirSync(`${dir}/models`).filter((n) => n.endsWith('.glb'))) {
    const p = `${dir}/models/${f}`, g = readFileSync(p);
    // point texture URIs at the webp files
    const jl = g.readUInt32LE(12), j = g.subarray(20, 20 + jl).toString('utf8');
    let b = g;
    if (j.includes('.png"')) {
      let jb = Buffer.from(j.replace(/\.png"/g, '.webp"'));
      jb = Buffer.concat([jb, Buffer.alloc((4 - (jb.length % 4)) % 4, 0x20)]);
      const rest = g.subarray(20 + jl);
      b = Buffer.concat([g.subarray(0, 12), Buffer.from(new Uint32Array([jb.length]).buffer), g.subarray(16, 20), jb, rest]);
      b.writeUInt32LE(b.length, 8);
    }
    const c = compressGLB(b);
    before += g.length; after += c.length;
    writeFileSync(p, c);
  }
  console.log(`models ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
  // old PNGs only after everything above succeeded
  for (const f of readdirSync(`${dir}/textures`).filter((n) => n.endsWith('.png'))) if (existsSync(`${dir}/textures/${f.replace(/\.png$/, '.webp')}`)) rmSync(`${dir}/textures/${f}`);
}
