// Mirror every A Wiki of Ice and Fire article (awoiaf.westeros.org) into docs/wiki/*.md via the MediaWiki API.
// The site sits behind a Cloudflare challenge, so API calls run inside a real Chrome window (system Chrome,
// persistent profile in .cache/) and reuse its clearance cookie. One request at a time, ~1.5s apart; resumable,
// pages already on disk are skipped. Content is CC BY-SA, keep the attribution frontmatter.
// Usage: node tools/wiki/scrape.mjs [Title ...]   (no titles = the whole wiki, ~10k pages, several hours)
//        node tools/wiki/scrape.mjs --places      (only the places on the map; name -> file in docs/wiki/_places.json)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const SITE = 'https://awoiaf.westeros.org';
const OUT = 'docs/wiki';
// Map names the wiki spells differently (checked by hand; the wiki's search guessed wrong about half the time).
const ALIASES = {
  'Old Stonebridge': 'Old Stone Bridge', 'Celtigar Keep': 'Claw Isle', 'Green Shield': 'Greenshield', 'Grey Shield': 'Greyshield',
  'South Shield': 'Southshield', 'Old Andalos': 'Andalos', 'The Fallen Kingdom of Sarnor': 'Kingdom of Sarnor', 'Sarne Delta': 'Sarne',
  'The Fallen Valyrian Freehold': 'Valyrian Freehold', 'The Mouths of the Rhoyne': 'Rhoyne', 'The Fallen Kingdom of Hyrkoon': 'Patrimony of Hyrkoon',
  'Lake Zamoyos': 'Zamoyos', 'Upper Zamoyos': 'Zamoyos', 'Lower Zamoyos': 'Zamoyos', 'The Jungles of Yi Ti': 'Yi Ti', 'The Straits of Leng': 'Leng',
  'Nightrunner Tribes': 'Nightrunners', 'Hornfoot Tribes': 'Hornfoot', "Storrord's Point": "Storrold's Point", "Hewett's Town": "Lord Hewett's Town",
  'Thenn': 'Thenn (valley)', 'Sweetport': 'Sweetport Sound', 'Mouth of the Mander': 'Mander', 'Lorath Island': 'Lorath', 'Lonely Hill': 'Lonely Hills', 'Marahai Bay': 'Marahai',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Title -> file name. Also run inside the page (as source text) to build link targets.
// ponytail: Windows is case-insensitive, so two articles differing only in case would share a file.
const FILE_OF = `(title) => title.replaceAll(' ', '_').replace(/[<>:"/\\\\|?*%]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()) + '.md'`;
const fileOf = eval(FILE_OF);

const ctx = await chromium.launchPersistentContext('.cache/awoiaf-profile', { channel: 'chrome', headless: false });
const page = ctx.pages()[0] ?? await ctx.newPage();
async function clearChallenge() {
  await page.goto(`${SITE}/index.php/Main_Page`);
  await page.waitForFunction(() => !document.title.includes('Just a moment'), null, { timeout: 300000 }); // solve by hand if it asks
}

async function api(params) {
  for (let attempt = 0; ; attempt++) {
    await sleep(1200 + Math.random() * 800);
    const res = await page.evaluate(async (q) => {
      const r = await fetch(`/api.php?format=json&formatversion=2&maxlag=5&${q}`);
      return { status: r.status, retry: r.headers.get('retry-after'), body: await r.text() };
    }, new URLSearchParams(params).toString());
    let json;
    try { json = JSON.parse(res.body); } catch { json = null; }
    if (json && !json.error) return json;
    if (json?.error && json.error.code !== 'maxlag') throw new Error(`${json.error.code}: ${json.error.info}`);
    if (attempt >= 6) throw new Error(`gave up after HTTP ${res.status}`);
    const wait = (Number(res.retry) || 2 ** attempt * 10) * 1000;
    console.warn(`HTTP ${res.status}${json ? ' (maxlag)' : ''}, waiting ${wait / 1000}s`);
    await sleep(wait);
    if (!json) await clearChallenge(); // HTML instead of JSON = Cloudflare challenged us again
  }
}

await clearChallenge();
mkdirSync(OUT, { recursive: true });

// Every article, plus the redirects pointing at it (from -> target#fragment) so links to redirect titles
// resolve to the real article file. Cached in _index.json; delete it to pick up new pages.
let index;
if (existsSync(`${OUT}/_index.json`)) index = JSON.parse(readFileSync(`${OUT}/_index.json`, 'utf8'));
else {
  index = { articles: new Set(), redirects: {} };
  for (let cont = {}; cont;) {
    const r = await api({ action: 'query', generator: 'allpages', gapnamespace: 0, gapfilterredir: 'nonredirects', gaplimit: 'max',
      prop: 'redirects', rdprop: 'title|fragment', rdnamespace: 0, rdlimit: 'max', ...cont });
    for (const p of r.query?.pages ?? []) {
      index.articles.add(p.title);
      for (const { title, fragment } of p.redirects ?? []) index.redirects[title] = fragment ? `${p.title}#${fragment}` : p.title;
    }
    cont = r.continue;
    process.stdout.write(`\rindexing: ${index.articles.size} articles`);
  }
  index.articles = [...index.articles].sort();
  writeFileSync(`${OUT}/_index.json`, JSON.stringify(index, null, 1));
  console.log();
}
const { redirects } = index;
let titles = process.argv.length > 2 ? process.argv.slice(2) : index.articles;

// --places: only the articles for the places on the map (src/world-data.ts), matched by name; the first letter of a
// wiki title is case-insensitive, and the map often says "The Frostfangs" where the wiki says "Frostfangs".
if (titles[0] === '--places') {
  const src = readFileSync('src/world-data.ts', 'utf8');
  const names = JSON.parse(src.slice(src.indexOf('[['), src.lastIndexOf(']') + 1)).map(([name]) => name);
  const lower = new Map();
  for (const t of index.articles) lower.set(t.toLowerCase(), t);
  for (const [from, to] of Object.entries(redirects)) if (!lower.has(from.toLowerCase())) lower.set(from.toLowerCase(), to.split('#')[0]);
  const places = {}, unmatched = [];
  for (const name of names) {
    const t = [ALIASES[name], name, name.replace(/^The /, '')].map((c) => c && lower.get(c.toLowerCase())).find(Boolean);
    if (t) places[name] = t; else unmatched.push(name);
  }
  writeFileSync(`${OUT}/_places.json`, JSON.stringify({ places: Object.fromEntries(Object.entries(places).map(([n, t]) => [n, fileOf(t)])), unmatched }, null, 1));
  titles = [...new Set(Object.values(places))];
  console.log(`${names.length} map places: ${titles.length} articles, ${unmatched.length} unmatched (see ${OUT}/_places.json)`);
}
console.log(`${titles.length} articles, ${Object.keys(redirects).length} redirects`);

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
td.use(gfm);
td.addRule('tableCell', { // keep multi-line cells (infobox rows) on one line, or the GFM table falls apart
  filter: ['th', 'td'],
  replacement: (content, node) => (node.previousElementSibling ? '' : '| ') + content.trim().replace(/\s*\n\s*/g, '<br>') + ' |',
});

let done = 0, failed = [];
for (const title of titles) {
  const file = `${OUT}/${fileOf(title)}`;
  done++;
  if (existsSync(file)) continue;
  try {
    const { parse } = await api({ action: 'parse', page: title, prop: 'text|categories|revid', disableeditsection: 1, disablelimitreport: 1, disabletoc: 1 });
    // Clean up in the browser, which has a real DOM: drop page chrome, make links absolute or local.
    const html = await page.evaluate(({ html, redirects, site, FILE_OF }) => {
      const fileOf = eval(FILE_OF);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('style, script, .toc, .mw-editsection, .navbox, .noprint, .mw-cite-backlink').forEach((n) => n.remove());
      doc.querySelectorAll('sup.reference').forEach((s) => s.replaceWith(s.textContent)); // "[3]", matching the numbered References list
      for (const a of doc.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href');
        const m = href.match(/^\/index\.php\/([^#?]+)(#.*)?$/);
        a.removeAttribute('title');
        if (a.classList.contains('new')) a.replaceWith(...a.childNodes); // red link: no such page
        else if (m && !decodeURIComponent(m[1]).includes(':')) { // another article -> its local .md
          const name = decodeURIComponent(m[1]).replaceAll('_', ' ');
          let [t, frag] = (redirects[name] ?? name).split('#');
          if (m[2]) frag = m[2].slice(1);
          a.setAttribute('href', encodeURIComponent(fileOf(t)).replace(/[()]/g, (c) => c === '(' ? '%28' : '%29') + (frag ? '#' + frag : ''));
        } else if (href.startsWith('/')) a.setAttribute('href', site + href);
      }
      doc.querySelectorAll('img[src^="/"]').forEach((i) => { i.setAttribute('src', site + i.getAttribute('src')); i.removeAttribute('srcset'); });
      return doc.body.innerHTML;
    }, { html: parse.text, redirects, site: SITE, FILE_OF });
    const md = td.turndown(html);
    const front = ['---', `title: ${JSON.stringify(title)}`, `source: ${SITE}/index.php/${encodeURI(title.replaceAll(' ', '_'))}`,
      `revid: ${parse.revid}`, `categories: ${JSON.stringify(parse.categories.filter((c) => !c.hidden).map((c) => c.category.replaceAll('_', ' ')))}`,
      'license: CC BY-SA 3.0, A Wiki of Ice and Fire contributors', '---', '', `# ${title}`, '', ''].join('\n');
    writeFileSync(file, front + md + '\n');
    if (done % 50 === 0) console.log(`${done}/${titles.length} ${title}`);
  } catch (e) {
    failed.push(title);
    console.warn(`failed ${title}: ${e.message}`);
  }
}
if (failed.length) writeFileSync(`${OUT}/_failed.json`, JSON.stringify(failed, null, 1));
console.log(`done, ${failed.length} failed${failed.length ? ` (see ${OUT}/_failed.json; rerun to retry)` : ''}`);
await ctx.close();
