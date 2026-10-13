// Tiny glTF 2.0 binary (.glb) writer: one node, one mesh, one primitive per material; textures by external URI.
import { writeFileSync } from 'node:fs';

/**
 * prims: [{ positions: Float32Array, normals?: Float32Array, uvs?: Float32Array, colors?: Uint8Array (RGBA),
 *           indices: Uint32Array, material: { color: [r,g,b,a], texture?: string, alphaCutoff?: number, doubleSided?: boolean } }]
 */
export function writeGLB(file, prims) {
  const chunks = [], bufferViews = [], accessors = [], materials = [], textures = [], images = [];
  let offset = 0;
  const add = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    chunks.push(bytes, Buffer.alloc(pad));
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target && { target }) });
    offset += bytes.length + pad;
    return bufferViews.length - 1;
  };
  const accessor = (typed, type, componentType, count, extra = {}) => {
    accessors.push({ bufferView: add(typed, extra.target), componentType, count, type, ...extra, target: undefined });
    return accessors.length - 1;
  };
  const imageIndex = new Map();

  const primitives = prims.map((p) => {
    const n = p.positions.length / 3, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
      const v = p.positions[i * 3 + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
    const attributes = { POSITION: accessor(p.positions, 'VEC3', 5126, n, { min, max, target: 34962 }) };
    if (p.normals) attributes.NORMAL = accessor(p.normals, 'VEC3', 5126, n, { target: 34962 });
    if (p.uvs) attributes.TEXCOORD_0 = accessor(p.uvs, 'VEC2', 5126, n, { target: 34962 });
    if (p.colors) attributes.COLOR_0 = accessor(p.colors, 'VEC4', 5121, n, { normalized: true, target: 34962 });
    const small = n <= 65535;
    const idx = small ? Uint16Array.from(p.indices) : p.indices;
    const indices = accessor(idx, 'SCALAR', small ? 5123 : 5125, p.indices.length, { target: 34963 });

    const m = p.material, mat = {
      pbrMetallicRoughness: { baseColorFactor: m.color, metallicFactor: 0, roughnessFactor: 0.9 },
      doubleSided: !!m.doubleSided,
    };
    if (m.texture) {
      if (!imageIndex.has(m.texture)) {
        images.push({ uri: m.texture });
        textures.push({ source: images.length - 1, sampler: 0 });
        imageIndex.set(m.texture, textures.length - 1);
      }
      mat.pbrMetallicRoughness.baseColorTexture = { index: imageIndex.get(m.texture) };
    }
    if (m.alphaCutoff !== undefined) { mat.alphaMode = 'MASK'; mat.alphaCutoff = m.alphaCutoff; }
    materials.push(mat);
    return { attributes, indices, material: materials.length - 1 };
  });

  const json = {
    asset: { version: '2.0', generator: 'map/tools/sites/winterfell' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }],
    materials, accessors: accessors.map(({ target, ...a }) => a), bufferViews,
    buffers: [{ byteLength: offset }],
    ...(images.length && { images, textures, samplers: [{ wrapS: 10497, wrapT: 10497, minFilter: 9987, magFilter: 9729 }] }),
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4); return b; };
  writeFileSync(file, Buffer.concat([header, ch(jsonBuf.length, 'JSON'), jsonBuf, ch(bin.length, 'BIN\0'), bin]));
}
