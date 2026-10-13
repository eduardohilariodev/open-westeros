import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { KNOWN_WORLD, METRES_PER_DEGREE, SITE_SWITCH, SITES, type SiteId } from '../config';
import { metresPerMapPixel, siteLatLon } from '../geo';
import type { Nav } from '../ui/nav';

// Everything a zoomable site shares: local frame in metres (x = east, y = up, z = south, origin at the site),
// sky + fog, camera + map controls, sun with shadows, the Known World map as ground around it, clickable
// labels, camera flights and WASD flying. A site module (kingsLanding/, winterfell/) adds its own content.

/** A named, clickable place. pos = [x, z, groundHeight] in the site frame. */
export type Place = { name: string; kind: string; pos: [number, number, number]; radius?: number };

export interface SiteView {
  id: SiteId;
  name: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: MapControls;
  labels: CSS2DRenderer;
  nav: Nav;
  places: Place[];
  labelObjs: { obj: CSS2DObject; place: Place }[];
  /** Filter checkboxes: [label, object]. */
  layers: [string, THREE.Object3D][];
  /** Label filter checkboxes: [label, kinds]. */
  labelGroups: [string, string[]][];
  tour: string[];
  overview: string;
  lore: Record<string, string>;
  onPick: (p: Place) => void;
  onUserMove: () => void;
  flyTo(p: Place): void;
  flyHome(): void;
  flyOut(): void;
  enter(position: THREE.Vector3, target: THREE.Vector3): void;
  update(dt: number, now: number): void;
  setSun(deg: number): void;
  setGround?(kind: 'painting' | 'clean'): void;
  setExaggeration?(v: number): void;
}

type Options = {
  id: SiteId;
  sky: number;
  shadowExtent: number; // half-size of the sun's shadow box, m
  home: { position: THREE.Vector3; target: THREE.Vector3 };
  ground: (x: number, z: number) => number; // current ground height (camera floor)
  labelMaxDistance: number;
};

