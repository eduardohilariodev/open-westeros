// Reads the mod's plugin: masters, base-object models, exterior placed references, cell grid and landscape heights.
import { walk, subrecords, sub, zstring } from './esm.mjs';
import { ESM } from './paths.mjs';

const DELETED = 0x20, DISABLED = 0x800;

export function readPlugin() {
  const plugin = { masters: [], models: new Map(), refs: [], cells: new Map(), land: [] };
  walk(ESM, (type, id, data, stack, flags) => {
    if (flags & DELETED) return;
    const subs = subrecords(data);
    if (type === 'TES4') plugin.masters = subs.filter(([t]) => t === 'MAST').map(([, b]) => zstring(b));
    else if (type === 'CELL') { const c = sub(subs, 'XCLC'); if (c) plugin.cells.set(id, [c.readInt32LE(0), c.readInt32LE(4)]); }
    else if (type === 'LAND') { const v = sub(subs, 'VHGT'); if (v) plugin.land.push({ cell: stack.at(-1).label, v }); }
    else if (type === 'REFR') {
      if (flags & DISABLED || !stack.some((g) => g.type === 1)) return; // exterior worldspace only
      const d = sub(subs, 'DATA'), s = sub(subs, 'XSCL');
      plugin.refs.push({
        base: sub(subs, 'NAME').readUInt32LE(0), scale: s ? s.readFloatLE(0) : 1,
        pos: [0, 4, 8].map((o) => d.readFloatLE(o)), rot: [12, 16, 20].map((o) => d.readFloatLE(o)),
      });
    } else { const m = sub(subs, 'MODL'); if (m) plugin.models.set(id, zstring(m)); }
  });
  return plugin;
}

/** Placed models we never render. */
export const SKIP_MODEL = /marker|fxsmoke|fxfog|fxmist|fxlight/i;
