import type { House } from '../houseGraph';
import type { HouseLayer } from '../globe/houses';
import { tintOf } from '../sigilTint';
import { ERAS, EVENTS, WIKI_YEAR, YEAR_STOPS } from '../timeline';
import { BOOKS, getBook, getMoment, onPeriod, setPeriod, withMoment, yearOf } from '../state/time';

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

/** The years the wheel turns through: only the years the wiki has events for (YEAR_STOPS), so the quiet years between are skipped, not scrolled. */
const YEARS = [...YEAR_STOPS].sort((a, b) => a - b);
const fmt = (y: number) => (y < 0 ? `${(-y).toLocaleString('en')} BC` : `${y} AC`);
/** The stop an event shows at: its own year, or the next listed one when the wiki has no page for that year. */
const stopOf = (e: { from: number }) => YEARS.find((y) => y >= e.from) ?? YEARS[YEARS.length - 1];
const EVENT_YEARS = new Set(EVENTS.map(stopOf));
const STEP = 34, WIDE = 120, BREAK = 24; // px between years, between years inside a short book (so its area has room), extra px across a skipped stretch
const inShortBook = (y: number) => BOOKS.some((b) => b.to - b.from < 5 && y >= b.from && y <= b.to);
const X = YEARS.reduce<number[]>((xs, y, i) => [...xs, i ? xs[i - 1] + (inShortBook(y) && inShortBook(YEARS[i - 1]) ? WIDE : STEP) + (y - YEARS[i - 1] > 1 ? BREAK : 0) : 0], []);
const nearest = (pos: number) => X.reduce((best, x, i) => (Math.abs(x - pos) < Math.abs(X[best] - pos) ? i : best), 0);

