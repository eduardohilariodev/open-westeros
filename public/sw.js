// Keeps every file the map fetches (relief, sigils, fonts, scripts, wiki pictures) so a second visit loads from disk.
// main.ts registers sw.js?v=<build>&m=<media>. The scripts (/assets/, hashed by Vite) sit in a cache named after the build: a new deploy
// starts a new one. Everything else of ours (maps, textures, 3D places: ~45 MB) sits in a cache named after a hash of public/'s
// contents (vite.config.ts), so it survives every deploy that changes no picture. The wiki's pictures never change: their cache stays.
const q = new URL(location.href).searchParams;
const STATIC = `static-${q.get('v')}`, MEDIA = `media-${q.get('m')}`, WIKI = 'wiki';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== MEDIA && k !== WIKI).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || req.mode === 'navigate' || req.headers.has('range')) return; // the page itself always comes fresh
  const name = url.origin === location.origin ? (url.pathname.includes('/assets/') ? STATIC : MEDIA) : url.hostname === 'awoiaf.westeros.org' ? WIKI : null;
  if (!name) return;
  e.respondWith(caches.open(name).then(async (cache) => {
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); // <img> from the wiki is no-cors: opaque, status unknown
    return res;
  }));
});
