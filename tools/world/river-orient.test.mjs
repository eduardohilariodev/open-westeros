import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSinks, orientLine } from './river-orient.mjs';

// a square island, 1 degree wide (~120 km): the sea is its outline, a lake sits in the middle
const edge = (a, b) => Array.from({ length: 51 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 50, a[1] + ((b[1] - a[1]) * i) / 50]); // coast points every 0.02 degrees, as in the real rings
const land = [[...edge([0, 0], [1, 0]), ...edge([1, 0], [1, 1]), ...edge([1, 1], [0, 1]), ...edge([0, 1], [0, 0])]];
const lakes = [{ rings: [[[0.5, 0.5], [0.52, 0.5], [0.52, 0.52], [0.5, 0.52]]] }];
const main = [[0.0, 0.5], [0.2, 0.5], [0.4, 0.5], [0.6, 0.5], [0.8, 0.5]]; // stored mouth first: starts at the west coast
const trib = [[0.3, 0.5], [0.3, 0.6], [0.3, 0.7], [0.3, 0.8]];            // stored mouth first: starts on `main`
const world = { land, lakes, rivers: [main, trib] };
const sinks = makeSinks(world);

test('the end on the sea is the mouth, so the line is reversed to run source to mouth', () => {
  const { line, why } = orientLine(world, 0, sinks);
  assert.deepEqual(line[0], [0.8, 0.5]); assert.deepEqual(line.at(-1), [0.0, 0.5]); assert.equal(why, 'first');
});
test('a tributary ends on the longer river', () => {
  const { line } = orientLine(world, 1, sinks);
  assert.deepEqual(line[0], [0.3, 0.8]); assert.deepEqual(line.at(-1), [0.3, 0.5]);
});
test('a line stored source first (last end on the sea) is kept', () => {
  const w = { land, lakes, rivers: [main.slice().reverse()] }, { line, why } = orientLine(w, 0, makeSinks(w));
  assert.deepEqual(line[0], [0.8, 0.5]); assert.equal(why, 'last');
});