/** The timeline (#when): a drum of years you drag to spin, the eras as bands in its background. What happened in the year in the middle, and which books cover it, is a separate window (#whenInfo). One store (state/time.ts) so other layers can follow it. */
export function initWhen() {
  const el = $('when');
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };
  const book = () => BOOKS.find((b) => b.id === getBook())!;
  const span = (b: { from: number; to: number }) => (b.from === b.to ? fmt(b.from) : `${b.from}–${fmt(b.to)}`);
  const wheel = mk('div', 't-wheel'), bg = mk('div', 't-bg'), pill = mk('div', 't-label');
  wheel.tabIndex = 0; wheel.role = 'slider'; wheel.ariaLabel = 'Year (AC)';
  const info = mk('div', 'card'), infoHead = mk('div', 'wi-head'), infoBody = mk('div', 'wi-body');
  info.id = 'whenInfo'; info.hidden = true;
  const more = mk('a', 'wi-more');
  more.target = '_blank'; more.rel = 'noopener';
  info.append(infoHead, infoBody);
  document.body.append(info);

  // eras and books: flat bands behind the drum, from the middle between two stops to the next
  const last = YEARS.length - 1;
  const ctx = document.createElement('canvas').getContext('2d')!;
  const textW = (t: string, font: string, size: number, spacing = 0.06) => { ctx.font = font; return ctx.measureText(t).width + t.length * spacing * size + 14; };
  const edges = (r: { from: number; to: number }): [number, number] | null => {
    const i0 = YEARS.findIndex((y) => y >= r.from), i1 = YEARS.filter((y) => y <= r.to).length - 1;
    if (i0 < 0 || i1 < i0) return null;
    return [i0 ? (X[i0] + X[i0 - 1]) / 2 : X[0] - STEP / 2, i1 < last ? (X[i1] + X[i1 + 1]) / 2 : X[last] + STEP / 2];
  };
  const band = (r: { from: number; to: number }, cls: string, text: string, w: number, style: string, range = edges(r)) => {
    if (!range) return [];
    const el = mk('div', cls), name = mk('span', 't-era-name', text);
    el.style.cssText = style;
    el.append(name); bg.append(el);
    return [{ r, el, name, xl: range[0], xr: range[1], w }];
  };
  const bands = ERAS.flatMap((era, n) => band(era, `t-era lane-${era.lane}`, era.name, textW(era.name.toUpperCase(), `600 ${era.lane === 'a' ? 12 : 9}px sans-serif`, era.lane === 'a' ? 12 : 9), `--h:${n * 41}`));
  // books at their years; books that overlap in time stack in rows, the others share one
  const rows: number[] = [];
  const bookBands = BOOKS.flatMap((b) => {
    let row = 0;
    while ((rows[row] ?? -Infinity) >= b.from) row++;
    rows[row] = b.to;
    return band(b, 't-book', b.label, textW(b.label, '600 11px sans-serif', 11, 0.04), `top:${44 + row * 17}px;--h:${BOOKS.indexOf(b) * 53}`).map((x) => { x.el.dataset.book = b.id; x.el.title = `${b.label}, ${span(b)}`; return x; });
  });
  const wheelH = 44 + rows.length * 17 + 36; // eras, the book rows, then the years
  wheel.style.height = wheelH + 'px';
  document.documentElement.style.setProperty('--wheel-h', wheelH + 'px');
  const items = YEARS.map((y, i) => mk('span', 't-y' + (y % 10 === 0 || (i && y - YEARS[i - 1] > 1) ? ' big' : '') + (EVENT_YEARS.has(y) ? ' ev' : '') + (y < 0 ? ' bc' : ''), String(Math.abs(y))));
  wheel.append(bg, mk('i', 't-mark'), ...items, pill);
  el.replaceChildren(wheel);

  /** The wheel stop of the moment: its chapter's year, else its book's first. */
  const momentYear = () => stopOf({ from: yearOf() ?? book().from });
  let pos = X[YEARS.indexOf(momentYear())], vel = 0, target: number | null = null, dragging = false, running = false, year: number = momentYear(), radius = 400, half = 400, zoom = 1; // zoom: px per drum px, set by the mouse wheel
  const draw = () => {
    bg.style.transform = `translateX(${-pos * zoom}px)`;
    const mid = pos * zoom;
    for (const { r, el, name, xl, xr, w } of [...bands, ...bookBands]) { // the name shows only where it fits whole in the visible part of its band
      const l = xl * zoom, rr = xr * zoom, a = Math.max(l, mid - half), b = Math.min(rr, mid + half), ok = b - a >= w;
      el.style.left = l + 'px'; el.style.width = rr - l + 'px';
      name.style.visibility = ok ? 'visible' : 'hidden';
      if (ok) name.style.transform = `translateX(${(a + b) / 2 - l}px) translateX(-50%)`;
      el.classList.toggle('on', el.dataset.book ? el.dataset.book === getBook() : year >= r.from && year <= r.to);
    }
    wheel.classList.toggle('far', zoom < 0.7);
    items.forEach((it, i) => {
      const t = ((X[i] - pos) * zoom) / radius, c = Math.cos(t), far = Math.abs(t) >= 1.4;
      if (far && it.style.visibility === 'hidden') return;
      it.style.visibility = far ? 'hidden' : 'visible';
      it.style.transform = `translateX(${radius * Math.sin(t)}px) scaleY(${0.35 + 0.65 * c})`;
      it.style.opacity = String(Math.max(0, c * c));
      it.classList.toggle('on', YEARS[i] === year);
    });
  };
  new ResizeObserver(() => { half = wheel.clientWidth / 2; radius = Math.max(220, half); draw(); }).observe(wheel);

  const showYear = () => {
    const cur = book(), covered = year >= cur.from && year <= cur.to;
    pill.textContent = fmt(year);
    wheel.ariaValueText = fmt(year);
    const here = EVENTS.filter((e) => (year >= e.from && year <= (e.to ?? e.from)) || stopOf(e) === year);
    infoHead.textContent = covered ? `${fmt(year)} · ${cur.label}` : fmt(year);
    infoBody.replaceChildren(...here.flatMap((e) => [
      mk('h3', 'wi-ev', (e.ca ? 'ca. ' : '') + e.title + (e.to ? ` (${span({ from: e.from, to: e.to })})` : e.from !== year ? ` (${fmt(e.from)})` : '')),
      mk('p', 'wi-text', e.text),
    ]), ...(here.length ? [mk('p', 'wi-credit', 'Wiki of Ice and Fire, Timeline of major events (CC BY-SA)')] : []), more);
    info.scrollTop = 0;
    more.href = WIKI_YEAR(year); more.textContent = `${fmt(year)} on the wiki`;
  };
  const tick = () => {
    if (!dragging) {
      if (target !== null) { pos += (target - pos) * 0.2; if (Math.abs(target - pos) < 0.4) { pos = target; target = null; } }
      else if (Math.abs(vel) > 0.4) { pos += vel; vel *= 0.94; } else { vel = 0; target = X[nearest(pos)]; }
    }
    pos = Math.min(X[X.length - 1], Math.max(0, pos));
    const y = YEARS[nearest(pos)];
    if (y !== year) {
      year = y;
      const cur = book();
      if (!target || dragging) { const b = year < cur.from || year > cur.to ? BOOKS.find((k) => year >= k.from && year <= k.to) : null; if (b) setPeriod(b.id); }
      showYear();
    }
    draw();
    running = dragging || target !== null || Math.abs(vel) > 0.4;
    if (running) requestAnimationFrame(tick);
  };
  const go = () => { if (!running) { running = true; requestAnimationFrame(tick); } };

  let lastX = 0, downX = 0, downEl: Element | null = null;
  wheel.onpointerdown = (e) => { downX = lastX = e.clientX; downEl = e.target as Element; dragging = true; target = null; vel = 0; wheel.setPointerCapture(e.pointerId); wheel.classList.add('drag'); go(); };
  wheel.onpointermove = (e) => { if (!dragging) return; vel = ((lastX - e.clientX) / zoom) * 1.1; pos += vel; lastX = e.clientX; };
  wheel.onpointerup = wheel.onpointercancel = (e) => {
    const id = (downEl as HTMLElement | null)?.closest<HTMLElement>('[data-book]')?.dataset.book; // a tap on a book's area picks it
    if (id && e.type === 'pointerup' && Math.abs(e.clientX - downX) < 5) setPeriod(id as never);
    dragging = false; wheel.classList.remove('drag'); go(); };
  wheel.addEventListener('wheel', (e) => { // sideways scroll (trackpad, shift) turns the years; up and down zooms them
    e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { target = null; vel += (e.deltaX / zoom) * 0.12; go(); return; }
    zoom = Math.min(2.5, Math.max(0.3, zoom * Math.exp(-e.deltaY * 0.0015))); go(); draw();
  }, { passive: false });
  wheel.onkeydown = (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (d) { e.preventDefault(); target = X[Math.min(X.length - 1, Math.max(0, nearest(pos) + d))]; go(); }
  };

  // the book changed (a chip, the address): spin to its first year unless it covers the one in the middle
  const sync = () => {
    const cur = book();
    if (year < cur.from || year > cur.to) { target = X[YEARS.indexOf(momentYear())]; vel = 0; go(); }
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
    q('.h-facts').replaceChildren(...row('Seat', seat), ...(h.head ? row('Head', h.head) : []), ...(h.region ? row('Region', h.region.replace(/^the /i, '')) : []), ...row('Sworn houses', realm ? String(realm) : 'None'));
    const lordBox = q('.h-lord'), swornBox = q('.h-sworn');
    lordBox.hidden = !lord; swornBox.hidden = !sworn.length;
    lordBox.querySelector('.h-chip')?.remove();
    if (lord) lordBox.append(chip(lord, () => o.flyTo(lord.id)));
    swornBox.querySelector('.h-list')!.replaceChildren(...sworn.sort((a, b) => shown(a).localeCompare(shown(b))).map((v) => chip(v, () => o.flyTo(v.id))));
    q('.h-note').textContent = h.seatOf ? `Shares its seat with ${g.by.get(h.seatOf)?.name ?? 'another house'}, whose land is shown.` : lord ? '' : 'Answers to no liege at this time (the wiki names none).';
    q('.h-note').hidden = !q('.h-note').textContent;
    q<HTMLAnchorElement>('.h-wiki').href = WIKI + encodeURIComponent(h.title.replaceAll(' ', '_'));
    card.scrollTop = 0; card.querySelector('.h-body')!.scrollTop = 0;
  };
  q('.close').onclick = o.onClose;
  onPeriod(() => { if (o.layer.focused) show(o.layer.focused); });
  return { show, hide: () => show(null) };
}
