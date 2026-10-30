// Everything the repo knows about one place, to start an audit from: position and where it came from, the lore claims already made
// about it, the wiki lead, the book passages that locate it, and measured distances to the coast, rivers, lakes and roads.
// Usage: node tools/lore/place.mjs "Name"   (or: npm run lore -- place "Name")
import { existsSync, readFileSync } from 'node:fs';
import { PLACES } from '../../src/world-data.ts';
import { W, nearest, nearestOf, riverLine } from '../books/place-checks.mjs';
import { gc, roads } from '../blog/roads-graph.mjs';

const name = process.argv[2];
const p = PLACES.find((q) => q[0].toLowerCase() === name?.toLowerCase());
if (!p) {
  const near = PLACES.filter((q) => q[0].toLowerCase().includes((name ?? '').toLowerCase())).slice(0, 8).map((q) => q[0]);
  console.log(`no place "${name}"${near.length ? `; did you mean: ${near.join(', ')}` : ''}`); process.exit(1);
}
const [, kind, lat, lon] = p, at = [lon, lat];
const raw = readFileSync('tools/world/places.raw.txt', 'utf8').split('\n').find((l) => l.startsWith(p[0] + '|'))?.split('|');
console.log(`## ${p[0]} (${kind}) at ${lat}, ${lon}   [data is rounded to 0.01 deg, about 0.75 mi]`);
console.log(`link: /?place=${encodeURIComponent(p[0])}`);
console.log(`source row: ${raw ? `position field "${raw[2]}"${raw[2].includes('>') || raw[2].startsWith('ll:') ? '  (fixed on the globe by canon)' : '  (consensus of the source maps)'}` : 'not in places.raw.txt (generated, e.g. a wall castle: src/globe/wallLine.ts)'}`);

const claims = JSON.parse(readFileSync('tools/books/place-checks.json', 'utf8')).filter((c) => c.place === p[0] || c.to === p[0]);
const travel = JSON.parse(readFileSync('tools/books/travel.json', 'utf8')).distances.filter((d) => d.from === p[0] || d.to === p[0]);
const lore = JSON.parse(readFileSync('tools/books/lore-roads.json', 'utf8')).filter((r) => r.via.includes(p[0]));
console.log(`\nclaims: ${claims.length + travel.length + lore.length ? '' : 'NONE yet (no lore check covers this place)'}`);
for (const c of claims) console.log(`  check ${c.rel}${c.to ? ' ' + c.to : ''}${c.river ? ' ' + c.river : ''}${c.lake ? ' ' + c.lake : ''}: ${c.cite.slice(0, 160)}`);
for (const d of travel) console.log(`  distance ${d.from} - ${d.to}: ${d.miles} mi, ${d.cite}`);
for (const r of lore) console.log(`  on ${r.name}: ${r.cites[0].slice(0, 140)}`);

console.log('\nmeasured:');
console.log(`  coast ${nearestOf(at, W.land)[0].toFixed(1)} mi`);
const rivers = PLACES.filter((q) => q[1] === 'river').map((q) => { try { return [q[0], nearest(at, riverLine(q[0]).pts)[0]]; } catch { return null; } }).filter(Boolean).filter(([, d]) => d < 80).sort((a, b) => a[1] - b[1]).slice(0, 3);
console.log(`  rivers ${rivers.map(([n, d]) => `${n} ${d.toFixed(1)} mi`).join(', ') || 'none near'}`);
const lakes = W.lakes.map((l) => [l.id, nearestOf(at, l.rings)[0]]).sort((a, b) => a[1] - b[1]).slice(0, 1);
console.log(`  lake ${lakes.map(([n, d]) => `${n} ${d.toFixed(1)} mi`).join('')}`);
console.log(`  main road ${Math.min(...roads.map((r) => r.pts.reduce((m, q) => Math.min(m, gc(at, q)), Infinity))).toFixed(1)} mi (to a vertex)`);

const wikiMap = existsSync('docs/sources/wiki/_places.json') ? JSON.parse(readFileSync('docs/sources/wiki/_places.json', 'utf8')) : { places: {} };
const page = wikiMap.places[p[0]];
console.log(`\nwiki: ${page ?? 'no page (canon from the wiki is silent, or scrape: node tools/wiki/scrape.mjs "Title")'}`);
if (page && existsSync(`docs/sources/wiki/${page}`)) {
  const lead = readFileSync(`docs/sources/wiki/${page}`, 'utf8').split('\n').find((l) => /^\*\*|^The \*\*/.test(l));
  if (lead) console.log('  ' + lead.replace(/\]\([^)]*\)/g, '').replace(/[[\]]|\\/g, '').slice(0, 420));
}
if (existsSync('docs/sources/books/places.json')) {
  const e = JSON.parse(readFileSync('docs/sources/books/places.json', 'utf8'))[p[0]];
  console.log(`\nbooks: ${e ? Object.entries(e.mentions).map(([b, n]) => `${b} ${n}`).join(', ') : 'not indexed (name under 4 letters, a region, or sea)'}`);
  for (const n of e?.notes.slice(0, 5) ?? []) console.log(`  ${n.book} | ${n.chapter} | ${n.s.slice(0, 220)}`);
  console.log('  (more: npm run lore -- find "' + p[0] + '" <word>)');
} else console.log('\nbooks: docs/sources/books/places.json missing: node tools/books/extract.mjs && node tools/books/place-index.mjs');
