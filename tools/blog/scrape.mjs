// Mirror the ASOIAF posts of the Atlas of Ice and Fire blog (atlasoficeandfireblog.wordpress.com) into docs/sources/atlas-blog/<slug>.md,
// with every post image at full size in docs/sources/atlas-blog/img/<slug>/. Uses the public WordPress.com API (no browser needed).
// Resumable: posts whose .md exists are skipped, so delete a file to refetch it.
// Usage: node tools/blog/scrape.mjs
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const SITE = 'atlasoficeandfireblog.wordpress.com';
const OUT = 'docs/sources/atlas-blog';
// Only keep ASOIAF posts; the blog also covers Forgotten Realms, Wheel of Time, Malazan, etc.
const KEEP = new Set(['a song of ice and fire', 'atlas of ice and fire', 'game of thrones', 'george r.r. martin']);
const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).use(gfm);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, binary = false) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return binary ? Buffer.from(await res.arrayBuffer()) : await res.json();
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(2000 * (attempt + 1));
    }
  }
}

mkdirSync(OUT, { recursive: true });
let n = 0;
for (let offset = 0; ; offset += 50) {
  const { posts } = await get(`https://public-api.wordpress.com/rest/v1.1/sites/${SITE}/posts?number=50&offset=${offset}&fields=ID,title,date,URL,slug,content,categories,tags`);
  if (!posts.length) break;
  for (const p of posts) {
    if (!Object.keys(p.categories ?? {}).some((c) => KEEP.has(c.toLowerCase()))) continue;
    const file = `${OUT}/${p.date.slice(0, 10)}-${p.slug}.md`;
    if (existsSync(file)) continue;
    const dir = `img/${p.date.slice(0, 10)}-${p.slug}`;
    let html = p.content;
    const imgs = new Map(); // full-size url -> local name
    html = html.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/g, (m, a, src, c) => {
      const url = src.replace(/&amp;/g, '&').split('?')[0];
      if (!/\/wp-content\/uploads\//.test(url)) return m;
      if (!imgs.has(url)) imgs.set(url, decodeURIComponent(url.split('/').pop()));
      return `${a}${dir}/${imgs.get(url)}${c}`;
    });
    if (imgs.size) mkdirSync(`${OUT}/${dir}`, { recursive: true });
    for (const [url, name] of imgs) {
      const dest = `${OUT}/${dir}/${name}`;
      if (existsSync(dest)) continue;
      try { writeFileSync(dest, await get(url, true)); } catch (e) { console.warn('image failed:', e.message); }
      await sleep(300);
    }
    const front = ['---', `title: ${JSON.stringify(p.title.replace(/&#8217;/g, '’').replace(/&amp;/g, '&'))}`, `date: ${p.date}`, `source: ${p.URL}`,
      `tags: ${JSON.stringify(Object.keys(p.tags ?? {}))}`, '---', ''].join('\n');
    writeFileSync(file, `${front}\n${td.turndown(html)}\n`);
    console.log(`${++n} ${p.slug} (${imgs.size} images)`);
  }
}
console.log(`done, ${n} new posts in ${OUT}`);
