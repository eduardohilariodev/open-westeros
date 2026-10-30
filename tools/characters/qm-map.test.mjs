import test from 'node:test';
import assert from 'node:assert/strict';
import { mercY, fitQuad, robustFit, makeTransform, buildMap, mapLine, miles, candidates, fold } from './qm-map.mjs';

// a made-up map: our lon/lat are a known quadratic of qm's (lng, mercator y)
const truth = (x, y) => [0.1 * x + 3 + 0.0004 * x * y, 0.07 * y - 2 + 0.0003 * y * y];
const grid = [];
for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
  const x = -150 + i * 20;
  const y = mercY(-5 + j * 15);
  const [lon, lat] = truth(x, y);
  grid.push({ x, y, lon, lat, key: `p${i}${j}` });
}

test('fitQuad recovers a quadratic exactly', () => {
  const f = fitQuad(grid);
  const [lon, lat] = f(-110, mercY(20));
  const [tl, tt] = truth(-110, mercY(20));
  assert.ok(Math.abs(lon - tl) < 1e-6 && Math.abs(lat - tt) < 1e-6);
});

test('robustFit drops a mismatched pair and keeps the rest', () => {
  const bad = { x: -90, y: mercY(10), lon: 60, lat: 50, key: 'bad' };
  const { kept, dropped } = robustFit([...grid, bad]);
  assert.deepEqual(dropped.map((p) => p.key), ['bad']);
  assert.equal(kept.length, grid.length);
});

test('makeTransform is exact on every kept pair', () => {
  const f = fitQuad(grid);
  const wobbly = grid.map((p, i) => (i % 5 === 0 ? { ...p, lon: p.lon + 0.2, lat: p.lat - 0.1 } : p));
  const t = makeTransform(wobbly, f);
  for (const p of wobbly) {
    const q = t(p.x, (Math.atan(Math.sinh((p.y * Math.PI) / 180)) * 180) / Math.PI);
    assert.ok(miles(q, [p.lon, p.lat]) < 0.01, p.key);
  }
});

test('candidates folds accents, parentheses and a leading "the"', () => {
  const byName = new Map([['the eyrie', [['The Eyrie']]], ['oakenshield', [['Oakenshield'], ['Oakenshield']]]]);
  assert.equal(candidates('Eyrie', byName).length, 1);
  assert.equal(candidates('Oakenshield_(Wall)', byName).length, 2);
  assert.equal(fold('King%27s_Landing'), "king's landing");
});

test('a leg keeps its stops on canon even where the maps disagree', () => {
  // qm: A at (0,0), bend at (10,0), B at (20,0). Our map puts B 5 degrees north of where qm would.
  const qm = { locations: { A: { lat: 0, lng: 0 }, B: { lat: 0, lng: 20 }, C: { lat: 0, lng: 40 }, D: { lat: 10, lng: 0 }, E: { lat: 10, lng: 20 } } };
  const places = [['A', 'town', 0, 0], ['B', 'town', 5, 2], ['C', 'town', 0, 4], ['D', 'town', 1, 0], ['E', 'town', 1, 2]];
  const m = buildMap(qm, places);
  const pts = mapLine(['A', [0, 10], 'B'], qm, m);
  assert.deepEqual(pts[0].ll, [0, 0]);
  assert.deepEqual(pts[2].ll, [2, 5]);
  assert.equal(pts[1].src, 'bend');
});
