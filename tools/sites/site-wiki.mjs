// What the place panel shows for the named places of the 3D sites (Winterfell, King's Landing): each one's passage from the
// scraped wiki article of its site (docs/sources/wiki, npm run wiki), written to src/sites/site-wiki.json, which place-info.ts merges
// in. Places the article gives only a name (or nothing) are left out and keep their lore text (src/sites/*/lore.ts).
// Usage: node tools/sites/site-wiki.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { rich, titleOf } from '../wiki/md.mjs';

const bullet = (s) => new RegExp(`^\\s*(?:-\\s+)+${s}`), para = (s) => new RegExp(`^${s}`);
// name -> { find: the article line (a bullet or paragraph, raw markdown), sentence?: keep only the sentence matching this, title?: the wiki article when it isn't the line's first link }
const SITES = [
  {
    article: 'Winterfell', from: '## Layout', to: '## History',
    places: {
      'Great Keep': { find: bullet('The \\[Great Keep\\]') },
      'Great Hall': { find: bullet('The \\[Great Hall\\]') },
      'First Keep': { find: bullet('The \\[First Keep\\]') },
      'Broken Tower': { find: bullet('The \\[broken tower\\]') },
      'Library Tower': { find: bullet('The \\[Library Tower\\]') },
      'Bell Tower': { find: bullet('The \\[Bell Tower\\]') },
      "Maester's Turret": { find: bullet("\\[Maester Luwin's turret\\]") },
      'Guards Hall': { find: bullet('The \\[Guards Hall\\]') },
      'Glass Gardens': { find: bullet('The \\[Glass Gardens\\]') },
      Godswood: { find: bullet('The ancient \\[godswood') },
      'Heart Tree': { find: bullet('The ancient \\[godswood'), sentence: /At the center of the grove/, title: 'Heart tree' },
      Crypts: { find: bullet('The \\[crypt of Winterfell\\]') },
      'South Gate': { find: para('The great \\[main gates') },
      "Hunter's Gate": { find: bullet("The \\[Hunter's Gate\\]") },
      'East Gate': { find: bullet('The \\[East Gate\\]') },
      Moat: { find: para('Winterfell is a huge castle complex spanning several acres, defended'), sentence: /moat/i, title: 'Winterfell' },
      'Winter Town': { find: para('The \\[winter town\\]\\([^)]*\\), so called') },
    },
  },
  {
    article: "King's Landing", from: '## Layout', to: '## Population',
    places: {
      'The Red Keep': { find: bullet('The \\[Red Keep\\]') },
      'Great Sept of Baelor': { find: bullet('The \\[Great Sept of Baelor\\]') },
      Dragonpit: { find: bullet('The \\[Dragonpit\\]') },
      'Guildhall of the Alchemists': { find: bullet('The \\[Guildhall of the Alchemists\\]') },
      'Flea Bottom': { find: bullet('\\[Flea Bottom\\]') },
      "Shae's Manse": { find: bullet('A \\[manse near the Iron Gate\\]') },
      "Littlefinger's Brothel": { find: bullet('Lord \\[Petyr Baelish\\].*brothel') },
      "Fishmonger's Square": { find: bullet("\\[Fishmonger's Square\\]") },
      'Tourney Grounds': { find: para('The \\[tourney grounds\\]') },
      "Aegon's High Hill": { find: para('The city covers the north shore'), sentence: /\[Aegon's High Hill\]/ },
      "Visenya's Hill": { find: para('The city covers the north shore'), sentence: /\[Visenya's Hill\]/, title: "Visenya's Hill" },
      "Rhaenys's Hill": { find: para('The city covers the north shore'), sentence: /\[Hill of Rhaenys\]/ },
      'Street of Steel': { find: bullet('The \\[Street of Steel\\]') },
      'Street of Silk': { find: bullet('The \\[Street of Silk\\]') },
      'Street of the Sisters': { find: bullet('The \\[Street of the Sisters\\]') },
      'Muddy Way': { find: bullet('The \\[Muddy Way\\]') },
      'The Hook': { find: bullet('The \\[Hook\\]') },
      'River Row': { find: bullet('\\[River Row\\]') },
      'Dragon Gate': { find: bullet('\\[Dragon Gate\\]') },
      'Iron Gate': { find: bullet('\\[Iron Gate\\]') },
      'River Gate': { find: bullet('\\[River Gate\\]') },
      'Lion Gate': { find: bullet('\\[Lion Gate\\]') },
      "King's Gate": { find: bullet("\\[King's Gate\\]") },
    },
  },
];

const out = {};
for (const site of SITES) {
  const md = readFileSync(`docs/sources/wiki/${site.article.replace(/ /g, '_')}.md`, 'utf8').split(/\r?\n/);
  const lines = md.slice(md.findIndex((l) => l === site.from), md.findIndex((l) => l === site.to));
  for (const [name, spec] of Object.entries(site.places)) {
    const line = lines.find((l) => spec.find.test(l));
    if (!line) { console.warn(`no line for ${name}`); continue; }
    let text = rich(line.replace(/^\s*(?:-\s+)+/, '')).replace(/\[\[citation needed\]\([^)]*\)\]/g, '');
    if (spec.sentence) {
      const hit = text.split(/(?<=[.!?])\s+(?=[A-Z[])/).find((s) => spec.sentence.test(s));
      if (!hit) { console.warn(`no sentence for ${name}`); continue; }
      text = hit;
    }
    if (text.length < 40) { console.warn(`${name}: too short (${text})`); continue; }
    const first = text.match(/\]\(([^)\s]+)\)/)?.[1];
    out[name] = {
      wiki: spec.title ?? (first ? titleOf(first) : site.article), summary: text,
      facts: [['Part of', `[${site.article}](${site.article.replace(/ /g, '_')})`]],
    };
  }
}
writeFileSync('src/sites/site-wiki.json', JSON.stringify(out, null, 1) + '\n');
console.log(`${Object.keys(out).length} site places`);
for (const [n, v] of Object.entries(out)) console.log(`  ${n} -> ${v.wiki}: ${v.summary.slice(0, 70)}`);
