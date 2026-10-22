import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MIN_ALT = 30, // close enough to stand among a 3D place's buildings
 MAX_ALT = 40_000_000;
const rad = THREE.MathUtils.degToRad;

/**
 * The camera on the planet (planet-centred frame, metres): altitude zoom, grab-the-surface drag, tilt and heading, flights.
 * `groundAt(p)` is the drawn ground's height (m) under a point, so a tilt never buries the camera. `step` once a frame.
 */
export function createCameraRig(camera: THREE.PerspectiveCamera, controls: OrbitControls, el: HTMLElement, R: number, home: { dir: THREE.Vector3; alt: number }, groundAt: (p: THREE.Vector3) => number) {
  const toNdc = (e: MouseEvent) => {
    const r = el.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };

  // ---------- altitude zoom ----------
  // Altitude eases toward altGoal in log space, so wheel and buttons zoom smoothly at any height.
  let alt = home.alt, altGoal = alt;
  let tilt = 0; // radians from straight down; alt is then the distance to the ground point at the screen centre
  let heading = 0; // radians clockwise from north
  const CLEARANCE = 200; // m the camera keeps above the ground
  const MAX_TILT = rad(85); // short of 90°, where the camera would sit on the ground
  // Wheel zoom keeps the spot under the cursor in place: `anchor` is its direction from the planet centre, `anchorNdc` the cursor.
  let anchor: THREE.Vector3 | null = null;
  const anchorNdc = new THREE.Vector2();
  const zoomTo = (a: number) => { anim = null; altGoal = THREE.MathUtils.clamp(a, MIN_ALT, MAX_ALT); };
  const onWheel = (e: WheelEvent) => {
    if (!controls.enabled) return;
    e.preventDefault();
    const ndc = toNdc(e);
    // keep the existing anchor while the zoom is still easing, so a fast wheel doesn't re-pick a drifting point
    if (!anchor || Math.abs(Math.log(alt / altGoal)) < 0.001) {
      ray.setFromCamera(ndc, camera);
      anchor = ray.ray.intersectSphere(planet, hit) ? hit.clone().normalize() : null;
      anchorNdc.copy(ndc);
    }
    zoomTo(altGoal * Math.pow(1.0015, e.deltaY));
  };
  /** Rotate the camera about the planet centre so the spot `dir` is under `ndc`. */
  const pinTo = (dir: THREE.Vector3, ndc: THREE.Vector2) => {
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectSphere(planet, hit)) return;
    const q = new THREE.Quaternion().setFromUnitVectors(hit.normalize(), dir);
    camera.position.applyQuaternion(q);
    camera.quaternion.premultiply(q);
  };
  const holdAnchor = () => {
    if (!anchor) return;
    if (Math.abs(Math.log(alt / altGoal)) < 0.001) anchor = null; else pinTo(anchor, anchorNdc);
  };

  // Dragging grabs the surface: the spot under the pointer stays under it (replaces OrbitControls' angular rotate).
  controls.enableRotate = false;
  // Place names sit in a separate overlay, so the same listeners go on both. Capture starts only once the pointer has
  // moved a few px, so a plain click on a name still reaches the name.
  // Shift-drag tilts and turns instead, about the ground point at the screen centre: up/down tilts, left/right turns.
  let grab: THREE.Vector3 | null = null, dragging = false, tilting = false, down = { x: 0, y: 0 };
  const release = () => (grab = null, dragging = tilting = false);
  const attachInput = (t: HTMLElement) => {
    t.addEventListener('pointerdown', (e) => {
      if (!controls.enabled || !e.isPrimary || e.button !== 0) return;
      anim = anchor = null;
      down = { x: e.clientX, y: e.clientY };
      if (e.shiftKey) { tilting = true; el.setPointerCapture(e.pointerId); return; }
      ray.setFromCamera(toNdc(e), camera);
      grab = ray.ray.intersectSphere(planet, hit) ? hit.clone().normalize() : null;
    });
    t.addEventListener('pointermove', (e) => {
      if (tilting) {
        tilt = THREE.MathUtils.clamp(tilt - e.movementY * 0.005, 0, MAX_TILT);
        heading = (heading + e.movementX * 0.005) % (2 * Math.PI);
        return;
      }
      if (!grab) return;
      if (!dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) return;
      if (!dragging) { dragging = true; el.setPointerCapture(e.pointerId); }
      pinTo(grab, toNdc(e));
    });
    t.addEventListener('pointerup', release);
    t.addEventListener('pointercancel', release);
    t.addEventListener('wheel', onWheel, { passive: false });
  };

  // ---------- flights ----------
  let anim: { t0: number; d0: THREE.Vector3; d1: THREE.Vector3; a0: number; a1: number } | null = null;
  const tmp = new THREE.Vector3();
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const flyToDir = (dir: THREE.Vector3, a: number) =>
    (anim = { t0: performance.now(), d0: camera.position.clone().normalize(), d1: dir.clone().normalize(), a0: alt, a1: a });
  const latLon = (v: THREE.Vector3) => ({ lat: THREE.MathUtils.radToDeg(Math.asin(v.y / v.length())), lon: THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z)) });
  const ray = new THREE.Raycaster(), planet = new THREE.Sphere(new THREE.Vector3(), R), hit = new THREE.Vector3();

  return {
    attachInput, latLon,
    /** Camera altitude (m), the tilt (radians from straight down) and the heading (radians clockwise from north). */
    get alt() { return alt; },
    get tilt() { return tilt; },
    get heading() { return heading; },
    set heading(h: number) { heading = h; },
    /** Back to straight down and north up, flying to `home`. */
    goHome() { tilt = heading = 0; flyToDir(home.dir, home.alt); },
    zoomBy: (f: number) => zoomTo(altGoal * f),
    flyToDir,
    /** The lat/lon of the ground under a screen point, if it is on the planet. */
    pick(ndc: THREE.Vector2) {
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectSphere(planet, hit) ? latLon(hit) : null;
    },
    /** Once a frame: moves the camera for the zoom, flight, tilt and heading. */
    step(dt: number, now: number) {
      if (tilt) { // undo last frame's tilt: back above the ground point at the screen centre
        camera.updateMatrixWorld();
        ray.setFromCamera(new THREE.Vector2(), camera);
        if (ray.ray.intersectSphere(planet, hit)) camera.position.copy(hit);
      }
      if (anim) {
        const t = Math.min(1, (now - anim.t0) / 3500), e = ease(t);
        camera.position.copy(tmp.copy(anim.d0).lerp(anim.d1, e).normalize());
        alt = altGoal = Math.exp(THREE.MathUtils.lerp(Math.log(anim.a0), Math.log(anim.a1), e));
        if (t === 1) anim = null;
      } else {
        alt = Math.exp(THREE.MathUtils.lerp(Math.log(alt), Math.log(altGoal), Math.min(1, dt * 8)));
      }
      camera.position.setLength(R + alt);
      const near = Math.min(100, alt / 20); // close to the ground, a 100 m near plane would clip it
      if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
      controls.rotateSpeed = THREE.MathUtils.clamp(alt / 10_000_000, 0.02, 1);
      controls.update();
      if (heading) camera.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(camera.position.clone().normalize(), -heading));
      if (tilt) { // swing about the ground point below, around the camera's right axis
        const g = camera.position.clone().setLength(R), right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const swing = (a: number) => camera.position.clone().sub(g).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(right, a)).add(g);
        const buried = (p: THREE.Vector3) => p.length() - R < groundAt(p) + Math.min(CLEARANCE, alt * 0.15);
        if (buried(swing(tilt))) { // the terrain is in the way: stop at the steepest tilt that clears it
          let lo = 0, hi = tilt;
          for (let i = 0; i < 8; i++) { const mid = (lo + hi) / 2; if (buried(swing(mid))) hi = mid; else lo = mid; }
          tilt = lo;
        }
        const q = new THREE.Quaternion().setFromAxisAngle(right, tilt);
        camera.position.copy(swing(tilt));
        camera.quaternion.premultiply(q);
      }
      if (anim) anchor = null; else holdAnchor(); // after the tilt, so the wheel's anchor stays under the cursor
    },
  };
}
