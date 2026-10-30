import test from 'node:test';
import houses from '../houses.json' with { type: 'json' };
import assert from 'node:assert/strict';
import { houseExists, liegeAt, stateAt } from './changes.ts';
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
  assert.equal(liegeAt('stark', { track: 'history', year: 100 }), 'targaryen'); // the Targaryens reign until 283 AC
});

test('a battle is hidden until its chapter, a pre-series one until its year', () => {
  assert.equal(stateAt('Battle of Oxcross', at('acok-sansa-ii')).state, 'gone');
  assert.equal(stateAt('Battle of Oxcross', at('acok-sansa-iii')).state, 'built');
  assert.equal(stateAt('Battle of Oxcross', { track: 'history', year: 100 }).state, 'gone');
  assert.equal(stateAt('Battle at Long Lake', { track: 'history', year: 225 }).state, 'gone');
  assert.equal(stateAt('Battle at Long Lake', { track: 'history', year: 226 }).state, 'built');
});

test('the Stark bannermen seats: Deepwood Motte and Riverrun change hands', () => {
  assert.equal(stateAt('Deepwood Motte', at('agot')).holder, 'glover');
  assert.equal(stateAt('Deepwood Motte', at('asos')).holder, 'greyjoy');
  assert.equal(stateAt('Deepwood Motte', at('adwd-reek-iii')).holder, 'glover');
  assert.equal(stateAt('Riverrun', at('asos')).holder, 'tully');
  assert.equal(stateAt('Riverrun', at('affc-jaime-vii')).holder, 'frey-of-riverrun');
});

test("Storm's End goes to Stannis, Brightwater Keep to the Tyrells", () => {
  assert.equal(stateAt("Storm's End", at('agot')).holder, 'baratheon');
  assert.equal(stateAt("Storm's End", before('acok-catelyn-vi')).holder, 'baratheon');
  assert.equal(stateAt("Storm's End", at('acok-catelyn-vi')).holder, 'baratheon-of-dragonstone');
  assert.equal(stateAt('Brightwater Keep', at('asos-tyrion-ii')).holder, 'florent');
  assert.equal(stateAt('Brightwater Keep', at('asos-tyrion-iii')).holder, 'tyrell-of-brightwater-keep');
});

test('Darry goes to Lancel Lannister, Harrenhal to Littlefinger', () => {
  assert.equal(stateAt('Darry', at('agot')).holder, 'darry');
  assert.equal(stateAt('Darry', before('affc-jaime-iii')).holder, 'darry');
  assert.equal(stateAt('Darry', at('affc-jaime-iii')).holder, 'lannister-of-darry');
  assert.equal(stateAt('Harrenhal', before('asos-sansa-v')).holder, 'bolton');
  assert.equal(stateAt('Harrenhal', at('asos-sansa-v')).holder, 'baelish');
});

test('the attack on Old Wyk shows from the Book of Brothers entry that tells it', () => {
  assert.equal(stateAt('Attack on Old Wyk', before('asos-jaime-viii')).state, 'gone');
  assert.equal(stateAt('Attack on Old Wyk', at('asos-jaime-viii')).state, 'built');
});

test('an occupied seat leaves its vassals sworn where they were', () => {
  assert.equal(stateAt('Deepwood Motte', at('asos')).holder, 'greyjoy');
  assert.equal(liegeAt('glover', at('asos')), liegeAt('glover', at('agot')));
});

test('the War of the Five Kings: Stannis and Renly split from the crown, the Tyrells follow Renly then Joffrey', () => {
  assert.equal(liegeAt('baratheon-of-dragonstone', before('acok-prologue')), 'baratheon-of-king-s-landing');
  assert.equal(liegeAt('baratheon-of-dragonstone', at('acok-prologue')), null);
  assert.equal(liegeAt('baratheon', at('acok-catelyn-ii')), null);
  assert.equal(liegeAt('tyrell', at('acok-jon-i')), 'baratheon');
  assert.equal(liegeAt('baratheon', at('acok-catelyn-vi')), 'baratheon-of-dragonstone');
  assert.equal(liegeAt('tyrell', at('acok-arya-x')), 'baratheon-of-king-s-landing');
  const end = { track: 'books', at: lastChapter('acok') } as const;
  assert.equal(liegeAt('baratheon', end), 'baratheon-of-dragonstone'); // the wiki's period seed must not undo it
});

test('the Iron Islands hold of the crown until Balon styles himself king; the Florents turn to Stannis', () => {
  assert.equal(liegeAt('greyjoy', at('agot-eddard-i')), 'baratheon-of-king-s-landing');
  assert.equal(liegeAt('greyjoy', before('acok-tyrion-xi')), 'baratheon-of-king-s-landing');
  assert.equal(liegeAt('greyjoy', at('acok-tyrion-xi')), null);
  assert.equal(liegeAt('florent', before('acok-davos-iii')), 'tyrell');
  assert.equal(liegeAt('florent', at('acok-davos-iii')), 'baratheon-of-dragonstone');
});

