// How much of the map has a lore claim: per kind, the places that appear in a place check, a stated distance or a lore road, and
// the capitals and cities that have none. Usage: node tools/lore/report.mjs   (or: npm run lore -- report)
import { readFileSync } from 'node:fs';
import { PLACES } from '../../src/world-data.ts';

const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const claimed = new Set([
  ...read('tools/books/place-checks.json').flatMap((c) => [c.place, c.to]),
  ...read('tools/books/travel.json').distances.flatMap((d) => [d.from, d.to]),
  ...read('tools/books/lore-roads.json').flatMap((r) => r.via),
].filter(Boolean));
const kinds = ['capital', 'city', 'castle', 'town', 'ruin'];
for (const k of kinds) {
  const all = PLACES.filter((p) => p[1] === k), done = all.filter((p) => claimed.has(p[0]));
  console.log(`${k.padEnd(8)} ${String(done.length).padStart(3)} / ${String(all.length).padEnd(3)} have a lore claim`);
}
const open = PLACES.filter((p) => ['capital', 'city'].includes(p[1]) && !claimed.has(p[0])).map((p) => p[0]);
console.log(`\ncapitals and cities with no claim (${open.length}): ${open.join(', ')}`);
