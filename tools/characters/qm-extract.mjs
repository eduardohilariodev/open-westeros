// Downloads quartermaester.info's character path data and writes docs/sources/quartermaester/qm-paths.json.
// A source-map claim only (CLAUDE.md): it gives stop order and chapter ranges, never a canon position.
// usage: node tools/characters/qm-extract.mjs [--offline]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const BASE = 'https://quartermaester.info/';
const DIR = 'docs/sources/quartermaester';
const FILES = ['ASoIaF-overlays.js', 'ASoIaF-events.js'];

fs.mkdirSync(DIR, { recursive: true });
if (!process.argv.includes('--offline')) {
  for (const f of FILES) {
    const res = await fetch(BASE + f);
    if (!res.ok) throw new Error(`${f}: ${res.status}`);
    fs.writeFileSync(path.join(DIR, f), await res.text());
  }
}
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split(/\r?\n/);

const overlays = read('ASoIaF-overlays.js');
const locStart = overlays.findIndex((l) => /^\s*locations\s*=\s*\{/.test(l));
let locEnd = locStart + 1;
while (!/^\s*\};?\s*$/.test(overlays[locEnd])) locEnd++;
const pathStart = overlays.findIndex((l) => /^\s*paths\s*=\s*\{\}/.test(l));
const chapStart = overlays.findIndex((l) => /^\s*chapters\s*=\s*\[/.test(l));
let chapEnd = chapStart + 1;
while (!/^\s*\];?\s*$/.test(overlays[chapEnd])) chapEnd++;

const ctx = {};
vm.createContext(ctx);
vm.runInContext(overlays.slice(locStart, locEnd + 1).join('\n'), ctx);
vm.runInContext(overlays.slice(chapStart, chapEnd + 1).join('\n'), ctx);
vm.runInContext(overlays.slice(pathStart).join('\n'), ctx);

// "AGOT-12: Eddard II" -> { book: 'AGOT', pov: 'Eddard', n: 'II', title }
const chapters = ctx.chapters.map((c, i) => {
  const m = /^(\w+)-(\d+): (.*)$/.exec(c.title);
  return { index: i, title: c.title, book: m?.[1], pov: m?.[3], url: c.url };
});

const locations = {};
for (const [k, v] of Object.entries(ctx.locations)) locations[k] = { lat: v.lat, lng: v.lng, title: v.title };

const characters = {};
for (const [name, segs] of Object.entries(ctx.paths)) {
  characters[name] = segs.map((s) => {
    const kind = s.line ? 'line' : s.arrow ? 'arrow' : 'marker';
    const o = { kind, chapters: s.chapters, episodes: s.episodes };
    if (kind === 'line') Object.assign(o, { color: s.line, path: s.path });
    else if (kind === 'arrow') Object.assign(o, { coord: s.coord, heading: s.heading });
    else Object.assign(o, { icon: s.icon, key: s.key, coord: s.coord });
    return o;
  });
}

fs.writeFileSync(path.join(DIR, 'qm-paths.json'), JSON.stringify({ chapters, locations, characters }, null, 1));
console.log(`characters ${Object.keys(characters).length}, locations ${Object.keys(locations).length}, chapters ${chapters.length}`);
