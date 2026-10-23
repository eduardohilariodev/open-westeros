import test from 'node:test';
import assert from 'node:assert/strict';
import { area, crossings, deviation, refineRing, refineSet } from './coast-refine.mjs';

// a jagged island, ~40 km across, plus a long straight cut edge on one side
const jag = [[10, 50], [10.1, 50.02], [10.2, 50], [10.3, 50.03], [10.4, 50.01], [10.45, 50.2], [10.35, 50.27], [10.2, 50.24], [10.1, 50.29], [10, 50.2]];

test('refinement is deterministic and adds points', () => {
  assert.deepEqual(refineRing(jag, 2), refineRing(jag, 2));
  assert.ok(refineRing(jag, 2).length > jag.length * 3);
});

test('without noise the coast passes through every drawn vertex', () => {
  const out = refineRing(jag, 0);
  for (const v of jag) assert.ok(Math.min(...out.map((p) => Math.hypot(p[0] - v[0], p[1] - v[1]))) < 2e-4);
  assert.ok(deviation(jag, out) < 1.5);
});

test('with noise it stays within the cap, keeps its area and does not cross itself', () => {
  const { out } = refineSet([jag], 2, () => 1);
  assert.ok(deviation(jag, out[0]) <= 3.2);
  assert.ok(Math.abs(area(out[0]) / area(jag) - 1) < 0.08);
  assert.equal(crossings(out).size, 0);
});

test('noise fades out where the weight is zero', () => {
  assert.ok(deviation(jag, refineRing(jag, 2, () => 0)) < 1.5);
});
