import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SITES, type SiteId } from '../config';
import { Q } from '../quality';
import { SITE_VIEWS } from '../sites';
import type { Place, SiteView } from '../sites/SiteScene';

// The 3D sites (King's Landing, Winterfell) in a full-screen view of their own, opened from the place card's "3D model"
// button (docs/decisions/0003: the globe stays a bird's-eye map). Its own canvas, renderer and orbit controls; the globe
// sleeps while it is open (main.ts). The place panel stays on top, so a picked building shows its card beside the model.
const $ = (id: string) => document.getElementById(id)!;
const root = $('model3d'), stage = root.querySelector<HTMLElement>('.stage')!;
const title = root.querySelector<HTMLElement>('.title')!, hint = root.querySelector<HTMLElement>('.hint')!;

let renderer: THREE.WebGLRenderer | null = null, controls: OrbitControls | null = null;
const views: Partial<Record<SiteId, SiteView>> = {}, loading: Partial<Record<SiteId, Promise<SiteView>>> = {};
let shown: SiteView | null = null, shownId: SiteId | null = null;
let fly: { t0: number; p0: THREE.Vector3; p1: THREE.Vector3; c0: THREE.Vector3; c1: THREE.Vector3 } | null = null;
let onPick: (id: SiteId, view: SiteView, p: Place) => void = () => {};
let onShow: (open: boolean) => void = () => {};

const init = () => {
  renderer = new THREE.WebGLRenderer({ antialias: Q.aa, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.ratio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0xc9d6df); // a hazy sky: the edge-faded ground dissolves into it
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  stage.prepend(renderer.domElement);
  addEventListener('resize', () => {
    renderer!.setSize(innerWidth, innerHeight);
    for (const v of Object.values(views)) { v.camera.aspect = innerWidth / innerHeight; v.camera.updateProjectionMatrix(); v.labels.setSize(innerWidth, innerHeight); }
  });
  renderer.setAnimationLoop((now) => {
    if (!shown || root.hidden) return;
    if (fly) {
      const t = Math.min(1, (now - fly.t0) / 1200), e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      shown.camera.position.lerpVectors(fly.p0, fly.p1, e);
      controls!.target.lerpVectors(fly.c0, fly.c1, e);
      if (t === 1) fly = null;
    }
    controls!.update();
    shown.updateLabels();
    renderer!.render(shown.scene, shown.camera);
    shown.labels.render(shown.scene, shown.camera);
  });
};

const labelLayers: Partial<Record<SiteId, HTMLElement>> = {}; // one per site, only the shown one visible
const load = (id: SiteId) => (loading[id] ??= SITE_VIEWS[id](renderer!, (labelLayers[id] = stage.appendChild(Object.assign(document.createElement('div'), { className: 'labels', hidden: true })))).then((v) => {
  v.camera.aspect = innerWidth / innerHeight;
  v.camera.near = 1; v.camera.far = 200_000; v.camera.updateProjectionMatrix();
  v.labels.setSize(innerWidth, innerHeight);
  v.setFade(1);
  v.onPick = (p) => { onPick(id, v, p); focus(p); };
  return (views[id] = v);
}));

/** How far the camera starts from a site: about its width (a site's draw distance is ~5-7 widths). */
const overview = (id: SiteId) => SITES[id].drawDistance * 0.14;

/** Eases the camera to look at place `p` from its view's focus height, keeping the current bearing. */
function focus(p: Place) {
  if (!shown || !controls) return;
  const f = shown.focus(p), label = shown.labelObjs.find((l) => l.place === p);
  const c1 = new THREE.Vector3(f.x, label ? label.obj.position.y : p.pos[2], f.z);
  const dir = shown.camera.position.clone().sub(controls.target).setY(0).normalize();
  const p1 = c1.clone().addScaledVector(dir, f.alt * 0.9).add(new THREE.Vector3(0, f.alt, 0));
  fly = { t0: performance.now(), p0: shown.camera.position.clone(), p1, c0: controls.target.clone(), c1 };
}

const setAddress = (on: boolean) => {
  const u = new URL(location.href);
  if (on) u.searchParams.set('view', '3d'); else u.searchParams.delete('view');
  history.replaceState(null, '', u);
};

/** Opens site `id`, at its overview or on the place named `place`. */
export async function openModel(id: SiteId, place?: string) {
  if (!renderer) init();
  root.hidden = false;
  title.textContent = SITES[id].name;
  setAddress(true);
  onShow(true);
  hint.hidden = !!views[id];
  const v = await load(id);
  hint.hidden = true;
  if (root.hidden) return; // closed while it loaded
  if (shownId !== id) {
    for (const [k, el] of Object.entries(labelLayers)) el.hidden = k !== id;
    shown = v; shownId = id;
    controls?.dispose();
    controls = new OrbitControls(v.camera, renderer!.domElement);
    controls.enableDamping = true;
    controls.screenSpacePanning = false; // pans over the ground, not up into the sky
    controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
    controls.minDistance = 40;
    controls.maxDistance = overview(id) * 2.5;
    controls.target.set(0, 0, 0);
    v.camera.position.set(0, overview(id) * 0.75, overview(id) * 0.66);
    fly = null;
  }
  const p = place && v.labelObjs.find((l) => l.place.name === place)?.place;
  if (p) focus(p);
  return v;
}

export function closeModel() {
  if (root.hidden) return;
  root.hidden = true;
  setAddress(false);
  onShow(false);
}

export const modelOpen = () => !root.hidden;
/** Every site opened so far: its places join the search. */
export const modelViews = () => Object.entries(views) as [SiteId, SiteView][];
/** A name on a site's labels was clicked (or searched): show its card. */
export const onModelPick = (fn: typeof onPick) => { onPick = fn; };
/** The viewer opened or closed: the globe sleeps while it is open. */
export const onModelShow = (fn: typeof onShow) => { onShow = fn; };

root.querySelector<HTMLElement>('.close')!.onclick = closeModel;
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden && $('viewer').hidden) closeModel(); });
