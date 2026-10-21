import * as THREE from 'three';
import { inject } from '@vercel/analytics';
import { SITE_SWITCH, type SiteId } from './config';
import { createGlobeView, type Card } from './globe/GlobeView';
import { PLACE_ICONS, PLACE_KINDS } from './globe/placeIcons';
import { PLACE_INFO } from './place-info';
import { SITE_VIEWS } from './sites';
import type { SiteView } from './sites/SiteScene';
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

// One place panel for whatever was picked: a place on the globe, a landmark inside a 3D place. Wiki facts from src/place-info.ts.
const place = $('place'), q = <T extends Element>(s: string) => place.querySelector<T & HTMLElement>(s)!;
const showCard = (c: Card) => {
  place.hidden = !c;
  if (!c) return;
  const info = PLACE_INFO[c.name] ?? {};
  const hero = q<HTMLImageElement>('.hero');
  hero.hidden = !info.image;
  hero.src = info.image ?? '';
  q('h1').textContent = c.name;
  q('.kind').textContent = c.kind;
  q('.summary').textContent = c.text ?? info.summary ?? '';
  q<HTMLAnchorElement>('.act').href = 'https://awoiaf.westeros.org/index.php/' + encodeURIComponent((info.wiki ?? c.name).replace(/ /g, '_'));
  q('.credit').hidden = !info.wiki || !!c.text;
  const facts: [string, string][] = [...(c.region ? [['Region', c.region] as [string, string]] : []), ...(info.facts ?? [])];
  if (c.lat !== undefined && c.lon !== undefined) facts.push(['Coordinates', `${c.lat.toFixed(2)}°, ${c.lon.toFixed(2)}°`]);
  q('.facts').replaceChildren(...facts.map(([k, v]) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="k"></span><span></span>';
    li.firstChild!.textContent = k; li.lastChild!.textContent = v;
    return li;
  }));
  place.scrollTop = 0;
};
const globe = createGlobeView(renderer, $('globeLabels'), showCard);
q('.close').onclick = () => globe.deselect();

// 3D place scenes (and their models) load on demand, the first time the camera zooms in on them.
const sites: Partial<Record<SiteId, SiteView>> = {};
const loading: Partial<Record<SiteId, Promise<void>>> = {};
function loadSite(id: SiteId) {
  return (loading[id] ??= (() => {
    const labels = document.createElement('div'); // one label layer per site, shown only while that site is active
    labels.className = 'labels';
    labels.dataset.site = id;
    labels.hidden = true;
    document.body.append(labels);
    return SITE_VIEWS[id](renderer, labels).then((view) => {
      view.camera.aspect = innerWidth / innerHeight;
      view.camera.updateProjectionMatrix();
      view.labels.setSize(innerWidth, innerHeight);
      view.controls.enabled = false;
      view.onPick = (p) => { showCard({ kind: p.kind, name: p.name, text: view.lore[p.name] }); view.flyTo(p); };
      sites[id] = view;
    });
  })());
}

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

// Edit mode (dev server only, it saves through it): the panel swaps to name-editing tools.
const ed = globe.editor, $in = (id: string) => $(id) as HTMLInputElement;
if (import.meta.env.DEV) $('editStart').hidden = false;
$('editStart').onclick = () => ed.setActive(true);
$('editDone').onclick = () => { if (!ed.dirty() || confirm('Leave with unsaved changes?')) ed.setActive(false); };
$('rotL').onclick = () => ed.setRot((ed.state()?.rot ?? 0) - 5);
$('rotR').onclick = () => ed.setRot((ed.state()?.rot ?? 0) + 5);
$in('rot').oninput = () => ed.setRot(+$in('rot').value);
$in('size').oninput = () => ed.setScale(+$in('size').value);
$('editReset').onclick = () => ed.reset();
$('editSave').onclick = async () => { $('editMsg').textContent = (await ed.save()) ? 'Saved to src/place-edits.ts.' : 'Save failed (is the dev server running?).'; };
ed.onChange = () => {
  const s = ed.state();
  $('editSel').textContent = s ? `${s.name} (${s.kind})${s.edited ? ' · edited' : ''}` : 'Nothing selected';
  for (const id of ['rotL', 'rotR', 'rot']) $in(id).disabled = !s?.flat;
  $in('rot').value = String(s?.rot ?? 0);
  $('rotV').textContent = `${s?.rot ?? 0}°`;
  $in('size').disabled = !s;
  $in('size').value = String(s?.scale ?? 1);
  $('sizeV').textContent = `${s?.scale ?? 1}×`;
  $in('editReset').disabled = !s?.edited;
  $in('editSave').disabled = !ed.dirty();
  if (ed.dirty()) $('editMsg').textContent = 'Unsaved changes. Ctrl+S also saves.';
};
ed.onChange();

