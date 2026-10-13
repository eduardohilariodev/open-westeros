// Imports "The True Winterfell SE" (Skyrim port of Shadiversity's Winterfell) into public/sites/winterfell:
//   models/*.glb  – every mesh placed in the worldspace, flattened, simplified, Y-up metres
//   textures/*    – diffuse textures (DDS -> jpg/png, max 1024 px)
//   terrain.bin   – landscape heights around the castle (Int16, decimetres)
//   scene.json    – model list, instances (position, rotation, scale) and terrain grid info
// Reads only project files: the extracted mod, plus the vanilla data copied by collect.mjs.
// Usage: node tools/sites/winterfell/import.mjs
import * as THREE from 'three';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { decodeDDS } from './dds.mjs';
import { writeGLB } from './glb.mjs';
import { readNif, texturePath } from './nif.mjs';
import { DATA, OUT, VANILLA } from './paths.mjs';
import { readPlugin, SKIP_MODEL } from './plugin.mjs';

const UNIT = 0.01428; // metres per Skyrim unit
const CELL = 4096; // units per exterior cell
const TERRAIN_RADIUS_CELLS = 12; // ~700 m around the castle
const SIMPLIFY = { minTris: 1500, ratio: 0.3, error: 0.02 };
const MAX_TEXTURE = 1024;

const plugin = readPlugin();
const models = new Map(Object.entries(JSON.parse(readFileSync(`${VANILLA}/models.json`, 'utf8'))).map(([k, v]) => [parseInt(k, 16), v]));
for (const [id, m] of plugin.models) models.set(id, m); // plugin records override masters

/** "meshes\..." / "textures\..." from the mod, else from the copied vanilla data. */
function asset(path) {
  for (const root of [DATA, VANILLA]) {
    const f = `${root}/${path.replace(/\\/g, '/')}`;
    if (existsSync(f)) return readFileSync(f);
  }
  return null;
}

// ---------- origin: centre of the castle (walls + castle pieces) ----------
const castleRefs = plugin.refs.filter((r) => /wall|castle/i.test(models.get(r.base) ?? ''));
const bbox = (k) => [Math.min(...castleRefs.map((r) => r.pos[k])), Math.max(...castleRefs.map((r) => r.pos[k]))];
const [bx, by] = [bbox(0), bbox(1)];
const O = { x: (bx[0] + bx[1]) / 2, y: (by[0] + by[1]) / 2, z: 0 };

// ---------- terrain ----------
const heights = new Map(); // "gx,gy" (global vertex grid, 128 units) -> height units
for (const { cell, v } of plugin.land) {
  const xy = plugin.cells.get(cell);
  if (!xy) continue;
  let row = v.readFloatLE(0);
  for (let r = 0; r < 33; r++) {
    row += v.readInt8(4 + r * 33);
    let h = row;
    for (let c = 0; c < 33; c++) {
      if (c) h += v.readInt8(4 + r * 33 + c);
      heights.set(`${xy[0] * 32 + c},${xy[1] * 32 + r}`, h * 8);
    }
  }
}
const ocx = Math.floor(O.x / CELL), ocy = Math.floor(O.y / CELL), R = TERRAIN_RADIUS_CELLS;
const g0x = (ocx - R) * 32, g0y = (ocy - R) * 32, n = (2 * R + 1) * 32 + 1;
const hAt = (gx, gy) => heights.get(`${gx},${gy}`);
O.z = hAt(Math.round(O.x / 128), Math.round(O.y / 128)) ?? 0;
const known = [...heights.values()], fallback = known.reduce((a, b) => a + b, 0) / known.length;
const terrain = new Int16Array(n * n); // row 0 = north
for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
  const h = hAt(g0x + c, g0y + (n - 1 - r)) ?? fallback;
  terrain[r * n + c] = Math.round((h - O.z) * UNIT * 10);
}

