// After `vite build`: one static page per map place, dist/place/<slug>/index.html, plus dist/sitemap.xml listing them all.
// Each page is the built index.html with the place's own title, description and canonical, and its wiki summary already in the
// place card, so a search engine reads "Winterfell Map" without running WebGL. The app then opens the place from the path
// (main.ts, placeSlug in src/ui/placePanel.ts: keep slug() below in step with it).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const SITE = html.match(/<link rel="canonical" href="([^"]+?)\/?"/)[1];
const PLACES = JSON.parse(readFileSync('src/world-data.ts', 'utf8').match(/export const PLACES[^=]*= (\[[\s\S]*?\]);\n/)[1]);
const WIKI = JSON.parse(readFileSync('src/place-wiki.json', 'utf8'));

const slug = (name) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (s) => s.replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1'); // [label](Page) wiki links → label
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(' ', n - 1))}…`);

/** Replaces exactly one match of `re` in `s`; a template change that breaks a pattern fails the build instead of shipping a page without it. */
const one = (s, re, to) => {
  const n = s.match(new RegExp(re.source, 'g'))?.length ?? 0;
  if (n !== 1) throw new Error(`prerender: ${re} matched ${n} times in dist/index.html`);
  return s.replace(re, to);
};

const page = (name, kind, summary) => {
  const url = `${SITE}/place/${slug(name)}/`;
  const title = `${name} Map · Open Westeros`;
  const Kind = kind[0].toUpperCase() + kind.slice(1);
  const desc = clip(summary ? plain(summary) : `${name}, a ${kind} of the Known World, on the free interactive 3D map of Westeros and Essos from Game of Thrones and A Song of Ice and Fire.`, 155);
  const ld = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Westeros Map', item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name: `${name} Map`, item: url },
  ] };
  let s = html;
  s = one(s, /<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  s = one(s, /<meta name="description" content="[^"]*"/, `<meta name="description" content="${esc(desc)}"`);
  s = one(s, /<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${url}"`);
  s = one(s, /<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${url}"`);
  s = one(s, /<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${esc(title)}"`);
  s = one(s, /<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${esc(title)}"`);
  s = one(s, /<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${esc(desc)}"`);
  s = one(s, /<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${esc(desc)}"`);
  s = one(s, /<\/head>/, `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n</head>`);
  s = one(s, /<noscript><h1>[^<]*<\/h1>/, `<noscript><h1>${esc(name)} on the Westeros Map</h1>`);
  // The place card's text, filled as the app fills it (src/ui/placePanel.ts showCard), so the page has its text before any script
  // runs. The card stays hidden: the app opens it itself, and what a visitor sees does not change.
  s = one(s, /(title="Close">×<\/button>\s*)<h1><\/h1>(\s*)<div class="kind"><\/div>/, `$1<h1>${esc(name)}</h1>$2<div class="kind">${esc(Kind)}</div>`); // not the house card's, which has a crest between
  s = one(s, /<p class="summary"><\/p>/, `<p class="summary">${esc(summary ? plain(summary) : desc)}</p>`);
  return s;
};

const done = new Set();
for (const [name, kind] of PLACES) {
  const sl = slug(name);
  if (!sl || done.has(sl)) continue; // a name shared by two kinds: the first row wins, as main.ts finds it
  done.add(sl);
  const info = WIKI[`${name} (${kind})`] ?? WIKI[name] ?? {};
  mkdirSync(`dist/place/${sl}`, { recursive: true });
  writeFileSync(`dist/place/${sl}/index.html`, page(name, kind, info.summary));
}
const day = new Date().toISOString().slice(0, 10);
const urls = [`${SITE}/`, ...[...done].map((sl) => `${SITE}/place/${sl}/`)];
writeFileSync('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u, i) => `<url><loc>${u}</loc><lastmod>${day}</lastmod><priority>${i ? '0.7' : '1.0'}</priority></url>`).join('\n')}\n</urlset>\n`);
console.log(`prerender: ${done.size} place pages, sitemap of ${urls.length} URLs`);
