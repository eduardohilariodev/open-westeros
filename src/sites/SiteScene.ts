import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { SiteId } from '../config';
import { createDeclutter } from '../declutter';

// What a 3D place adds to the globe: a scene in a local frame in metres (x = east, y = up, z = south, origin at the site),
// with a sun and shadows, clickable labels, and a fade-in. It has no controls of its own: main.ts drives its camera from
// the globe's, so there is one view. It is drawn over the globe (its own frame keeps float precision at planet scale).
// A site module (kingsLanding/, winterfell/) adds the content.

/** A named, clickable place. pos = [x, z, groundHeight] in the site frame. */
export type Place = { name: string; kind: string; pos: [number, number, number]; radius?: number };

/** A site scene plus what its view module adds: the lore shown when a label is clicked, and where the globe flies for a place (x, z in the site frame, camera altitude in m). */
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
  // No background: this scene is drawn over the globe's, with the globe camera's fov and far plane (its pose is copied in each frame).
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 3e8);
  const labels = new CSS2DRenderer({ element: labelsEl });

  scene.add(new THREE.HemisphereLight(0xe2ecf4, 0x6b5a40, 1.2));
  const sun = new THREE.DirectionalLight(0xfff0d4, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
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
  const labelObjs: { obj: CSS2DObject; place: Place; w: number }[] = [];
  function addPlaces(places: Place[]) {
    for (const p of places) {
      const el = document.createElement('div');
      el.className = `lbl ${p.kind}`;
      el.textContent = p.name;
      el.onclick = () => site.onPick(p);
      const obj = new CSS2DObject(el);
      obj.position.set(p.pos[0], p.pos[2], p.pos[1]);
      scene.add(obj);
      labelObjs.push({ obj, place: p, w: p.name.length * 8.5 + 14 });
    }
    labelObjs.sort((a, b) => rank(a.place.kind) - rank(b.place.kind));
  }
  const pt = new THREE.Vector3();
  /** Hides the names that are too far for their kind or overlap a more important one. Call each frame, after the camera is placed. */
  function updateLabels() {
    camera.updateMatrixWorld();
    const taken = createDeclutter(4, 2);
    for (const { obj, place, w } of labelObjs) {
      pt.copy(obj.position).project(camera);
      const x = ((pt.x + 1) / 2) * innerWidth, y = ((1 - pt.y) / 2) * innerHeight;
      const b = [x - w / 2, y - 12, x + w / 2, y + 12];
      let on = pt.z < 1 && camera.position.distanceTo(obj.position) < (SHOWN_WITHIN[place.kind] ?? 8000);
      on &&= taken.claim(b);
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
