// Keeps every file the map fetches (relief, sigils, fonts, scripts, wiki pictures) so a second visit loads from disk.
// Our own files sit in a cache named after the build (main.ts registers sw.js?v=<build>): a new deploy starts a new
// cache and drops the old one. The wiki's pictures never change under the same name, so their cache stays across deploys.
const STATIC = `static-${new URL(location.href).searchParams.get('v')}`, WIKI = 'wiki';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== WIKI).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || req.mode === 'navigate' || req.headers.has('range')) return; // the page itself always comes fresh
  const name = url.origin === location.origin ? STATIC : url.hostname === 'awoiaf.westeros.org' ? WIKI : null;
  if (!name) return;
  e.respondWith(caches.open(name).then(async (cache) => {
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); // <img> from the wiki is no-cors: opaque, status unknown
    return res;
  }));
});
