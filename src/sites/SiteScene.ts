import { Q } from '../quality';
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { SiteId } from '../config';
import { createDeclutter } from '../declutter';
import { AREA_KINDS, easeFont, FONT_DEFAULT, FONT_PX, wrap } from '../globe/labelText';
import { PLACE_ICONS } from '../globe/placeIcons';

// What a 3D place adds to the globe: a scene in a local frame in metres (x = east, y = up, z = south, origin at the site),
// with a sun and shadows, clickable labels, and a fade-in. It is shown in the full-screen model view (ui/modelViewer.ts),
// whose orbit controls drive its camera. A site module (kingsLanding/, winterfell/) adds the content.

/** A named, clickable place. pos = [x, z, groundHeight] in the site frame. */
export type Place = { name: string; kind: string; pos: [number, number, number]; radius?: number };

/** The globe kind a site kind is named and shown as (symbol, colour, type size, and the kind the place panel gives it). */
export const GLOBE_KIND: Record<string, string> = {
  castle: 'castle', keep: 'castle', tower: 'ruin', sept: 'monument', pit: 'monument', gate: 'landmark', hall: 'town', square: 'town',
  place: 'minor', wood: 'forest', hill: 'mountain', district: 'region', water: 'lake', street: 'road', road: 'road',
};

/** A site scene plus what its view module adds: the lore shown when a label is clicked, and where the camera goes for a place (x, z in the site frame, camera height in m). */
export type SiteView = ReturnType<typeof createSiteScene> & { lore: Record<string, string>; focus(p: Place): { x: number; z: number; alt: number } };

type Options = {
  id: SiteId;
  shadowExtent: number; // half-size of the sun's shadow box, m
};

/** Dissolves the edge of a ground patch into the globe's ground below. */
export function edgeFade<M extends THREE.MeshStandardMaterial>(m: M, width = 0.15) {
  const N = 64, px = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N, v = (j + 0.5) / N, e = Math.min(u, 1 - u, v, 1 - v) / width;
    px.set([255, Math.round(255 * THREE.MathUtils.smoothstep(e, 0, 1)), 255, 255], (j * N + i) * 4);
  }
  m.alphaMap = new THREE.DataTexture(px, N, N);
  m.alphaMap.minFilter = m.alphaMap.magFilter = THREE.LinearFilter;
  m.alphaMap.needsUpdate = true;
  return m;
}

