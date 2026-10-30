// Checks tools/books/timeline.json, the dated changes the map shows through time (docs/decisions/0008, docs/roadmap-timeline.md):
// every subject is a place or a house, every house named exists, every chapter and episode exists, and every book quote is in
// the chapter it cites (the Nth "## POV" heading of the extracted book, docs/sources/books/text). Prints "OK ..." or "OFF ..." per change.
// usage: node tools/books/timeline-check.mjs            check every change
//        node tools/books/timeline-check.mjs --where "a quote"   the chapter slug a quote is in, to cite it
import { existsSync, readFileSync } from 'node:fs';
import { PLACES } from '../../src/world-data.ts';

const FILES = { agot: 'a-game-of-thrones', acok: 'a-clash-of-kings', asos: 'a-storm-of-swords', affc: 'a-feast-for-crows', adwd: 'a-dance-with-dragons' };
const { chapters, episodes } = JSON.parse(readFileSync('src/chapters.json', 'utf8'));
const houses = JSON.parse(readFileSync('src/houses.json', 'utf8'));
const changes = JSON.parse(readFileSync('tools/books/timeline.json', 'utf8'));
const slugs = new Set(chapters.map((c) => c.t.replace(/^\w+(?:-\d+)?: /, `${c.book}-`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')));
const roman = (n) => [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']].reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, '');
const norm = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ');

// Some books are hard-wrapped, so the text is searched with its whitespace collapsed; each "## " heading line becomes a
// \u0001HEADING\u0002 marker first, so it survives the collapse.
const texts = {};
const text = (b) => (texts[b] ??= existsSync(`docs/sources/books/text/${FILES[b]}.txt`) ? norm(readFileSync(`docs/sources/books/text/${FILES[b]}.txt`, 'utf8').replace(/^## (.+)$/gm, '\u0001$1\u0002')) : null);
/** The chapter slugs a quote sits in, over every book (a slug per hit). */
function where(quote) {
  const q = norm(quote), out = [];
  for (const b of Object.keys(FILES)) {
    const t = text(b);
    if (!t) continue;
    for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + 1)) {
      const heads = [...t.slice(0, i).matchAll(/\u0001([^\u0002]+)\u0002/g)].map((m) => m[1].trim()); // headings before the hit
      const pov = heads.at(-1), n = heads.filter((h) => h === pov).length;
      const head = pov.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
      // a POV chapter takes its count ("catelyn-vii"); a named one is its title, which qm sometimes gives without "The"
      const hit = [`${b}-${head}-${roman(n)}`, `${b}-${head}`, `${b}-${head.replace(/^the-/, '')}`].find((s) => slugs.has(s));
      out.push(hit ?? `${b}-${head} (no such chapter)`);
    }
  }
  return out;
}

const at = process.argv.indexOf('--where');
if (at > 0) { console.log(where(process.argv[at + 1]).join('\n') || 'not found'); process.exit(0); }

const places = new Set(PLACES.map((p) => p[0])), ids = new Set(houses.map((h) => h.id));
const SET = { holder: (v) => v === null || ids.has(v), liege: (v) => v === null || ids.has(v), state: (v) => ['built', 'ruin', 'gone'].includes(v), name: (v) => typeof v === 'string' };
const booksOn = Object.values(FILES).some((f) => existsSync(`docs/sources/books/text/${f}.txt`));
for (const c of changes) {
  const id = `${c.subject} ${JSON.stringify(c.set)} @ ${[c.books, c.show, c.year].filter((x) => x != null).join(' / ')}`;
  const off = [];
  if (c.subject.startsWith('house:') ? !ids.has(c.subject.slice(6)) : !places.has(c.subject)) off.push('no such place or house');
  for (const [k, v] of Object.entries(c.set ?? {})) if (!SET[k]?.(v)) off.push(`bad ${k}: ${v}`);
  if (!Object.keys(c.set ?? {}).length) off.push('sets nothing');
  if (c.books != null) {
    if (!slugs.has(c.books)) off.push(`no chapter ${c.books}`);
    else if (!c.quote) off.push('no quote');
    else if (booksOn && !where(c.quote).includes(c.books)) off.push(`quote not in ${c.books} (found in: ${where(c.quote).join(', ') || 'none'})`);
  }
  if (c.show != null) {
    const m = /^s(\d+)e(\d+)$/.exec(c.show);
    if (!m || !episodes.some((e) => e.s === +m[1] && e.e === +m[2])) off.push(`no episode ${c.show}`);
  }
  if (c.books == null && c.show == null) {
    if (c.year == null) off.push('no date');
    else if (c.year >= 297) off.push('a change in the years of the books needs a chapter or episode');
    if (!c.source) off.push('no source');
  }
  console.log(off.length ? `OFF ${id}: ${off.join('; ')}` : `OK ${id}`);
}
