// Cross-checks the adapted qm stops against the books: qm's chapter N of a book is the Nth real "## " heading from the
// prologue on; a stop is "supported" when its place name is said somewhere in the chapters it covers.
// usage: node tools/characters/qm-lore.mjs [character]   (needs docs/sources/books/text and docs/sources/quartermaester/qm-mapped.json)
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fold } from './qm-map.mjs';

const DIR = 'docs/sources/books/text';
export const SLUG = { AGOT: 'a-game-of-thrones', ACOK: 'a-clash-of-kings', ASOS: 'a-storm-of-swords', AFFC: 'a-feast-for-crows', ADWD: 'a-dance-with-dragons' };

/** qm chapter index -> { book, n, heading, text } (text is the chapter's lowercase text) */
export function chapterTexts(qm) {
  const out = new Map();
  for (const [book, slug] of Object.entries(SLUG)) {
    const lines = fs.readFileSync(`${DIR}/${slug}.txt`, 'utf8').split(/\r?\n/);
    const mine = qm.chapters.filter((c) => c.book === book);
    // walk the chapters in order; a chapter starts at the next "## X" line, or a bare all-caps line, that says its name
    // (the extracted text sometimes loses the "## " of a title, e.g. "THE KRAKEN'S DAUGHTER")
    let at = lines.findIndex((l) => /^(## )?PROLOGUE\s*$/i.test(l.trim()));
    const starts = [];
    mine.forEach((c, n) => {
      const want = expectedHeading(c);
      let h = n === 0 ? at : -1;
      for (let i = at + (n ? 1 : 0); h < 0 && i < lines.length; i++) {
        const l = lines[i].trim();
        const bare = l.startsWith('## ') ? l.slice(3) : l === l.toUpperCase() && /^[A-Z][A-Z '’.-]+$/.test(l) ? l : null;
        if (bare !== null && same(bare, want)) h = i;
      }
      starts.push(h);
      if (h >= 0) at = h;
    });
    mine.forEach((c, n) => {
      const h = starts[n];
      if (h < 0) return;
      const end = starts.slice(n + 1).find((s) => s >= 0) ?? lines.length;
      out.set(c.index, { book, n, heading: lines[h].replace(/^## /, '').trim(), title: c.title, text: lines.slice(h + 1, end).join(' ').toLowerCase().replace(/[’‘]/g, "'") });
    });
  }
  return out;
}

/** the heading a qm title stands for: "Eddard II" -> "eddard", "The Prophet" -> "the prophet" */
const expectedHeading = (c) => fold(c.title.replace(/^[^:]*:\s*/, '')).replace(/\s+[ivxl]+$/, '');
const same = (a, b) => fold(a).replace(/^the /, '') === b.replace(/^the /, '');

const range = (c) => (Array.isArray(c) ? [c[0], c[1]] : [c, c]);
const mentions = (text, name) => {
  const n = name.toLowerCase().replace(/^the /, '').replace(/\s*\(.*\)$/, '');
  for (let at = text.indexOf(n); at >= 0; at = text.indexOf(n, at + 1)) if (!/\w/.test(text[at - 1] ?? ' ') && !/\w/.test(text[at + n.length] ?? ' ')) return true;
  return false;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const qm = JSON.parse(fs.readFileSync('docs/sources/quartermaester/qm-paths.json', 'utf8'));
  const mapped = JSON.parse(fs.readFileSync('docs/sources/quartermaester/qm-mapped.json', 'utf8'));
  const only = process.argv[2];
  const ch = chapterTexts(qm);
  const lost = qm.chapters.filter((c) => c.book && !ch.has(c.index));
  console.log(`chapters placed ${ch.size} of ${qm.chapters.filter((c) => c.book).length}; not found in the text: ${lost.map((c) => c.title).join(' | ') || 'none'}`);
  let total = 0, ok = 0;
  const unsupported = [];
  for (const [name, segs] of Object.entries(mapped.characters)) {
    if (only && name !== only) continue;
    for (const s of segs) {
      const place = s.pts.filter((p) => p.src === 'place');
      if (!place.length || s.chapters === undefined) continue;
      const [a, b] = range(s.chapters);
      const texts = [];
      for (let i = a; i <= b; i++) if (ch.get(i)) texts.push(ch.get(i));
      if (!texts.length) continue;
      for (const p of place) {
        total++;
        if (texts.some((t) => mentions(t.text, p.name))) ok++;
        else unsupported.push(`${name} ch ${a}${b > a ? '-' + b : ''} (${texts[0].title}${b > a ? ' ...' : ''}) ${p.name}`);
      }
    }
  }
  console.log(`stops with a named place: ${total}; said in their chapters: ${ok}; not said: ${total - ok}`);
  console.log(unsupported.join('\n'));
}
