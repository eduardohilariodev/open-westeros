import type { MeasureState } from '../globe/measure';
import { imperial, landLeagues, metric, nautical, PACES, seaLeagues, travelTime } from '../measureUnits';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const row = (k: string, v: string, title = '') => `<div${title ? ` title="${esc(title)}"` : ''}><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;

/** The wool's results card: legs, the total in many units, and how long the trip takes at each pace. */
export function initMeasurePanel(wool: { setActive(on: boolean): void; undo(): void; clear(): void; active: boolean; onChange: (s: MeasureState) => void }, onStart: () => void) {
  const panel = $('measure'), btn = $('measureBtn');
  const hint = panel.querySelector<HTMLElement>('.m-hint')!, legs = panel.querySelector<HTMLElement>('.m-legs')!, body = panel.querySelector<HTMLElement>('.m-body')!;
  const total = panel.querySelector<HTMLElement>('.m-total')!, units = panel.querySelector<HTMLElement>('.m-units')!, paces = panel.querySelector<HTMLElement>('.m-paces')!;

  wool.onChange = ({ legs: ls, total: m, active }) => {
    btn.setAttribute('aria-pressed', String(active));
    panel.hidden = !active && !ls.length;
    hint.hidden = !active;
    hint.textContent = !ls.length && !active ? '' : active
      ? (ls.length ? 'Click the next place to stretch the wool on. Esc to finish.' : 'Click a place or the ground to start the wool.')
      : '';
    if (active && !ls.length) hint.textContent = 'Click a place or the ground to start the wool.';
    legs.innerHTML = ls.map((l) => `<li${l.live ? ' class="live"' : ''}><span>${esc(l.from)} → ${esc(l.to)}</span><b>${metric(l.m)}</b></li>`).join('');
    const pinned = ls.some((l) => !l.live); // the total and its units count pinned legs only; the cursor's leg is just shown
    body.hidden = !pinned;
    if (!pinned) return;
    total.innerHTML = `<span>Total</span><b>${metric(m)}</b>`;
    units.innerHTML = [
      row('Metric', metric(m)), row('Imperial', imperial(m)), row('Nautical', nautical(m)),
      row('Leagues', landLeagues(m), '1 land league = 3 miles'), row('Sea leagues', seaLeagues(m), '1 sea league = 3 nautical miles'),
    ].join('');
    paces.innerHTML = PACES.map((p) => row(p.name, travelTime(m, p.kmh), `${p.kmh} km/h: ${p.note}`)).join('');
  };
  btn.onclick = () => { if (!wool.active) onStart(); wool.setActive(!wool.active); }; // measuring and focusing a place exclude each other
  $('measureUndo').onclick = () => wool.undo();
  $('measureClear').onclick = () => wool.clear();
  $('measureClose').onclick = () => { wool.setActive(false); wool.clear(); };
}