test('before the Conquest the regions are kingdoms, and Dorne stands outside the realm until 187 AC', () => {
  const y = (year: number): Moment => ({ track: 'history', year });
  assert.equal(stateAt('The Reach', y(-100)).name, 'Kingdom of the Reach');
  assert.equal(stateAt('The Reach', y(-1)).name, 'The Reach');
  assert.equal(stateAt('The Stormlands', y(-2)).name, 'Kingdom of the Storm');
  assert.equal(stateAt('The Stormlands', y(0)).name, 'The Stormlands');
  assert.equal(stateAt('The Riverlands', y(-100)).name, 'The Riverlands');
  assert.equal(stateAt('The Riverlands', y(-45)).name, 'Kingdom of the Isles and the Rivers');
  assert.equal(stateAt('The North', y(0)).name, 'Kingdom of the North');
  assert.equal(stateAt('The North', y(100)).name, 'The North');
  assert.equal(liegeAt('stark', y(0)), null);
  assert.equal(liegeAt('stark', y(100)), 'targaryen');
  assert.equal(liegeAt('martell', y(186)), null);
  assert.equal(liegeAt('martell', y(187)), 'targaryen');
  assert.equal(stateAt('The North', at('agot')).name, 'The North'); // the books start long after the Conquest
});

test('houses and regions that do not exist yet are not there', () => {
  const y = (year: number): Moment => ({ track: 'history', year });
  assert.equal(houseExists('baratheon', y(0)), false);
  assert.equal(houseExists('baratheon', y(1)), true);
  assert.equal(houseExists('baratheon-of-dragonstone', y(283)), false);
  assert.equal(houseExists('baratheon-of-dragonstone', at('agot')), true);
  assert.equal(houseExists('baratheon-of-king-s-landing', y(200)), false);
  assert.equal(houseExists('baratheon-of-king-s-landing', at('agot')), true);
  assert.equal(stateAt('The Crownlands', y(0)).state, 'gone');
  assert.equal(stateAt('The Crownlands', y(1)).state, 'built');
  assert.equal(stateAt('The Crownlands', at('agot')).state, 'built');
});

test('before the Conquest the old royal houses stand where the new ones do', () => {
  const y = (year: number): Moment => ({ track: 'history', year });
  assert.equal(liegeAt('buckler', y(-30)), 'durrandon'); // sworn to Baratheon later, to the Storm Kings then
  assert.equal(liegeAt('buckler', y(100)), 'baratheon'); // House Baratheon is founded in 1 AC
  assert.equal(liegeAt('buckler', at('agot')), 'baratheon');
  assert.equal(liegeAt('tyrell', y(-30)), 'gardener');
  assert.equal(liegeAt('tyrell', y(-1)), 'baratheon-of-king-s-landing');
  assert.equal(houseExists('gardener', y(-30)), true);
  assert.equal(houseExists('gardener', at('agot')), false);
  assert.equal(liegeAt('tully', y(-100)), 'durrandon');
  assert.equal(liegeAt('tully', y(-45)), 'hoare');
});

test('every house is sworn to someone or is a king, at every moment of the books', () => {
  for (const when of ['agot-eddard-i', 'acok-arya-x', 'asos-sansa-v']) {
    const m = at(when), free = HOUSE_IDS.filter((id) => houseExists(id, m) && !liegeAt(id, m));
    // Greyjoy and the Stark, Baratheon and crown houses are the kings and the crown; Smallwood, Meadows, Morrigen and Slynt were once left out
    for (const id of free) assert.ok(['greyjoy', 'stark', 'baratheon-of-dragonstone', 'baratheon-of-king-s-landing', 'frey-of-riverrun', 'lannister-of-darry'].includes(id), `${id} is sworn to no one at ${when}`);
  }
  assert.equal(liegeAt('smallwood', at('agot')), 'tully');
  assert.equal(liegeAt('meadows', at('agot')), 'tyrell');
  assert.equal(liegeAt('morrigen', at('agot')), 'baratheon');
  assert.equal(houseExists('lannister-of-darry', before('affc-jaime-iii')), false);
  assert.equal(liegeAt('lannister-of-darry', at('affc-jaime-iii')), 'baratheon-of-king-s-landing');
  assert.equal(houseExists('targaryen', { track: 'history', year: 100 }), true);
  assert.equal(houseExists('targaryen', at('agot')), false);
});

const HOUSE_IDS = (houses as { id: string; extinct?: boolean }[]).filter((h) => !h.extinct).map((h) => h.id);

test("King's Landing is held by the Targaryens until the Baratheon crown", () => {
  assert.equal(stateAt("King's Landing", { track: 'history', year: 100 }).holder, 'targaryen');
  assert.equal(stateAt("King's Landing", at('agot')).holder, 'baratheon-of-king-s-landing');
  assert.equal(stateAt('Storm\'s End', { track: 'history', year: -30 }).holder, 'durrandon');
});
