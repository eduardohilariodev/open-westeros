import type { House } from '../houseGraph';
import type { HouseLayer } from '../globe/houses';
import { tintOf } from '../sigilTint';
import houseWiki from '../house-wiki.json'; // tools/wiki/house-info.mjs
import { ERAS, EVENTS, WIKI_YEAR, YEAR_STOPS } from '../timeline';
import { BOOKS, CHAPTERS, atEnd, EPISODES, chapterTitle, getBook, getMoment, onPeriod, setMoment, setPeriod, withMoment, type Moment } from '../state/time';

// The houses overlay's sidebar (index.html #house): a big coat of arms, the house's facts, who it is sworn to and who is sworn to it.
// It replaces the place card while a house is open (style.css hides the menu behind either) and follows the book period.
const $ = (id: string) => document.getElementById(id)!;
const card = $('house'), q = <T extends Element>(s: string) => card.querySelector<T & HTMLElement>(s)!;
const WIKI = 'https://awoiaf.westeros.org/index.php/';
export const sigilUrl = (h: House) => `${import.meta.env.BASE_URL}sigils/${h.sigil.replace(/\.[^.]+$/, '')}.webp`; // the wiki file may be an svg or a png

export interface HousePanelOptions {
  layer: HouseLayer;
  flyTo: (id: string) => void; // light a house and frame it
  goToSeat: (name: string) => void; // the place on the map
  onClose: () => void;
}

const FIRST_BOOK_YEAR = Math.min(...CHAPTERS.map((c) => c.year)); // the history ends where the chapters begin
/** The years the wiki has events for (YEAR_STOPS) before the books: the coarse stops of the wheel. The quiet years between are fine stops, folded away until you scroll in. */
const YEARS = [...YEAR_STOPS].filter((y) => y < FIRST_BOOK_YEAR).sort((a, b) => a - b);
const fmt = (y: number) => (y < 0 ? `${(-y).toLocaleString('en')} BC` : `${y} AC`);
/** The stop an event shows at: its own year, or the next listed one when the wiki has no page for that year. */
const stopOf = (e: { from: number }) => YEARS.find((y) => y >= e.from) ?? e.from;

/** One place the wheel can rest: a year of the history (fine = no wiki page of its own) or a chapter of the books (at). */
interface Stop { y: number; at?: number; fine?: boolean; first?: boolean }
let lastLabel = -99, lastYear = NaN;
const labelled = (at: number) => { const y = CHAPTERS[at].year, on = y !== lastYear && at - lastLabel >= 12; if (on) { lastLabel = at; lastYear = y; } return on; };
const STOPS: Stop[] = [
  ...[...new Set([...YEARS, ...Array.from({ length: FIRST_BOOK_YEAR + 3 }, (_, i) => i - 3)].filter((y) => y !== 0))].sort((a, b) => a - b).map((y): Stop => ({ y, fine: !YEARS.includes(y) })),
  ...CHAPTERS.map((c, at): Stop => ({ y: c.year, at, first: labelled(at) })), // a year is lettered where it changes, not more often than every 12 chapters (AFFC and ADWD overlap in time)
];
const FIRST_CHAPTER_STOP = STOPS.findIndex((s) => s.at !== undefined);
const STEP = 34, CHAPTER = 15, WIDE = 120, BREAK = 24; // px between years, between chapters, between years inside a short book (so its area has room), extra px across a skipped stretch
const inShortBook = (y: number) => BOOKS.some((b) => b.to - b.from < 5 && y >= b.from && y <= b.to);
const FINE_FROM = 1, FINE_FULL = 1.6; // the scroll zoom at which the quiet years start to unfold, and at which they are fully open
/** The x of every stop when the quiet years are `open` (0 folded to 1 unfolded) of the way open; folded stops take no room. */
const layout = (open: number) => {
  const xs: number[] = [];
  STOPS.forEach((s, i) => {
    const p = STOPS[i - 1];
    if (!p) return xs.push(0);
    if (s.at !== undefined) return xs.push(xs[i - 1] + (p.at !== undefined ? CHAPTER : STEP));
    if (s.fine) return xs.push(xs[i - 1] + STEP * open);
    const wide = !p.fine && inShortBook(s.y) && inShortBook(p.y);
    xs.push(xs[i - 1] + (wide ? WIDE : STEP) + (s.y - lastCoarse(i) > 1 ? BREAK * (p.fine ? 1 - open : 1) : 0));
  });
  return xs;
};
const lastCoarse = (i: number) => { for (let j = i - 1; j >= 0; j--) if (!STOPS[j].fine) return STOPS[j].y; return STOPS[i].y; };

