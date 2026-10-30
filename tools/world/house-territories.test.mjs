import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const t = JSON.parse(readFileSync('src/house-territories.json', 'utf8'));
const houses = JSON.parse(readFileSync('src/houses.json', 'utf8'));
const src = readFileSync('src/world-data.ts', 'utf8');
const PLACES = eval(src.slice(src.indexOf('= [[') + 2).replace(/\]\];[\s\S]*/, ']]'));
const at = Object.fromEntries(PLACES.map(([n, , lat, lon]) => [n, [lat, lon]]));

const inside = (rings, lon, lat) => {
  let odd = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
};

test('a seat lies in its own territory (within two cells of its edge)', () => {
  const bad = [];
  for (const h of houses) {
    const rings = t.houses[h.id];
    if (!rings || !at[h.seat]) continue;
    const [lat, lon] = at[h.seat];
    // smoothing rounds corners by up to a cell, so a seat on the very edge may test just outside
    const near = [[0, 0], [t.cell, 0], [-t.cell, 0], [0, t.cell], [0, -t.cell], [2 * t.cell, 0], [-2 * t.cell, 0], [0, 2 * t.cell], [0, -2 * t.cell]].some(([dx, dy]) => inside(rings, lon + dx, lat + dy));
    if (!near) bad.push(h.id);
  }
  assert.deepEqual(bad, []);
});

test('borders join two different houses that both have a territory', () => {
  assert.ok(t.borders.length > 100);
  for (const [a, b, pts] of t.borders) {
    assert.notEqual(a, b);
    assert.ok(t.houses[a] && t.houses[b], `${a}|${b}`);
    assert.ok(pts.length >= 2);
  }
});

test('a house with a shared seat draws no territory of its own', () => {
  for (const h of houses) if (h.seatOf) assert.equal(t.houses[h.id], undefined, h.id);
});

test('no border stretch is drawn twice', () => {
  const seen = new Set();
  let dupes = 0;
  for (const [, , pts] of t.borders) for (let i = 1; i < pts.length; i++) {
    const k = [pts[i - 1], pts[i]].map((p) => p.join(',')).sort().join(' ');
    if (seen.has(k)) dupes++; seen.add(k);
  }
  assert.equal(dupes, 0);
});

test('no house holds the Gift (fifty leagues south of the Wall, ASOS Bran)', async () => {
  const { wallLine } = await import('../../src/globe/wallLine.ts');
  const { METRES_PER_DEGREE, MILE } = await import('../../src/config.ts');
  const wall = wallLine(), bad = new Set();
  const north = JSON.parse(readFileSync('src/vector-world.json', 'utf8')).regions.find((r) => r.name === 'The North').polygons;
  // houses seated on the North's mainland (Skagos, across the Bay of Seals, is off every region and no Gift)
  const mainland = Object.entries(t.houses).filter(([id]) => inside(north, ...t.seats[id]));
  for (const [id, rings] of mainland) for (const ring of rings) for (const [lon, lat] of ring) {
    const k = Math.cos((lat * Math.PI) / 180);
    let d = Infinity;
    for (let i = 1; i < wall.length; i++) {
      const [ax, ay] = wall[i - 1], [bx, by] = wall[i], ux = (bx - ax) * k, uy = by - ay, px = (lon - ax) * k, py = lat - ay;
      const s = Math.max(0, Math.min(1, (px * ux + py * uy) / (ux * ux + uy * uy)));
      d = Math.min(d, Math.hypot(px - s * ux, py - s * uy));
    }
    if ((d * METRES_PER_DEGREE) / MILE < 145) bad.add(id); // 150 miles, less smoothing slack
  }
  assert.deepEqual([...bad], []);
});
