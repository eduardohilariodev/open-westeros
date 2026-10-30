// Character card text for src/character-wiki.json, from the scraped wiki articles (docs/sources/wiki): the lead as the summary, a few
// infobox rows as facts, the article's best picture (hot-linked from thumb.php, like places). Also lists any house sigil that
// public/sigils lacks in docs/sources/wiki/_sigils.json, so `node tools/wiki/scrape.mjs --sigils` fetches it.
// Usage: node tools/wiki/scrape.mjs --characters && node tools/wiki/character-info.mjs && node tools/wiki/scrape.mjs --sigils
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse, parseHouse } from './article.mjs';

const DIR = 'docs/sources/wiki';
const { characters } = JSON.parse(readFileSync('tools/characters/characters.json', 'utf8'));
const FACTS = ['Born', 'Died', 'Title', 'Titles', 'Allegiance', 'Culture', 'Religion', 'Played by', 'Father', 'Mother', 'Spouse'];
const file = (title) => `${DIR}/${title.replaceAll(' ', '_').replace(/[<>:"/\|?*%]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}.md`;
const text = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // the panel shows plain text

const out = {}, missing = [], sigils = [];
for (const [id, c] of Object.entries(characters)) {
  // the house's sigil file comes from its own article
  const hf = file(c.house[0].replaceAll('_', ' '));
  const sigil = existsSync(hf) ? parseHouse(readFileSync(hf, 'utf8')).sigil : null;
  if (sigil && !existsSync(`public/sigils/${sigil.replace(/\.[^.]+$/, '.webp')}`)) sigils.push(sigil);
  const f = file(c.wiki.replaceAll('_', ' '));
  if (!existsSync(f)) { missing.push(c.wiki); continue; }
  const { summary, facts, image, more } = parse(readFileSync(f, 'utf8'));
  const keep = facts.filter(([k, v]) => FACTS.includes(k) && v && v.length < 160).slice(0, 7).map(([k, v]) => [k, text(v)]);
  out[id] = { ...(image && { image }), ...(summary && { summary: text(summary) }), ...(more && { more: true }), ...(keep.length && { facts: keep }) };
}
if (Object.keys(out).length) writeFileSync('src/character-wiki.json', JSON.stringify(out));
if (sigils.length) {
  const f = `${DIR}/_sigils.json`, have = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
  writeFileSync(f, JSON.stringify([...new Set([...have, ...sigils])].sort()));
}
console.log(`${Object.keys(out).length} of ${Object.keys(characters).length} characters written to src/character-wiki.json; sigils to fetch: ${[...new Set(sigils)].join(', ') || 'none'}`);
if (missing.length) console.log(`not scraped yet (${missing.length}): ${missing.join(', ')}`);
