// Offline gap report: wiki places the map lacks. Reads the mirrored articles in docs/wiki (categories + links) and the map's
// names (src/world-data.ts). Writes docs/wiki/_place-gap.json. Usage: node tools/wiki/place-gap.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const W = 'docs/wiki';
const src = readFileSync('src/world-data.ts', 'utf8');
const mapNames = JSON.parse(src.slice(src.indexOf('[['), src.lastIndexOf(']') + 1)).map(([n]) => n);
const norm = (s) => s.toLowerCase().replace(/^the /, '').replace(/_/g, ' ').trim();
const index = JSON.parse(readFileSync(`${W}/_index.json`, 'utf8'));
const placeFiles = new Set(Object.values(JSON.parse(readFileSync(`${W}/_places.json`, 'utf8')).places));
const onMap = new Set(mapNames.map(norm));
const fileOf = (t) => t.replaceAll(' ', '_') + '.md';
const titleOfFile = (f) => decodeURIComponent(f).replace(/\.md$/, '').replaceAll('_', ' ');
const isArticle = new Set(index.articles);
const placeCat = /^(Places in |Castles|Towns|Cities|Villages|Inns|Ruins|Ports|Keeps|Towers|Bridges|Fords|Septs|Holdfasts|Forts|Islands|Rivers|Lakes|Hills|Mountains|Forests|Battles|Landmarks|Taverns|Brothels|Ships)/;
const wanted = [], mentioned = new Map(); // wanted: scraped articles in a place category not on the map; mentioned: link target -> pages linking it
const files = readdirSync(W).filter((f) => f.endsWith('.md'));
for (const f of files) {
  const t = readFileSync(`${W}/${f}`, 'utf8');
  const title = (t.match(/^title: "(.*)"$/m) ?? [])[1] ?? titleOfFile(f);
  const cats = JSON.parse((t.match(/^categories: (.*)$/m) ?? [, '[]'])[1]);
  const pc = cats.filter((c) => placeCat.test(c));
  if (pc.length && !title.startsWith('House ') && !onMap.has(norm(title)) && !placeFiles.has(f)) wanted.push({ title, cats: pc });
  if (!placeFiles.has(f)) continue; // links are followed from articles of places already on the map
  for (const [, href] of t.matchAll(/\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g)) {
    const m = titleOfFile(href);
    if (!isArticle.has(m) || onMap.has(norm(m)) || m.startsWith('House ')) continue;
    (mentioned.get(m) ?? mentioned.set(m, new Set()).get(m)).add(titleOfFile(f));
  }
}
const scraped = new Set(files);
const linked = [...mentioned].filter(([m]) => !scraped.has(fileOf(m))).map(([title, by]) => ({ title, by: [...by].slice(0, 4), n: by.size })).sort((a, b) => b.n - a.n);
writeFileSync(`${W}/_place-gap.json`, JSON.stringify({ wanted, linkedUnscraped: linked }, null, 1));
console.log(`${wanted.length} scraped place articles not on the map, ${linked.length} unscraped articles linked from map places`);
