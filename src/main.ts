import * as THREE from 'three';
import { inject } from '@vercel/analytics';
import { SITE_LOAD_DISTANCE, SITES, type SiteId } from './config';
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
const WIKI = 'https://awoiaf.westeros.org/index.php/';
const anchor = (href: string, ...kids: (Node | string)[]) => {
  const a = document.createElement('a');
  a.href = href; a.target = '_blank'; a.rel = 'noopener';
  a.append(...kids);
  return a;
};
// Text with [label](Page_title#section) links (see tools/wiki/place-info.mjs) becomes text and links to that page of the wiki.
const fill = (el: HTMLElement, text: string) => {
  const nodes: (Node | string)[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    nodes.push(text.slice(last, m.index), anchor(WIKI + m[2], m[1]));
    last = m.index + m[0].length;
  }
  el.replaceChildren(...nodes, text.slice(last));
};
const showCard = (c: Card) => {
  place.hidden = !c;
  if (!c) return;
  const info = PLACE_INFO[c.name] ?? {};
  const hero = q<HTMLImageElement>('.hero');
  hero.hidden = !info.image;
  hero.src = info.image ?? '';
  q('h1').textContent = c.name;
  q('.kind').textContent = c.kind;
  fill(q('.summary'), c.text ?? info.summary ?? '');
  q<HTMLAnchorElement>('.act').href = WIKI + encodeURIComponent((info.wiki ?? c.name).replace(/ /g, '_'));
  q('.credit').hidden = !info.wiki || !!c.text;
  // Houses of the place: the sigil opens the wiki's file page (author and licence), the name opens the house's article.
  q('.sigils-credit').hidden = !info.houses;
  q('.houses').replaceChildren(...(info.houses ?? []).map(([page, file, label]) => {
    const chip = document.createElement('span'), img = new Image();
    chip.className = 'house';
    img.src = `/sigils/${file.replace(/\.[^.]+$/, '.webp')}`; img.alt = `Coat of arms of ${label}`;
    img.onerror = () => chip.remove();
    chip.append(anchor(`${WIKI}File:${file}`, img), anchor(WIKI + encodeURIComponent(page.replace(/ /g, '_')), label));
    return chip;
  }));
  const facts: [string, string][] = [...(c.region ? [['Region', c.region] as [string, string]] : []), ...(info.facts ?? [])];
  if (c.lat !== undefined && c.lon !== undefined) facts.push(['Coordinates', `${c.lat.toFixed(2)}°, ${c.lon.toFixed(2)}°`]);
  q('.facts').replaceChildren(...facts.map(([k, v]) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="k"></span><span></span>';
    li.firstChild!.textContent = k; fill(li.lastChild as HTMLElement, v);
    return li;
  }));
  files = info.images ?? [];
  captions = info.captions ?? [];
  q('.photos').hidden = !files.length;
  if (files.length) { q<HTMLImageElement>('.tile img').src = thumb(files[0], 400); q('.tile span').textContent = `Images (${files.length})`; }
  place.scrollTop = 0;
};
q<HTMLImageElement>('.hero').onerror = () => { q('.hero').hidden = true; }; // hot-linked: hide it if it fails

// Gallery: the place's pictures from its wiki article (file names in place-info), opened by the panel's picture or its
// Images tile. thumb.php resizes by width but refuses to upscale (400), so the big picture tries the widest first and
// steps down. Arrows or ←/→ browse, the strip jumps, click outside the picture or Esc closes.
let files: string[] = [], captions: string[] = [], at = 0, widths: number[] = [];
const thumb = (f: string, w: number) => `https://awoiaf.westeros.org/thumb.php?f=${f}&width=${w}`;
const viewer = $('viewer'), big = viewer.querySelector<HTMLImageElement>('.big')!, strip = viewer.querySelector<HTMLElement>('.strip')!, caption = viewer.querySelector<HTMLElement>('.caption')!;
const tryWidth = () => { big.src = thumb(files[at], widths.shift()!); };
big.onerror = () => { if (widths.length) tryWidth(); };
const showImage = (i: number) => {
  at = (i + files.length) % files.length;
  widths = [1600, 1200, 800, 400, 200];
  tryWidth();
  caption.textContent = captions[at] ?? ''; caption.hidden = !caption.textContent;
  [...strip.children].forEach((b, j) => b.classList.toggle('on', j === at));
  strip.children[at].scrollIntoView({ inline: 'center', block: 'nearest' });
};
const openGallery = (i: number) => {
  if (!files.length) return;
  const many = files.length > 1;
  strip.hidden = !many;
  viewer.querySelectorAll<HTMLElement>('.nav').forEach((b) => (b.hidden = !many));
  strip.replaceChildren(...files.map((f, j) => {
    const b = document.createElement('button'), img = document.createElement('img');
    img.src = thumb(f, 200); img.loading = 'lazy'; img.alt = '';
    b.append(img); b.onclick = () => showImage(j);
    return b;
  }));
  viewer.hidden = false;
  showImage(i);
};
const closeGallery = () => { viewer.hidden = true; big.removeAttribute('src'); };
q<HTMLImageElement>('.hero').onclick = (e) => openGallery(Math.max(0, files.findIndex((f) => (e.currentTarget as HTMLImageElement).src.includes(`f=${f}&`))));
q('.tile').onclick = () => openGallery(0);
viewer.onclick = (e) => { if (e.target === viewer) closeGallery(); };
viewer.querySelector<HTMLElement>('.close')!.onclick = closeGallery;
viewer.querySelector<HTMLElement>('.prev')!.onclick = () => showImage(at - 1);
viewer.querySelector<HTMLElement>('.next')!.onclick = () => showImage(at + 1);
addEventListener('keydown', (e) => {
  if (viewer.hidden) return;
  if (e.key === 'Escape') closeGallery();
  else if (e.key === 'ArrowLeft') showImage(at - 1);
  else if (e.key === 'ArrowRight') showImage(at + 1);
});
const globe = createGlobeView(renderer, $('globeLabels'), showCard);
q('.close').onclick = () => globe.deselect();

