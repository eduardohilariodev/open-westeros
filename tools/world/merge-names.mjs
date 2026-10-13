// Appends newly read atlas names (lines "Name|kind|-|@x,y") to places.raw.txt, skipping names already there.
// Usage: node tools/world/merge-names.mjs <file> [<file>...]
import { appendFileSync, readFileSync } from 'node:fs';

const RAW = 'tools/world/places.raw.txt', KINDS = new Set('city town capital castle minor ruin island mountain forest wild region sea ocean lake river landmark'.split(' '));
const norm = (s) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
const seen = new Set(readFileSync(RAW, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => norm(l.split('|')[0])));
const keep = [], skipped = [];
for (const file of process.argv.slice(2)) for (const line of readFileSync(file, 'utf8').split('\n')) {
  const l = line.trim(); if (!l) continue;
  const [name, kind, p, a] = l.split('|');
  const ok = name && KINDS.has(kind) && p === '-' && /^@\d{1,5},\d{1,5}$/.test(a ?? '');
  if (!ok || seen.has(norm(name))) { skipped.push(l); continue; }
  seen.add(norm(name)); keep.push(`${name.trim()}|${kind}|-|${a}`);
}
appendFileSync(RAW, `# --- more names read off the political atlas (full-resolution atlas px) ---\n${keep.join('\n')}\n`);
console.log(`added ${keep.length}, skipped ${skipped.length}`);
for (const s of skipped.slice(0, 15)) console.log('  skipped:', s);
