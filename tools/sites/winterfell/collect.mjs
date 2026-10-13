// One-time copy of the vanilla Skyrim SE data the Winterfell mod relies on into the project
// (assets/sites/winterfell/vanilla): the base-object -> mesh mapping from the masters, plus only the
// referenced meshes and diffuse textures, unpacked from the game's archives.
// Usage: node tools/sites/winterfell/collect.mjs   (needs the game; see SKYRIM_DATA in paths.mjs)
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openBSA } from './bsa.mjs';
import { walk, subrecords, sub, zstring } from './esm.mjs';
import { readNif, texturePath } from './nif.mjs';
import { DATA, SKYRIM_DATA, VANILLA } from './paths.mjs';
import { readPlugin, SKIP_MODEL } from './plugin.mjs';

const BASE_TYPES = new Set(['TES4', 'STAT', 'MSTT', 'TREE', 'FURN', 'DOOR', 'CONT', 'ACTI', 'LIGH', 'FLOR', 'MISC', 'SCOL', 'MOVS']);
const plugin = readPlugin();

// Base objects from the masters: formId (in the plugin's load order) -> model path.
const needed = new Set(plugin.refs.map((r) => r.base).filter((b) => !plugin.models.has(b)));
const models = {};
plugin.masters.forEach((name, k) => {
  let own = 0, list = [];
  walk(`${SKYRIM_DATA}/${name}`, (type, id, data) => {
    const subs = subrecords(data);
    if (type === 'TES4') { list = subs.filter(([t]) => t === 'MAST').map(([, b]) => zstring(b)); own = list.length; return; }
    const hi = id >>> 24, key = ((((hi === own ? k : plugin.masters.indexOf(list[hi])) << 24) | (id & 0xffffff)) >>> 0);
    const m = sub(subs, 'MODL');
    if (m && needed.has(key)) models[key.toString(16)] = zstring(m);
  }, BASE_TYPES);
});

const archives = readdirSync(SKYRIM_DATA).filter((f) => /\.bsa$/i.test(f) && !/sounds|voices|animations|interface|shaders|misc/i.test(f))
  .map((f) => openBSA(`${SKYRIM_DATA}/${f}`));
const loose = (path) => `${DATA}/${path.replace(/\\/g, '/')}`;
const stats = { meshes: 0, textures: 0, missing: [] };
function copy(path) { // "meshes\..." or "textures\..." -> vanilla/<path>, unless the mod ships it
  if (existsSync(loose(path))) return loose(path);
  const out = `${VANILLA}/${path.replace(/\\/g, '/')}`;
  if (existsSync(out)) return out;
  for (const a of archives) {
    const b = a.get(path);
    if (!b) continue;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, b);
    stats[path.startsWith('meshes') ? 'meshes' : 'textures']++;
    return out;
  }
  stats.missing.push(path);
  return null;
}

const used = new Set(plugin.refs.map((r) => plugin.models.get(r.base) ?? models[r.base.toString(16)]).filter((m) => m && !SKIP_MODEL.test(m)));
for (const m of used) {
  const file = copy(`meshes\\${m}`.toLowerCase());
  if (!file) continue;
  for (const b of readNif(file).blocks) {
    const t = b.textures?.[0];
    if (t) copy(texturePath(t));
  }
}
mkdirSync(VANILLA, { recursive: true });
writeFileSync(`${VANILLA}/models.json`, JSON.stringify(models, null, 1));
console.log({ vanillaBaseObjects: Object.keys(models).length, copiedMeshes: stats.meshes, copiedTextures: stats.textures, missing: stats.missing.length });
if (stats.missing.length) console.log('missing (first 12):', [...new Set(stats.missing)].slice(0, 12));
