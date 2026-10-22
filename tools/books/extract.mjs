// Turns the books in docs/books (epub, pdf) into plain text under docs/books/text/, one file per novel, for grep. The books are
// copyrighted and git-ignored (docs/books/), like docs/wiki. Chapter headings stay as "## ..." lines so a hit can be cited
// (book, chapter, POV). The 5-book bundle is split into its five novels by the table of contents.
// Usage: node tools/books/extract.mjs   (epubs through adm-zip, the PDF through pdftotext, which must be on PATH)
import AdmZip from 'adm-zip';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { posix, join } from 'node:path';

const IN = 'docs/books', OUT = 'docs/books/text';
mkdirSync(OUT, { recursive: true });
const NOVELS = [['a-game-of-thrones', 'A Game of Thrones'], ['a-clash-of-kings', 'A Clash of Kings'], ['a-storm-of-swords', 'A Storm of Swords'], ['a-feast-for-crows', 'A Feast for Crows'], ['a-dance-with-dragons', 'A Dance with Dragons']];
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);
const text = (html) => decode(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, t) => `\n\n## ${t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n\n`)
  .replace(/<br\s*\/?>|<\/(p|div|li|tr|blockquote)>/gi, '\n').replace(/<[^>]+>/g, ''))
  .replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n')
  .replace(/^([A-Z][A-Z' .-]{2,30})$/gm, '## $1').trim(); // the later novels set chapter titles (POV names) as plain capitals

/** The epub's chapter files in reading order, as [path, text]. */
const epub = (file) => {
  const z = new AdmZip(file), names = z.getEntries().map((e) => e.entryName);
  const opfPath = z.readAsText('META-INF/container.xml').match(/full-path="([^"]+)"/)[1], opf = z.readAsText(opfPath), dir = posix.dirname(opfPath);
  const href = new Map([...opf.matchAll(/<item\b[^>]*>/g)].map((m) => [m[0].match(/\bid="([^"]*)"/)?.[1], m[0].match(/\bhref="([^"]*)"/)?.[1]]));
  const ncx = names.find((n) => n.endsWith('.ncx'));
  return {
    spine: [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]*)"/g)].map((m) => posix.normalize(posix.join(dir, decodeURI(href.get(m[1]) ?? '')))).filter((p) => z.getEntry(p)).map((p) => [p, text(z.readAsText(p))]),
    toc: ncx ? [...z.readAsText(ncx).matchAll(/<navLabel>\s*<text>([^<]*)<\/text>[\s\S]*?<content src="([^"#]*)/g)].map((m) => [decode(m[1]).trim(), posix.normalize(posix.join(posix.dirname(ncx), decodeURI(m[2])))]) : [],
  };
};
const save = (slug, body) => { writeFileSync(join(OUT, slug + '.txt'), body); console.log(`${slug}: ${(body.length / 1e6).toFixed(2)} MB, ${body.split('\n').filter((l) => l.startsWith('## ')).length} headings`); };

for (const f of readdirSync(IN).filter((n) => /\.(epub|pdf)$/i.test(n))) {
  const file = join(IN, f);
  if (/\.pdf$/i.test(f)) { save('world-of-ice-and-fire', execFileSync('pdftotext', ['-layout', file, '-'], { maxBuffer: 1 << 29 }).toString('utf8')); continue; }
  const { spine, toc } = epub(file);
  if (/5-Book Bundle/.test(f)) { // each novel starts at the first spine file its title points to
    const at = NOVELS.map(([, title]) => spine.findIndex(([p]) => p === toc.find(([label]) => label === title)?.[1]));
    if (at.some((i) => i < 0) || at.some((i, k) => k && i <= at[k - 1])) throw new Error('bundle: could not find the five novels in the table of contents: ' + at);
    NOVELS.forEach(([slug], k) => save(slug, spine.slice(at[k], at[k + 1] ?? spine.length).map(([, t]) => t).join('\n\n')));
  } else save(/Knight of the Seven/.test(f) ? 'a-knight-of-the-seven-kingdoms' : /Beyond the Wall/.test(f) ? 'beyond-the-wall' : /Fire & Blood/.test(f) ? 'fire-and-blood' : f.replace(/\W+/g, '-').slice(0, 40), spine.map(([, t]) => t).join('\n\n'));
}
