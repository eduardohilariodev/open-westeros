// Converts the Known World SVG maps (Abjiklam, CC BY-NC-SA 4.0) into src/vector-world.json: land, lakes, rivers and the
// Westeros regions as lat/lon rings and lines. The SVGs are plate carree at 88 px/degree: lon = (x - 2640) / 88,
// lat = (6500 - y) / 88 (their viewBox is 10000 x 6667 for lon -30..83.64, lat 73.86..-1.90).
// Usage: node tools/world/svg-vector.mjs <maps-dir>
import { readFileSync, writeFileSync } from 'node:fs';

const dir = process.argv[2] ?? 'assets/world/svg';
const PX_PER_DEG = 88, X0 = 2640, Y0 = 6500;
const toLL = ([x, y]) => [+((x - X0) / PX_PER_DEG).toFixed(3), +((Y0 - y) / PX_PER_DEG).toFixed(3)];

// path data -> subpaths (arrays of [x, y]); only the commands these files use: M m L l H h V v C c (c rare: ends of grids) Z z
function subpaths(d) {
  const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0;
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === 'Z') { if (cur) out.push(cur); cur = null; x = sx; y = sy; continue; }
    if (C === 'M') { if (cur) out.push(cur); const a = num(), b = num(); x = rel ? x + a : a; y = rel ? y + b : b; sx = x; sy = y; cur = [[x, y]]; cmd = rel ? 'l' : 'L'; continue; }
    if (C === 'L') { const a = num(), b = num(); x = rel ? x + a : a; y = rel ? y + b : b; }
    else if (C === 'H') { const a = num(); x = rel ? x + a : a; }
    else if (C === 'V') { const a = num(); y = rel ? y + a : a; }
    else if (C === 'C') { const n = [num(), num(), num(), num(), num(), num()]; x = rel ? x + n[4] : n[4]; y = rel ? y + n[5] : n[5]; }
    else throw new Error('unsupported path command ' + cmd);
    (cur ??= [[sx, sy]]).push([x, y]);
  }
  if (cur) out.push(cur);
  return out;
}

// walk the markup keeping the stack of enclosing group ids; collect every path with its ancestors
function paths(file) {
  const svg = readFileSync(`${dir}/${file}`, 'utf8').replace(/<metadata[\s\S]*?<\/metadata>/g, '').replace(/<defs[\s\S]*?<\/defs>/g, '');
  const stack = [], res = [];
  for (const m of svg.matchAll(/<(\/?)(g|path)\b([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, self] = m, id = attrs.match(/\bid="([^"]+)"/)?.[1];
    if (tag === 'g') { close ? stack.pop() : stack.push(id ?? ''); if (!close && self) stack.pop(); }
    else if (!close) {
      const d = attrs.match(/\sd="([^"]+)"/)?.[1]; if (d) res.push({ id, anc: [...stack], rings: subpaths(d) });
    }
  }
  return res;
}

const world = paths('Location_map_Known_world.svg');
const rings = (ps) => ps.flatMap((p) => p.rings.filter((r) => r.length > 2).map((r) => r.map(toLL)));
const land = world.filter((p) => p.anc.includes('land'));
const lakes = world.filter((p) => p.anc.includes('lakes'));
const rivers = world.filter((p) => p.anc.includes('rivers'));

// regions come from a Westeros locator map, which groups every island under its realm
const REGIONS = { north: 'The North', riverlands: 'The Riverlands', vale: 'The Vale', westerlands: 'The Westerlands', reach: 'The Reach', crownlands: 'The Crownlands', stormlands: 'The Stormlands', dorne: 'Dorne', 'iron-islands': 'The Iron Islands' };
const westeros = paths('Locator_map_Dorne_in_Westeros.svg');
const regions = Object.entries(REGIONS).map(([id, name]) => ({ id, name, polygons: rings(westeros.filter((p) => p.anc.includes(id) && p.anc.includes('seven-kingdoms'))) }));
const wall = westeros.find((p) => p.id === 'beyond-the-wall');
regions.push({ id: 'beyond-the-wall', name: 'Beyond the Wall', polygons: rings([wall]) });

const out = {
  land: rings(land),
  lakes: lakes.map((p) => ({ id: p.id, rings: rings([p]) })),
  rivers: rivers.flatMap((p) => p.rings.filter((r) => r.length > 1).map((r) => r.map(toLL))),
  regions,
};
writeFileSync('src/vector-world.json', JSON.stringify(out));
const pts = (a) => a.reduce((n, r) => n + r.length, 0);
console.log(`land ${out.land.length} rings / ${pts(out.land)} pts; lakes ${out.lakes.length}; rivers ${out.rivers.length} / ${pts(out.rivers)} pts`);
for (const r of regions) console.log(`  ${r.id.padEnd(16)} ${r.polygons.length} rings ${pts(r.polygons)} pts`);
