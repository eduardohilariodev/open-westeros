// Builds src/chapters.json (generated, never hand-edited): the two axes of the map's timeline (docs/decisions/0008).
// Books: the chapters in publication order, from quartermaester.info's chapter table (docs/sources/quartermaester/qm-paths.json, run
// `npm run characters` first), each with its book and the year AC it takes place in. Show: the episodes of Game of Thrones
// from the wiki's season pages (docs/sources/wiki/Game_of_Thrones_-_Season_N.md). Canon gives no year for an episode, so they carry none.
// usage: node tools/books/chapters.mjs
import fs from 'node:fs';

const WIKI = 'https://awoiaf.westeros.org/index.php/';
const qm = JSON.parse(fs.readFileSync('docs/sources/quartermaester/qm-paths.json', 'utf8'));

// The year of a chapter, by book and its index in the book (the number after the book in "ASOS-59: Sansa IV").
// Wiki, 297 AC: "The prologue from A Game of Thrones takes place in 297 AC."
// Wiki, 298 AC: "Many chapters from A Game of Thrones take place during 298 AC."
// Wiki, 299 AC: "The final chapters of A Game of Thrones, all chapters from A Clash of Kings, and most chapters of A Storm of Swords
//   take place during 299 AC." Its events open with the Battle on the Green Fork, AGOT 62 Tyrion VIII. AGOT 61 (Daenerys VII,
//   in Essos) is dated by neither page: assumption, kept in 298 with the chapters before it.
// ASOS 59 Sansa IV, the morning of Joffrey's wedding: "The three hundredth year since Aegon's Conquest."
// Wiki, 300 AC: "The final chapters of A Storm of Swords, most chapters of A Feast For Crows and all chapters of A Dance with Dragons
//   take place in 300 AC", note 2: "The first ironborn chapter, The Prophet, and possibly more, do not take place in 300 AC."
// TWOW sample chapter: canon gives no year; assumption, 300 AC like the end of ADWD it follows.
const YEAR = {
  agot: (n) => (n === 0 ? 297 : n <= 61 ? 298 : 299),
  acok: () => 299,
  asos: (n) => (n < 59 ? 299 : 300),
  affc: (n) => (n === 1 ? 299 : 300),
  adwd: () => 300,
  twow: () => 300,
};

const chapters = qm.chapters.map((c) => {
  const t = c.title.replace(/^TWOW-\?: /, 'TWOW: ');
  const m = /^(\w+)(?:-(\d+))?: /.exec(t);
  const book = m[1].toLowerCase();
  if (!YEAR[book]) throw new Error(`no year rule for ${t}`);
  return { t, u: c.url, book, year: YEAR[book](Number(m[2] ?? 0)) };
});

// "| 1 |"[Winter Is Coming](Winter_Is_Coming.md)" |" (season 4 drops the quotes)
const episodes = [];
for (let s = 1; s <= 8; s++) {
  const md = fs.readFileSync(`docs/sources/wiki/Game_of_Thrones_-_Season_${s}.md`, 'utf8');
  for (const m of md.matchAll(/^\| (\d+) \|"?\[([^\]]+)\]\(([^)]+)\.md\)"? \|/gm)) episodes.push({ s, e: Number(m[1]), t: m[2], u: WIKI + m[3] });
}
if (episodes.length !== 73) throw new Error(`expected 73 episodes, got ${episodes.length}`);

fs.writeFileSync('src/chapters.json', JSON.stringify({ chapters, episodes }));
console.log(`src/chapters.json: ${chapters.length} chapters, ${episodes.length} episodes`);