/** The picker above the window: Books or Show, a book (or season), a chapter (or episode), and a step back and forward. It reads and writes the moment only. */
function pickerEl() {
  const box = document.createElement('div'), mkb = (t: string, title: string, on: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.title = title; b.onclick = on; return b; };
  const sel = () => { const e = document.createElement('select'); e.className = 'wi-sel'; return e; };
  box.className = 'wi-pick';
  const track = document.createElement('div'); track.className = 'wi-track';
  const group = sel(), item = sel();
  const seasons = [...new Set(EPISODES.map((e) => e.s))];
  const at = () => { const m = getMoment(); return m.track === 'history' ? -1 : m.at; };
  const go = (m: Moment) => setMoment(m);
  const bookMode = () => getMoment().track !== 'show';
  const bBooks = mkb('Books', 'The books, chapter by chapter', () => { if (!bookMode()) go({ track: 'books', at: CHAPTERS.findIndex((c) => c.book === getBook()) }); });
  const SEASON: Record<string, number> = { agot: 1, acok: 2, asos: 3, affc: 5, adwd: 5, twow: 8 }; // the season that adapts each book, as time.ts borrows them
  const bShow = mkb('Show', 'The show, episode by episode', () => { if (bookMode()) go({ track: 'show', at: EPISODES.findIndex((e) => e.s === (SEASON[getBook()] ?? 1)) }); });
  track.append(bBooks, bShow);
  const step = (d: number) => { const m = getMoment(), n = at() + d, len = m.track === 'show' ? EPISODES.length : CHAPTERS.length; if (m.track !== 'history' && n >= 0 && n < len) go({ track: m.track, at: n }); };
  const prev = mkb('‹', 'One step back', () => step(-1)), next = mkb('›', 'One step forward', () => step(1));
  group.onchange = () => go(bookMode() ? { track: 'books', at: CHAPTERS.findIndex((c) => c.book === group.value) } : { track: 'show', at: EPISODES.findIndex((e) => e.s === +group.value) });
  item.onchange = () => go({ track: bookMode() ? 'books' : 'show', at: +item.value });
  const fill = () => {
    const m = getMoment(), books = m.track !== 'show';
    bBooks.setAttribute('aria-pressed', String(books)); bShow.setAttribute('aria-pressed', String(!books));
    const groups: [string, string][] = books ? BOOKS.filter((b) => CHAPTERS.some((c) => c.book === b.id)).map((b) => [b.id, b.short]) : seasons.map((x) => [String(x), 'Season ' + x]);
    const g = m.track === 'history' ? '' : books ? CHAPTERS[m.at].book : String(EPISODES[m.at].s);
    group.replaceChildren(...groups.map(([v, t]) => new Option(t, v)));
    group.value = g; group.disabled = m.track === 'history';
    const items: [number, string][] = m.track === 'history' ? [] : books ? CHAPTERS.flatMap((c, i): [number, string][] => (c.book === g ? [[i, chapterTitle(c)]] : [])) : EPISODES.flatMap((e, i): [number, string][] => (String(e.s) === g ? [[i, `E${e.e} ${e.t}`]] : []));
    item.replaceChildren(...items.map(([v, t]) => new Option(t, String(v))));
    item.value = String(at()); item.disabled = !items.length;
    prev.disabled = m.track === 'history' || m.at <= 0; next.disabled = m.track === 'history' || m.at >= (books ? CHAPTERS.length : EPISODES.length) - 1;
  };
  onPeriod(fill); fill();
  box.append(track, prev, group, item, next);
  return box;
}

