import { defineConfig } from 'vite';

// The dev server watches the whole repo by default: the wiki scraper's browser profile (.cache, files locked while it runs), the
// wiki and book dumps (docs) and screenshots (tmp) made every request take seconds and `npm run shot` time out.
export default defineConfig({
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) }, // names the service worker's cache, so each deploy refreshes it (main.ts)
  server: { watch: { ignored: ['**/.cache/**', '**/docs/**', '**/tmp/**', '**/assets/**'] } },
});
