// Writes the battle rows at the end of tools/world/places.raw.txt from tools/books/battles.json (see its first line for the rules).
// Usage: node tools/world/battles.mjs && npm run places
import { readFileSync, writeFileSync } from 'node:fs';
import { W, nearest, riverLine } from '../books/place-checks.mjs';

const FILE = 'tools/world/places.raw.txt', MARK = '# --- battles: tools/books/battles.json via tools/world/battles.mjs, do not edit below ---';
const world = readFileSync('src/world-data.ts', 'utf8');
const spot = (n) => {
  const m = world.match(new RegExp(`\\["${n.replace(/[.*+?^${}()|[\]\\']/g, '\\$&')}","\\w+",(-?[\\d.]+),(-?[\\d.]+)\\]`));
  if (!m) throw new Error('no place ' + n);
  return [+m[2], +m[1]]; // lon, lat
};

/** The lake's inside along a horizontal (axis 1) or vertical (axis 0) line through its middle, 0.08 deg in from the shore. */
const lakeAt = (id, side) => {
  const pts = W.lakes.find((l) => l.id === id).rings.flat();
  const lo = [0, 1].map((a) => Math.min(...pts.map((p) => p[a]))), hi = [0, 1].map((a) => Math.max(...pts.map((p) => p[a])));
  const c = [0, 1].map((a) => (lo[a] + hi[a]) / 2);
  if (side === 'centre') return c;
  const along = side === 'west' || side === 'east' ? 1 : 0, cross = [];
  for (const r of W.lakes.find((l) => l.id === id).rings) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    if ((a[along] - c[along]) * (b[along] - c[along]) < 0) cross.push(a[1 - along] + ((c[along] - a[along]) / (b[along] - a[along])) * (b[1 - along] - a[1 - along]));
  }
  cross.sort((x, y) => x - y);
  const v = side === 'west' || side === 'south' ? cross[0] + 0.08 : cross.at(-1) - 0.08;
  return along ? [v, c[1]] : [c[0], v];
};

const { battles } = JSON.parse(readFileSync('tools/books/battles.json', 'utf8'));
const rows = battles.map((b) => {
  let p;
  if (b.mid) { const [a, z] = b.mid.map(spot); p = [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2]; } else if (b.place) p = spot(b.place); else if (b.river) p = spot(b.river);
  if (b.river) p = nearest(p, riverLine(b.river).pts)[1];
  if (b.lake) p = lakeAt(b.lake, b.side);
  return { name: b.name, p };
});

// battles at one spot are fanned out on a ring about 5 mi across (0.07 deg), the first on the spot itself
const groups = new Map();
for (const r of rows) { const k = r.p.map((v) => v.toFixed(2)).join(); (groups.get(k) ?? groups.set(k, []).get(k)).push(r); }
for (const g of groups.values()) if (g.length > 1) g.forEach((r, i) => {
  if (!i) return;
  const t = (2 * Math.PI * (i - 1)) / (g.length - 1), k = Math.cos((r.p[1] * Math.PI) / 180);
  r.p = [r.p[0] + (0.07 * Math.cos(t)) / k, r.p[1] + 0.07 * Math.sin(t)];
});

const raw = readFileSync(FILE, 'utf8'), nl = raw.includes('\r\n') ? '\r\n' : '\n';
let lines = raw.split(/\r?\n/);
const cut = lines.findIndex((l) => l.startsWith('# --- battles and inns added') || l === MARK);
if (cut >= 0) lines = lines.slice(0, cut);
while (lines.at(-1) === '') lines.pop();
const have = new Set(lines.map((l) => l.split('|')[0]));
lines.push(MARK);
for (const r of rows) {
  if (have.has(r.name)) { console.log('already on the map, skipped:', r.name); continue; }
  lines.push(`${r.name}|battle|ll:${r.p[1].toFixed(3)},${r.p[0].toFixed(3)}|-`);
}
writeFileSync(FILE, lines.join(nl) + nl);
console.log(rows.length, 'battles');