export function createSiteScene(labelsEl: HTMLElement, o: Options) {
  // No background: the model view's renderer clears to a hazy sky.
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 3e8);
  const labels = new CSS2DRenderer({ element: labelsEl });

  scene.add(new THREE.HemisphereLight(0xe2ecf4, 0x6b5a40, 1.2));
  const sun = new THREE.DirectionalLight(0xfff0d4, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  const e = o.shadowExtent;
  Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 10, far: e * 5 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 1;
  sun.shadow.autoUpdate = false; // the sun and the models are static: render the shadow map once, not every frame
  scene.add(sun, sun.target);
  const a = THREE.MathUtils.degToRad(220);
  sun.position.set(Math.cos(a), 0.8, Math.sin(a)).multiplyScalar(e * 1.5);
  sun.shadow.needsUpdate = true;

  // ---------- labels ----------
  // Same rules as the globe's names: placed in rank order, a name that would overlap one already placed is hidden (faded,
  // not popped), and the fine kinds only show once the camera is near. Box sizes are estimated, never read from layout.
  const RANK = ['castle', 'keep', 'sept', 'pit', 'district', 'hill', 'water', 'gate', 'wood', 'square'], SHOWN_WITHIN: Record<string, number> = { street: 1500, road: 1500 };
  const rank = (k: string) => { const i = RANK.indexOf(k); return i < 0 ? RANK.length : i; };
  // The names look like the globe's (style.css .globe-place): a site kind borrows a globe kind's symbol, colour and type size,
  // lettering over an area (a district, water, a street) has no symbol, and the type grows as the camera nears (labelText.ts).
  const labelObjs: { obj: CSS2DObject; place: Place; gk: string; area: boolean; text: HTMLElement; chars: number; lines: number; base: number; s: number }[] = [];
  const NEAR = 250; // m: the type is at its largest from here down
  function addPlaces(places: Place[]) {
    for (const p of places) {
      const gk = GLOBE_KIND[p.kind] ?? 'town', area = AREA_KINDS.has(gk);
      const el = document.createElement('div');
      el.className = `globe-place k-${gk}${area ? ' globe-area' : ''}`;
      el.innerHTML = `<span></span>${area ? '' : `<svg viewBox="0 0 512 512">${PLACE_ICONS[gk] ?? PLACE_ICONS.town}</svg>`}`;
      const text = el.firstElementChild as HTMLElement, shown = gk === 'lake' ? wrap(p.name, 1, []) : area ? p.name : wrap(p.name), rows = shown.split('\n');
      text.textContent = shown;
      el.onclick = () => site.onPick(p);
      const obj = new CSS2DObject(el);
      obj.position.set(p.pos[0], p.pos[2], p.pos[1]);
      scene.add(obj);
      labelObjs.push({ obj, place: p, gk, area, text, chars: Math.max(...rows.map((r) => r.length)), lines: rows.length, base: 0, s: 1 });
    }
    labelObjs.sort((a, b) => rank(a.place.kind) - rank(b.place.kind));
  }
  const pt = new THREE.Vector3();
  /** Hides the names that are too far for their kind or overlap a more important one. Call each frame, after the camera is placed. */
  function updateLabels() {
    camera.updateMatrixWorld();
    const taken = createDeclutter(4, 2);
    for (const l of labelObjs) {
      const { obj, place, gk, area, text } = l, far = SHOWN_WITHIN[place.kind] ?? 8000;
      pt.copy(obj.position).project(camera);
      const x = ((pt.x + 1) / 2) * innerWidth, y = ((1 - pt.y) / 2) * innerHeight, d = camera.position.distanceTo(obj.position);
      let on = pt.z < 1 && d < far;
      if (on) {
        if (!l.base && obj.element.isConnected) l.base = parseFloat(getComputedStyle(text).fontSize) || 16; // the CSS size of the kind, read once
        const px = easeFont(FONT_PX[gk] ?? FONT_DEFAULT, far, NEAR, d), s = Math.round((px / (l.base || 16)) * 50) / 50; // 2% steps, so the style isn't rewritten every frame
        if (s !== l.s) {
          l.s = s;
          text.style.cssText = `display:inline-block;transform-origin:${area ? '50% 50%' : '0 50%'};transform:scale(${s})`;
        }
        // box estimated from the letters (never read from layout): bold serif ~0.56 em a letter, rows 1.1 em apart
        const em = (l.base || 16) * s, tw = l.chars * 0.56 * em, th = l.lines * 1.1 * em;
        on = taken.claim(area ? [x - tw / 2, y - th / 2, x + tw / 2, y + th / 2] : [x - 7, y - Math.max(13, th) / 2, x + 11 + tw, y + Math.max(13, th) / 2]);
      }
      obj.element.classList.toggle('off', !on);
    }
  }

  // ---------- fade in ----------
  // The whole scene fades in as the camera comes within the site's draw distance, so it never pops over the globe. Alpha
  // hashing dithers the opacity (no sorting, writes depth); it is on only while fading, except on edge-faded ground.
  const base = new Map<THREE.Material, { opacity: number; transparent: boolean }>();
  let fade = -1;
  const setFade = (f: number) => {
    if (f === fade) return;
    fade = f;
    if (!base.size) scene.traverse((o) => {
      for (const m of [(o as THREE.Mesh).material].flat()) if (m && !base.has(m)) base.set(m, { opacity: m.opacity, transparent: m.transparent });
    });
    for (const [m, b] of base) {
      const hash = f < 1 || (!!(m as THREE.MeshStandardMaterial).alphaMap && !b.transparent), transparent = f < 1 ? false : b.transparent;
      if (m.alphaHash !== hash || m.transparent !== transparent) { m.alphaHash = hash; m.transparent = transparent; m.needsUpdate = true; }
      m.opacity = b.opacity * f;
    }
    labelsEl.style.opacity = String(f ** 4); // names arrive late in the fade, when the place is big enough to read
    labelsEl.style.visibility = f < 0.5 ? 'hidden' : '';
  };

  const site = {
    scene, camera, labels, labelObjs, addPlaces, updateLabels, setFade,
    get fade() { return fade; },
    onPick: (_p: Place) => {},
  };
  return site;
}
