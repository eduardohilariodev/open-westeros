// Place panel text for every place on the map, from the scraped wiki articles (docs/wiki, npm run wiki -- --places):
// the article's lead as the summary and its infobox rows as facts. Writes src/place-wiki.json.
// The image is the article's first picture, hot-linked from awoiaf's thumb.php (browsers load it; scripts get a 403).
// Usage: node tools/wiki/place-info.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = 'docs/wiki';
const { places } = JSON.parse(readFileSync(`${DIR}/_places.json`, 'utf8'));

// Markdown -> plain text: link text only, no citation marks, emphasis or escapes.
const plain = (md) => md
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\\\[[^\]]*\\\]/g, '')
  .replace(/\*\*|(?<!\w)_|_(?!\w)/g, '')
  .replace(/\\(.)/g, '$1')
  .replace(/\s+([,.;:])/g, '$1').trim();

export function parse(md) {
  const body = md.replace(/^---[\s\S]*?---\s*/, '');
  const title = body.match(/^# (.+)/m)[1];
  const lead = body.slice(body.indexOf('\n')).split(/^## /m)[0];
  const facts = [];
  for (const row of lead.matchAll(/^\| ([^|]+?) \|([^|]+?) \|$/gm)) { // two-cell infobox rows; single-cell ones are its title/caption
    if (/!\[/.test(row[2])) continue; // map or picture cell
    facts.push([plain(row[1]), plain(row[2].replace(/<br>/g, ', '))]);
  }
  // Prose only: from the paragraph that names the subject in bold ("The **Trident** is..."), skipping tables and captions.
  const paras = lead.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && !/^[|!\[]/.test(p));
  const start = paras.findIndex((p) => p.includes('**') && !/^\*\*[^*]+\*\*$/.test(p)); // bold name in prose, not a bold caption
  const summary = (start < 0 ? [] : paras.slice(start)).map(plain).join('\n\n');
  // The lead's first picture (the infobox's, else a location map); the wiki's "red pog" marker is not one.
  const image = [...lead.matchAll(/!\[[^\]]*\]\((https:\/\/awoiaf\.westeros\.org\/thumb\.php\?[^)\s]+)\)/g)].map((m) => m[1]).find((u) => !/f=Red_pog/.test(u));
  // The gallery: every picture in the article (file names for thumb.php), not icons or the red pog; document order, no repeats.
  // A picture's caption is the text after its <br> in an infobox cell, else the paragraph under it (none if that is a table, a heading or
  // another picture, or too long to be one). captions[i] belongs to images[i]; '' when it has none.
  const found = new Map();
  for (const m of body.matchAll(/!\[[^\]]*\]\(https:\/\/awoiaf\.westeros\.org\/thumb\.php\?f=([^&)\s]+)&width=(\d+)\)/g)) {
    if (+m[2] < 200 || /^Red_pog/.test(m[1]) || found.has(m[1])) continue;
    const tail = body.slice(m.index + m[0].length).replace(/^\]\([^)]*\)/, '');
    const raw = tail.startsWith('<br>') ? tail.slice(4).split(/ \|\s*(?:\n|$)|\n/)[0] : (tail.match(/^\s*\n\n([^\n]+)/)?.[1] ?? '');
    const caption = /^[|#!]|^\[!\[/.test(raw) ? '' : plain(raw).replace(/\s*-?\s*Click to zoom$/i, '');
    found.set(m[1], caption.length > 160 ? '' : caption);
  }
  const images = [...found.keys()].slice(0, 40), captions = images.map((f) => found.get(f));
  return { title, summary, facts, image, images, captions };
}

const out = {};
for (const [name, file] of Object.entries(places)) {
  const { title, summary, facts, image, images, captions } = parse(readFileSync(`${DIR}/${decodeURIComponent(file)}`, 'utf8'));
  out[name] = { wiki: title, ...(image && { image }), ...(images.length && { images }), ...(captions.some(Boolean) && { captions }), ...(summary && { summary }), ...(facts.length && { facts }) };
}
writeFileSync('src/place-wiki.json', JSON.stringify(out));
console.log(`${Object.keys(out).length} places, ${Object.values(out).filter((p) => !p.summary).length} without a summary, ${Object.values(out).filter((p) => !p.image).length} without an image`);

// Self-check on a known shape (infobox + captions + lead).
const t = parse('---\ntitle: x\n---\n\n# Oldtown\n\n| Oldtown |\n| --- |\n| Location |the [Reach](Reach.md), [Westeros](Westeros.md) |\n| Map |![](x.png) |\n\nOldtown by someone\n\nThe **Oldtown** is a city,\\[1\\] old _and_ big. It sits in the Reach by the Honeywine.\n\n## History\n\nNo.');
console.assert(t.summary === 'The Oldtown is a city, old and big. It sits in the Reach by the Honeywine.', t.summary);
console.assert(JSON.stringify(t.facts) === '[["Location","the Reach, Westeros"]]', JSON.stringify(t.facts));
