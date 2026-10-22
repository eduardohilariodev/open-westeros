// Place panel text for every place on the map, from the scraped wiki articles (docs/wiki, npm run wiki -- --places):
// the article's lead as the summary and its infobox rows as facts. Writes src/place-wiki.json.
// The image is the article's first picture, hot-linked from awoiaf's thumb.php (browsers load it; scripts get a 403).
// Usage: node tools/wiki/place-info.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'docs/wiki';
const { places } = JSON.parse(readFileSync(`${DIR}/_places.json`, 'utf8'));

// No citation marks, emphasis or escapes.
const strip = (md) => md
  .replace(/\\\[[^\]]*\\\]/g, '')
  .replace(/\*\*|(?<!\w)_|_(?!\w)/g, '')
  .replace(/\\(.)/g, '$1')
  .replace(/\s+([,.;:])/g, '$1').trim();
// Markdown -> plain text: link text only.
const plain = (md) => strip(md.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'));
const parens = (s) => s.replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'));
// Markdown -> text that keeps its wiki links as [text](Page_title#section), the part after awoiaf.westeros.org/index.php/, which the
// panel turns into links. Other links and pictures lose their markup.
const rich = (md) => {
  const kept = [];
  const text = md.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const doc = href.match(/^(.+?)\.md(#.*)?$/), abs = href.match(/^https:\/\/awoiaf\.westeros\.org\/index\.php\/(.+)$/);
      const target = doc ? parens(decodeURIComponent(doc[1])) + (doc[2] ?? '') : abs?.[1];
      const text = strip(label);
      if (!target || !text) return label;
      kept.push(`[${text}](${target})`);
      return `\u0001${kept.length - 1}\u0002`;
    });
  return strip(text).replace(/\u0001(\d+)\u0002/g, (_, i) => kept[i]);
};
// An article title from a link target ("Great_Keep_%28Winterfell%29" -> "Great Keep (Winterfell)").
const titleOf = (target) => decodeURIComponent(target.split('#')[0]).replaceAll('_', ' ');

export function parse(md) {
  const body = md.replace(/^---[\s\S]*?---\s*/, '');
  const title = body.match(/^# (.+)/m)[1];
  const lead = body.slice(body.indexOf('\n')).split(/^## /m)[0];
  const facts = [];
  for (const row of lead.matchAll(/^\| ([^|]+?) \|([^|]+?) \|$/gm)) { // two-cell infobox rows; single-cell ones are its title/caption
    if (/!\[/.test(row[2])) continue; // map or picture cell
    facts.push([plain(row[1]), rich(row[2].replace(/<br>/g, ', ').replace(/(^|, )- +/g, '$1'))]);
  }
  // Prose only: from the paragraph that names the subject in bold ("The **Trident** is..."), skipping tables and captions.
  const paras = lead.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && !/^[|!\[]/.test(p));
  const start = paras.findIndex((p) => p.includes('**') && !/^\*\*[^*]+\*\*$/.test(p)); // bold name in prose, not a bold caption
  const summary = (start < 0 ? [] : paras.slice(start)).map(rich).join('\n\n');
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
  // Artist renditions first (Ted Nasmith, Fantasy Flight Games, other credited art), plain pictures next, maps last; stable, so ties keep
  // document order. The panel's hero is then the best picture instead of the infobox's (often a map). ponytail: keyword scoring on the
  // caption/file name, a place whose art is uncredited stays as is.
  const score = (f) => { const s = `${f} ${found.get(f)}`; return /map/i.test(s) ? -5 : /Nasmith|TN-/.test(s) ? 4 : /Fantasy Flight|Jedruszek|Vela/.test(s) ? 3 : /\bby \S/.test(found.get(f)) ? 2 : 0; };
  const images = [...found.keys()].slice(0, 40).sort((a, b) => score(b) - score(a)), captions = images.map((f) => found.get(f));
  const hero = images.length && score(images[0]) > 0 ? `https://awoiaf.westeros.org/thumb.php?f=${images[0]}&width=350` : image;
  return { title, summary, facts, image: hero, images, captions };
}

// A house article's infobox: its full name, coat-of-arms file (the picture in the infobox) and seats, [title, formerly?].
export function parseHouse(md) {
  const body = md.replace(/^---[\s\S]*?---\s*/, '');
  const lead = body.slice(body.indexOf('\n')).split(/^## /m)[0];
  const sigil = lead.match(/^\| \[!\[[^\]]*\]\(https:\/\/awoiaf\.westeros\.org\/thumb\.php\?f=([^&)\s]+)&/m)?.[1];
  const label = lead.match(/^\| (House [^|]+?) \|$/m)?.[1];
  const seats = [...(lead.match(/^\| Seats? \|(.+)\|$/m)?.[1] ?? '').matchAll(/\]\(([^)\s]+)\.md\)([^[<|]*)/g)]
    .map((m) => [titleOf(decodeURIComponent(m[1])), /former|ruin|lost/i.test(m[2])]); // doc links are the file name, encoded once more
  return { label, sigil: sigil && decodeURIComponent(sigil), seats };
}

// The houses of every house article: title -> { label, sigil, seats }.
const houses = {};
for (const f of readdirSync(DIR)) {
  if (!f.startsWith('House_') || !f.endsWith('.md')) continue;
  const md = readFileSync(`${DIR}/${f}`, 'utf8');
  const h = parseHouse(md);
  if (h.sigil) houses[md.match(/^# (.+)/m)[1]] = h;
}

// The great house of each region on the map: regions have no seat or government row of their own to read it from.
const REGION_HOUSE = {
  'The North': 'House Stark', 'The Riverlands': 'House Tully', 'The Vale of Arryn': 'House Arryn', 'The Westerlands': 'House Lannister',
  'The Reach': 'House Tyrell', 'The Stormlands': 'House Baratheon', 'Iron Islands': 'House Greyjoy', 'Dorne': 'House Martell',
  'The Crownlands': 'House Targaryen',
};
const MAX_HOUSES = 4;

const out = {}, sigils = new Set();
for (const [name, file] of Object.entries(places)) {
  const { title, summary, facts, image, images, captions } = parse(readFileSync(`${DIR}/${decodeURIComponent(file)}`, 'utf8'));
  // Houses first from its Government row (a link in its facts), then those whose seat it is, current seats before former ones.
  const government = [...(facts.find(([k]) => k === 'Government')?.[1] ?? '').matchAll(/\]\((House_[^)#\s]+)\)/g)].map((m) => titleOf(m[1]));
  const seated = Object.entries(houses).flatMap(([t, h]) => h.seats.filter(([s]) => s === title).map(([, formerly]) => [t, formerly]));
  const ranked = [REGION_HOUSE[name], ...government, ...seated.filter(([, f]) => !f).map(([t]) => t), ...seated.filter(([, f]) => f).map(([t]) => t)];
  const placeHouses = [...new Set(ranked)].filter((t) => houses[t]).slice(0, MAX_HOUSES)
    .map((t) => { sigils.add(houses[t].sigil); return [t, houses[t].sigil, houses[t].label ?? t]; });
  out[name] = { wiki: title, ...(image && { image }), ...(images.length && { images }), ...(captions.some(Boolean) && { captions }), ...(summary && { summary }), ...(facts.length && { facts }), ...(placeHouses.length && { houses: placeHouses }) };
}
writeFileSync('src/place-wiki.json', JSON.stringify(out));
writeFileSync(`${DIR}/_sigils.json`, JSON.stringify([...sigils].sort()));
console.log(`${Object.keys(out).length} places, ${Object.values(out).filter((p) => !p.summary).length} without a summary, ${Object.values(out).filter((p) => !p.image).length} without an image, ${Object.values(out).filter((p) => p.houses).length} with houses (${sigils.size} sigils)`);

// Self-check on a known shape (infobox + captions + lead).
const t = parse('---\ntitle: x\n---\n\n# Oldtown\n\n| Oldtown |\n| --- |\n| Location |the [Reach](Reach.md), [Westeros](Westeros.md) |\n| Map |![](x.png) |\n\nOldtown by someone\n\nThe **Oldtown** is a city,\\[1\\] old _and_ big. It sits in the Reach by the Honeywine.\n\n## History\n\nNo.');
console.assert(t.summary === 'The Oldtown is a city, old and big. It sits in the Reach by the Honeywine.', t.summary);
console.assert(JSON.stringify(t.facts) === '[["Location","the [Reach](Reach), [Westeros](Westeros)"]]', JSON.stringify(t.facts));
console.assert(rich('Of [_House Stark_](House_Stark.md) at [Great Keep](Great_Keep_%28Winterfell%29.md#Layout), see [here](https://x.org/) and [1](#cite_note-1).') ===
  'Of [House Stark](House_Stark) at [Great Keep](Great_Keep_%28Winterfell%29#Layout), see here and 1.', rich('[_House Stark_](House_Stark.md)'));
const h = parseHouse('# House Stark\n\n| House Stark of Winterfell |\n| --- |\n| [![](https://awoiaf.westeros.org/thumb.php?f=House_Stark.svg&width=250)](x)<br>Words |\n| Seat |[Winterfell](Winterfell.md) (formerly)<br>[Wolf\'s Den](Wolf\'s_Den.md)<br>[Why?](Why%253F.md) |\n\nText.');
console.assert(JSON.stringify(h) === '{"label":"House Stark of Winterfell","sigil":"House_Stark.svg","seats":[["Winterfell",true],["Wolf\'s Den",false],["Why?",false]]}', JSON.stringify(h));
