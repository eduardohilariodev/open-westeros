// Which legs of src/characters.json cross water? Samples each travel leg (smoothed like the map draws it) against the land
// polygons of src/vector-world.json and reports the share in the sea. A leg between two stops that are both on land and is mostly
// sea is a fit error or a voyage the books describe; check it with `npm run lore -- find`.
// usage: node tools/characters/legs-check.mjs [character] [--min 0.15]
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('src/characters.json', 'utf8'));
const world = JSON.parse(fs.readFileSync('src/vector-world.json', 'utf8'));
const args = process.argv.slice(2);
const mi = args.indexOf('--min');
const min = mi >= 0 ? +args.splice(mi, 2)[1] : 0.15;
const only = args[0];

const rings = world.land.map((r) => ({ r, x0: Math.min(...r.map((p) => p[0])), x1: Math.max(...r.map((p) => p[0])), y0: Math.min(...r.map((p) => p[1])), y1: Math.max(...r.map((p) => p[1])) }));
const inRing = (r, x, y) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
};
const onLand = (x, y) => rings.reduce((n, b) => n + (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && inRing(b.r, x, y) ? 1 : 0), 0) % 2 === 1;

const chaikin = (pts, rounds = 2) => {
  for (let k = 0; k < rounds; k++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    out.push(pts.at(-1));
    pts = out;
  }
  return pts;
};
const sample = (pts, step = 0.05) => pts.flatMap((a, i) => {
  if (!i) return [a];
  const b = pts[i - 1], n = Math.max(1, Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1]) / step));
  return Array.from({ length: n }, (_, k) => [b[0] + ((a[0] - b[0]) * (k + 1)) / n, b[1] + ((a[1] - b[1]) * (k + 1)) / n]);
});

const rows = [];
for (const c of data.characters) {
  if (only && c.id !== only) continue;
  c.steps.forEach((s, i) => {
    if (s.kind !== 'travel') return;
    const pts = sample(chaikin(s.pts));
    const sea = pts.filter(([x, y]) => !onLand(x, y)).length / pts.length;
    const endsLand = onLand(...s.pts[0]) && onLand(...s.pts.at(-1));
    if (sea >= min) rows.push({ c: c.id, i, ch: s.chapters.join('-'), from: s.from, to: s.to, sea: Math.round(sea * 100), endsLand });
  });
}
rows.sort((a, b) => b.sea - a.sea);
for (const r of rows) console.log(`${r.c.padEnd(12)} step ${String(r.i).padStart(2)} ch ${r.ch.padEnd(8)} ${String(r.sea).padStart(3)}% sea  ${r.endsLand ? 'LAND->LAND ' : '           '}${r.from} -> ${r.to}`);
console.log(`${rows.length} leg(s) at least ${min * 100}% in the sea; ${rows.filter((r) => r.endsLand).length} of them join two land stops`);
