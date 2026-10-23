import * as THREE from 'three';
import { inject } from '@vercel/analytics';
import { createGlobeView } from './globe/GlobeView';
import { PLACE_ICONS, PLACE_KINDS } from './globe/placeIcons';
import { isOpen, onClose, onNavigate, showCard } from './ui/placePanel';
import { createSites } from './sites/handoff';
import { GLOBE_KIND, type SiteView } from './sites/SiteScene';
import { initMeasurePanel } from './ui/measurePanel';
import { initNav } from './ui/nav';

// Initialize Vercel Web Analytics
inject();

// One renderer, several scenes: the planet (planet-centred frame) and one local scene per 3D place.
// Zooming close to such a place on the globe hands the camera over to its scene, and back.
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.autoClear = false; // the globe's pass clears; the site scene is drawn over it
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const $ = (id: string) => document.getElementById(id)!;

// Loading overlay: covers the canvas until the first frame is rendered. Heavy setup is synchronous,
// so yield a frame to let the message paint.
$('loadMsg').textContent = 'Building the globe…';
await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));

const globe = createGlobeView(renderer, $('globeLabels'), showCard);
onClose(() => globe.deselect());

// 3D place scenes (and their models) load on demand, the first time the camera zooms in on them.
const sites = createSites(renderer, globe, showCard);

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
const legendBoxes = PLACE_KINDS.filter(([kind]) => globe.kindCounts[kind]).map(([kind, label]) => {
  const row = document.createElement('label');
  row.className = 'legend-row';
  row.innerHTML = `<span class="what"><input type="checkbox" checked /><svg class="k-${kind}" viewBox="0 0 512 512">${PLACE_ICONS[kind]}</svg>${label}</span><span class="n">${globe.kindCounts[kind]}</span>`;
  const box = row.querySelector('input')!;
  box.addEventListener('change', () => globe.setKindVisible(kind, box.checked));
  $('legend').append(row);
  return { kind, box };
});
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

// Search: every place name on the map, plus the places inside any 3D site that has loaded (Winterfell's keeps, gates...). Fuzzy.
type Item = { label: string; kind: string; go: () => void };
const mapItems: Item[] = globe.places.map((p, i) => ({ label: p.name, kind: p.kind, go: () => globe.flyToPlace(i) }));
const siteItems = (): Item[] => sites.views().flatMap((v) => v.labelObjs.map(({ place: p }) => ({ label: p.name, kind: GLOBE_KIND[p.kind] ?? 'town', go: () => v.onPick(p) })));
const search = $('search') as HTMLInputElement;
const results = $('results');
const kindLabel = Object.fromEntries(PLACE_KINDS);
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
const score = (label: string, q: string) => {
  let sum = 0;
  for (const t of q.split(/\s+/)) { const x = scoreTerm(label, t); if (x < 0) return -1; sum += x; }
  return sum;
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
  shown = [...siteItems(), ...mapItems].map((m) => ({ m, sc: score(m.label, q) })).filter((x) => x.sc >= 0)
    .sort((a, b) => a.sc - b.sc || a.m.label.localeCompare(b.m.label)).slice(0, 8).map((x) => x.m);
  results.innerHTML = shown.length
    ? shown.map((m, k) => {
      const l = m.label, i = fold(l).indexOf(q); // the matched letters are marked when the query is a plain substring
      const name = i >= 0 && fold(l).length === l.length ? `${esc(l.slice(0, i))}<mark>${esc(l.slice(i, i + q.length))}</mark>${esc(l.slice(i + q.length))}` : esc(l);
      return `<li role="option" data-k="${k}"><svg class="k-${m.kind}" viewBox="0 0 512 512">${PLACE_ICONS[m.kind]}</svg>` +
        `<span class="nm">${name}</span><span class="kd">${kindLabel[m.kind] ?? ''}</span></li>`;
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
$('loadMsg').textContent = 'Loading terrain…';
const bar = $('loadFill');
const tick = setInterval(() => { bar.style.width = `${10 + 85 * globe.relief.progress()}%`; }, 100);
await globe.relief.ready;
clearInterval(tick);

let ready = false;
let last = performance.now();
const debug = $('debug');
debug.hidden = !import.meta.env.DEV;
let fps = 60;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // The globe is the only view. A 3D place loads as the camera nears it and is drawn over the globe from the camera's own
  // pose, faded in over the last stretch of its draw distance.
  globe.update(dt, now);
  $('loadHint').hidden = !sites.update();
  globe.setSky();
  renderer.render(globe.scene, globe.camera); // clears to the sky colour; the site is drawn over it
  globe.labels.render(globe.scene, globe.camera);
  sites.render();
  if (pendingStyle !== null) { crossfade(pendingStyle); pendingStyle = null; } // after the whole frame, so the copy is complete
  nav.update();
  if (import.meta.env.DEV) {
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
    const n = globe.nav, c = n.pick(new THREE.Vector2(0, 0)), deg = THREE.MathUtils.radToDeg;
    debug.textContent = [
      sites.drawnId() ?? 'globe',
      c ? `centre ${c.lat.toFixed(2)}°, ${c.lon.toFixed(2)}°` : 'centre: sky',
      `alt ${(n.altitude() / 1000).toFixed(1)} km`,
      `tilt ${deg(n.tilt()).toFixed(1)}°`,
      `heading ${((deg(n.heading()) % 360) + 360) % 360 | 0}°`,
      `${n.metresPerPixel().toFixed(0)} m/px`,
      `${fps.toFixed(0)} fps`,
      `${renderer.info.render.calls} calls`,
    ].join('  |  ');
  }
  if (!ready) { // first frame is on screen: reveal the world
    ready = true;
    $('loadFill').style.width = '100%';
    const el = $('loading');
    el.classList.add('done');
    setTimeout(() => el.remove(), 1500); // after the 1.4 s fade (style.css #loading)
  }
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  for (const v of [globe, ...sites.views()] as (typeof globe | SiteView)[]) {
    v.camera.aspect = innerWidth / innerHeight;
    v.camera.updateProjectionMatrix();
    v.labels.setSize(innerWidth, innerHeight);
  }
});
globe.labels.setSize(innerWidth, innerHeight);

// credits dialog
const creditsDlg = document.getElementById("credits") as HTMLDialogElement;
document.getElementById("creditsBtn")!.addEventListener("click", () => creditsDlg.showModal());
creditsDlg.addEventListener("click", (e) => { if (e.target === creditsDlg) creditsDlg.close(); });
