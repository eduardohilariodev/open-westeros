// Place panel text for every place on the map, from the scraped wiki articles (docs/sources/wiki, npm run wiki -- --places):
// the article's lead as the summary and its infobox rows as facts. Writes src/place-wiki.json.
// The image is the article's first picture, hot-linked from awoiaf's thumb.php (browsers load it; scripts get a 403).
// Usage: node tools/wiki/place-info.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rich, titleOf } from './md.mjs';
import { parse, parseHouse } from './article.mjs';
export { parse, parseHouse };

const DIR = 'docs/sources/wiki';
const { places } = JSON.parse(readFileSync(`${DIR}/_places.json`, 'utf8'));

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
  const { title, summary, facts, image, images, captions, more } = parse(readFileSync(`${DIR}/${decodeURIComponent(file)}`, 'utf8'));
  // Houses first from its Government row (a link in its facts), then those whose seat it is, current seats before former ones.
  const government = [...(facts.find(([k]) => k === 'Government')?.[1] ?? '').matchAll(/\]\((House_[^)#\s]+)\)/g)].map((m) => titleOf(m[1]));
  const seated = Object.entries(houses).flatMap(([t, h]) => h.seats.filter(([s]) => s === title).map(([, formerly]) => [t, formerly]));
  const ranked = [REGION_HOUSE[name], ...government, ...seated.filter(([, f]) => !f).map(([t]) => t), ...seated.filter(([, f]) => f).map(([t]) => t)];
  const placeHouses = [...new Set(ranked)].filter((t) => houses[t]).slice(0, MAX_HOUSES)
    .map((t) => { sigils.add(houses[t].sigil); return [t, houses[t].sigil, houses[t].label ?? t]; });
  out[name] = { wiki: title, ...(image && { image }), ...(images.length && { images }), ...(captions.some(Boolean) && { captions }), ...(summary && { summary }), ...(more && { more: true }), ...(facts.length && { facts }), ...(placeHouses.length && { houses: placeHouses }) };
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
