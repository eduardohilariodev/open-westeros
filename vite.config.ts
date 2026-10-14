import { writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const FILE = 'src/place-edits.ts';
const HEADER = `// Hand-placed names, written by the globe's "Edit names" mode (npm run dev). Applied on top of world-data.ts, so they survive \`npm run places\`.
// p = [lat, lon], rot = degrees counter-clockwise (water names), s = size multiplier.
export type PlaceEdit = { p?: [number, number]; rot?: number; s?: number };
`;
const pair = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n));

// Dev only: the globe's edit mode POSTs its edits here and they are written into src/place-edits.ts.
export default defineConfig({
  // The file is rewritten on every edit; ignoring it keeps the page (camera, selection) from hot-reloading under you.
  server: { watch: { ignored: [`**/${FILE}`] } },
  plugins: [{
    name: 'place-edits',
    configureServer(server) {
      server.middlewares.use('/__place-edits', (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const rows = Object.entries(JSON.parse(body) as Record<string, { p?: unknown; rot?: unknown; s?: unknown }>).flatMap(([name, e]) => {
              const out: Record<string, unknown> = {};
              if (pair(e.p)) out.p = e.p;
              if (typeof e.rot === 'number' && Number.isFinite(e.rot)) out.rot = e.rot;
              if (typeof e.s === 'number' && Number.isFinite(e.s)) out.s = e.s;
              return Object.keys(out).length ? [`  ${JSON.stringify(name)}: ${JSON.stringify(out)},`] : [];
            });
            writeFileSync(FILE, `${HEADER}export const PLACE_EDITS: Record<string, PlaceEdit> = {\n${rows.join('\n')}\n};\n`);
            res.statusCode = 204;
          } catch (err) {
            res.statusCode = 400;
            console.error(err);
          }
          res.end();
        });
      });
    },
  }],
});
