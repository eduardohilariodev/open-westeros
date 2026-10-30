// What is true of a place or a house at a moment (docs/decisions/0008): its AGOT state plus every dated change at or before
// the moment. Changes are the quoted claims of tools/books/timeline.json (checked by tools/books/timeline-check.mjs) and, for
// house lieges, the wiki's four book periods (src/houses.json). A period's liege counts from the last chapter of its book: the
// wiki does not say in which chapter it turns, and late never spoils. A blank period means the wiki is silent: the last liege stays.
import houses from '../houses.json' with { type: 'json' };
import claims from '../../tools/books/timeline.json' with { type: 'json' };
import { chapterIndex, episodeIndex, getMoment, getPeriod, lastChapter, type Moment, type Period } from './time.ts'; // with the extension, so node's test runner loads it

export interface State {
  /** The house holding a place (its seat), null when none does. */
  holder?: string | null;
  /** The house a house is sworn to, null when it answers to no one. */
  liege?: string | null;
  state?: 'built' | 'ruin' | 'gone';
  name?: string;
}
/** `first`: the place does not exist, or is not yet known, before this change (a battle, a castle built later). */
interface Claim { subject: string; set: State; books?: string; show?: string; year?: number; first?: boolean }
/** A change placed on the tracks: the chapter and episode it counts from (-1 before the books), or its year for history. */
interface Change { books: number | null; show: number | null; year: number | null; set: State }

interface HouseRow { id: string; seat: string; seatOf?: string; liege: Record<Period, string | null> }
const HOUSES = houses as HouseRow[];
const PERIODS: Period[] = ['agot', 'acok', 'asos', 'adwd'];

/** Each period's lieges with the wiki's blanks filled from the period before. */
const filled = new Map(HOUSES.map((h) => {
  const out = {} as Record<Period, string | null>;
  PERIODS.forEach((p, i) => { out[p] = h.liege[p] ?? (i ? out[PERIODS[i - 1]] : null); });
  return [h.id, out];
}));

const bySubject = new Map<string, Change[]>();
const FIRST = new Set((claims as Claim[]).filter((c) => c.first).map((c) => c.subject));
const add = (subject: string, c: Change) => bySubject.set(subject, [...(bySubject.get(subject) ?? []), c]);
for (const h of HOUSES) { // the period seeds first, so a quoted change in the same chapter wins
  const f = filled.get(h.id)!;
  PERIODS.slice(1).forEach((p, i) => { if (f[p] !== f[PERIODS[i]]) add(`house:${h.id}`, { books: lastChapter(p), show: null, year: null, set: { liege: f[p] } }); });
}
for (const c of claims as Claim[]) {
  const pre = c.books == null && c.show == null ? -1 : null; // a change dated by year only is before the books, on every track
  add(c.subject, { books: c.books != null ? chapterIndex(c.books) : pre, show: c.show != null ? episodeIndex(c.show) : pre, year: c.year ?? null, set: c.set });
}

function base(subject: string, m: Moment): State {
  if (subject.startsWith('house:')) {
    const f = filled.get(subject.slice(6));
    // the show borrows a book period per season until it has changes of its own (roadmap step 7)
    return { liege: f ? f[m.track === 'show' ? getPeriod(m) : 'agot'] : null, state: FIRST.has(subject) ? 'gone' : 'built' };
  }
  return { holder: HOUSES.find((h) => h.seat === subject && !h.seatOf)?.id ?? null, state: FIRST.has(subject) ? 'gone' : 'built', name: subject };
}

/** The state of `subject` (a place name, or "house:<id>") at the moment. */
export function stateAt(subject: string, m: Moment = getMoment()): State {
  const changes = (bySubject.get(subject) ?? []).filter((c) =>
    m.track === 'history' ? c.year != null && c.year <= m.year : c[m.track] != null && c[m.track]! <= m.at);
  changes.sort((a, b) => (m.track === 'history' ? a.year! - b.year! : a[m.track]! - b[m.track]!)); // stable: same-chapter changes keep file order
  const st = changes.reduce<State>((s, c) => ({ ...s, ...c.set }), base(subject, m));
  const stand = !subject.startsWith('house:') && st.holder ? standIn(st.holder, m) : null; // the seat of a house not there yet is held by the house that stood in for it
  return stand ? { ...st, holder: stand } : st;
}

/** The liege of a house at the moment (a house id), or null. */
/** The house that held a seat before another did: a house sworn to the later one, when that is not there yet, is sworn to this one. */
const STAND_IN: Record<string, string> = { baratheon: 'durrandon', 'baratheon-of-king-s-landing': 'targaryen' };
/** The house standing in for `id` while `id` is not there yet (Targaryen for the Baratheon crown, Durrandon for Baratheon), or null. */
export const standIn = (id: string, m: Moment = getMoment()) => (STAND_IN[id] && !houseExists(id, m) && houseExists(STAND_IN[id], m) ? STAND_IN[id] : null);
export const liegeAt = (id: string, m: Moment = getMoment()) => {
  const l = stateAt(`house:${id}`, m).liege ?? null;
  return (l && standIn(l, m)) || l;
};
/** Whether the house is there at the moment: the Baratheons are made in 1 AC, the crown house in 283 AC. */
export const houseExists = (id: string, m: Moment = getMoment()) => stateAt(`house:${id}`, m).state !== 'gone';
