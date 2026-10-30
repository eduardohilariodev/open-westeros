// Mirror every A Wiki of Ice and Fire article (awoiaf.westeros.org) into docs/sources/wiki/*.md via the MediaWiki API.
// The site sits behind a Cloudflare challenge, so API calls run inside a real Chrome window (system Chrome,
// persistent profile in .cache/) and reuse its clearance cookie. One request at a time, ~1.5s apart; resumable,
// pages already on disk are skipped. Content is CC BY-SA, keep the attribution frontmatter.
// Usage: node tools/wiki/scrape.mjs [Title ...]   (no titles = the whole wiki, ~10k pages, several hours)
//        node tools/wiki/scrape.mjs --places      (only the places on the map, plus all houses; name -> file in docs/sources/wiki/_places.json)
//        node tools/wiki/scrape.mjs --characters  (the characters of tools/characters/characters.json)
//        node tools/wiki/scrape.mjs --sigils      (download the house sigils place-info.mjs listed, into public/sigils/)
//        node tools/wiki/scrape.mjs --categories [Category:Places]  (walk a category tree, 500 members a call, into docs/sources/wiki/_place-categories.json)
//        node tools/wiki/scrape.mjs --wayback Title ...  (read the latest Wayback Machine copy instead of the live site)
// AWOIAF_COOKIE=<cf_clearance value> [AWOIAF_UA=<that browser's user agent>]: call the API with curl and that cookie, with no
// visible window (Chrome stays, headless, only as a DOM). Node's own fetch gets the challenge even with the cookie, curl does not.
// An article the live site refuses falls back to its Wayback copy, marked `copy:` in the frontmatter.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const SITE = 'https://awoiaf.westeros.org';
const OUT = 'docs/sources/wiki';
// Map names the wiki spells differently (checked by hand; the wiki's search guessed wrong about half the time).
const ALIASES = {
  'Old Stonebridge': 'Old Stone Bridge', 'Celtigar Keep': 'Claw Isle', 'Green Shield': 'Greenshield', 'Oakenshield (castle)': 'Oakenshield (Wall)', 'Oakenshield (island)': 'Oakenshield', 'Grey Shield': 'Greyshield',
  'South Shield': 'Southshield', 'Old Andalos': 'Andalos', 'The Fallen Kingdom of Sarnor': 'Kingdom of Sarnor', 'Sarne Delta': 'Sarne',
  'The Fallen Valyrian Freehold': 'Valyrian Freehold', 'The Mouths of the Rhoyne': 'Rhoyne', 'The Fallen Kingdom of Hyrkoon': 'Patrimony of Hyrkoon',
  'Lake Zamoyos': 'Zamoyos', 'Upper Zamoyos': 'Zamoyos', 'Lower Zamoyos': 'Zamoyos', 'The Jungles of Yi Ti': 'Yi Ti', 'The Straits of Leng': 'Leng',
  'Nightrunner Tribes': 'Nightrunners', 'Hornfoot Tribes': 'Hornfoot', "Storrord's Point": "Storrold's Point", "Hewett's Town": "Lord Hewett's Town",
  'Thenn': 'Thenn (valley)', 'Sweetport': 'Sweetport Sound', 'Mouth of the Mander': 'Mander', 'Lorath Island': 'Lorath', 'Lonely Hill': 'Lonely Hills', 'Marahai Bay': 'Marahai', "Mormont's Keep": 'Hall of the Mormonts', 'Kingshouse (Skagos)': 'Kingshouse',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Title -> file name. Also run inside the page (as source text) to build link targets.
// ponytail: Windows is case-insensitive, so two articles differing only in case would share a file.
const FILE_OF = `(title) => title.replaceAll(' ', '_').replace(/[<>:"/\\\\|?*%]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()) + '.md'`;
const fileOf = eval(FILE_OF);

const COOKIE = process.env.AWOIAF_COOKIE;
const UA = process.env.AWOIAF_UA ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const WAYBACK = process.argv[2] === '--wayback';
if (WAYBACK) process.argv.splice(2, 1);

// --sigils: download the coat-of-arms files place-info.mjs asked for (docs/sources/wiki/_sigils.json) and the houses mode's (src/houses.json)
// into public/sigils/. They are the wiki's own SVGs under CC BY-SA 3.0, so we host them instead of hot-linking; each stays linked to
// its File: page for credit. curl, no browser: Special:FilePath was not behind the challenge (2026-10-29); AWOIAF_COOKIE is sent when set.
if (process.argv[2] === '--sigils') {
  const SIGILS = 'public/sigils', tmp = `${SIGILS}/.download`;
  // Stored as 120px-high WebP (the SVGs are ~45 KB each, 8 MB for the lot; the panel shows them ~30px tall).
  const dest = (f) => `${SIGILS}/${f.replace(/\.[^.]+$/, '.webp')}`;
  const listed = [...JSON.parse(readFileSync(`${OUT}/_sigils.json`, 'utf8')), ...JSON.parse(readFileSync('src/houses.json', 'utf8')).map((h) => h.sigil)];
  const files = [...new Set(listed)].filter((f) => !existsSync(dest(f)));
  console.log(`${files.length} sigils to download`);
  for (const f of files) {
    await sleep(1000 + Math.random() * 600);
    const { stdout } = await promisify(execFile)('curl', ['-sL', '-A', UA, ...(COOKIE ? ['-b', `cf_clearance=${COOKIE}`] : []), '-o', tmp, '-w', '%{http_code} %{content_type}', `${SITE}/index.php/Special:FilePath/${encodeURIComponent(f)}`]);
    const [status, type = ''] = stdout.split(' ');
    if (status === '200' && type.startsWith('image/')) await sharp(readFileSync(tmp), { density: 300 }).resize({ height: 120 }).webp({ quality: 85 }).toFile(dest(f));
    else console.warn(`failed ${f}: HTTP ${status} ${type}`);
  }
  if (existsSync(tmp)) unlinkSync(tmp);
  process.exit(0);
}
// Chrome can die during a long run (seen after ~2,700 articles); `page` goes null and the article loop starts a new one.
let ctx, page;
async function launch() {
  ctx = await chromium.launchPersistentContext('.cache/awoiaf-profile', { channel: 'chrome', headless: !!(COOKIE || WAYBACK) });
  page = ctx.pages()[0] ?? await ctx.newPage();
  ctx.on('close', () => { page = null; });
}
await launch();
async function clearChallenge() {
  if (COOKIE || WAYBACK) return; // the page is only a DOM then, it never visits the wiki
  await page.goto(`${SITE}/index.php/Main_Page`);
  await page.waitForFunction(() => !document.title.includes('Just a moment'), null, { timeout: 300000 }); // solve by hand if it asks
}
async function curl(url) {
  const { stdout } = await promisify(execFile)('curl', ['-s', '--compressed', '-A', UA, '-b', `cf_clearance=${COOKIE}`, '-w', '\n%{http_code}', url], { maxBuffer: 64 << 20 });
  const cut = stdout.lastIndexOf('\n');
  return { status: Number(stdout.slice(cut + 1)), retry: null, body: stdout.slice(0, cut) };
}

async function api(params) {
  if (WAYBACK) throw new Error('live site skipped (--wayback)');
  for (let attempt = 0; ; attempt++) {
    await sleep(1200 + Math.random() * 800);
    const q = new URLSearchParams(params).toString();
    const res = COOKIE ? await curl(`${SITE}/api.php?format=json&formatversion=2&maxlag=5&${q}`) : await page.evaluate(async (q) => {
      const r = await fetch(`/api.php?format=json&formatversion=2&maxlag=5&${q}`);
      return { status: r.status, retry: r.headers.get('retry-after'), body: await r.text() };
    }, q);
    let json;
    try { json = JSON.parse(res.body); } catch { json = null; }
    if (json && !json.error) return json;
    if (json?.error && json.error.code !== 'maxlag') throw new Error(`${json.error.code}: ${json.error.info}`);
    if (attempt >= 6) throw new Error(`gave up after HTTP ${res.status}`);
    const wait = (Number(res.retry) || 2 ** attempt * 10) * 1000;
    console.warn(`HTTP ${res.status}${json ? ' (maxlag)' : ''}, waiting ${wait / 1000}s`);
    if (!json && COOKIE && attempt >= 1) throw new Error('cookie refused (expired, or AWOIAF_UA is not the browser that got it)');
    await sleep(wait);
    if (!json) await clearChallenge(); // HTML instead of JSON = Cloudflare challenged us again
  }
}

await clearChallenge();
mkdirSync(OUT, { recursive: true });

// --categories: a category and all its subcategories, 500 members a call (what place-categories.console.js does by hand).
if (process.argv[2] === '--categories') {
  const seen = new Set(), pages = {}, queue = [process.argv[3] ?? 'Category:Geography']; // the wiki's root of places; there is no Category:Places
  while (queue.length) {
    const cat = queue.shift();
    if (seen.has(cat)) continue;
    seen.add(cat);
    for (let cont = {}; cont;) {
      const r = await api({ action: 'query', list: 'categorymembers', cmtitle: cat, cmlimit: 'max', cmtype: 'page|subcat', ...cont });
      for (const m of r.query?.categorymembers ?? []) {
        if (m.ns === 14) queue.push(m.title);
        else if (m.ns === 0) (pages[m.title] ??= []).push(cat.replace('Category:', ''));
      }
      cont = r.continue;
    }
    process.stdout.write(`\r${seen.size} categories, ${queue.length} queued, ${Object.keys(pages).length} pages`);
  }
  writeFileSync(`${OUT}/_place-categories.json`, JSON.stringify({ categories: [...seen].sort(), pages }, null, 1));
  console.log(`\nwrote ${OUT}/_place-categories.json`);
  await ctx.close();
  process.exit(0);
}

// The latest Wayback Machine copy of an article, as the API's parse would give it ({ text, categories, revid }), plus the copy's URL.
// The archive rate-limits (HTTP 429) after a few quick calls, hence the longer pause.
async function wayback(title) {
  const url = `${SITE}/index.php/${encodeURI(title.replaceAll(' ', '_'))}`;
  const get = async (u) => {
    for (let attempt = 0; ; attempt++) {
      await sleep(3000 + Math.random() * 2000);
      const r = await fetch(u);
      if (r.ok) return r.text();
      if (r.status !== 429 || attempt >= 4) throw new Error(`wayback HTTP ${r.status}`);
      await sleep(2 ** attempt * 15000);
    }
  };
  const ts = (await get(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&filter=statuscode:200&fl=timestamp&limit=-1`)).trim();
  if (!ts) throw new Error('no wayback copy');
  const copy = `https://web.archive.org/web/${ts}id_/${url}`;
  const parse = await page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const body = doc.querySelector('.mw-parser-output');
    return body && { text: body.outerHTML, revid: Number(html.match(/"wgRevisionId":(\d+)/)?.[1]),
      categories: [...doc.querySelectorAll('#mw-normal-catlinks li a')].map((a) => ({ category: a.textContent })) };
  }, await get(copy));
  if (!parse) throw new Error('wayback copy has no article body');
  return { parse, copy };
}

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
  const rowsAll = JSON.parse(src.slice(src.indexOf('[['), src.lastIndexOf(']') + 1));
  // a name shared by two places (Oakenshield: Wall castle and Shield island) gets a 'Name (kind)' key per place, the bare name stays the first
  const dup = new Set(rowsAll.map(([n]) => n).filter((n, i, a) => a.indexOf(n) !== i));
  const names = rowsAll.flatMap(([name, kind]) => dup.has(name) ? [name, `${name} (${kind})`] : [name]);
  const lower = new Map();
  for (const t of index.articles) lower.set(t.toLowerCase(), t);
  for (const [from, to] of Object.entries(redirects)) if (!lower.has(from.toLowerCase())) lower.set(from.toLowerCase(), to.split('#')[0]);
  const places = {}, unmatched = [];
  for (const name of names) {
    const t = [ALIASES[name], name, name.replace(/^The /, '')].map((c) => c && lower.get(c.toLowerCase())).find(Boolean);
    if (t) places[name] = t; else unmatched.push(name);
  }
  writeFileSync(`${OUT}/_places.json`, JSON.stringify({ places: Object.fromEntries(Object.entries(places).map(([n, t]) => [n, fileOf(t)])), unmatched }, null, 1));
  // Plus every house: their infoboxes give the sigil and the seat, which is how a place gets its houses (place-info.mjs).
  titles = [...new Set([...Object.values(places), ...index.articles.filter((t) => t.startsWith('House '))])];
  console.log(`${names.length} map places: ${titles.length} articles with the houses, ${unmatched.length} unmatched (see ${OUT}/_places.json)`);
}

