// Minimal reader for Skyrim SE meshes (NIF 20.2.0.7, BS version 100): node hierarchy, BSTriShape geometry,
// lighting-shader texture sets and alpha flags. Unknown blocks are skipped via the header's block sizes.
import { readFileSync } from 'node:fs';

class Reader {
  constructor(buf) { this.b = buf; this.p = 0; }
  u8() { return this.b.readUInt8(this.p++); }
  u16() { const v = this.b.readUInt16LE(this.p); this.p += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.p); this.p += 4; return v; }
  i32() { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
  f32() { const v = this.b.readFloatLE(this.p); this.p += 4; return v; }
  f16() { const v = this.b.readUInt16LE(this.p); this.p += 2; return half(v); }
  str(n) { const s = this.b.toString('latin1', this.p, this.p + n); this.p += n; return s; }
  sized() { return this.str(this.u32()); }
  short() { return this.str(this.u8()).replace(/\0$/, ''); }
}
function half(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/** Texture path as used in Data/ ("textures\..."), repairing absolute build paths some meshes carry. */
export function texturePath(t) {
  t = t.toLowerCase().replace(/\//g, '\\');
  const i = t.lastIndexOf('data\\textures\\');
  if (i >= 0) t = t.slice(i + 5);
  return t.startsWith('textures\\') ? t : `textures\\${t}`;
}

/** Parse a NIF (path or Buffer) into flat blocks: nodes with transforms + children, shapes with geometry, materials. */
export function readNif(src) {
  const r = new Reader(Buffer.isBuffer(src) ? src : readFileSync(src));
  const line = r.b.toString('latin1', 0, r.b.indexOf(10));
  r.p = line.length + 1;
  r.u32(); r.u8();
  r.u32(); const numBlocks = r.u32(), bs = r.u32();
  r.short(); if (bs > 130) r.u32(); r.short(); r.short(); if (bs >= 103) r.short();
  const types = Array.from({ length: r.u16() }, () => r.sized());
  const blockTypes = Array.from({ length: numBlocks }, () => types[r.u16()]);
  const sizes = Array.from({ length: numBlocks }, () => r.u32());
  const nStrings = r.u32(); r.u32();
  const strings = Array.from({ length: nStrings }, () => r.sized());
  const nGroups = r.u32(); r.p += nGroups * 4;

  const blocks = [];
  for (let i = 0; i < numBlocks; i++) {
    const start = r.p, type = blockTypes[i];
    let block = { type };
    try { block = parseBlock(r, type, bs, strings) ?? block; } catch { /* malformed/unsupported: keep type only */ }
    block.type = type;
    blocks.push(block);
    r.p = start + sizes[i];
  }
  return { bs, blocks };
}

/** NiObjectNET: name, extra data list, controller. (Note: `r.p += r.u32()` would lose the u32's own advance.) */
function skipObjectNET(r) {
  r.i32();
  const n = r.u32();
  r.p += n * 4;
  r.i32();
}

function avObject(r, bs, strings, o) {
  const nameIdx = r.i32(); o.name = nameIdx >= 0 ? strings[nameIdx] : '';
  const nExtra = r.u32(); r.p += nExtra * 4;
  r.i32(); // controller
  o.flags = r.u32();
  o.translation = [r.f32(), r.f32(), r.f32()];
  o.rotation = Array.from({ length: 9 }, () => r.f32()); // row-major
  o.scale = r.f32();
  r.i32(); // collision object
}

function parseBlock(r, type, bs, strings) {
  if (/^(NiNode|BSFadeNode|BSLeafAnimNode|BSMultiBoundNode|BSOrderedNode|BSValueNode|NiBillboardNode|NiSwitchNode|NiLODNode|BSTreeNode)$/.test(type)) {
    const o = {}; avObject(r, bs, strings, o);
    o.children = Array.from({ length: r.u32() }, () => r.i32());
    return o;
  }
  if (/^(BSTriShape|BSMeshLODTriShape|BSSubIndexTriShape|BSDynamicTriShape)$/.test(type)) {
    const o = {}; avObject(r, bs, strings, o);
    r.p += 16; // bounding sphere
    r.i32(); // skin
    o.shader = r.i32(); o.alpha = r.i32();
    const descLo = r.u32(), descHi = r.u32();
    const attrs = (descHi >>> 12) & 0xfff; // vertex attribute flags live in bits 44..55
    const stride = (descLo & 0xf) * 4;
    const nTri = bs >= 130 ? r.u32() : r.u16();
    const nVert = r.u16();
    const dataSize = r.u32();
    if (!dataSize) return o;
    const pos = new Float32Array(nVert * 3), uv = new Float32Array(nVert * 2), nrm = new Float32Array(nVert * 3), col = new Float32Array(nVert * 4);
    o.hasUV = !!(attrs & 0x2); o.hasNormal = !!(attrs & 0x8); o.hasColor = !!(attrs & 0x20);
    const full = bs < 130 || !!(attrs & 0x400);
    for (let v = 0; v < nVert; v++) {
      const s = r.p;
      if (attrs & 0x1) {
        if (full) { pos[v * 3] = r.f32(); pos[v * 3 + 1] = r.f32(); pos[v * 3 + 2] = r.f32(); r.p += 4; }
        else { pos[v * 3] = r.f16(); pos[v * 3 + 1] = r.f16(); pos[v * 3 + 2] = r.f16(); r.p += 2; }
      }
      if (attrs & 0x2) { uv[v * 2] = r.f16(); uv[v * 2 + 1] = r.f16(); }
      if (attrs & 0x8) { nrm[v * 3] = r.u8() / 127.5 - 1; nrm[v * 3 + 1] = r.u8() / 127.5 - 1; nrm[v * 3 + 2] = r.u8() / 127.5 - 1; r.p += 1; }
      if ((attrs & 0x18) === 0x18) r.p += 4; // tangent + bitangent z
      if (attrs & 0x20) { for (let c = 0; c < 4; c++) col[v * 4 + c] = r.u8() / 255; }
      r.p = s + stride;
    }
    const idx = new Uint32Array(nTri * 3);
    for (let t = 0; t < nTri * 3; t++) idx[t] = r.u16();
    Object.assign(o, { pos, uv, nrm, col, idx });
    return o;
  }
  if (type === 'BSLightingShaderProperty') {
    const o = {};
    if (bs < 130) o.shaderType = r.u32();
    skipObjectNET(r);
    o.flags1 = r.u32(); o.flags2 = r.u32();
    o.uvOffset = [r.f32(), r.f32()]; o.uvScale = [r.f32(), r.f32()];
    o.textureSet = r.i32();
    return o;
  }
  if (type === 'BSShaderTextureSet') return { textures: Array.from({ length: r.u32() }, () => r.sized()) };
  if (type === 'NiAlphaProperty') {
    skipObjectNET(r);
    const flags = r.u16(), threshold = r.u8();
    return { blend: !!(flags & 1), test: !!(flags & 0x200), threshold };
  }
  return null;
}
