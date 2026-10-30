// Builds src/characters.json (generated, never hand-edited) from the adapted qm paths and tools/characters/characters.json.
// Each character is a timeline of steps in reading order: a 'stay' at a place, a 'travel' along points, or a 'death' / 'lost' marker.
// usage: node tools/characters/build.mjs   (after qm-extract.mjs and qm-map.mjs)
import fs from 'node:fs';
import { PLACES } from '../../src/world-data.ts';
import { miles } from './qm-map.mjs';

const qm = JSON.parse(fs.readFileSync('docs/sources/quartermaester/qm-paths.json', 'utf8'));
const mapped = JSON.parse(fs.readFileSync('docs/sources/quartermaester/qm-mapped.json', 'utf8'));
const meta = JSON.parse(fs.readFileSync('tools/characters/characters.json', 'utf8')).characters;

const round = (n) => Math.round(n * 1e4) / 1e4;
const human = (key) => decodeURIComponent(key).replace(/_/g, ' ').replace(/\s*\(.*\)$/, '');
const last = qm.chapters.length - 1;
const clamp = (n) => Math.min(last, n);
const range = (c) => (Array.isArray(c) ? [clamp(c[0]), clamp(c[1] ?? c[0])] : [clamp(c), clamp(c)]);
// a spot with no name (a bend in the road): "near" the closest place that is a point on the map
const POINT = new Set(['city', 'town', 'castle', 'ruin', 'landmark', 'minor', 'village', 'port', 'holdfast']);
const near = (ll) => {
  const best = PLACES.filter((p) => POINT.has(p[1])).map((p) => ({ n: p[0], m: miles(ll, [p[3], p[2]]) })).sort((a, b) => a.m - b.m)[0];
  return `near ${best.n}`;
};
const label = (p) => p.name ?? (p.key ? human(p.key) : near(p.ll));

const characters = [];
for (const [id, m] of Object.entries(meta)) {
  const segs = mapped.characters[id];
  if (!segs) throw new Error(`no qm path for ${id}`);
  const steps = [];
  for (const s of segs) {
    if (s.kind === 'arrow' || s.chapters === undefined) continue;
    const pts = s.pts.filter((p) => p.ll);
    if (!pts.length) continue;
    const step = { chapters: range(s.chapters), pts: pts.map((p) => [round(p.ll[0]), round(p.ll[1])]) };
    if (s.kind === 'line') {
      Object.assign(step, { kind: 'travel', from: label(pts[0]), to: label(pts.at(-1)) });
      if (pts.length < 2) continue;
    } else {
      step.kind = s.icon === 'skull' ? 'death' : s.icon === 'lost' ? 'lost' : 'stay';
      step.at = label(pts[0]);
    }
    steps.push(step);
  }
  characters.push({ id, name: m.name, wiki: m.wiki, house: m.house, color: mapped.characters[id].find((s) => s.color)?.color ?? '#808080', steps });
}

const out = { characters }; // the chapters they count by are in src/chapters.json (tools/books/chapters.mjs)
fs.writeFileSync('src/characters.json', JSON.stringify(out));
const n = characters.reduce((s, c) => s + c.steps.length, 0);
console.log(`src/characters.json: ${characters.length} characters, ${n} steps, ${(fs.statSync('src/characters.json').size / 1024).toFixed(0)} KB`);
for (const c of characters) console.log(c.id.padEnd(13), String(c.steps.length).padStart(3), 'steps', c.steps.filter((s) => s.kind === 'travel').length, 'travels');