// --characters: the articles of the characters whose journeys the map shows (tools/characters/characters.json)
if (titles[0] === '--characters') {
  titles = Object.values(JSON.parse(readFileSync('tools/characters/characters.json', 'utf8')).characters).map((c) => c.wiki.replaceAll('_', ' '));
  console.log(`${titles.length} character articles`);
}
console.log(`${titles.length} articles, ${Object.keys(redirects).length} redirects`);

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
td.use(gfm);
td.addRule('tableCell', { // keep multi-line cells (infobox rows) on one line, or the GFM table falls apart
  filter: ['th', 'td'],
  replacement: (content, node) => (node.previousElementSibling ? '' : '| ') + content.trim().replace(/\s*\n\s*/g, '<br>') + ' |',
});

let done = 0, fetched = 0, failed = [];
const started = Date.now();
for (const title of titles) {
  const file = `${OUT}/${fileOf(title)}`;
  done++;
  if (existsSync(file)) continue;
  for (let tries = 0; !page; tries++) { // the browser died: start another (stop after 3 failed starts)
    console.warn('browser closed, restarting it');
    try { await launch(); await clearChallenge(); } catch (e) { if (tries >= 2) throw e; await sleep(10000); }
  }
  try {
    let parse, copy;
    try {
      ({ parse } = await api({ action: 'parse', page: title, prop: 'text|categories|revid', disableeditsection: 1, disablelimitreport: 1, disabletoc: 1 }));
    } catch (e) {
      if (/missingtitle|invalidtitle/.test(e.message)) throw e;
      if (e.message.startsWith('cookie refused')) { console.error(`${e.message}: stopping, rerun with a fresh AWOIAF_COOKIE to resume`); break; }
      ({ parse, copy } = await wayback(title));
    }
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
      `revid: ${parse.revid}`, ...(copy ? [`copy: ${copy}`] : []), `categories: ${JSON.stringify(parse.categories.filter((c) => !c.hidden).map((c) => c.category.replaceAll('_', ' ')))}`,
      'license: CC BY-SA 3.0, A Wiki of Ice and Fire contributors', '---', '', `# ${title}`, '', ''].join('\n');
    writeFileSync(file, front + md + '\n');
    fetched++;
    const left = titles.length - done, eta = ((Date.now() - started) / fetched) * left / 60000;
    console.log(`${done}/${titles.length} ${(100 * done / titles.length).toFixed(1)}%  ~${Math.floor(eta / 60)}h${String(Math.round(eta % 60)).padStart(2, '0')}m left  ${copy ? '[wayback] ' : ''}${title}`);
  } catch (e) {
    failed.push(title);
    console.warn(`failed ${title}: ${e.message}`);
  }
}
if (failed.length) writeFileSync(`${OUT}/_failed.json`, JSON.stringify(failed, null, 1));
console.log(`done, ${failed.length} failed${failed.length ? ` (see ${OUT}/_failed.json; rerun to retry)` : ''}`);
await ctx.close();