let active: SiteId | null = null; // null = globe
function setActive(id: SiteId | null) {
  active = id;
  if (id) ed.setActive(false);
  globe.deselect();
  globe.controls.enabled = id === null;
  for (const [s, view] of Object.entries(sites)) view.controls.enabled = s === id;
  for (const el of document.querySelectorAll<HTMLElement>('[data-site]')) el.hidden = el.dataset.site !== id;
  document.body.dataset.mode = id ? 'site' : 'globe';
}
function enterSite(id: SiteId) {
  const { position, target } = globe.siteCamera(id);
  sites[id]!.enter(position, target);
  setActive(id);
}
function exitSite(id: SiteId) {
  globe.followSite(id, sites[id]!.camera);
  setActive(null);
}

$('menuBtn').onclick = () => { // with a place open, the menu closes it and brings the drawer back
  if (!place.hidden) { globe.deselect(); document.body.classList.add('drawer-open'); }
  else document.body.classList.toggle('drawer-open');
};
if (innerWidth < 700) document.body.classList.remove('drawer-open');
const nav = initNav(renderer.domElement, () => (active ? sites[active]!.nav : globe.nav));

// Search: every place name on the map.
const mapItems = globe.places.map((p, i) => ({ label: p.name, kind: p.kind, i }));
$('places').innerHTML = mapItems.map((m) => `<option value="${m.label.replace(/"/g, '&quot;')}" label="${m.kind}"></option>`).join('');
const search = $('search') as HTMLInputElement;
search.addEventListener('change', () => {
  const q = search.value.trim().toLowerCase();
  // exact name first, then "contains"
  const place = mapItems.find((m) => m.label.toLowerCase() === q) ?? (q && mapItems.find((m) => m.label.toLowerCase().includes(q)));
  if (!place) return;
  if (active) exitSite(active);
  globe.flyToPlace(place.i);
  search.value = ''; search.blur();
});

// Start in 3D: keep the loading screen up until the relief maps and mesh are in (on failure it resolves and stays flat).
$('loadMsg').textContent = 'Loading terrain…';
await globe.relief.ready;

let ready = false;
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // The planet and the nearby site's scene are drawn into one frame with the same camera pose: whoever steers (the globe
  // controls far away, the site's map controls close up), the other camera follows.
  let drawn: SiteId | null = active;
  if (!active) {
    globe.update(dt, now);
    const load = globe.siteWithin(SITE_SWITCH.loadDistance);
    if (load && !sites[load]) loadSite(load);
    const enter = globe.siteWithin(SITE_SWITCH.enterDistance);
    if (enter && sites[enter]) { enterSite(enter); drawn = enter; }
    else drawn = globe.siteWithin(SITE_SWITCH.drawDistance) ?? null;
    $('loadHint').hidden = !(enter && !sites[enter]);
  } else {
    sites[active]!.update(dt, now);
    if (sites[active]!.camera.position.length() > SITE_SWITCH.exitDistance) { exitSite(active); drawn = null; }
    $('loadHint').hidden = true;
  }
  const site = drawn && sites[drawn];
  if (site && drawn) {
    if (active) globe.followSite(drawn, site.camera);
    else { const c = globe.siteCamera(drawn); site.camera.position.copy(c.position); site.camera.quaternion.copy(c.quaternion); }
  }
  globe.setSky();
  renderer.render(globe.scene, globe.camera); // clears to the sky colour; the site is drawn over it, depth-tested against it
  if (site) {
    site.scene.fog!.color.copy(globe.scene.background as THREE.Color);
    if (!active) site.setFog(site.camera.position.length());
    renderer.render(site.scene, site.camera);
  }
  const v = active ? sites[active]! : globe;
  v.labels.render(v.scene, v.camera);
  nav.update();
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
  for (const v of [globe, ...Object.values(sites)] as (typeof globe | SiteView)[]) {
    v.camera.aspect = innerWidth / innerHeight;
    v.camera.updateProjectionMatrix();
    v.labels.setSize(innerWidth, innerHeight);
  }
});
globe.labels.setSize(innerWidth, innerHeight);
