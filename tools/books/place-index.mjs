// For every named place on the map, finds where the books mention it and keeps the sentences that say where it is (direction,
// distance, water, road), with book and chapter, in docs/books/places.json: { name: { mentions: { book: n }, chapters: { book: { chapter: n } }, notes: [{ book, chapter, s }] } }.
// Start a place audit from `node tools/books/find.mjs`-style quotes here instead of from memory. Usage: node tools/books/place-index.mjs
import { writeFileSync } from 'node:fs';
import { PLACES } from '../../src/world-data.ts';
import { books, sentences } from './find.mjs';

const SKIP = new Set(['region', 'ocean', 'sea', 'continent', 'minor', 'wild', 'road']); // too broad to locate, or not a point
const REL = /\b(north|south|east|west|northern|southern|eastern|western|miles?|leagues?|days?|day's|fortnight|mouth|shore|bank|confluence|headwaters|road|river|hills?|ride|rode|sail|sailed|across|between|beyond|near|overlook\w*|lies|stands?|sits)\b/i;
const DIST = /\b(miles?|leagues?|days?|day's|fortnight|\d+)\b/i;
const MAX_NOTES = 8;
const norm = (s) => s.replace(/[’‘]/g, "'");
const keys = PLACES.filter((p) => !SKIP.has(p[1])).map((p) => p[0]); // the place's name on the map
const names = keys.map((k) => k.replace(/\s*\(.*\)$/, '').replace(/^The /, '')); // what to look for in the text
const lower = names.map((n) => n.toLowerCase());
const index = Object.fromEntries(keys.filter((_, i) => names[i].length >= 4).map((k) => [k, { mentions: {}, chapters: {}, notes: [] }]));

for (const book of books()) for (const h of sentences(book)) {
  const s = norm(h.s), l = s.toLowerCase();
  for (let i = 0; i < names.length; i++) {
    if (!index[keys[i]]) continue;
    const at = l.indexOf(lower[i]);
    if (at < 0 || (at > 0 && /\w/.test(l[at - 1])) || /\w/.test(l[at + lower[i].length] ?? '')) continue; // whole word only
    const e = index[keys[i]];
    e.mentions[book] = (e.mentions[book] ?? 0) + 1;
    if (h.chapter) ((e.chapters[book] ??= {})[h.chapter] = (e.chapters[book][h.chapter] ?? 0) + 1);
    if (REL.test(s) && s.length < 400) e.notes.push({ book, chapter: h.chapter, s, score: DIST.test(s) ? 1 : 0 });
  }
}
for (const e of Object.values(index)) e.notes = e.notes.sort((a, b) => b.score - a.score).slice(0, MAX_NOTES).map(({ score, ...n }) => n);
writeFileSync('docs/books/places.json', JSON.stringify(index, null, 1));
const hit = Object.values(index).filter((e) => Object.keys(e.mentions).length).length;
console.log(`${hit} of ${Object.keys(index).length} places are mentioned in the books; written to docs/books/places.json`);
