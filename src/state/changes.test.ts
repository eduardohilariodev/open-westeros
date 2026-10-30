import test from 'node:test';
import assert from 'node:assert/strict';
import { liegeAt, stateAt } from './changes.ts';
import { lastChapter, momentFromSearch, type Moment } from './time.ts';

const at = (when: string) => momentFromSearch(`?when=${when}`)!;
const before = (when: string): Moment => ({ track: 'books', at: (at(when) as { at: number }).at - 1 });

test('Winterfell: Stark, Greyjoy, burned and empty, Bolton', () => {
  assert.deepEqual(stateAt('Winterfell', at('agot')), { holder: 'stark', state: 'built', name: 'Winterfell' });
  assert.equal(stateAt('Winterfell', before('acok-bran-vi')).holder, 'stark');
  assert.equal(stateAt('Winterfell', at('acok-bran-vi')).holder, 'greyjoy');
  assert.deepEqual(stateAt('Winterfell', at('acok-bran-vii')), { holder: null, state: 'ruin', name: 'Winterfell' });
  assert.equal(stateAt('Winterfell', at('affc')).holder, null);
  assert.equal(stateAt('Winterfell', at('adwd-a-ghost-in-winterfell')).holder, 'bolton');
  assert.equal(stateAt('Winterfell', at('adwd-a-ghost-in-winterfell')).state, 'ruin');
});

test('Moat Cailin: nobody, the ironmen, the Boltons', () => {
  assert.equal(stateAt('Moat Cailin', at('agot')).holder, null);
  assert.equal(stateAt('Moat Cailin', at('acok-bran-vii')).holder, 'greyjoy');
  assert.equal(stateAt('Moat Cailin', before('adwd-reek-ii')).holder, 'greyjoy');
  assert.equal(stateAt('Moat Cailin', at('adwd-reek-ii')).holder, 'bolton');
});

test('Harrenhal: Whent, Lannister, Bolton', () => {
  assert.equal(stateAt('Harrenhal', at('agot')).holder, 'whent');
  assert.equal(stateAt('Harrenhal', at('acok-catelyn-v')).holder, 'lannister');
  assert.equal(stateAt('Harrenhal', at('acok-arya-x')).holder, 'bolton');
});

test('the Freys and the Boltons turn at the Red Wedding, not before', () => {
  assert.equal(liegeAt('frey', at('agot')), 'tully');
  assert.equal(liegeAt('frey', before('asos-catelyn-vii')), 'tully');
  assert.equal(liegeAt('frey', at('asos-catelyn-vii')), 'baratheon-of-king-s-landing');
  assert.equal(liegeAt('bolton', before('asos-catelyn-vii')), 'stark');
  assert.equal(liegeAt('bolton', at('asos-catelyn-vii')), 'baratheon-of-king-s-landing');
});

test('the north crowns Robb, the river lords swear to him', () => {
  assert.equal(liegeAt('stark', before('agot-catelyn-xi')), 'baratheon-of-king-s-landing');
  assert.equal(liegeAt('stark', at('agot-catelyn-xi')), null);
  assert.equal(liegeAt('tully', at('agot-catelyn-xi')), 'baratheon-of-king-s-landing');
  assert.equal(liegeAt('tully', at('acok')), 'stark');
});

test("a wiki period counts from the end of its book, and a blank keeps the last liege", () => {
  // the wiki's ADWD liege of House Whent is Baelish; it shows only from the last chapter of ADWD
  const end = { track: 'books', at: lastChapter('adwd') } as const;
  assert.equal(liegeAt('whent', { track: 'books', at: end.at - 1 }), 'tully');
  assert.equal(liegeAt('whent', end), 'baelish');
  assert.equal(liegeAt('karstark', at('asos')), 'stark'); // the wiki leaves ACOK and ASOS blank
});

test('the show takes only its own changes, on its own borrowed periods', () => {
  assert.equal(liegeAt('stark', at('s1e9')), 'baratheon-of-king-s-landing');
  assert.equal(liegeAt('stark', at('s1e10')), null);
  assert.equal(liegeAt('frey', at('s3e9')), 'tully'); // no show date for the Red Wedding yet: books-only changes stay off the show
  assert.equal(stateAt('Winterfell', at('s8e6')).holder, 'stark');
});

test('history sees only changes dated by year', () => {
  assert.equal(stateAt('Winterfell', { track: 'history', year: 100 }).holder, 'stark');
  assert.equal(liegeAt('stark', { track: 'history', year: 100 }), 'baratheon-of-king-s-landing');
});

test('a battle is hidden until its chapter, a pre-series one until its year', () => {
  assert.equal(stateAt('Battle of Oxcross', at('acok-sansa-ii')).state, 'gone');
  assert.equal(stateAt('Battle of Oxcross', at('acok-sansa-iii')).state, 'built');
  assert.equal(stateAt('Battle of Oxcross', { track: 'history', year: 100 }).state, 'gone');
  assert.equal(stateAt('Battle at Long Lake', { track: 'history', year: 225 }).state, 'gone');
  assert.equal(stateAt('Battle at Long Lake', { track: 'history', year: 226 }).state, 'built');
});
