import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeclutter } from './declutter.ts';

test('a box overlapping a placed one is refused, a clear one is taken', () => {
  const d = createDeclutter(4, 4);
  assert.equal(d.claim([0, 0, 50, 20]), true);
  assert.equal(d.claim([40, 10, 90, 30]), false);  // overlaps
  assert.equal(d.claim([52, 0, 90, 20]), false);   // inside the 4 px padding
  assert.equal(d.claim([60, 0, 90, 20]), true);
});

test('boxes across grid cells, off screen and in chains agree with a brute-force check', () => {
  const d = createDeclutter(4, 4), placed: number[][] = [];
  const hit = (a: number[], b: number[]) => a[0] < b[2] + 4 && b[0] < a[2] + 4 && a[1] < b[3] + 4 && b[1] < a[3] + 4;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 600; i++) {
    const x = rnd() * 3000 - 800, y = rnd() * 2000 - 600, w = 5 + rnd() * (i % 7 ? 80 : 400), h = 5 + rnd() * 40, b = [x, y, x + w, y + h];
    const want = !placed.some((t) => hit(t, b)), force = i % 11 === 0;
    assert.equal(d.claim(b, force), force || want);
    if (force || want) placed.push(b);
  }
  assert.equal(d.claim([[0, 0, 10, 10], [-9000, 0, -8000, 10]]), true);
  assert.equal(d.claim([[2000, 0, 2010, 10], [-8500, 0, -8400, 10]]), false); // second box meets the first chain's far box; none is kept
});