/** The timeline (#when): a drum of years you drag to spin, the eras as bands in its background. What happened in the year in the middle, and which books cover it, is a separate window (#whenInfo). One store (state/time.ts) so other layers can follow it. */
export function initWhen() {
  const el = $('when');
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };
  const book = () => BOOKS.find((b) => b.id === getBook())!;
  const span = (b: { from: number; to: number }) => (b.from === b.to ? fmt(b.from) : `${b.from}–${fmt(b.to)}`);
  const wheel = mk('div', 't-wheel'), bg = mk('div', 't-bg'), pill = mk('div', 't-label');
  wheel.tabIndex = 0; wheel.role = 'slider'; wheel.ariaLabel = 'Year (AC) and chapter';
  const info = mk('div', 'card'), infoHead = mk('div', 'wi-head'), infoBody = mk('div', 'wi-body');
  info.id = 'whenInfo'; info.hidden = true;
  const more = mk('a', 'wi-more');
  more.target = '_blank'; more.rel = 'noopener';
  info.append(pickerEl(), infoHead, infoBody);
  document.body.append(info);

  let open = 0, X = layout(0);
  const shown = (i: number) => !STOPS[i].fine || open > 0.5; // a folded year is not a place to rest
  const ctx = document.createElement('canvas').getContext('2d')!;
  const textW = (t: string, font: string, size: number, spacing = 0.06) => { ctx.font = font; return ctx.measureText(t).width + t.length * spacing * size + 14; };
  // eras and books: flat bands behind the drum, from the middle between two stops to the next
  const last = STOPS.length - 1;
  const edgesOf = (i0: number, i1: number): [number, number] | null => (i0 < 0 || i1 < i0 ? null : [i0 ? (X[i0] + X[i0 - 1]) / 2 : X[0] - STEP / 2, i1 < last ? (X[i1] + X[i1 + 1]) / 2 : X[last] + STEP / 2]);
  type Range = { from: number; to: number };
  const byYear = (r: Range) => () => edgesOf(STOPS.findIndex((s) => s.at === undefined ? s.y >= r.from : s.y >= r.from), STOPS.reduce((n, s, i) => (s.y <= r.to ? i : n), -1));
  const byChapters = (b: string) => () => edgesOf(STOPS.findIndex((s) => s.at !== undefined && CHAPTERS[s.at].book === b), STOPS.reduce((n, s, i) => (s.at !== undefined && CHAPTERS[s.at].book === b ? i : n), -1));
  const bands: { el: HTMLElement; name: HTMLElement; w: number; range: () => [number, number] | null; r: Range }[] = [];
  const band = (r: Range, cls: string, text: string, w: number, style: string, range: () => [number, number] | null) => {
    const el = mk('div', cls), name = mk('span', 't-era-name', text);
    el.style.cssText = style;
    el.append(name); bg.append(el);
    bands.push({ el, name, w, range, r });
    return el;
  };
  ERAS.forEach((era, n) => band(era, `t-era lane-${era.lane}`, era.name, textW(era.name.toUpperCase(), `600 ${era.lane === 'a' ? 12 : 9}px sans-serif`, era.lane === 'a' ? 12 : 9), `--h:${n * 41}`, byYear(era)));
  // the books on one row: the history books at their years, the series books at their chapters (in publication order they never overlap)
  BOOKS.forEach((b) => {
    const e = band(b, 't-book', b.label, textW(b.label, '600 11px sans-serif', 11, 0.04), `top:44px;--h:${BOOKS.indexOf(b) * 53}`, CHAPTERS.some((c) => c.book === b.id) ? byChapters(b.id) : byYear(b));
    e.dataset.book = b.id; e.title = `${b.label}, ${span(b)}`;
  });
  const wheelH = 44 + 17 + 36; // eras, the book rows, then the years
  wheel.style.height = wheelH + 'px';
  document.documentElement.style.setProperty('--wheel-h', wheelH + 'px');
  const EVENT_YEARS = new Set(EVENTS.map(stopOf));
  const items = STOPS.map((s, i) => mk('span', 't-y' + (s.at !== undefined ? ' ch' : s.fine ? ' fine' : '') + (s.at !== undefined ? (s.first ? ' big' : '') : s.y % 10 === 0 || (i && !STOPS[i - 1].fine && s.y - STOPS[i - 1].y > 1) ? ' big' : '') + (s.at === undefined && EVENT_YEARS.has(s.y) ? ' ev' : '') + (s.y < 0 ? ' bc' : ''), s.at !== undefined && !s.first ? '' : String(Math.abs(s.y))));
  wheel.append(bg, mk('i', 't-mark'), ...items, pill);
  el.replaceChildren(wheel);

  /** The stop the moment sits on: its chapter, else its year (or the next coarse one), else (the show) its book's first chapter. */
  const momentStop = () => {
    const m = getMoment();
    if (m.track === 'books') return STOPS.findIndex((s) => s.at === m.at);
    if (m.track === 'history') { const i = STOPS.findIndex((s) => s.at === undefined && s.y >= m.year); return i < 0 ? FIRST_CHAPTER_STOP : i; }
    return STOPS.findIndex((s) => s.at !== undefined && CHAPTERS[s.at].book === getBook());
  };
  const nearest = (pos: number) => X.reduce((best, x, i) => (shown(i) && (best < 0 || Math.abs(x - pos) < Math.abs(X[best] - pos)) ? i : best), -1);
  let pos = X[momentStop()], vel = 0, target: number | null = null, dragging = false, running = false, seek = false, cur = momentStop(), radius = 400, half = 400, zoom = 1; // zoom: px per drum px, set by the mouse wheel
  const draw = () => {
    bg.style.transform = `translateX(${-pos * zoom}px)`;
    const mid = pos * zoom;
    for (const { r, el, name, w, range } of bands) { // the name shows only where it fits whole in the visible part of its band
      const e = range();
      if (!e) { el.style.display = 'none'; continue; }
      const l = e[0] * zoom, rr = e[1] * zoom, a = Math.max(l, mid - half), b = Math.min(rr, mid + half), ok = b - a >= w;
      el.style.display = ''; el.style.left = l + 'px'; el.style.width = rr - l + 'px';
      name.style.visibility = ok ? 'visible' : 'hidden';
      if (ok) name.style.transform = `translateX(${(a + b) / 2 - l}px) translateX(-50%)`;
      el.classList.toggle('on', el.dataset.book ? el.dataset.book === getBook() : STOPS[cur].y >= r.from && STOPS[cur].y <= r.to);
    }
    wheel.classList.toggle('far', zoom < 0.7);
    items.forEach((it, i) => {
      const t = ((X[i] - pos) * zoom) / radius, c = Math.cos(t), far = Math.abs(t) >= 1.4 || !shown(i);
      if (far && it.style.visibility === 'hidden') return;
      it.style.visibility = far ? 'hidden' : 'visible';
      it.style.transform = `translateX(${radius * Math.sin(t)}px) scaleY(${0.35 + 0.65 * c})`;
      it.style.opacity = String(Math.max(0, c * c));
      it.classList.toggle('on', i === cur);
    });
  };
  new ResizeObserver(() => { half = wheel.clientWidth / 2; radius = Math.max(220, half); draw(); }).observe(wheel);

  const showYear = () => {
    const s = STOPS[cur], m = getMoment(), year = s.y, bk = book(), covered = year >= bk.from && year <= bk.to;
    const ch = s.at !== undefined ? CHAPTERS[s.at] : null;
    pill.textContent = ch ? `${fmt(year)} · ${chapterTitle(ch)}` : fmt(year);
    wheel.ariaValueText = pill.textContent;
    const here = s.at !== undefined && !atEnd() ? [] : EVENTS.filter((e) => (year >= e.from && year <= (e.to ?? e.from)) || (s.at === undefined && stopOf(e) === year));
    infoHead.textContent = ch ? `${fmt(year)} · ${bk.short}: ${chapterTitle(ch)}` : covered && m.track !== 'books' ? `${fmt(year)} · ${bk.label}` : fmt(year);
    infoBody.replaceChildren(...here.flatMap((e) => [
      mk('h3', 'wi-ev', (e.ca ? 'ca. ' : '') + e.title + (e.to ? ` (${span({ from: e.from, to: e.to })})` : e.from !== year ? ` (${fmt(e.from)})` : '')),
      mk('p', 'wi-text', e.text),
    ]), ...(here.length ? [mk('p', 'wi-credit', 'Wiki of Ice and Fire, Timeline of major events (CC BY-SA)')] : []), more);
    info.scrollTop = 0;
    more.href = WIKI_YEAR(year); more.textContent = `${fmt(year)} on the wiki`;
  };
  /** The wheel rests on a stop: that stop is the moment (a chapter of the books, or a year of the history). */
  const apply = (s: Stop) => setMoment(s.at !== undefined ? { track: 'books', at: s.at } : { track: 'history', year: s.y });
  const tick = () => {
    if (!dragging) {
      if (target !== null) { pos += (target - pos) * 0.2; if (Math.abs(target - pos) < 0.4) { pos = target; target = null; seek = false; } }
      else if (Math.abs(vel) > 0.4) { pos += vel; vel *= 0.94; } else { vel = 0; target = X[nearest(pos)]; }
    }
    pos = Math.min(X[X.length - 1], Math.max(0, pos));
    const i = nearest(pos);
    if (i !== cur) { cur = i; showYear(); if (!seek) apply(STOPS[i]); }
    draw();
    running = dragging || target !== null || Math.abs(vel) > 0.4;
    if (running) requestAnimationFrame(tick);
  };
  const go = () => { if (!running) { running = true; requestAnimationFrame(tick); } };
  /** Scrolling in unfolds the quiet years: the same stop stays in the middle while the layout opens around it. */
  const setZoom = (z: number) => {
    zoom = Math.min(2.5, Math.max(0.3, z));
    const o = Math.min(1, Math.max(0, (zoom - FINE_FROM) / (FINE_FULL - FINE_FROM)));
    if (o === open) return;
    const j = Math.max(0, X.findIndex((x) => x >= pos) - 1), f = X[j + 1] > X[j] ? (pos - X[j]) / (X[j + 1] - X[j]) : 0;
    open = o; X = layout(open);
    pos = X[j] + f * (X[j + 1] - X[j]);
    if (target !== null) target = X[nearest(pos)];
    if (!shown(cur)) cur = nearest(pos);
  };

  let lastX = 0, downX = 0, downEl: Element | null = null;
  wheel.onpointerdown = (e) => { downX = lastX = e.clientX; downEl = e.target as Element; dragging = true; target = null; seek = false; vel = 0; wheel.setPointerCapture(e.pointerId); wheel.classList.add('drag'); go(); };
  wheel.onpointermove = (e) => { if (!dragging) return; vel = ((lastX - e.clientX) / zoom) * 1.1; pos += vel; lastX = e.clientX; };
  wheel.onpointerup = wheel.onpointercancel = (e) => {
    const id = (downEl as HTMLElement | null)?.closest<HTMLElement>('[data-book]')?.dataset.book; // a tap on a book's area picks it
    if (id && e.type === 'pointerup' && Math.abs(e.clientX - downX) < 5) setPeriod(id as never);
    dragging = false; wheel.classList.remove('drag'); go(); };
  wheel.addEventListener('wheel', (e) => { // sideways scroll (trackpad, shift) turns the years; up and down zooms them
    e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { target = null; seek = false; vel += (e.deltaX / zoom) * 0.12; go(); return; }
    setZoom(zoom * Math.exp(-e.deltaY * 0.0015)); go(); draw();
  }, { passive: false });
  wheel.onkeydown = (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    let i = (target !== null ? nearest(target) : cur) + d; // from where the wheel is heading, so quick presses add up
    while (i > 0 && i < last && !shown(i)) i += d;
    target = X[Math.min(last, Math.max(0, i))]; seek = false; go();
  };

  // the moment changed from outside (a chip, a book band, the address): spin to its stop
  const sync = () => {
    const i = momentStop();
    if (i >= 0 && STOPS[i].fine && open <= 0.5) setZoom(FINE_FULL); // a year with no stop of its own: open the quiet years around it
    if (i >= 0 && i !== cur) { seek = true; target = X[i]; vel = 0; go(); }
    showYear();
    const u = new URL(location.href);
    history.replaceState(null, '', u.pathname + withMoment(u.search, getMoment()) + u.hash);
  };
  onPeriod(sync); showYear(); draw(); sync();
  /** The timeline and its window are shown or hidden together (the timeline button). */
  return (on: boolean) => { el.hidden = !on; info.hidden = !on; if (on) { half = wheel.clientWidth / 2; radius = Math.max(220, half); draw(); } };
}

