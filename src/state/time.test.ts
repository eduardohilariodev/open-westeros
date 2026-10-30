import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOKS, CHAPTERS, EPISODES, START, atEnd, chapterLimit, getBook, getMoment, getPeriod, momentFromSearch, momentParam, onPeriod, setMoment, setPeriod, lastChapter, withMoment, yearOf } from './time.ts';

test('listeners fire once per real change', () => {
  const seen: string[] = [];
  const off = onPeriod((p) => seen.push(p));
  setPeriod('asos');
  setPeriod('asos');
  setPeriod('nope' as never);
  assert.deepEqual(seen, ['asos']);
  assert.equal(getPeriod(), 'asos');
  setMoment({ track: 'books', at: getMoment().track === 'books' ? (getMoment() as { at: number }).at + 1 : 0 }); // the next chapter, same book
  assert.deepEqual(seen, ['asos', 'asos']);
  off();
  setMoment(START);
  assert.equal(seen.length, 2);
});

test('the start is the first chapter of AGOT, and stays out of the address', () => {
  assert.equal(getMoment(), START);
  assert.equal(CHAPTERS[0].t, 'AGOT-0: Prologue');
  assert.equal(withMoment('?place=Riverrun', START), '?place=Riverrun');
  assert.equal(withMoment('', START), '');
});

test('the address round-trips books, chapters, episodes and history', () => {
  for (const when of ['acok', 'asos-sansa-iv', 'affc-the-prophet', 'adwd-prologue', 's3e9', 's8e6', 'fab', 'aksk']) {
    const m = momentFromSearch(`?place=Riverrun&when=${when}`);
    assert.ok(m, when);
    assert.equal(withMoment('?place=Riverrun', m), `?place=Riverrun&when=${when === 'adwd-prologue' ? 'adwd' : when}`);
  }
  assert.equal(momentFromSearch('?when=agot')?.track, 'books');
  assert.equal(momentFromSearch('?when=zzz'), null);
  assert.equal(momentFromSearch('?when=s9e1'), null);
  assert.equal(momentFromSearch('?place=Riverrun'), null);
});

test('books map to their first chapter, chapters to their year', () => {
  for (const b of BOOKS) { setPeriod(b.id); assert.equal(getBook(), b.id); assert.ok(['agot', 'acok', 'asos', 'adwd'].includes(getPeriod()), b.id); }
  setPeriod('affc');
  assert.equal(getPeriod(), 'adwd');
  assert.equal(yearOf(), 300); // the AFFC prologue
  const at = (when: string) => momentFromSearch(`?when=${when}`)!;
  assert.equal(yearOf(at('agot')), 297);
  assert.equal(yearOf(at('agot-bran-i')), 298);
  assert.equal(yearOf(at('agot-tyrion-viii')), 299);
  assert.equal(yearOf(at('asos-sansa-iv')), 300);
  assert.equal(yearOf(at('affc-the-prophet')), 299);
  assert.equal(yearOf(at('s1e1')), null);
  assert.equal(yearOf(at('fab')), 1);
  for (const b of BOOKS) for (const c of CHAPTERS.filter((c) => c.book === b.id)) assert.ok(c.year >= b.from && c.year <= b.to, `${c.t} ${c.year}`);
  setMoment(START);
});

test('the show has 73 episodes and borrows a book period per season', () => {
  assert.equal(EPISODES.length, 73);
  setMoment(momentFromSearch('?when=s1e1')!);
  assert.equal(getPeriod(), 'agot');
  setMoment(momentFromSearch('?when=s8e6')!);
  assert.equal(getPeriod(), 'adwd');
  setPeriod('acok'); // a book from the show track moves to the books
  assert.equal(getMoment().track, 'books');
  setMoment(START);
});

test('a year of the history has its own address', () => {
  assert.deepEqual(momentFromSearch('?when=y-100'), { track: 'history', year: -100 });
  assert.equal(momentParam({ track: 'history', year: -100 }), 'y-100');
  assert.deepEqual(momentFromSearch(`?when=${momentParam({ track: 'history', year: 187 })}`), { track: 'history', year: 187 });
});

test('the wiki text opens only at the end of the story', () => {
  assert.equal(atEnd({ track: 'books', at: 0 }), false);
  assert.equal(atEnd({ track: 'books', at: lastChapter('adwd') }), true);
  assert.equal(atEnd({ track: 'show', at: EPISODES.length - 1 }), true);
  assert.equal(atEnd({ track: 'show', at: 3 }), false);
  assert.equal(atEnd({ track: 'history', year: 100 }), false);
  assert.equal(chapterLimit({ track: 'history', year: 100 }), -1);
  assert.equal(chapterLimit({ track: 'books', at: 80 }), 80);
  assert.equal(chapterLimit({ track: 'show', at: 0 }), lastChapter('agot'));
});
