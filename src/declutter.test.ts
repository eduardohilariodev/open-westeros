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
