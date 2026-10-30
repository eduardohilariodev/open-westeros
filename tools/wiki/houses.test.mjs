import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERIODS } from './houses.mjs';

const houses = JSON.parse(readFileSync('src/houses.json', 'utf8'));
const by = Object.fromEntries(houses.map((h) => [h.id, h]));

test('every liege is a house in the set, and no house is its own liege', () => {
  for (const h of houses) for (const p of PERIODS) {
    const l = h.liege[p];
    if (l) { assert.ok(by[l], `${h.id} ${p}: ${l}`); assert.notEqual(l, h.id); }
  }
});

test('the liege chains follow the wiki per period', () => {
  assert.equal(by.mallister.liege.agot, 'tully');
  assert.equal(by.tully.liege.acok, 'stark');
  assert.equal(by.tully.liege.adwd, 'baelish');
  assert.equal(by.stark.liege.acok, null); // wiki silent: not guessed
});

test('a shared seat has one primary; the rest point at it', () => {
  assert.equal(by.whent.seatOf, undefined);
  assert.equal(by.baelish.seatOf, 'whent');
  assert.equal(by['bolton-of-winterfell'].seatOf, 'stark');
  for (const h of houses) if (h.seatOf) assert.equal(by[h.seatOf].seat, h.seat);
});

test('no cycles in any period', () => {
  for (const p of PERIODS) for (const h of houses) {
    const seen = new Set();
    for (let x = h; x; x = by[x.liege[p]]) { assert.ok(!seen.has(x.id), `${p}: cycle at ${x.id}`); seen.add(x.id); }
  }
});
