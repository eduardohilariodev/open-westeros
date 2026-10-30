// The point on the timeline the map shows (docs/decisions/0008). One store, so every feature that depends on "when" (house
// lieges now; places, borders and card text later) reads and follows the same value. Kept in the address as `when=`.
// A moment is a chapter of the books in publication order, an episode of the show, or a year of the history before the books.
// Nothing after the moment is shown, so a new visitor starts at the first chapter of A Game of Thrones.
import data from '../chapters.json' with { type: 'json' }; // tools/books/chapters.mjs; the attribute lets node's test runner load it

/** from/to are inclusive years AC. Sources: Fire & Blood (the crowning in 1 AC to the regency, 136 AC), World of Ice & Fire
 * (Ashford tourney 209 AC, Whitewalls tourney 211 AC); the series books span the years of their chapters (src/chapters.json). */
export const BOOKS = [
  { id: 'fab', short: 'F&B', label: 'Fire & Blood', from: 1, to: 136, period: 'agot' },
  { id: 'aksk', short: 'Dunk & Egg', label: 'A Knight of the Seven Kingdoms', from: 209, to: 211, period: 'agot' },
  { id: 'agot', short: 'AGOT', label: 'A Game of Thrones', from: 297, to: 299, period: 'agot' },
  { id: 'acok', short: 'ACOK', label: 'A Clash of Kings', from: 299, to: 299, period: 'acok' },
  { id: 'asos', short: 'ASOS', label: 'A Storm of Swords', from: 299, to: 300, period: 'asos' },
  { id: 'affc', short: 'AFFC', label: 'A Feast for Crows', from: 299, to: 300, period: 'adwd' },
  { id: 'adwd', short: 'ADWD', label: 'A Dance with Dragons', from: 300, to: 300, period: 'adwd' },
  { id: 'twow', short: 'TWOW', label: 'The Winds of Winter (sample)', from: 300, to: 300, period: 'adwd' },
] as const;

/** The periods src/houses.json has liege ties for. */
export type Period = 'agot' | 'acok' | 'asos' | 'adwd';
export type Book = (typeof BOOKS)[number]['id'];
export interface Chapter { t: string; u: string; book: Book; year: number }
export interface Episode { s: number; e: number; t: string; u: string }
export const CHAPTERS = data.chapters as Chapter[];
export const EPISODES = data.episodes as Episode[];

export type Moment = { track: 'books'; at: number } | { track: 'show'; at: number } | { track: 'history'; year: number };
export const START: Moment = { track: 'books', at: 0 };

const isBook = (v: unknown): v is Book => BOOKS.some((b) => b.id === v);
const HISTORY = BOOKS.filter((b) => !CHAPTERS.some((c) => c.book === b.id));
const firstChapter = (b: Book) => CHAPTERS.findIndex((c) => c.book === b);
/** "asos-sansa-iv", "affc-the-prophet", "agot-prologue": a chapter's name in the address. */
const slug = (c: Chapter) => c.t.replace(/^\w+(?:-\d+)?: /, `${c.book}-`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
const SLUGS = CHAPTERS.map(slug);
/** The index of a chapter by its address name ("asos-sansa-iv"), or -1. */
export const chapterIndex = (s: string) => SLUGS.indexOf(s);
/** The index of an episode by its code ("s3e9"), or -1. */
export function episodeIndex(code: string) {
  const ep = /^s(\d+)e(\d+)$/.exec(code);
  return ep ? EPISODES.findIndex((e) => e.s === +ep[1] && e.e === +ep[2]) : -1;
}
/** The index of a book's last chapter. */
export const lastChapter = (b: Book) => firstChapter(b) + CHAPTERS.filter((c) => c.book === b).length - 1; // a book's chapters are contiguous
// The show has no house ties of its own yet (roadmap step 7): each season borrows the period of the books it adapts. Assumption.
const SHOW_PERIOD: Period[] = ['agot', 'agot', 'acok', 'asos', 'asos', 'adwd', 'adwd', 'adwd', 'adwd'];

let current: Moment = START;
const listeners = new Set<(b: Book) => void>();
const same = (a: Moment, b: Moment) => momentKey(a) === momentKey(b);
const momentKey = (m: Moment) => (m.track === 'history' ? `h${m.year}` : `${m.track}${m.at}`);

export const getMoment = (): Moment => current;

/** The book the moment is in; on the show track, the book its season adapts (by period). */
export function getBook(m = current): Book {
  if (m.track === 'books') return CHAPTERS[m.at].book;
  if (m.track === 'show') return SHOW_PERIOD[EPISODES[m.at].s];
  const y = m.year;
  return (HISTORY.find((b) => y >= b.from && y <= b.to) ?? [...HISTORY].reverse().find((b) => b.from <= y) ?? HISTORY[0]).id;
}

/** The house-tie period of the moment. */
export const getPeriod = (m = current): Period => (m.track === 'show' ? SHOW_PERIOD[EPISODES[m.at].s] : BOOKS.find((b) => b.id === getBook(m))!.period);

/** The year AC of the moment; null on the show track, whose years canon does not give. */
export const yearOf = (m = current): number | null => (m.track === 'books' ? CHAPTERS[m.at].year : m.track === 'history' ? m.year : null);

export function setMoment(m: Moment) {
  if (same(m, current)) return;
  current = m;
  listeners.forEach((fn) => fn(getBook()));
}

/** Moves to a book: a series book at its first chapter, a history book at its first year. A no-op when already in that book. */
export function setPeriod(b: Book) {
  if (!isBook(b) || (current.track !== 'show' && b === getBook())) return;
  const i = firstChapter(b);
  setMoment(i >= 0 ? { track: 'books', at: i } : { track: 'history', year: BOOKS.find((k) => k.id === b)!.from });
}

/** Calls `fn` on every change of the moment (not on subscribe). Returns the unsubscribe. */
export function onPeriod(fn: (b: Book) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The moment in an address' query, or null when absent or unknown: `?when=acok` (a book), `?when=asos-sansa-iv` (a chapter),
 * `?when=s3e9` (an episode). */
export function momentFromSearch(search: string): Moment | null {
  const v = new URLSearchParams(search).get('when')?.toLowerCase();
  if (!v) return null;
  if (/^s\d+e\d+$/.test(v)) { const at = episodeIndex(v); return at < 0 ? null : { track: 'show', at }; }
  if (isBook(v)) { const i = firstChapter(v); return i >= 0 ? { track: 'books', at: i } : { track: 'history', year: BOOKS.find((b) => b.id === v)!.from }; }
  const at = chapterIndex(v);
  return at < 0 ? null : { track: 'books', at };
}

/** How a moment is written in the address: a book when at its first chapter (or year), else the chapter or episode. */
export function momentParam(m: Moment) {
  if (m.track === 'show') return `s${EPISODES[m.at].s}e${EPISODES[m.at].e}`;
  if (m.track === 'history') return getBook(m);
  const b = CHAPTERS[m.at].book;
  return firstChapter(b) === m.at ? b : SLUGS[m.at];
}

/** The same query with `when` set; the start (AGOT's first chapter) is left out so plain addresses stay plain. */
export function withMoment(search: string, m: Moment) {
  const q = new URLSearchParams(search);
  if (same(m, START)) q.delete('when'); else q.set('when', momentParam(m));
  const s = q.toString();
  return s ? `?${s}` : '';
}
