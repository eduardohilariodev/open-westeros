import test from 'node:test';
import assert from 'node:assert/strict';
import { chevrons, densify, dist, makeRoute, pointAt, segmentsUpTo, type Pt } from './pathMath.ts';

// two legs on the equator, one degree (~120 km) each, with a gap between them
const route = makeRoute([[[0, 0], [1, 0]], [[3, 0], [4, 0]]]);
const deg = dist([0, 0], [1, 0]);

test('route length is the sum of its legs, the gap counts for nothing', () => {
  assert.ok(Math.abs(route.total - 2 * deg) < 1e-6);
  assert.equal(route.start[1], deg);
});

test('pointAt walks along a leg and jumps the gap', () => {
  const mid = pointAt(route, deg / 2);
  assert.ok(Math.abs(mid.p[0] - 0.5) < 1e-9 && mid.dir[0] > 0.999);
  const later = pointAt(route, deg * 1.5);
  assert.ok(Math.abs(later.p[0] - 3.5) < 1e-9);
  assert.deepEqual(pointAt(route, -5).p, [0, 0]);
  assert.deepEqual(pointAt(route, 1e12).p, [4, 0]);
});

test('segmentsUpTo counts whole segments leg by leg', () => {
  const r = makeRoute([densify([[0, 0], [1, 0]], 0.25), densify([[3, 0], [4, 0]], 0.25)]); // 4 + 4 segments
  assert.equal(segmentsUpTo(r, 0), 0);
  assert.equal(segmentsUpTo(r, deg * 0.5), 2);
  assert.equal(segmentsUpTo(r, deg * 0.5 + 1), 2);
  assert.equal(segmentsUpTo(r, deg), 4);
  assert.equal(segmentsUpTo(r, deg * 1.25), 5);
  assert.equal(segmentsUpTo(r, 1e12), 8);
});

test('chevrons sit on the line and point forward', () => {
  const { rings, at } = chevrons(route, deg / 2, 10_000);
  assert.equal(rings.length, at.length);
  assert.equal(rings.length, 3);
  assert.deepEqual(chevrons(route, deg, 10_000).at, at.filter((_, i) => i % 2 === 1), 'doubling the spacing keeps every other arrow in place');
  for (const [w1, tip, w2] of rings as [Pt, Pt, Pt][]) {
    assert.equal(tip[1], 0);
    assert.ok(w1[0] < tip[0] && w2[0] < tip[0], 'wings trail behind the tip');
    assert.ok(w1[1] * w2[1] < 0 && Math.abs(w1[1] + w2[1]) < 1e-9, 'one wing each side, mirrored');
  }
  assert.ok(at.every((s, i) => !i || s > at[i - 1]));
});

test('densify keeps the ends and never leaves a gap over the step', () => {
  const d = densify([[0, 0], [1, 1]], 0.3);
  assert.deepEqual(d[0], [0, 0]);
  assert.deepEqual(d.at(-1), [1, 1]);
  for (let i = 1; i < d.length; i++) assert.ok(Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]) <= 0.3 + 1e-9);
});
