// Measures whether each place sits where the primary text puts it (tools/books/place-checks.json): at a river mouth, on a
// confluence, on a coast or lake shore, on a river, or so many miles from another place. One line per check: the measured
// miles, the allowed miles, OK or OFF. Geometry is src/vector-world.json (globe lon/lat). A river's line is the polyline
// nearest its place spot, as the globe letters its name (LINES in src/globe/GlobeView.ts).
// Usage: node tools/books/place-checks.mjs [place ...]   (no names = every check)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gc, place } from '../blog/roads-graph.mjs';

export const W = JSON.parse(readFileSync('src/vector-world.json', 'utf8'));
const checks = JSON.parse(readFileSync('tools/books/place-checks.json', 'utf8'));
const rad = (d) => (d * Math.PI) / 180;

/** Nearest point on a polyline: [miles, [lon, lat]]. */
export const nearest = (p, pts) => {
  let best = [Infinity, null]; const k = Math.cos(rad(p[1]));
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]], dx = (b[0] - a[0]) * k, dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * k * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d = gc(p, q);
    if (d < best[0]) best = [d, q];
  }
  return best;
};
export const nearestOf = (p, rings) => rings.reduce((b, r) => { const n = nearest(p, [...r, r[0]]); return n[0] < b[0] ? n : b; }, [Infinity, null]);
/** The polyline of a river by its name on the map: the one nearest the river's place spot. */
export const riverLine = (name) => {
  const at = place(name); let best = [Infinity, null];
  W.rivers.forEach((r, i) => { const d = nearest(at, r)[0]; if (d < best[0]) best = [d, i]; });
  return { id: best[1], pts: W.rivers[best[1]], spotMiles: best[0] };
};

export const measure = (c) => {
  const p = place(c.place);
  switch (c.rel) {
    case 'river-mouth': { const r = riverLine(c.river).pts; return Math.min(gc(p, r[0]), gc(p, r.at(-1))); }
    case 'on-river': return nearest(p, riverLine(c.river).pts)[0];
    case 'confluence': return Math.max(...c.rivers.map((n) => nearest(p, riverLine(n).pts)[0]));
    case 'coast': return nearestOf(p, W.land)[0];
    case 'lake-shore': { const l = W.lakes.find((x) => x.id === c.lake); if (!l) throw new Error('no lake ' + c.lake); return nearestOf(p, l.rings)[0]; }
    case 'distance': return gc(p, place(c.to));
    default: throw new Error('unknown rel ' + c.rel);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv.slice(2);
  for (const c of checks.filter((x) => !only.length || only.includes(x.place))) {
    let m; try { m = measure(c); } catch (e) { console.log(`${c.place}: ${e.message}`); continue; }
    const tag = c.rel === 'distance' ? c.to : c.river ?? c.rivers?.join(' + ') ?? c.lake ?? '';
    console.log(`${m <= c.max && m >= (c.min ?? 0) ? 'OK ' : 'OFF'} ${c.place.padEnd(18)} ${c.rel.padEnd(12)} ${tag.padEnd(30)} ${m.toFixed(1).padStart(6)} mi (${c.min ? `min ${c.min}, ` : ''}max ${c.max})  ${c.cite}`);
  }
}
