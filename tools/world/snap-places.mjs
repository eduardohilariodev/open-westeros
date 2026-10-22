// Snaps place names onto the vector map (src/vector-world.json), writing src/place-snap.ts. Run: npm run snap
// The positions in world-data.ts come from two hand-read pictures and can be tens of km off the drawn coast:
//  - a lake goes to the middle of its polygon (matched by name to the polygon id, else the nearest one);
//  - an island that is not on land goes to the middle of the nearest small land ring (or the coast, beside a big one);
//  - any other place that stands in the sea or a lake is moved to the nearest shore, a little inland.
// Seas, oceans, regions and rivers are lettering, not spots.
import { readFileSync, writeFileSync } from 'node:fs';

const KM = (6915 * Math.PI) / 180; // km per degree on this planet
const world = JSON.parse(readFileSync('src/vector-world.json', 'utf8'));
const places = [...readFileSync('src/world-data.ts', 'utf8').matchAll(/\["((?:[^"\\]|\\.)*)","(\w+)",(-?[\d.]+),(-?[\d.]+)\]/g)].map((m) => ({ name: m[1].replace(/\\"/g, '"'), kind: m[2], lat: +m[3], lon: +m[4] }));

const mk = (ring) => {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { ring, x0, x1, y0, y1 };
};
const land = world.land.map(mk), lakes = world.lakes.map((l) => ({ id: l.id, rings: l.rings.map(mk) }));
const lakeRings = lakes.flatMap((l) => l.rings);

const inRing = (x, y, r) => {
  if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) return false;
  let c = false;
  for (let i = 0, j = r.ring.length - 1; i < r.ring.length; j = i++) {
    const [xi, yi] = r.ring[i], [xj, yj] = r.ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const odd = (x, y, rings) => rings.reduce((n, r) => n + (inRing(x, y, r) ? 1 : 0), 0) % 2 === 1;
const onLand = (x, y) => odd(x, y, land) && !odd(x, y, lakeRings);

/** Nearest point of the rings' edges: { d (km), q: [lon, lat] }. */
const nearest = (x, y, rings) => {
  const k = Math.cos((y * Math.PI) / 180);
  let best = { d: Infinity, q: null };
  for (const r of rings) {
    for (let i = 0, j = r.ring.length - 1; i < r.ring.length; j = i++) {
      const ax = (r.ring[j][0] - x) * k, ay = r.ring[j][1] - y, bx = (r.ring[i][0] - x) * k, by = r.ring[i][1] - y;
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(px, py) * KM;
      if (d < best.d) best = { d, q: [x + px / k, y + py] };
    }
  }
  return best;
};

/** Pole of inaccessibility of a polygon (rings = outer + holes, or lobes): the inside point farthest from every edge. */
const pole = (rings) => {
  const x0 = Math.min(...rings.map((r) => r.x0)), x1 = Math.max(...rings.map((r) => r.x1)), y0 = Math.min(...rings.map((r) => r.y0)), y1 = Math.max(...rings.map((r) => r.y1));
  let best = { d: -1, p: [(x0 + x1) / 2, (y0 + y1) / 2] }, [bx0, bx1, by0, by1] = [x0, x1, y0, y1];
  for (let pass = 0; pass < 3; pass++) {
    const N = 24;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = bx0 + ((bx1 - bx0) * i) / N, y = by0 + ((by1 - by0) * j) / N;
      if (!odd(x, y, rings)) continue;
      const d = nearest(x, y, rings).d;
      if (d > best.d) best = { d, p: [x, y] };
    }
    const w = (bx1 - bx0) / 6, h = (by1 - by0) / 6;
    [bx0, bx1, by0, by1] = [best.p[0] - w, best.p[0] + w, best.p[1] - h, best.p[1] + h];
  }
  return best.p;
};

/** From a shore point q seen from p (in the water), a few km on into the land. */
const inland = (p, q, km = 3) => {
  const k = Math.cos((p[1] * Math.PI) / 180);
  let dx = (q[0] - p[0]) * k, dy = q[1] - p[1];
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  for (const s of [km, km * 2, km * 4, 0]) {
    const c = [q[0] + (dx * s) / KM / k, q[1] + (dy * s) / KM];
    if (onLand(...c)) return c;
  }
  return q;
};

const slug = (n) => n.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').replace(/^the-/, '');
const LETTERING = new Set(['sea', 'ocean', 'region', 'continent', 'river', 'road']);
const MAX_KM = 250;
const snap = {}, report = { moved: 0, far: [], kept: 0 };
const claimed = new Set();
const put = (pl, p, why) => {
  const km = Math.hypot((p[0] - pl.lon) * Math.cos((pl.lat * Math.PI) / 180), p[1] - pl.lat) * KM;
  if (km < 1) { report.kept++; return; }
  if (km > MAX_KM) { report.far.push(`${pl.name} (${pl.kind}) ${Math.round(km)} km: ${why}`); return; }
  snap[pl.name] = [+p[1].toFixed(3), +p[0].toFixed(3)];
  report.moved++;
};

for (const pl of places.filter((x) => x.kind === 'lake')) {
  const byName = lakes.find((l) => l.id === slug(pl.name));
  let lake = byName;
  if (!lake) {
    const cand = lakes.filter((l) => !claimed.has(l.id)).map((l) => ({ l, d: nearest(pl.lon, pl.lat, l.rings).d })).sort((a, b) => a.d - b.d)[0];
    if (cand && cand.d < 200) lake = cand.l;
  }
  if (!lake) { report.far.push(`${pl.name} (lake): no polygon`); continue; }
  claimed.add(lake.id);
  put({ ...pl, name: pl.name }, pole(lake.rings), `lake ${lake.id}`);
}

for (const pl of places.filter((x) => !LETTERING.has(x.kind) && x.kind !== 'lake')) {
  if (onLand(pl.lon, pl.lat)) { report.kept++; continue; }
  const p = [pl.lon, pl.lat];
  if (pl.kind === 'island') {
    const near = land.map((r) => ({ r, ...nearest(pl.lon, pl.lat, [r]) })).sort((a, b) => a.d - b.d)[0];
    if (near.r.x1 - near.r.x0 < 6 && near.r.y1 - near.r.y0 < 6) { put(pl, pole([near.r]), 'island ring'); continue; }
  }
  const s = nearest(pl.lon, pl.lat, [...land, ...lakeRings]);
  put(pl, inland(p, s.q), 'shore');
}

writeFileSync('src/place-snap.ts', `// Generated by tools/world/snap-places.mjs (npm run snap): names moved onto the drawn map. 
export const PLACE_SNAP: Record<string, [number, number]> = {
${Object.entries(snap).map(([n, p]) => `  ${JSON.stringify(n)}: ${JSON.stringify(p)},`).join('\n')}
};
`);
console.log(`moved ${report.moved}, already right ${report.kept}, left (too far or unmatched) ${report.far.length}`);
report.far.forEach((l) => console.log('  ' + l));
