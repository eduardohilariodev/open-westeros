// One cache entry per stage, in assets/terrain-lab/cache/ (gitignored): the arrays a stage produced and a few scalars,
// valid while the key (hash of the chain of earlier stages' parameters, the pipeline code and the source data) matches.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'assets/terrain-lab/cache';
export const hash = (...parts) => createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 12);
export const fileHash = (f) => createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 12);

export function load(stage, key) {
  const meta = `${DIR}/${stage}.json`;
  if (!existsSync(meta)) return null;
  const m = JSON.parse(readFileSync(meta, 'utf8'));
  if (m.key !== key) return null;
  const arrays = {};
  for (const [name, len] of Object.entries(m.arrays)) {
    const f = `${DIR}/${stage}-${name}.f32`;
    if (!existsSync(f)) return null;
    const b = readFileSync(f);
    if (b.byteLength !== len * 4) return null;
    arrays[name] = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); // copy: Buffer offsets are not 4-aligned
  }
  return { arrays, scalars: m.scalars };
}

export function save(stage, key, arrays, scalars = {}) {
  mkdirSync(DIR, { recursive: true });
  for (const [name, a] of Object.entries(arrays)) writeFileSync(`${DIR}/${stage}-${name}.f32`, new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  writeFileSync(`${DIR}/${stage}.json`, JSON.stringify({ key, scalars, arrays: Object.fromEntries(Object.entries(arrays).map(([n, a]) => [n, a.length])) }));
}
