import * as THREE from 'three';
import { SITES, SITE_SWITCH, type SiteId } from './config';
import { createGlobeView } from './globe/GlobeView';
import { SITE_VIEWS } from './sites';
import type { SiteView } from './sites/SiteScene';
import { initNav } from './ui/nav';
import { createSitePanel } from './ui/sitePanel';

// One renderer, several scenes: the planet (planet-centred frame) and one local scene per site.
// Zooming close to a site on the globe hands the camera over to that site's scene, and back.
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const $ = (id: string) => document.getElementById(id)!;
const globe = createGlobeView(renderer, $('globeLabels'));
const ids = Object.keys(SITES) as SiteId[];
const labelLayer = (id: SiteId) => { // one label layer per site, shown only while that site is active
  const el = document.createElement('div');
  el.className = 'labels';
  el.dataset.site = id;
  document.body.append(el);
  return el;
};
const sites = Object.fromEntries(
  await Promise.all(ids.map(async (id) => [id, await SITE_VIEWS[id](renderer, labelLayer(id))] as const)),
) as Record<SiteId, SiteView>;
const panel = createSitePanel();

// Fly-to buttons on the globe panel, one per site.
for (const id of ids) {
  const b = document.createElement('button');
  b.textContent = `Fly to ${SITES[id].name}`;
  b.onclick = () => goTo(id);
  $('siteButtons').append(b);
}

for (const r of document.querySelectorAll<HTMLInputElement>('input[name=globeStyle]'))
  r.addEventListener('change', () => globe.setStyle(r.value as 'painted' | 'outline'));

let active: SiteId | null = null; // null = globe
let pending: { id: SiteId; place?: string } | null = null; // what to show after the next arrival
function setActive(id: SiteId | null) {
  active = id;
  globe.controls.enabled = id === null;
  for (const s of ids) sites[s].controls.enabled = s === id;
  for (const el of document.querySelectorAll<HTMLElement>('[data-site]')) el.hidden = el.dataset.site !== id;
  document.body.dataset.mode = id ? 'site' : 'globe';
  if (!id) history.replaceState(null, '', location.pathname);
}
function enterSite(id: SiteId) {
  const s = sites[id], { position, target } = globe.siteCamera(id);
  s.enter(position, target);
  setActive(id);
  panel.show(s);
  history.replaceState(null, '', `#${id}`);
  if (pending?.id === id) {
    const place = s.places.find((p) => p.name === pending!.place);
    place ? panel.go(place) : s.flyHome();
  }
  pending = null;
}
function exitSite(id: SiteId) {
  panel.stopTour();
  globe.enterFromSite(id, sites[id].camera.position);
  setActive(null);
}

$('toGlobe').onclick = () => { panel.stopTour(); if (active) sites[active].flyOut(); };
$('menuBtn').onclick = () => document.body.classList.toggle('drawer-open');
if (innerWidth < 700) document.body.classList.remove('drawer-open');
const nav = initNav(renderer.domElement, () => (active ? sites[active].nav : globe.nav));

/** Go to a site (and optionally one of its places) from anywhere: fly across the globe if needed. */
function goTo(id: SiteId, place?: string) {
  if (active === id) {
    const p = sites[id].places.find((x) => x.name === place);
    return p ? panel.go(p) : sites[id].flyHome();
  }
  if (active) exitSite(active);
  pending = { id, place };
  globe.flyTo(id);
}

// One search for everything: sites and all their places ("Great Keep — Winterfell").
const searchItems = ids.flatMap((id) => [
  { label: SITES[id].name, id, place: undefined as string | undefined },
  ...sites[id].places.map((p) => ({ label: `${p.name} — ${SITES[id].name}`, id, place: p.name })),
]);
$('places').innerHTML = searchItems.map((s) => `<option value="${s.label.replace(/"/g, '&quot;')}"></option>`).join('');
const search = $('search') as HTMLInputElement;
search.addEventListener('change', () => {
  const q = search.value.trim().toLowerCase();
  if (!q) return;
  const hit = searchItems.find((s) => s.label.toLowerCase() === q) ?? searchItems.find((s) => s.label.toLowerCase().includes(q));
  if (hit) { goTo(hit.id, hit.place); search.value = ''; search.blur(); }
});

// Deep links: #siteId or #siteId/Place%20Name land straight on the site (no flight from space).
const [hashId, hashPlace] = location.hash.slice(1).split('/');
setActive(null);
if (hashId in SITES) {
  pending = { id: hashId as SiteId, place: hashPlace && decodeURIComponent(hashPlace) };
  globe.jumpTo(hashId as SiteId);
}

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!active) {
    globe.update(dt, now);
    const id = globe.siteInRange();
    if (id) enterSite(id);
  } else {
    sites[active].update(dt, now);
    if (sites[active].camera.position.length() > SITE_SWITCH.exitDistance) exitSite(active);
  }
  const v = active ? sites[active] : globe;
  renderer.render(v.scene, v.camera);
  v.labels.render(v.scene, v.camera);
  nav.update();
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  for (const v of [globe, ...Object.values(sites)]) {
    v.camera.aspect = innerWidth / innerHeight;
    v.camera.updateProjectionMatrix();
    v.labels.setSize(innerWidth, innerHeight);
  }
});
for (const v of [globe, ...Object.values(sites)]) v.labels.setSize(innerWidth, innerHeight);
