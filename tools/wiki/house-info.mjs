// House card text for src/house-wiki.json, from the scraped house articles (docs/sources/wiki): the lead as the summary and a few infobox
// rows as facts, as character-info.mjs does for characters. The card hides all of it behind the spoiler button until the end of the story.
// Usage: node tools/wiki/house-info.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from './article.mjs';

const DIR = 'docs/sources/wiki';
const houses = JSON.parse(readFileSync('src/houses.json', 'utf8'));
const FACTS = ['Coat of arms', 'Titles', 'Heirs', 'Ancestral weapon', 'Founder', 'Founded', 'Cadet branches', 'Regions', 'Region', 'Religion', 'Culture'];
const file = (title) => `${DIR}/${title.replaceAll(' ', '_').replace(/[<>:"/\|?*%]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}.md`;
const text = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<br>/g, '; ').replace(/(^|; )-\s+/g, '$1'); // the card shows plain text

const out = {}, missing = [];
for (const h of houses) {
  const f = file(h.title);
  if (!existsSync(f)) { missing.push(h.title); continue; }
  const { summary, facts, more } = parse(readFileSync(f, 'utf8'));
  const keep = facts.filter(([k, v]) => FACTS.includes(k) && v && text(v).length < 220).slice(0, 6).map(([k, v]) => [k, text(v)]);
  if (summary || keep.length) out[h.id] = { ...(summary && { summary: text(summary) }), ...(more && { more: true }), ...(keep.length && { facts: keep }) };
}
writeFileSync('src/house-wiki.json', JSON.stringify(out));
console.log(`${Object.keys(out).length} of ${houses.length} houses written to src/house-wiki.json${missing.length ? `; no article for ${missing.join(', ')}` : ''}`);
