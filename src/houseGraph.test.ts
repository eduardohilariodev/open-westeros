import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGraph, tierOf, type House } from './houseGraph.ts';

const houses: House[] = JSON.parse(readFileSync('src/houses.json', 'utf8'));

test('a lord lights its vassals and theirs, nested', () => {
  const g = buildGraph(houses, (h) => h.liege.agot);
  const north = g.subtree('stark');
  assert.equal(north.get('stark'), 0);
  assert.equal(north.get('karstark'), 1);
  assert.ok(north.size > 8, `${north.size}`);
  assert.equal(g.subtree('karstark').size, 1); // a house nobody swears to has only itself
});

test('the vassal side: a house knows who it is sworn to, and its sworn houses', () => {
  const g = buildGraph(houses, (h) => h.liege.agot);
  assert.equal(g.liegeOf('mallister')?.id, 'tully');
  assert.ok(g.vassals('tully').some((h) => h.id === 'mallister'));
  assert.ok(g.subtree('tully').has('mallister'));
});

test('the realm of a house is the great lord below the crown', () => {
  const g = buildGraph(houses, (h) => h.liege.agot);
  assert.equal(g.realm('mallister'), 'tully');
  assert.equal(g.realm('tully'), 'tully');
  assert.equal(g.realm('baratheon-of-king-s-landing'), 'baratheon-of-king-s-landing');
});

test('the graph follows the period', () => {
  assert.equal(buildGraph(houses, (h) => h.liege.agot).liegeOf('tully')?.id, 'baratheon-of-king-s-landing');
  assert.equal(buildGraph(houses, (h) => h.liege.acok).liegeOf('tully')?.id, 'stark');
  assert.equal(buildGraph(houses, (h) => h.liege.adwd).liegeOf('tully')?.id, 'baelish');
});

test('tiers: a great house is bigger than a leaf', () => {
  const g = buildGraph(houses, (h) => h.liege.agot);
  assert.ok(tierOf(g, 'stark') < tierOf(g, 'karstark'));
});
