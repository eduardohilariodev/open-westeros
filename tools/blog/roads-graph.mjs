// The road network of src/roads.json as a graph, for the checks: great-circle miles, a place's spot, the nearest road node to a
// place, and the shortest road path between two nodes. Shared by roads-check.mjs and tools/books/travel-check.mjs.
import { readFileSync } from 'node:fs';
import { PLANET, MILE } from '../../src/config.ts';
import { PLACES } from '../../src/world-data.ts';

export const { roads, minor = [], named } = JSON.parse(readFileSync('src/roads.json', 'utf8'));
const id = (p) => p.join(',');
export const adj = new Map();
const link = (a, b, w) => { (adj.get(a) ?? adj.set(a, []).get(a)).push([b, w]); };
for (const r of roads) { const a = id(r.pts[0]), b = id(r.pts.at(-1)); link(a, b, r.miles); link(b, a, r.miles); }

const rad = (d) => (d * Math.PI) / 180;
/** Great-circle miles between [lon, lat] points. */
export const gc = ([lo1, la1], [lo2, la2]) => PLANET.radius / MILE * 2 * Math.asin(Math.sqrt(Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2));
/** A place's [lon, lat]. */
/** A place's [lon, lat]; a lore-roads waypoint read off a map (`@lat,lon`) is its own spot. */
export const place = (n) => { if (n.startsWith('@')) { const [lat, lon] = n.slice(1).split(',').map(Number); return [lon, lat]; } const p = PLACES.find((q) => q[0] === n && q[1] !== 'road'); if (!p) throw new Error('no place ' + n); return [p[3], p[2]]; };
/** The road node nearest a place: [node id, miles]. */
export const snap = (n) => {
  const at = place(n); let best = [null, Infinity];
  for (const k of adj.keys()) { const d = gc(at, k.split(',').map(Number)); if (d < best[1]) best = [k, d]; }
  return best;
};
/** Shortest road miles between two node ids (undefined when not connected). */
export const dijkstra = (from, to) => {
  const dist = new Map([[from, 0]]), todo = new Set([from]);
  while (todo.size) {
    let u = null; for (const k of todo) if (u === null || dist.get(k) < dist.get(u)) u = k;
    todo.delete(u); if (u === to) break;
    for (const [v, w] of adj.get(u)) if (dist.get(u) + w < (dist.get(v) ?? Infinity)) { dist.set(v, dist.get(u) + w); todo.add(v); }
  }
  return dist.get(to);
};
/** Miles from a [lon, lat] point to the nearest line of `lines` ({ pts }[]). */
export const toLines = (p, lines) => {
  let best = Infinity; const k = Math.cos(rad(p[1]));
  for (const { pts } of lines) for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]], dx = (b[0] - a[0]) * k, dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * k * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    best = Math.min(best, gc(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
  }
  return best;
};