export function createSiteScene(renderer: THREE.WebGLRenderer, labelsEl: HTMLElement, o: Options) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(o.sky);
  const fog = new THREE.Fog(o.sky, 4500, 15000);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 3_000_000);
  camera.position.copy(o.home.position);
  const controls = new MapControls(camera, renderer.domElement);
  controls.target.copy(o.home.target);
  controls.enableDamping = true;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(86);
  controls.minDistance = 20;
  controls.maxDistance = SITE_SWITCH.exitDistance * 1.25;
  const labels = new CSS2DRenderer({ element: labelsEl });

  scene.add(new THREE.HemisphereLight(0xe2ecf4, 0x6b5a40, 1.2));
  const sun = new THREE.DirectionalLight(0xfff0d4, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const e = o.shadowExtent;
  Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 10, far: e * 5 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 1;
  scene.add(sun, sun.target);
  const setSun = (deg: number) => {
    const a = THREE.MathUtils.degToRad(deg);
    sun.position.set(Math.cos(a), 0.8, Math.sin(a)).multiplyScalar(e * 1.5);
  };
  setSun(220);

  // The Known World map around the site at true scale (its own icon painted out by tools/world/prepare.mjs).
  const tex = new THREE.TextureLoader().load(`/world/surroundings-${o.id}.jpg`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const size = 2 * KNOWN_WORLD.surroundings * metresPerMapPixel;
  const surroundings = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }));
  surroundings.position.y = -7;
  scene.add(surroundings);

  // ---------- labels ----------
  const labelObjs: SiteView['labelObjs'] = [];
  function addPlaces(places: Place[]) {
    for (const p of places) {
      const el = document.createElement('div');
      el.className = `lbl ${p.kind}`;
      el.textContent = p.name;
      el.onclick = () => site.onPick(p);
      const obj = new CSS2DObject(el);
      obj.position.set(p.pos[0], p.pos[2], p.pos[1]);
      scene.add(obj);
      labelObjs.push({ obj, place: p });
    }
  }

  // ---------- camera flights ----------
  let anim: { t0: number; dur: number; p0: THREE.Vector3; c0: THREE.Vector3; p1: THREE.Vector3; c1: THREE.Vector3 } | null = null;
  const animateTo = (p1: THREE.Vector3, c1: THREE.Vector3, dur = 2200) => {
    orbit = null;
    anim = { t0: performance.now(), dur, p0: camera.position.clone(), c0: controls.target.clone(), p1, c1 };
  };
  /** Fly to look at `target` from `dist` metres away, keeping the current heading. */
  function flyToPoint(target: THREE.Vector3, dist: number) {
    const dir = camera.position.clone().sub(controls.target).setY(0);
    if (dir.lengthSq() < 1) dir.set(0, 0, 1);
    dir.normalize();
    animateTo(target.clone().addScaledVector(dir, dist * 0.8).setY(target.y + dist * 0.55), target);
  }
  controls.addEventListener('start', () => { anim = orbit = null; site.onUserMove(); });

  // ---------- WASD flight ----------
  const keys = new Set<string>();
  addEventListener('keydown', (ev) => {
    if (!controls.enabled || (ev.target as HTMLElement).tagName === 'INPUT') return;
    keys.add(ev.code);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(ev.code)) { anim = orbit = null; site.onUserMove(); }
  });
  addEventListener('keyup', (ev) => keys.delete(ev.code));
  addEventListener('blur', () => keys.clear());
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function fly(dt: number) {
    const k = (c: string) => (keys.has(c) ? 1 : 0);
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1) * Math.max(40, camera.position.distanceTo(controls.target) * 0.7) * dt;
    camera.getWorldDirection(fwd).setY(0).normalize();
    right.crossVectors(fwd, UP);
    move.set(0, 0, 0).addScaledVector(fwd, k('KeyW') - k('KeyS')).addScaledVector(right, k('KeyD') - k('KeyA'));
    move.y = k('KeyE') - k('KeyQ');
    if (move.lengthSq()) { move.multiplyScalar(speed); camera.position.add(move); controls.target.add(move); }
  }

  // ---------- navigation controls (compass, zoom, tilt) ----------
  // Smooth orbit around the target: azimuth (0 = looking north), polar (0 = straight down), distance.
  let orbit: { t0: number; a0: number; a1: number; p0: number; p1: number; d0: number; d1: number } | null = null;
  const orbitTo = (a1: number, p1: number, d1: number) => {
    anim = null;
    const a0 = controls.getAzimuthalAngle();
    orbit = {
      t0: performance.now(), a0, a1: a0 + Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)), // shortest turn
      p0: controls.getPolarAngle(), p1, d0: controls.getDistance(),
      d1: THREE.MathUtils.clamp(d1, controls.minDistance, controls.maxDistance),
    };
  };
  const origin = siteLatLon(o.id), cosLat = Math.cos(THREE.MathUtils.degToRad(origin.lat));
  const ray = new THREE.Raycaster(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const offset = new THREE.Vector3(), sph = new THREE.Spherical();
  const nav: Nav = {
    heading: () => -controls.getAzimuthalAngle(),
    resetNorth: () => orbitTo(0, controls.getPolarAngle(), controls.getDistance()),
    zoom: (f) => orbitTo(controls.getAzimuthalAngle(), controls.getPolarAngle(), controls.getDistance() * f),
    canTilt: true,
    tilt: () => controls.getPolarAngle(),
    toggleTilt: () => orbitTo(controls.getAzimuthalAngle(), controls.getPolarAngle() > 0.3 ? 0.001 : 1.0, controls.getDistance()),
    home: () => site.flyHome(),
    altitude: () => camera.position.y,
    pick(ndc) {
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(groundPlane, hit)) return null;
      return { lat: origin.lat - hit.z / METRES_PER_DEGREE, lon: origin.lon + hit.x / (METRES_PER_DEGREE * cosLat) };
    },
    metresPerPixel: () => (2 * controls.getDistance() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / innerHeight,
  };

  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const site = {
    id: o.id,
    name: SITES[o.id].name,
    scene, camera, controls, labels, labelObjs, addPlaces, flyToPoint, setSun, nav,
    onPick: (_p: Place) => {},
    onUserMove: () => {},
    flyHome: () => animateTo(o.home.position.clone(), o.home.target.clone(), 3500),
    flyOut: () => animateTo(new THREE.Vector3(0, SITE_SWITCH.exitDistance * 1.15, 50_000), new THREE.Vector3(), 2500),
    enter(position: THREE.Vector3, target: THREE.Vector3) {
      anim = orbit = null;
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
    },
    update(dt: number, now: number) {
      if (anim) {
        const t = Math.min(1, (now - anim.t0) / anim.dur), k = ease(t);
        camera.position.lerpVectors(anim.p0, anim.p1, k).y += Math.sin(Math.PI * t) * anim.p0.distanceTo(anim.p1) * 0.15;
        controls.target.lerpVectors(anim.c0, anim.c1, k);
        if (t === 1) anim = null;
      }
      if (orbit) {
        const t = Math.min(1, (now - orbit.t0) / 700), k = ease(t);
        sph.set(THREE.MathUtils.lerp(orbit.d0, orbit.d1, k), THREE.MathUtils.lerp(orbit.p0, orbit.p1, k), THREE.MathUtils.lerp(orbit.a0, orbit.a1, k));
        camera.position.copy(controls.target).add(offset.setFromSpherical(sph));
        if (t === 1) orbit = null;
      }
      fly(dt);
      const floor = o.ground(camera.position.x, camera.position.z) + 8;
      if (camera.position.y < floor) camera.position.y = floor;
      controls.update();
      const d = camera.position.distanceTo(controls.target);
      fog.near = Math.max(4500, d * 1.5);
      fog.far = Math.max(15000, d * 6);
      labelsEl.style.visibility = d > o.labelMaxDistance ? 'hidden' : '';
    },
  };
  return site;
}
