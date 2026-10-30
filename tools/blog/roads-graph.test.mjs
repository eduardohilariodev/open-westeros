import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gc, place, snap, dijkstra, named, roads, minor, toLines } from './roads-graph.mjs';

const json = (f) => JSON.parse(readFileSync(f, 'utf8'));

test('a degree of latitude is about 75 miles', () => {
  const d = gc([0, 40], [0, 41]);
  assert.ok(d > 70 && d < 80, String(d));
});

test('road distance between two places is connected and not shorter than the straight line', () => {
  const [a, b] = ["King's Landing", 'Winterfell'];
  const d = dijkstra(snap(a)[0], snap(b)[0]);
  assert.ok(Number.isFinite(d), 'not connected');
  assert.ok(d >= gc(place(a), place(b)) * 0.95, `${d} mi by road`);
  assert.equal(dijkstra(snap(a)[0], snap(a)[0]), 0);
});

test('every place a claim file names exists on the map', () => {
  const missing = [];
  const need = (n, where) => { try { place(n); } catch { missing.push(`${n} (${where})`); } };
  for (const c of json('tools/books/place-checks.json')) need(c.place, 'place-checks');
  for (const r of json('tools/books/lore-roads.json')) for (const n of r.via) need(n, `road ${r.name}`);
  for (const d of json('tools/books/travel.json').distances) { need(d.from, 'travel'); need(d.to, 'travel'); }
  assert.deepEqual(missing, []);
});

// a lore road reaches each of its places (the network is within 3 miles); its named line may pass one by on a short spur
test('every lore road reaches each of its places', () => {
  const off = [];
  for (const r of json('tools/books/lore-roads.json')) {
    const line = named.find((n) => n.name === r.name);
    if (!line) { off.push(`${r.name}: not drawn`); continue; }
    for (const n of r.via) {
      const net = toLines(place(n), roads), own = toLines(place(n), [line]);
      if (net > 3 || own > 20) off.push(`${r.name}: ${n} ${net.toFixed(1)} mi off the network, ${own.toFixed(1)} off its line`);
    }
  }
  assert.deepEqual(off, []);
});

test('no road stretch crosses itself (no loops or knots)', () => {
  const cross = (a, b, c, d) => {
    const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
    if (!den) return false;
    const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    return t > 0 && t < 1 && u > 0 && u < 1;
  };
  const knots = [...roads, ...minor].filter(({ pts }) => pts.some((_, i) => i && pts.some((__, j) => j > i + 1 && cross(pts[i - 1], pts[i], pts[j - 1], pts[j]))));
  assert.equal(knots.length, 0, `${knots.length} stretches cross themselves`);
});
