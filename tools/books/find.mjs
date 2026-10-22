// Searches the extracted books (docs/books/text, from extract.mjs) and prints each hit as "book | chapter | sentence".
// Every term must occur in the sentence (case-insensitive); the chapter is the nearest "## " line above, for citing.
// Usage: node tools/books/find.mjs [--book=a-clash-of-kings] [--max=40] term [term ...]
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DIR = 'docs/books/text';
export const books = () => readdirSync(DIR).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4));
/** Every sentence of a book as { book, chapter, s }. */
export const sentences = (book) => {
  const out = []; let chapter = '', buf = '';
  const flush = () => { for (const s of buf.split(/(?<=[.!?”"])\s+(?=[A-Z“"‘'])/)) if (s.trim()) out.push({ book, chapter, s: s.trim() }); buf = ''; };
  for (const line of readFileSync(`${DIR}/${book}.txt`, 'utf8').split('\n')) { // some epubs hard-wrap: a line that stops mid-sentence continues on the next
    if (line.startsWith('## ')) { flush(); chapter = line.slice(3); continue; }
    buf += (buf ? ' ' : '') + line.trim();
    if (!line.trim() || /[.!?”"’)]$/.test(line.trim())) flush();
  }
  flush();
  return out;
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
  const terms = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((t) => t.toLowerCase());
  if (!terms.length) throw new Error('usage: node tools/books/find.mjs [--book=slug] [--max=40] term [term ...]');
  let n = 0;
  for (const b of opt.book ? [opt.book] : books()) for (const h of sentences(b)) {
    const l = h.s.toLowerCase();
    if (terms.every((t) => l.includes(t)) && n++ < (+opt.max || 40)) console.log(`${h.book} | ${h.chapter} | ${h.s.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  console.log(`${n} hit(s)`);
}