// ---------- meshes ----------
const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1); // Skyrim Z-up -> three Y-up
const toThree = new THREE.Matrix4().makeScale(UNIT, UNIT, UNIT).premultiply(C);
await MeshoptSimplifier.ready;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/models`, { recursive: true });
mkdirSync(`${OUT}/textures`, { recursive: true });

const FALLBACK = [
  [/water/, 0x3b5a66], [/glass|window/, 0xbfd8d8], [/roof|slate|shingle/, 0x4c4f55], [/thatch|straw|hay/, 0xa08a55],
  [/leaf|leaves|branch|needle|pine|moss|grass|ivy|plant|bush|fern|canopy/, 0x4f6b3a], [/bark|trunk|log/, 0x5b4a3a],
  [/wood|plank|beam|timber|door|fence|table|chair|barrel/, 0x6e5236], [/iron|metal|steel|chain/, 0x5a5a5e],
  [/stone|rock|wall|castle|brick|cobble|tower|keep|road|stair/, 0x8a8780], [/dirt|mud|ground/, 0x6b5a45],
];
const fallbackColor = (name) => {
  const hex = FALLBACK.find(([re]) => re.test(name.toLowerCase()))?.[1] ?? 0x9a9488;
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, 1];
};
const texCache = new Map(), stats = { textures: 0, missingTextures: 0, unsupportedTextures: 0, trisIn: 0, trisOut: 0, models: 0, skippedModels: 0 };
async function texture(path) {
  const key = path.toLowerCase();
  if (texCache.has(key)) return texCache.get(key);
  let result = null;
  const buf = asset(texturePath(path));
  if (!buf) stats.missingTextures++;
  else {
    try {
      const { width, height, data } = decodeDDS(buf);
      let alpha = false;
      for (let i = 3; i < data.length && !alpha; i += 4) alpha = data[i] < 250;
      const name = key.replace(/^textures[\\/]/, '').replace(/[\\/ ]+/g, '_').replace(/\.dds$/, alpha ? '.png' : '.jpg');
      let img = sharp(Buffer.from(data.buffer), { raw: { width, height, channels: 4 } }).resize(MAX_TEXTURE, MAX_TEXTURE, { fit: 'inside', withoutEnlargement: true });
      img = alpha ? img.png({ compressionLevel: 9 }) : img.removeAlpha().jpeg({ quality: 82 });
      await img.toFile(`${OUT}/textures/${name}`);
      result = `../textures/${name}`;
      stats.textures++;
    } catch { stats.unsupportedTextures++; }
  }
  texCache.set(key, result);
  return result;
}

/** Flatten a NIF to shapes with model-space matrices. NIF rotations are stored transposed (row-vector convention). */
function flatten(nif) {
  const B = nif.blocks, out = [];
  const visit = (i, parent) => {
    const b = B[i];
    if (!b || b.flags & 1) return; // hidden
    const local = new THREE.Matrix4();
    if (b.translation) {
      const m = b.rotation;
      local.makeScale(b.scale, b.scale, b.scale)
        .premultiply(new THREE.Matrix4().set(m[0], m[3], m[6], 0, m[1], m[4], m[7], 0, m[2], m[5], m[8], 0, 0, 0, 0, 1))
        .premultiply(new THREE.Matrix4().makeTranslation(...b.translation));
    }
    const world = parent.clone().multiply(local);
    for (const c of b.children ?? []) if (c >= 0) visit(c, world);
    if (b.pos) out.push({ shape: b, world });
  };
  visit(0, new THREE.Matrix4());
  return out;
}

const skipReasons = {};
const skip = (why) => { skipReasons[why] = (skipReasons[why] ?? 0) + 1; return false; };
async function convert(modelPath, file) {
  const buf = asset(`meshes\\${modelPath}`.toLowerCase());
  if (!buf) return skip('no file');
  const nif = readNif(buf), B = nif.blocks, groups = new Map();
  for (const { shape, world } of flatten(nif)) {
    const shader = B[shape.shader];
    if (shader?.type !== 'BSLightingShaderProperty') continue; // effects, water, sky: skip
    const diffuse = B[shader.textureSet]?.textures?.[0] ?? '';
    const alphaProp = B[shape.alpha];
    const cutoff = alphaProp?.test || alphaProp?.blend ? (alphaProp.test ? alphaProp.threshold / 255 : 0.5) : undefined;
    const key = `${diffuse}|${cutoff}`;
    if (!groups.has(key)) groups.set(key, { diffuse, cutoff, doubleSided: !!(shader.flags2 & 0x10), parts: [] });
    groups.get(key).parts.push({ shape, m: world.clone().premultiply(toThree) });
  }
  const prims = [];
  for (const g of groups.values()) {
    const nv = g.parts.reduce((s, p) => s + p.shape.pos.length / 3, 0), ni = g.parts.reduce((s, p) => s + p.shape.idx.length, 0);
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Uint8Array(nv * 4).fill(255);
    const idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    for (const { shape: s, m } of g.parts) {
      nm.getNormalMatrix(m);
      const count = s.pos.length / 3;
      for (let i = 0; i < count; i++) {
        v.fromArray(s.pos, i * 3).applyMatrix4(m).toArray(pos, (vo + i) * 3);
        v.fromArray(s.nrm, i * 3).applyMatrix3(nm).normalize().toArray(nrm, (vo + i) * 3);
        uv[(vo + i) * 2] = s.uv[i * 2]; uv[(vo + i) * 2 + 1] = s.uv[i * 2 + 1];
        if (s.hasColor) for (let c = 0; c < 4; c++) col[(vo + i) * 4 + c] = Math.round(s.col[i * 4 + c] * 255);
      }
      for (let i = 0; i < s.idx.length; i++) idx[io + i] = s.idx[i] + vo;
      vo += count; io += s.idx.length;
    }
    stats.trisIn += ni / 3;
    let outIdx = idx;
    if (ni / 3 > SIMPLIFY.minTris) {
      const target = Math.max(SIMPLIFY.minTris * 3, Math.floor((ni * SIMPLIFY.ratio) / 3) * 3);
      [outIdx] = MeshoptSimplifier.simplify(idx, pos, 3, target, SIMPLIFY.error, []);
      // UV seams / split vertices can stop the topology-preserving pass early; fall back to sloppy decimation.
      if (outIdx.length > target * 1.5) [outIdx] = MeshoptSimplifier.simplifySloppy(idx, pos, 3, null, target, SIMPLIFY.error * 2);
    }
    // compact to the vertices still referenced
    const remap = new Int32Array(nv).fill(-1);
    let k = 0;
    for (const i of outIdx) if (remap[i] < 0) remap[i] = k++;
    const P = new Float32Array(k * 3), N = new Float32Array(k * 3), U = new Float32Array(k * 2), Cc = new Uint8Array(k * 4);
    for (let i = 0; i < nv; i++) {
      const j = remap[i];
      if (j < 0) continue;
      P.set(pos.subarray(i * 3, i * 3 + 3), j * 3); N.set(nrm.subarray(i * 3, i * 3 + 3), j * 3);
      U.set(uv.subarray(i * 2, i * 2 + 2), j * 2); Cc.set(col.subarray(i * 4, i * 4 + 4), j * 4);
    }
    stats.trisOut += outIdx.length / 3;
    const tex = g.diffuse ? await texture(g.diffuse) : null;
    prims.push({
      positions: P, normals: N, uvs: U, colors: Cc, indices: Uint32Array.from(outIdx, (i) => remap[i]),
      material: { color: tex ? [1, 1, 1, 1] : fallbackColor(g.diffuse || modelPath), texture: tex ?? undefined, alphaCutoff: tex ? g.cutoff : undefined, doubleSided: g.doubleSided || g.cutoff !== undefined },
    });
  }
  if (!prims.length) return skip(groups.size ? 'empty after simplify' : 'no lit shapes');
  writeGLB(`${OUT}/models/${file}`, prims);
  return true;
}

// ---------- placements ----------
const modelFiles = new Map(); // model path -> index in scene.models (or -1 if unusable)
const sceneModels = [], instances = [];
const R3 = new THREE.Matrix4(), q = new THREE.Quaternion(), Ci = C.clone().invert();
for (const r of plugin.refs) {
  const path = models.get(r.base);
  if (!path || SKIP_MODEL.test(path)) continue;
  if (!modelFiles.has(path)) {
    const file = `${String(sceneModels.length).padStart(3, '0')}_${path.split(/[\\/]/).pop().replace(/[^\w.-]+/g, '_').replace(/\.nif$/i, '.glb')}`;
    let ok = false;
    try { ok = await convert(path, file); } catch (e) { skip(`error: ${e.message}`); }
    modelFiles.set(path, ok ? sceneModels.length : -1);
    if (ok) { sceneModels.push({ file: `models/${file}`, source: path }); stats.models++; } else stats.skippedModels++;
  }
  const mi = modelFiles.get(path);
  if (mi < 0) continue;
  // Bethesda rotations: clockwise radians, matrix = Rx(-x)·Ry(-y)·Rz(-z) in Z-up space; conjugate into Y-up.
  R3.makeRotationFromEuler(new THREE.Euler(-r.rot[0], -r.rot[1], -r.rot[2], 'XYZ')).premultiply(C).multiply(Ci);
  q.setFromRotationMatrix(R3);
  const p = new THREE.Vector3(r.pos[0] - O.x, r.pos[1] - O.y, r.pos[2] - O.z).multiplyScalar(UNIT).applyMatrix4(C);
  instances.push(mi, ...p.toArray().map((x) => +x.toFixed(3)), ...q.toArray().map((x) => +x.toFixed(5)), +r.scale.toFixed(4));
}

writeFileSync(`${OUT}/terrain.bin`, Buffer.from(terrain.buffer));
writeFileSync(`${OUT}/scene.json`, JSON.stringify({
  source: 'The True Winterfell SE (Nexus Mods 94816), port of Shadiversity\'s Winterfell; vanilla assets from Skyrim SE',
  unit: UNIT,
  terrain: { file: 'terrain.bin', cols: n, rows: n, step: 128 * UNIT, x0: (g0x * 128 - O.x) * UNIT, z0: -((g0y + n - 1) * 128 - O.y) * UNIT, scale: 0.1 },
  models: sceneModels, instanceStride: 9, instances,
}));
const size = readdirSync(OUT, { recursive: true }).reduce((s, f) => s + (existsSync(`${OUT}/${f}`) && !f.endsWith('models') && !f.endsWith('textures') ? readFileSync(`${OUT}/${f}`).length : 0), 0);
console.log({ ...stats, skipReasons, instances: instances.length / 9, refs: plugin.refs.length, terrain: `${n}x${n}`, castleSize_m: [(bx[1] - bx[0]) * UNIT, (by[1] - by[0]) * UNIT].map(Math.round), outputMB: +(size / 1e6).toFixed(1) });
