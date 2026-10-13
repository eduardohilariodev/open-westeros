// Reader for Skyrim SE archives (BSA v105, LZ4-frame compressed files). Builds a path index without loading the archive.
import { openSync, readSync } from 'node:fs';
import lz4 from 'lz4js';

export function openBSA(file) {
  const fd = openSync(file, 'r');
  const read = (pos, len) => { const b = Buffer.alloc(len); readSync(fd, b, 0, len, pos); return b; };
  const h = read(0, 36);
  if (h.toString('latin1', 0, 4) !== 'BSA\0' || h.readUInt32LE(4) !== 105) throw new Error(`${file}: not an SSE BSA`);
  const flags = h.readUInt32LE(12), folderCount = h.readUInt32LE(16), fileCount = h.readUInt32LE(20), totalFileNameLength = h.readUInt32LE(28);
  const compressedDefault = !!(flags & 4), embedNames = !!(flags & 0x100);

  const folders = read(36, folderCount * 24);
  const files = []; // in file-record order
  let p = 36 + folderCount * 24;
  for (let f = 0; f < folderCount; f++) {
    const count = folders.readUInt32LE(f * 24 + 8);
    const nameLen = read(p, 1)[0];
    const folder = read(p + 1, nameLen - 1).toString('latin1');
    p += 1 + nameLen;
    const recs = read(p, count * 16);
    for (let i = 0; i < count; i++) {
      const size = recs.readUInt32LE(i * 16 + 8);
      files.push({ folder, size: size & 0x3fffffff, toggle: !!(size & 0x40000000), offset: recs.readUInt32LE(i * 16 + 12) });
    }
    p += count * 16;
  }
  const names = read(p, totalFileNameLength).toString('latin1').split('\0');
  const index = new Map();
  files.forEach((f, i) => index.set(`${f.folder}\\${names[i]}`.toLowerCase(), f));
  if (index.size !== fileCount) console.warn(`${file}: indexed ${index.size}/${fileCount} files`);

  return {
    has: (path) => index.has(norm(path)),
    get(path) {
      const f = index.get(norm(path));
      if (!f) return null;
      let pos = f.offset, size = f.size;
      if (embedNames) { const n = read(pos, 1)[0]; pos += 1 + n; size -= 1 + n; }
      if (compressedDefault !== f.toggle) {
        const original = read(pos, 4).readUInt32LE(0);
        const out = Buffer.from(lz4.decompress(read(pos + 4, size - 4), original));
        return out;
      }
      return read(pos, size);
    },
  };
}
const norm = (p) => p.toLowerCase().replace(/\//g, '\\').replace(/^\\+/, '');
