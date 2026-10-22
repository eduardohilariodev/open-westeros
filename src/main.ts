import * as THREE from 'three';
import { inject } from '@vercel/analytics';
import { createGlobeView } from './globe/GlobeView';
import { PLACE_ICONS, PLACE_KINDS } from './globe/placeIcons';
import { isOpen, onClose, showCard } from './ui/placePanel';
import { createSites } from './sites/handoff';
import type { SiteView } from './sites/SiteScene';
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
$('showBorders').addEventListener('change', (e) => globe.setBordersVisible((e.target as HTMLInputElement).checked));
// Terrain button (top of the nav): 3D relief or the flat parchment map. The page starts in 3D, see the await below.
// Like Google Maps' layer button, it shows a thumbnail of the style a click switches to (style.css picks it by aria-pressed).
const reliefBtn = $('reliefBtn');
const showStyle = (on: boolean) => {
  reliefBtn.setAttribute('aria-pressed', String(on));
  reliefBtn.title = on ? 'Switch to the flat map' : 'Switch to 3D relief';
  reliefBtn.querySelector('.name')!.textContent = on ? 'Map' : 'Relief';
  globe.relief.setEnabled(on);
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
  if (isOpen()) { globe.deselect(); document.body.classList.add('drawer-open'); }
  else document.body.classList.toggle('drawer-open');
};
const nav = initNav(renderer.domElement, () => globe.nav);
initMeasurePanel(globe.wool);

// Search: every place name on the map.
const mapItems = globe.places.map((p, i) => ({ label: p.name, kind: p.kind, i }));
const search = $('search') as HTMLInputElement;
const results = $('results');
const kindLabel = Object.fromEntries(PLACE_KINDS);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
let shown: typeof mapItems = [];
let active = 0;
const setActive = (n: number) => {
  active = n;
  [...results.children].forEach((li, k) => li.classList.toggle('on', k === n));
  results.children[n]?.scrollIntoView({ block: 'nearest' });
};
const closeResults = () => { results.hidden = true; search.setAttribute('aria-expanded', 'false'); };
const go = (m: (typeof mapItems)[number]) => { globe.flyToPlace(m.i); search.value = ''; search.blur(); closeResults(); };
const renderResults = () => {
  const q = search.value.trim().toLowerCase();
  if (!q) return closeResults();
  const at = (m: (typeof mapItems)[number]) => m.label.toLowerCase().indexOf(q);
  // names starting with the query first, then those containing it, then alphabetical
  shown = mapItems.filter((m) => at(m) >= 0)
    .sort((a, b) => (at(a) > 0 ? 1 : 0) - (at(b) > 0 ? 1 : 0) || a.label.localeCompare(b.label)).slice(0, 8);
  results.innerHTML = shown.length
    ? shown.map((m, k) => {
      const i = at(m), l = m.label;
      return `<li role="option" data-k="${k}"><svg class="k-${m.kind}" viewBox="0 0 512 512">${PLACE_ICONS[m.kind]}</svg>` +
        `<span class="nm">${esc(l.slice(0, i))}<mark>${esc(l.slice(i, i + q.length))}</mark>${esc(l.slice(i + q.length))}</span>` +
        `<span class="kd">${kindLabel[m.kind] ?? ''}</span></li>`;
    }).join('')
    : '<li class="none">No such place in the known world</li>';
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
    setTimeout(() => el.remove(), 500);
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
