import * as THREE from 'three';
import { inject } from '@vercel/analytics';
import { createGlobeView } from './globe/GlobeView';
import { PLACE_ICONS, PLACE_KINDS } from './globe/placeIcons';
import { isOpen, onClose, onHouse, onModel, onNavigate, showCard } from './ui/placePanel';
import { showCharacter } from './ui/characterPanel';
import { initHousePanel, initWhen, sigilUrl } from './ui/housePanel';
import { momentFromSearch, setMoment, START } from './state/time';
import type { House } from './houseGraph';
import houseData from './houses.json';
import { CHARACTERS } from './character-info';
import { GLOBE_KIND, type Place, type SiteView } from './sites/SiteScene';
import { closeModel, modelOpen, modelViews, onModelPick, onModelShow, openModel } from './ui/modelViewer';
import { SITES, type SiteId } from './config';
import { PLACE_INFO } from './place-info';
import PLACE_ALT from './place-alt.json';
import { initMeasurePanel } from './ui/measurePanel';
import { initNav } from './ui/nav';
import { Q } from './quality';

// Built only: the service worker keeps fetched files for the next visit (public/sw.js); the dev server always serves fresh ones.
declare const __BUILD__: string;
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js?v=${__BUILD__}`);

// Initialize Vercel Web Analytics
inject();

// The globe's renderer. The 3D places have their own, in the full-screen model view (ui/modelViewer.ts).
const renderer = new THREE.WebGLRenderer({ antialias: Q.aa, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault()); // lets the browser restore the context instead of leaving a dead canvas
const MAX_RATIO = Math.min(devicePixelRatio, Q.ratio);
renderer.setPixelRatio(MAX_RATIO);
renderer.setSize(innerWidth, innerHeight);
renderer.autoClear = false; // the globe's pass clears (its background colour)
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const $ = (id: string) => document.getElementById(id)!;

// Loading overlay: covers the canvas until the first frame is rendered. Heavy setup is synchronous,
// so yield a frame to let the message paint.
await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));

const globe = createGlobeView(renderer, $('globeLabels'), showCard);
onClose(() => globe.deselect());

// 3D places open in their own full-screen view from the card's "3D model" button; their models load the first time.
const SITE_IDS = Object.keys(SITES) as SiteId[];
const KIND_NAME = Object.fromEntries(PLACE_KINDS.map(([k, , one]) => [k, one]));
const siteOf = (name: string) => SITE_IDS.find((id) => SITES[id].name === name);
/** The card of a building in a 3D place: the wiki's passage (place-info.ts) when it has one, the hand-written lore otherwise. */
const showSitePlace = (v: SiteView, p: Place) =>
  showCard({ kind: KIND_NAME[GLOBE_KIND[p.kind]] ?? p.kind, name: p.name, text: PLACE_INFO[p.name]?.summary ? undefined : v.lore[p.name] });
onModelPick((_id, v, p) => showSitePlace(v, p));
onModel((c) => {
  const id = siteOf(c.name) ?? modelViews().find(([, v]) => v.labelObjs.some((l) => l.place.name === c.name))?.[0];
  return id ? () => void openModel(id, siteOf(c.name) ? undefined : c.name) : null;
});

$('showNames').addEventListener('change', (e) => globe.setNamesVisible((e.target as HTMLInputElement).checked));
// Terrain button (top of the nav): 3D relief or the flat parchment map. The page starts in 3D, see the await below.
// Like Google Maps' layer button, it shows a thumbnail of the style a click switches to (style.css picks it by aria-pressed).
const reliefBtn = $('reliefBtn');
const showStyle = (on: boolean) => {
  reliefBtn.setAttribute('aria-pressed', String(on));
  reliefBtn.title = on ? 'Switch to the flat map' : 'Switch to 3D relief';
  reliefBtn.querySelector('.name')!.textContent = on ? 'Map' : 'Relief';
  pendingStyle = on; // swapped after the next frame is drawn, see crossfade()
};
let pendingStyle: boolean | null = null;
// Map types crossfade: the frame just drawn is copied to a canvas laid over the globe, the style swaps under it, and the copy fades away.
const fader = document.createElement('canvas');
fader.id = 'styleFade';
renderer.domElement.after(fader);
const crossfade = (on: boolean) => {
  const c = renderer.domElement;
  fader.width = c.width; fader.height = c.height;
  fader.getContext('2d')!.drawImage(c, 0, 0);
  fader.style.transition = 'none';
  fader.style.opacity = '1';
  globe.relief.setEnabled(on);
  void fader.offsetWidth; // commit the opaque copy before the fade starts
  fader.style.transition = 'opacity .7s ease-in-out';
  fader.style.opacity = '0';
};
reliefBtn.onclick = () => showStyle(reliefBtn.getAttribute('aria-pressed') !== 'true');
reliefBtn.querySelector('.name')!.textContent = 'Map';

// Legend: one row per kind of name (symbol, colour, count) with a checkbox to show or hide that kind.
const legendBoxes = PLACE_KINDS.filter(([kind]) => globe.kindCounts[kind]).sort((a, b) => a[1].localeCompare(b[1])).map(([kind, label]) => {
  const row = document.createElement('label');
  row.className = 'legend-row';
  row.innerHTML = `<span class="what"><input type="checkbox" checked /><svg class="k-${kind}" viewBox="0 0 512 512">${PLACE_ICONS[kind]}</svg>${label}</span><span class="n">${globe.kindCounts[kind]}</span>`;
  const box = row.querySelector('input')!;
  box.addEventListener('change', () => globe.setKindVisible(kind, box.checked));
  $('legend').append(row);
  return { kind, box };
});
const OFF_AT_START = ['battle']; // kinds that start unchecked
legendBoxes.forEach(({ kind, box }) => { if (OFF_AT_START.includes(kind)) { box.checked = false; globe.setKindVisible(kind, false); } });
const setAllKinds = (on: boolean) => legendBoxes.forEach(({ kind, box }) => { box.checked = on; globe.setKindVisible(kind, on); });
$('legendAll').onclick = () => setAllKinds(true);
$('legendNone').onclick = () => setAllKinds(false);

if (import.meta.env.DEV) document.title += ' (dev)';

$('menuBtn').onclick = () => { // with a place open, the menu closes it and brings the drawer back
  closeResults(); // the menu and the search results are never open together
  if (isOpen()) { globe.deselect(); document.body.classList.add('drawer-open'); }
  else document.body.classList.toggle('drawer-open');
};
const nav = initNav(renderer.domElement, () => globe.nav);
initMeasurePanel(globe.wool, () => globe.deselect());

// Search: every place name on the map, plus the places inside any 3D site opened so far (Winterfell's keeps, gates...). Fuzzy.
type Item = { label: string; kind: string; go: () => void; img?: string; alt?: string[] };
/** Other names a place is searched by: its Dothraki or original name (place-alt.json) and its wiki article's title ("Gift" for Brandon's Gift). */
const aliases = (name: string) => {
  const w = PLACE_INFO[name]?.wiki?.replace(/_/g, ' ').replace(/ \(.*\)$/, '');
  return [(PLACE_ALT as Record<string, string>)[name], w].filter((a): a is string => !!a && a !== name);
};
const mapItems: Item[] = globe.places.map((p, i) => ({ label: p.name, kind: p.kind, alt: aliases(p.name), go: () => { closeModel(); globe.flyToPlace(i); } })); // a place on the map closes the 3D model view
// A character: its journey on the map and its card (characterPanel.ts). Searched like a place.
const characterItems: Item[] = CHARACTERS.map((c) => ({ label: c.name, kind: 'character', go: () => { closeModel(); globe.deselect(); showCharacter(c, globe.characters); } }));
// The houses overlay (globe/houses.ts, ui/housePanel.ts): every house's land and borders, the coats of arms, and a house card, over either terrain look.
const modeBtns = [...document.querySelectorAll<HTMLButtonElement>('#modeSwitch button')]; // Regions | Houses, top right
// read before initWhen, which writes the address for the moment it shows
const linkedMoment = momentFromSearch(location.search);
setMoment(linkedMoment ?? START); // ?when=asos, asos-sansa-iv, s3e9: the moment every layer follows
const showTimeline = initWhen();
const housePanel = initHousePanel({
  layer: globe.houses,
  flyTo: (id) => globe.flyToHouse(id),
  goToSeat: (name) => mapItems.find((x) => fold(x.label) === fold(name))?.go(),
  onClose: () => globe.houses.focus(null),
});
let awakeUntil = performance.now() + 5000;
const wake = (ms = 1000) => { awakeUntil = Math.max(awakeUntil, performance.now() + ms); };
const setHouses = (on: boolean) => {
  globe.houses.setVisible(on);
  modeBtns.forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.mode === 'houses') === on)));
  wake();
};
modeBtns.forEach((b) => { b.onclick = () => setHouses(b.dataset.mode === 'houses'); });
const timelineBtn = $('timelineBtn');
const setTimeline = (on: boolean) => {
  showTimeline(on);
  document.body.classList.toggle('timeline-on', on);
  timelineBtn.setAttribute('aria-pressed', String(on));
  timelineBtn.title = on ? 'Hide the timeline' : 'Show the timeline';
  wake();
};
timelineBtn.onclick = () => setTimeline(!document.body.classList.contains("timeline-on"));
if (linkedMoment) setTimeline(true); // a ?when= link opens the timeline
globe.onHouseFocus((id) => { if (id) globe.clearPlace(); housePanel.show(id); wake(1500); }); // a house card and a place card are never open together
addEventListener('placeopen', () => globe.houses.focus(null));
const houseItems: Item[] = (houseData as unknown as House[]).map((h) => ({ label: h.name, kind: 'house', img: sigilUrl(h), go: () => { closeModel(); if (!globe.houses.visible) setHouses(true); globe.flyToHouse(h.id); } }));
onHouse((label, file) => {
  const stem = file.replace(/\.[^.]+$/, '');
  const h = (houseData as unknown as House[]).find((x) => x.name === label) ?? (houseData as unknown as House[]).find((x) => !x.seatOf && x.sigil.replace(/\.[^.]+$/, '') === stem);
  if (!h) return;
  closeModel(); if (!globe.houses.visible) setHouses(true); globe.flyToHouse(h.id);
});
const SHIELD ='<path d="M256 32 64 96v128c0 120 82 224 192 256 110-32 192-136 192-256V96z" />';
const siteItems = (): Item[] => modelViews().flatMap(([id, v]) => v.labelObjs.map(({ place: p }) => ({ label: p.name, kind: GLOBE_KIND[p.kind] ?? 'town', alt: aliases(p.name), go: () => { showSitePlace(v, p); void openModel(id, p.name); } })));
const search = $('search') as HTMLInputElement;
const results = $('results');
const kindLabel: Record<string, string> = { ...Object.fromEntries(PLACE_KINDS), character: 'Character', house: 'House' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const lev = (a: string, b: string) => {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
};
/** Lower is better, -1 no match: a word starts with the query, contains it, has its letters in order, or is a typo away (1 letter from 4, 2 from 7). */
const scoreTerm = (label: string, q: string) => {
  const l = fold(label), at = l.indexOf(q);
  if (at >= 0) return at === 0 || l[at - 1] === ' ' ? 0 : 1;
  let i = 0;
  for (const c of l) if (c === q[i]) i++;
  if (q.length > 1 && i === q.length) return 2;
  const room = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0;
  if (!room) return -1;
  const d = Math.min(lev(q, l.slice(0, q.length)), ...l.split(' ').map((w) => lev(q, w.slice(0, q.length))));
  return d <= room ? 3 + d : -1;
};
/** Every term of the query must match, in any order ("keep great" finds the Great Keep). */
const scoreOne = (label: string, q: string) => {
  let sum = 0;
  for (const t of q.split(/\s+/)) { const x = scoreTerm(label, t); if (x < 0) return -1; sum += x; }
  return sum;
};
/** The best of the name and its aliases; an alias costs a little, so the name itself wins a tie. `via` is the alias that matched. */
const score = (m: Item, q: string) => {
  let best = scoreOne(m.label, q), via: string | undefined;
  for (const a of m.alt ?? []) { const x = scoreOne(a, q); if (x >= 0 && (best < 0 || x + 0.5 < best)) { best = x + 0.5; via = a; } }
  return { sc: best, via };
};
// Names in the place card that are places on the map go there instead of to the wiki.
onNavigate((name) => {
  const n = fold(name), m = [...siteItems(), ...mapItems].find((x) => fold(x.label) === n);
  return m ? () => m.go() : null;
});
let shown: Item[] = [];
let active = 0;
const setActive = (n: number) => {
  active = n;
  [...results.children].forEach((li, k) => li.classList.toggle('on', k === n));
  results.children[n]?.scrollIntoView({ block: 'nearest' });
};
const closeResults = () => { results.hidden = true; search.setAttribute('aria-expanded', 'false'); };
const go = (m: Item) => { m.go(); search.value = ''; search.blur(); closeResults(); };
const renderResults = () => {
  const raw = search.value.trim(), q = fold(raw);
  if (!q) return closeResults();
  // best match first, then alphabetical
  const ranked = [...siteItems(), ...characterItems, ...houseItems, ...mapItems.filter((_, i) => !globe.placeGone(i))].map((m) => ({ m, ...score(m, q) })).filter((x) => x.sc >= 0)
    .sort((a, b) => a.sc - b.sc || a.m.label.localeCompare(b.m.label)).slice(0, 40);
  const hits = ranked.map((x) => x.via);
  shown = ranked.map((x) => x.m);
  results.innerHTML = shown.length
    ? shown.map((m, k) => {
      const via = hits[k], l = m.label, i = fold(l).indexOf(q); // the matched letters are marked when the query is a plain substring
      const name = i >= 0 && fold(l).length === l.length ? `${esc(l.slice(0, i))}<mark>${esc(l.slice(i, i + q.length))}</mark>${esc(l.slice(i + q.length))}` : esc(l);
      const icon = m.img ? `<img src="${m.img}" alt="" onerror="this.style.visibility='hidden'">` // a house shows its arms
        : `<svg class="k-${m.kind}" viewBox="0 0 512 512">${PLACE_ICONS[m.kind] ?? SHIELD}</svg>`;
      return `<li role="option" data-k="${k}">${icon}` +
        `<span class="nm">${name}${via ? ` <small>(${esc(via)})</small>` : ''}</span><span class="kd">${kindLabel[m.kind] ?? ''}</span></li>`;
    }).join('')
    : '<li class="none">No such place in the known world</li>';
  document.body.classList.remove('drawer-open'); // the menu and the search results are never open together
  results.hidden = false; search.setAttribute('aria-expanded', 'true');
  setActive(0);
};
search.addEventListener('input', renderResults);
search.addEventListener('focus', renderResults);
search.addEventListener('blur', () => setTimeout(closeResults, 120)); // after a click on a row has landed
search.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!shown.length) return;
    e.preventDefault();
    setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
  } else if (e.key === 'Enter' && shown[active] && !results.hidden) go(shown[active]);
  else if (e.key === 'Escape') { closeResults(); search.blur(); }
});
results.addEventListener('mousedown', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-k]');
  if (li) { e.preventDefault(); go(shown[+li.dataset.k!]); }
});

// Start in 3D: keep the loading screen up until the relief maps and mesh are in (on failure it resolves and stays flat).
await globe.relief.ready;
globe.relief.warm(renderer, globe.camera);
// A link with ?place=Name opens on that place.
// With &view=3d it opens that place's 3D model too: a site, or a building in one (each site is tried until one has it).
const params = new URLSearchParams(location.search), linked = params.get('place');
const linkedHouse = params.get('house');
if (linkedHouse) houseItems[(houseData as unknown as House[]).findIndex((h) => h.id === linkedHouse)]?.go(); // ?house=tully opens the overlay on that house
const linkedItem = linked ? mapItems.find((m) => fold(m.label) === fold(linked)) : undefined;
linkedItem?.go();
const linkedCharacter = params.get('character');
if (linkedCharacter) characterItems[CHARACTERS.findIndex((c) => c.id === linkedCharacter)]?.go(); // ?character=eddard opens that journey
if (linked && params.get('view') === '3d') void (async () => {
  if (siteOf(linkedItem?.label ?? '')) return void openModel(siteOf(linkedItem!.label)!);
  if (linkedItem) return;
  for (const id of SITE_IDS) {
    const v = await openModel(id, linked), p = v?.labelObjs.find((l) => fold(l.place.name) === fold(linked))?.place;
    if (p) return showSitePlace(v!, p);
  }
})();

let ready = false;
let last = performance.now();
const debug = $('debug');
debug.hidden = !import.meta.env.DEV;
const debugText = document.createElement('span'), debugBtn = document.createElement('button');
debugBtn.textContent = '–'; debugBtn.title = 'Minimise';
debugBtn.onclick = () => { const min = debug.classList.toggle('min'); debugBtn.textContent = min ? '+' : '–'; debugBtn.title = min ? 'Expand' : 'Minimise'; };
debug.append(debugBtn, debugText);
// what the pointer is doing, mirroring cameraRig: left press = click, left drag past 4 px = drag, shift+drag = rotate/tilt, two fingers = pinch/twist
let input = 'idle', pressAt: { x: number; y: number } | null = null, fingers = 0;
if (import.meta.env.DEV) {
  const opt = { capture: true, passive: true } as const;
  addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') fingers++; pressAt = { x: e.clientX, y: e.clientY }; input = fingers > 1 ? 'pinch/twist' : e.shiftKey ? 'rotating (shift)' : 'click'; }, opt);
  addEventListener('pointermove', (e) => {
    if (!e.buttons || !pressAt) return;
    if (fingers > 1) input = 'pinch/twist';
    else if (e.shiftKey) input = 'rotating (shift)';
    else if (Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) >= 4) input = 'dragging';
  }, opt);
  const up = (e: PointerEvent) => { if (e.pointerType === 'touch') fingers = Math.max(0, fingers - 1); if (!fingers) { pressAt = null; input = 'idle'; } };
  addEventListener('pointerup', up, opt); addEventListener('pointercancel', up, opt);
}
let fps = 60, cpuMs = 0;
if (import.meta.env.DEV) Object.assign(window, { __globe: globe, __renderer: renderer, __THREE: THREE, __wake: () => wake(60_000) }); // for profiling from the console: toggle layers, keep rendering

// Render on demand: a still globe costs nothing. The loop keeps running but only draws while something is awake: an input
// event (a drag counts, a bare mouse move does not), the camera moving, the measuring wool, a 3D place in view, and the
// first seconds (textures arrive on their own).
for (const t of ['pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup', 'input', 'change', 'click', 'resize', 'visibilitychange'])
  addEventListener(t, () => wake(), { capture: true, passive: true });
addEventListener('pointermove', (e) => { if (e.buttons) wake(); }, { capture: true, passive: true });
onModelShow((open) => { if (!open) wake(); }); // the globe sleeps under the 3D model view and is drawn again when it closes

// Slow GPUs, in order: while the camera moves the ground shader goes lean (no fine procedural detail, `relief.lean`) at full
// resolution; only if frames still run long does the canvas shrink to `moveRatio`. Both undo after two quiet seconds of fast
// frames, and a camera at rest (150 ms) is redrawn rich and at full ratio, which costs one frame now the loop is on demand.
const cam = globe.camera, lastPos = new THREE.Vector3(), lastQuat = new THREE.Quaternion();
const MIN_MOVE_RATIO = Math.min(MAX_RATIO, 0.75); // never blurrier than this: a safety net for slow GPUs, not the way to be fast
let ratio = MAX_RATIO, moveRatio = MAX_RATIO, lean = false, movedAt = -1e9, frameMs = 16.7, fastFrames = 0;
renderer.setAnimationLoop((now) => {
  if ((ready && modelOpen()) || (now >= awakeUntil && !globe.wool.active && !globe.characters.busy)) { last = now; return; } // the first frame is drawn even under the 3D model view, to lift the loading screen
  const cpu0 = performance.now(), gap = now - last;
  const dt = Math.min(0.1, gap / 1000);
  last = now;
  globe.update(dt, now);
  globe.setSky();
  // moved = by more than ~1% of a pixel (the zoom's ease creeps for seconds at float precision); drift adds up against the last position that counted
  const step = globe.nav.altitude() * 4e-6;
  if (cam.position.distanceToSquared(lastPos) > step * step || cam.quaternion.angleTo(lastQuat) > 1e-5) { lastPos.copy(cam.position); lastQuat.copy(cam.quaternion); movedAt = now; wake(700); }
  const moving = now - movedAt < 150;
  if (moving && gap < 100) { // frame interval while moving, to size the canvas for the machine
    frameMs += (gap - frameMs) * 0.1;
    if (frameMs > 24 && (!lean || moveRatio > MIN_MOVE_RATIO)) {
      if (!lean) lean = true; else moveRatio = Math.max(MIN_MOVE_RATIO, moveRatio - 0.125);
      frameMs = 16.7; fastFrames = 0;
    } else if (frameMs < 18 && ++fastFrames > 120 && (lean || moveRatio < MAX_RATIO)) {
      if (moveRatio < MAX_RATIO) moveRatio = Math.min(MAX_RATIO, moveRatio + 0.125); else lean = false;
      fastFrames = 0;
    } else if (frameMs >= 18) fastFrames = 0;
  }
  const want = moving ? moveRatio : MAX_RATIO;
  if (want !== ratio) { ratio = want; renderer.setPixelRatio(ratio); }
  globe.relief.lean = moving && lean;
  renderer.render(globe.scene, globe.camera); // clears to the sky colour
  globe.labels.render(globe.scene, globe.camera);
  if (pendingStyle !== null) { crossfade(pendingStyle); pendingStyle = null; } // after the whole frame, so the copy is complete
  nav.update();
  cpuMs += (performance.now() - cpu0 - cpuMs) * 0.05;
  if (import.meta.env.DEV) {
    if (gap < 100) fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
    const n = globe.nav, c = n.pick(new THREE.Vector2(0, 0)), deg = THREE.MathUtils.radToDeg;
    debugText.textContent = [
      [
        c ? `centre ${c.lat.toFixed(2)}°, ${c.lon.toFixed(2)}°` : 'centre: sky',
        `alt ${(n.altitude() / 1000).toFixed(1)} km`,
        `tilt ${deg(n.tilt()).toFixed(1)}°`,
        `heading ${((deg(n.heading()) % 360) + 360) % 360 | 0}°`,
        `${n.metresPerPixel().toFixed(0)} m/px`,
      ].join('  |  '),
      [
        `input ${input}`,
        `${fps.toFixed(0)} fps`,
        `cpu ${cpuMs.toFixed(1)} ms`,
        `ratio ${ratio.toFixed(2)} (moving ${moveRatio.toFixed(2)})${lean ? ' lean' : ''}`,
        `${renderer.info.render.calls} calls`,
      ].join('  |  '),
    ].join('\n');
  }
  if (!ready) { // first frame is on screen: reveal the world
    ready = true;
    // The loading screen is held for at least MIN_LOAD_MS so the coin gets its turns. Then the finale starts as a throw begins:
    // the veil clears while the coin rises spinning, and at the top it falls on into the world (style.css #coinStage.fall).
    // Both steps follow the coin's own animation clock, frame by frame: a timer would fire late while the page is busy, with the coin mid-air.
    const MIN_LOAD_MS = 3200, APEX = 0.42, LAUNCH = 0.1; // APEX: where coin-toss peaks, as a share of its cycle; LAUNCH: how far into a throw still counts as its start
    const el = $('loading'), stage = $('coinStage'), toss = stage.querySelector('.toss')!.getAnimations()[0];
    const fall = () => {
      const r = stage.querySelector('.coin')!.getBoundingClientRect();
      stage.style.setProperty('--y0', getComputedStyle(stage.querySelector('.toss')!).translate.split(' ')[1] || '0px'); // where the coin is in its throw
      stage.style.setProperty('--dy', `${innerHeight / 2 - (r.top + r.height / 2)}px`); // from there to the middle of the screen, where the globe is
      stage.classList.add('fall');
      setTimeout(() => el.remove(), 900);
    };
    if (toss) {
      const { delay, duration } = toss.effect!.getComputedTiming(), cycle = +duration!;
      let launched = -1;
      const follow = () => {
        const t = (+toss.currentTime! - +delay!) / cycle, k = Math.floor(t), phase = t - k;
        if (launched < 0) {
          if (t >= 0 && phase < LAUNCH && performance.now() >= MIN_LOAD_MS) { launched = k; el.classList.add('done'); }
        } else if (phase >= APEX || k > launched) return fall();
        requestAnimationFrame(follow);
      };
      requestAnimationFrame(follow);
    } else { el.classList.add('done'); setTimeout(() => el.remove(), 1700); }
  }
});

// The bottom sheets on a phone (style.css): their height goes to --sheet-h so the round buttons ride above them.
const sheets = [$('place'), $('measure'), $('house')];
const syncSheet = () => document.documentElement.style.setProperty('--sheet-h', `${Math.max(0, ...sheets.map((el) => (el.hidden ? 0 : el.offsetHeight)))}px`);
const sheetWatch = new ResizeObserver(syncSheet);
sheets.forEach((el) => sheetWatch.observe(el));

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  globe.camera.aspect = innerWidth / innerHeight;
  globe.camera.updateProjectionMatrix();
  globe.labels.setSize(innerWidth, innerHeight);
});
globe.labels.setSize(innerWidth, innerHeight);

// credits dialog
const creditsDlg = document.getElementById("credits") as HTMLDialogElement;
document.getElementById("creditsBtn")!.addEventListener("click", () => creditsDlg.showModal());
creditsDlg.addEventListener("click", (e) => { if (e.target === creditsDlg) creditsDlg.close(); });

// contribute dialog
const contributeDlg = document.getElementById("contribute") as HTMLDialogElement;
document.getElementById("contributeBtn")!.addEventListener("click", () => contributeDlg.showModal());
contributeDlg.addEventListener("click", (e) => { if (e.target === contributeDlg) contributeDlg.close(); });
