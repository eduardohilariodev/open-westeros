// Minimal reader for Skyrim SE plugins (.esm/.esp, TES4 format): records, groups, subrecords, zlib-compressed records.
// Only what the Winterfell import needs: base-object models, placed references and landscape heights.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const COMPRESSED = 0x00040000;

/**
 * Walk records. cb(type, formId, data: Buffer, parents: group stack {type, label}, recordFlags).
 * types (optional Set): only these record types are decompressed/reported, and top-level groups of other
 * types are skipped entirely (fast on big masters like Skyrim.esm).
 */
export function walk(file, cb, types) {
  const buf = readFileSync(file);
  const stack = [];
  let p = 0;
  while (p < buf.length) {
    while (stack.length && p >= stack.at(-1).end) stack.pop();
    const type = buf.toString('latin1', p, p + 4);
    if (type === 'GRUP') {
      const size = buf.readUInt32LE(p + 4), label = buf.readUInt32LE(p + 8), gtype = buf.readInt32LE(p + 12);
      if (types && !stack.length && gtype === 0 && !types.has(buf.toString('latin1', p + 8, p + 12))) { p += size; continue; }
      stack.push({ end: p + size, type: gtype, label });
      p += 24;
      continue;
    }
    const size = buf.readUInt32LE(p + 4), flags = buf.readUInt32LE(p + 8), formId = buf.readUInt32LE(p + 12);
    if (!types || types.has(type)) {
      let data = buf.subarray(p + 24, p + 24 + size);
      if (flags & COMPRESSED) data = inflateSync(data.subarray(4));
      cb(type, formId, data, stack, flags);
    }
    p += 24 + size;
  }
}

/** Subrecords of a record as [type, Buffer][] (handles XXXX large-size prefixes). */
export function subrecords(data) {
  const out = [];
  let p = 0, big = 0;
  while (p < data.length) {
    const type = data.toString('latin1', p, p + 4);
    let size = data.readUInt16LE(p + 4);
    p += 6;
    if (type === 'XXXX') { big = data.readUInt32LE(p); p += size; continue; }
    if (big) { size = big; big = 0; }
    out.push([type, data.subarray(p, p + size)]);
    p += size;
  }
  return out;
}

export const zstring = (b) => b.toString('latin1', 0, b.indexOf(0) >= 0 ? b.indexOf(0) : b.length);
export const sub = (subs, type) => subs.find(([t]) => t === type)?.[1];
