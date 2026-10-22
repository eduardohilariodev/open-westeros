// Checks src/roads.json against the road distances the blog states (docs/atlas-blog/_roads.md): shortest road path between
// two places, snapped to the nearest road junction/end, vs. the quoted miles. Usage: node tools/blog/roads-check.mjs
import { readFileSync } from 'node:fs';
import { PLANET, MILE } from '../../src/config.ts';
import { PLACES } from '../../src/world-data.ts';

const { roads } = JSON.parse(readFileSync('src/roads.json', 'utf8'));
const id = (p) => p.join(',');
const adj = new Map();
const link = (a, b, w) => { (adj.get(a) ?? adj.set(a, []).get(a)).push([b, w]); };
for (const r of roads) { const a = id(r.pts[0]), b = id(r.pts.at(-1)); link(a, b, r.miles); link(b, a, r.miles); }

const rad = (d) => (d * Math.PI) / 180;
const gc = ([lo1, la1], [lo2, la2]) => PLANET.radius / MILE * 2 * Math.asin(Math.sqrt(Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2));
const place = (n) => { const p = PLACES.find((q) => q[0] === n); if (!p) throw new Error('no place ' + n); return [p[3], p[2]]; };
const snap = (n) => { // nearest road node to a place
  const at = place(n); let best = [null, Infinity];
  for (const k of adj.keys()) { const d = gc(at, k.split(',').map(Number)); if (d < best[1]) best = [k, d]; }
  return best;
};
const dijkstra = (from, to) => {
  const dist = new Map([[from, 0]]), todo = new Set([from]);
  while (todo.size) {
    let u = null; for (const k of todo) if (u === null || dist.get(k) < dist.get(u)) u = k;
    todo.delete(u); if (u === to) break;
    for (const [v, w] of adj.get(u)) if (dist.get(u) + w < (dist.get(v) ?? Infinity)) { dist.set(v, dist.get(u) + w); todo.add(v); }
  }
  return dist.get(to);
};

// [from, to, miles the blog quotes]
const CHECKS = [
  ["King's Landing", 'Winterfell', 1500], ["King's Landing", 'Lannisport', 800], ["King's Landing", "Storm's End", 400],
  ['Castle Black', "Storm's End", 2600], ['Volantis', 'Mantarys', 600], ['Mantarys', 'Bhorash', 450], ['Asabhad', 'Qarth', 500],
];
for (const [a, b, miles] of CHECKS) {
  const [na, da] = snap(a), [nb, db] = snap(b), d = dijkstra(na, nb);
  console.log(`${a} -> ${b}: ${d === undefined ? 'not connected' : Math.round(d) + ' mi'} (blog ${miles}); snapped ${Math.round(da)} / ${Math.round(db)} mi from the places`);
}