export function initHousePanel(o: HousePanelOptions) {
  const shown = (h: House) => h.name.replace(/^House /, ''); // the name as the chips print it, and the order they sort in
  const chip = (h: House, onclick: () => void) => {
    const b = document.createElement('button'), img = new Image();
    b.type = 'button'; b.className = 'h-chip';
    img.src = sigilUrl(h); img.alt = ''; img.onerror = () => img.remove();
    b.append(img, shown(h));
    b.onclick = onclick;
    return b;
  };
  const link = (text: string, onclick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'h-link'; b.textContent = text; b.onclick = onclick;
    return b;
  };
  const row = (k: string, v: Node | string) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.append(v);
    return [dt, dd];
  };
  const syncAddress = (h: House | null) => {
    const u = new URL(location.href);
    if (h) { u.searchParams.set('house', h.id); u.searchParams.delete('place'); u.searchParams.delete('character'); } else u.searchParams.delete('house');
    history.replaceState(null, '', u);
  };

  const show = (id: string | null) => {
    const g = o.layer.graph, h = id ? g.by.get(id) : null;
    card.hidden = !h;
    syncAddress(h ?? null);
    if (!h) return;
    const lord = g.liegeOf(h.id), sworn = g.vassals(h.id), realm = g.subtree(h.id).size - 1;
    const crest = q<HTMLImageElement>('.crest img');
    card.style.removeProperty('--tint'); // the card takes its colour from the arms once they load
    crest.onload = () => { const t = tintOf(crest); if (t) card.style.setProperty('--tint', t.join(',')); };
    crest.src = sigilUrl(h);
    q('h1').textContent = h.name;
    q('.kind').textContent = h.words ? `“${h.words}”` : ''; // the house's words
    const seat = link(h.seat, () => o.goToSeat(h.seat));
    q('.h-facts').replaceChildren(...row('Seat', seat), ...(h.head && atEnd() ? row('Head', h.head) : []), ...(h.region ? row('Region', h.region.replace(/^the /i, '')) : []), ...row('Sworn houses', realm ? String(realm) : 'None'));
    const lordBox = q('.h-lord'), swornBox = q('.h-sworn');
    lordBox.hidden = !lord; swornBox.hidden = !sworn.length;
    lordBox.querySelector('.h-chip')?.remove();
    if (lord) lordBox.append(chip(lord, () => o.flyTo(lord.id)));
    swornBox.querySelector('.h-list')!.replaceChildren(...sworn.sort((a, b) => shown(a).localeCompare(shown(b))).map((v) => chip(v, () => o.flyTo(v.id))));
    // the wiki's lead and facts of the house
    const wiki = (houseWiki as unknown as Record<string, { summary?: string; facts?: [string, string][] }>)[h.id], box = q('.h-wikitext');
    box.hidden = !wiki;
    if (wiki) {
      const sum = box.querySelector('.h-summary')!, wf = box.querySelector('.h-wfacts')!;
      sum.textContent = wiki.summary ?? ''; wf.replaceChildren(...(wiki.facts ?? []).flatMap(([k, v]) => row(k, v)));
    }
    q('.h-note').textContent = h.seatOf ? `Shares its seat with ${g.by.get(h.seatOf)?.name ?? 'another house'}, whose land is shown.` : lord ? '' : 'Answers to no liege at this time (the wiki names none).';
    q('.h-note').hidden = !q('.h-note').textContent;
    q<HTMLAnchorElement>('.h-wiki').href = WIKI + encodeURIComponent(h.title.replaceAll(' ', '_'));
    card.scrollTop = 0; card.querySelector('.h-body')!.scrollTop = 0;
  };
  q('.close').onclick = o.onClose;
  onPeriod(() => { if (o.layer.focused) show(o.layer.focused); });
  return { show, hide: () => show(null) };
}
