// Where each place appears in the novels, as one fact row for the place panel: references only (book, POV chapters), no text from
// the books. Reads docs/books/places.json (place-index.mjs), writes src/place-books.json: { place: "AGOT: Tyrion, Jon; ACOK: ..." }.
// Usage: node tools/books/place-books.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const NOVELS = { 'a-game-of-thrones': 'AGOT', 'a-clash-of-kings': 'ACOK', 'a-storm-of-swords': 'ASOS', 'a-feast-for-crows': 'AFFC', 'a-dance-with-dragons': 'ADWD' };
const OTHER = { 'a-knight-of-the-seven-kingdoms': 'Dunk & Egg', 'fire-and-blood': 'Fire & Blood', 'world-of-ice-and-fire': 'World of Ice & Fire' };
const MIN = 2, POVS = 4; // a place mentioned once or twice is not "in" a book; the most frequent chapters only
const title = (c) => c.toLowerCase().replace(/(^| )(\w)/g, (_, sp, ch) => sp + ch.toUpperCase());
const NOT_A_CHAPTER = /^(CONTENTS|PROLOGUE|EPILOGUE|APPENDIX|THE KINGS AND THEIR COURTS|HOUSE )/; // the appendices are headed by house names
const index = JSON.parse(readFileSync('docs/books/places.json', 'utf8'));
const out = {};
for (const [name, e] of Object.entries(index)) {
  const parts = [];
  for (const [slug, code] of Object.entries(NOVELS)) {
    if ((e.mentions[slug] ?? 0) < MIN) continue;
    const pov = Object.entries(e.chapters[slug] ?? {}).filter(([c]) => !NOT_A_CHAPTER.test(c)).sort((a, b) => b[1] - a[1]).slice(0, POVS).map(([c]) => title(c));
    parts.push(pov.length ? `${code} (${pov.join(', ')})` : code);
  }
  for (const [slug, label] of Object.entries(OTHER)) if ((e.mentions[slug] ?? 0) >= MIN) parts.push(label);
  if (parts.length) out[name] = parts.join('; ');
}
writeFileSync('src/place-books.json', JSON.stringify(out));
console.log(`${Object.keys(out).length} places with book references -> src/place-books.json`);