// 3D place scenes (and their models) load on demand, the first time the camera zooms in on them.
const sites: Partial<Record<SiteId, SiteView>> = {};
const loading: Partial<Record<SiteId, Promise<void>>> = {};
function loadSite(id: SiteId) {
  return (loading[id] ??= (() => {
    const labels = document.createElement('div'); // one label layer per site, faded in with the site
    labels.className = 'labels';
    document.body.append(labels);
    return SITE_VIEWS[id](renderer, labels).then((view) => {
      view.camera.aspect = innerWidth / innerHeight;
      view.camera.updateProjectionMatrix();
      view.labels.setSize(innerWidth, innerHeight);
      view.onPick = (p) => {
        showCard({ kind: p.kind, name: p.name, text: view.lore[p.name] });
        const f = view.focus(p);
        globe.flyToSite(id, f.x, f.z, f.alt);
      };
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

if (import.meta.env.DEV) document.title += ' (dev)';

$('menuBtn').onclick = () => { // with a place open, the menu closes it and brings the drawer back
  if (!place.hidden) { globe.deselect(); document.body.classList.add('drawer-open'); }
  else document.body.classList.toggle('drawer-open');
};
const nav = initNav(renderer.domElement, () => globe.nav);

// Search: every place name on the map.
const mapItems = globe.places.map((p, i) => ({ label: p.name, kind: p.kind, i }));
$('places').innerHTML = mapItems.map((m) => `<option value="${m.label.replace(/"/g, '&quot;')}" label="${m.kind}"></option>`).join('');
const search = $('search') as HTMLInputElement;
search.addEventListener('change', () => {
  const q = search.value.trim().toLowerCase();
  // exact name first, then "contains"
  const place = mapItems.find((m) => m.label.toLowerCase() === q) ?? (q && mapItems.find((m) => m.label.toLowerCase().includes(q)));
  if (!place) return;
  globe.flyToPlace(place.i);
  search.value = ''; search.blur();
});

// Start in 3D: keep the loading screen up until the relief maps and mesh are in (on failure it resolves and stays flat).
$('loadMsg').textContent = 'Loading terrain…';
await globe.relief.ready;

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
  const load = globe.siteWithin(SITE_LOAD_DISTANCE);
  if (load && !sites[load]) loadSite(load);
  const drawn = globe.siteWithin((id) => SITES[id].drawDistance) ?? null;
  const site = drawn && sites[drawn];
  $('loadHint').hidden = !(drawn && !sites[drawn]);
  for (const [id, s] of Object.entries(sites) as [SiteId, SiteView][]) {
    if (id !== drawn) { s.setFade(0); continue; }
    const c = globe.siteCamera(id), D = SITES[id].drawDistance;
    s.camera.position.copy(c.position);
    s.camera.quaternion.copy(c.quaternion);
    s.setFade(1 - THREE.MathUtils.smoothstep(c.position.length(), D * 0.55, D));
  }
  globe.setSky();
  renderer.render(globe.scene, globe.camera); // clears to the sky colour; the site is drawn over it
  globe.labels.render(globe.scene, globe.camera);
  if (site && site.fade > 0) {
    renderer.clearDepth(); // the site has its own ground; the globe's depth would hide its low parts under the globe's surface
    renderer.render(site.scene, site.camera);
    site.labels.render(site.scene, site.camera);
  }
  nav.update();
  if (import.meta.env.DEV) {
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
    const n = globe.nav, c = n.pick(new THREE.Vector2(0, 0)), deg = THREE.MathUtils.radToDeg;
    debug.textContent = [
      drawn ?? 'globe',
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
  for (const v of [globe, ...Object.values(sites)] as (typeof globe | SiteView)[]) {
    v.camera.aspect = innerWidth / innerHeight;
    v.camera.updateProjectionMatrix();
    v.labels.setSize(innerWidth, innerHeight);
  }
});
globe.labels.setSize(innerWidth, innerHeight);
