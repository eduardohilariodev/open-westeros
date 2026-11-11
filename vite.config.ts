import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync } from 'node:fs';

/** A hash of every file in public/ (the maps, textures, 3D places): the service worker's media cache is named after it, so a deploy that
 * changes no picture keeps every returning visitor's ~45 MB of maps instead of downloading them again (public/sw.js). */
function mediaHash() {
  const h = createHash('md5');
  for (const e of readdirSync('public', { recursive: true, withFileTypes: true }).sort((a, b) => `${a.parentPath}/${a.name}`.localeCompare(`${b.parentPath}/${b.name}`))) {
    if (!e.isFile() || e.name === 'sw.js' || e.parentPath.includes('world-test')) continue;
    const p = `${e.parentPath}/${e.name}`;
    h.update(p).update(readFileSync(p));
  }
  return h.digest('hex').slice(0, 10);
}

// The dev server watches the whole repo by default: the wiki scraper's browser profile (.cache, files locked while it runs), the
// wiki and book dumps (docs) and screenshots (tmp) made every request take seconds and `npm run shot` time out.
export default defineConfig(({ command }) => ({
  define: {
    __BUILD__: JSON.stringify(Date.now().toString(36)), // names the service worker's cache of scripts, so each deploy refreshes it (main.ts)
    __MEDIA__: JSON.stringify(command === 'build' ? mediaHash() : 'dev'),
  },
  server: { watch: { ignored: ['**/.cache/**', '**/docs/**', '**/tmp/**', '**/assets/**'] } },
  // public/world-test holds test bakes for the dev server (?bake=, src/globe/bake.ts): 41 MB that the site never loads, so not shipped
  plugins: [{ name: 'drop-test-bakes', apply: 'build', closeBundle: () => rmSync('dist/world-test', { recursive: true, force: true }) }],
}));
