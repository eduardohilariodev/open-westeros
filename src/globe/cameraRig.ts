import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const MIN_ALT = 30, // close enough to stand among a 3D place's buildings
 MAX_ALT = 40_000_000;
export const GLOBE_MIN_ALT = 2_000; // zooming in stops here everywhere else: lower, the relief and the sea are not detailed enough to stand on
const rad = THREE.MathUtils.degToRad;

/**
 * The camera on the planet (planet-centred frame, metres): altitude zoom, grab-the-surface drag, tilt and heading, flights.
 * `groundAt(p)` is the drawn ground's height (m) under a point, so a tilt never buries the camera. `step` once a frame.
 */
export function createCameraRig(camera: THREE.PerspectiveCamera, controls: OrbitControls, el: HTMLElement, R: number, home: { dir: THREE.Vector3; alt: number }, groundAt: (p: THREE.Vector3) => number, minAlt: () => number = () => MIN_ALT) {
  const toNdc = (e: { clientX: number; clientY: number }) => {
    const r = el.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };

  // ---------- altitude zoom ----------
  // Altitude eases toward altGoal in log space, so wheel and buttons zoom smoothly at any height.
  let alt = home.alt, altGoal = alt;
  let tilt = 0; // radians from straight down; alt is then the distance to the ground point at the screen centre
  let heading = 0; // radians clockwise from north
  let turn: { h0: number; t0: number } | null = null; // an eased turn back to north, cancelled by a drag
  const CLEARANCE = 200; // m the camera keeps above the ground
  const MAX_TILT = rad(85); // short of 90°, where the camera would sit on the ground
  // Wheel zoom keeps the spot under the cursor in place: `anchor` is its direction from the planet centre, `anchorNdc` the cursor.
  let anchor: THREE.Vector3 | null = null, anchorR = R; // anchorR: radius of the ground under it (relief included)
  const anchorNdc = new THREE.Vector2();
  const zoomTo = (a: number) => { anim = null; altGoal = THREE.MathUtils.clamp(a, minAlt(), MAX_ALT); };
  const onWheel = (e: WheelEvent) => {
    if (!controls.enabled) return;
    e.preventDefault();
    const ndc = toNdc(e);
    // keep the existing anchor while the zoom is still easing, so a fast wheel doesn't re-pick a drifting point
    if (!anchor || Math.abs(Math.log(alt / altGoal)) < 0.001 || ndc.distanceTo(anchorNdc) > 0.002) setAnchor(ndc); // a moved cursor takes a new anchor
    zoomTo(altGoal * Math.pow(1.0015, e.deltaY));
  };
  /** The ground under `ndc`: its direction from the planet centre and its radius (the drawn relief, not the bare sphere). */
  const pickGround = (ndc: THREE.Vector2) => {
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    planet.radius = R;
    if (!ray.ray.intersectSphere(planet, hit)) return null;
    planet.radius = R + Math.max(0, groundAt(hit));
    if (!ray.ray.intersectSphere(planet, hit)) { planet.radius = R; ray.ray.intersectSphere(planet, hit); }
    const r = hit.length();
    planet.radius = R;
    return { dir: hit.clone().normalize(), r };
  };
  const setAnchor = (ndc: THREE.Vector2) => { const g = pickGround(ndc); anchor = g?.dir ?? null; anchorR = g?.r ?? R; anchorNdc.copy(ndc); };
  /** Rotate the camera about the planet centre so the spot `dir` (on the sphere of radius `r`) is under `ndc`. */
  const pinTo = (dir: THREE.Vector3, ndc: THREE.Vector2, r = R) => {
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    planet.radius = r;
    const ok = ray.ray.intersectSphere(planet, hit);
    planet.radius = R;
    if (!ok) return;
    const q = new THREE.Quaternion().setFromUnitVectors(hit.normalize(), dir);
    camera.position.applyQuaternion(q);
    camera.quaternion.premultiply(q);
  };
  const holdAnchor = () => {
    if (!anchor) return;
    if (Math.abs(Math.log(alt / altGoal)) < 0.001) anchor = null; else pinTo(anchor, anchorNdc, anchorR);
  };

  // Dragging grabs the surface: the spot under the pointer stays under it (replaces OrbitControls' angular rotate).
  controls.enableRotate = false;
  // Place names sit in a separate overlay, so the same listeners go on both. Capture starts only once the pointer has
  // moved a few px, so a plain click on a name still reaches the name.
  // Shift-drag tilts and turns instead, about the ground point at the screen centre: up/down tilts, left/right turns.
  let grab: THREE.Vector3 | null = null, grabR = R, dragging = false, tilting = false, down = { x: 0, y: 0 };
  // Two fingers pinch-zoom about their midpoint, the same anchored altitude zoom as the wheel.
  const touches = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  const pinchSpan = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const pinchMid = () => { const [a, b] = [...touches.values()]; return toNdc({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }); };
  // The same two fingers also tilt (both slide up/down together) and turn (twist), like Google Maps.
  let pinchAngle = 0, pinchMidY = 0;
  const pinchTwist = () => { const [a, b] = [...touches.values()]; return Math.atan2(b.y - a.y, b.x - a.x); };
  const pinchY = () => { const [a, b] = [...touches.values()]; return (a.y + b.y) / 2; };
  const release = (e?: PointerEvent) => {
    if (e && touches.delete(e.pointerId) && touches.size === 1) pinchDist = 0; // the rest of the pinch is not a drag
    if (touches.size === 0) pinchDist = 0;
    grab = null; dragging = tilting = false;
    document.body.classList.remove('grabbing');
  };
  const attachInput = (t: HTMLElement) => {
    t.style.touchAction = 'none'; // the browser must not pan or page-zoom over the globe
    t.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && controls.enabled) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) { grab = null; dragging = false; anim = anchor = null; pinchDist = pinchSpan(); pinchAngle = pinchTwist(); pinchMidY = pinchY(); return; }
      }
      if (!controls.enabled || !e.isPrimary || e.button !== 0) return;
      anim = anchor = null;
      down = { x: e.clientX, y: e.clientY };
      if (e.shiftKey) { tilting = true; document.body.classList.add('grabbing'); el.setPointerCapture(e.pointerId); return; }
      const g = pickGround(toNdc(e));
      grab = g?.dir ?? null; grabR = g?.r ?? R;
    });
    t.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && pinchDist) {
        const d = pinchSpan();
        if (d < 1) return;
        if (!anchor || Math.abs(Math.log(alt / altGoal)) < 0.001) setAnchor(pinchMid());
        zoomTo(altGoal * pinchDist / d); // fingers apart (d grows) lowers the altitude
        pinchDist = d;
        // twist turns the map with the fingers (wrapped so crossing ±π isn't a jump); sliding together tilts
        const ang = pinchTwist(), my = pinchY();
        let da = ang - pinchAngle;
        da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI;
        heading = (heading - da) % (2 * Math.PI);
        tilt = THREE.MathUtils.clamp(tilt - (my - pinchMidY) * 0.005, 0, MAX_TILT);
        turn = null;
        pinchAngle = ang; pinchMidY = my;
        return;
      }
      if (tilting) {
        tilt = THREE.MathUtils.clamp(tilt - e.movementY * 0.005, 0, MAX_TILT);
        turn = null;
        heading = (heading + e.movementX * 0.005) % (2 * Math.PI);
        return;
      }
      if (!grab) return;
      if (!dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) return;
      if (!dragging) { dragging = true; document.body.classList.add('grabbing'); el.setPointerCapture(e.pointerId); }
      pinTo(grab, toNdc(e), grabR);
    });
    t.addEventListener('pointerup', release);
    t.addEventListener('pointercancel', release);
    t.addEventListener('wheel', onWheel, { passive: false });
  };

  // Arrow keys roll the globe under the camera: up moves the view north (or toward the top of the screen once turned), down back, left/right sideways.
  const held = new Set<string>();
  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, select, [contenteditable]')) return;
    if (e.code.startsWith('Arrow')) { held.add(e.code); e.preventDefault(); }
  });
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => held.clear());

  // ---------- flights ----------
  let anim: { t0: number; d0: THREE.Vector3; d1: THREE.Vector3; a0: number; a1: number } | null = null;
  const tmp = new THREE.Vector3();
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  /** Fly to look at the spot `dir` from altitude `a`. With `inset` (px each side is covered), the spot lands in the middle of what is left free, not of the screen. */
  const flyToDir = (dir: THREE.Vector3, a: number, inset?: { l: number; r: number; t: number; b: number }) => {
    const d1 = dir.clone().normalize();
    if (inset) {
      const east = new THREE.Vector3(0, 1, 0).cross(d1).normalize(), north = d1.clone().cross(east);
      const up = north.clone().multiplyScalar(Math.cos(heading)).addScaledVector(east, Math.sin(heading)), right = d1.clone().cross(up).multiplyScalar(-1).normalize();
      const mpp = (a * 2 * Math.tan(rad(camera.fov / 2))) / el.clientHeight;
      d1.addScaledVector(right, (-((inset.l - inset.r) / 2) * mpp) / R).addScaledVector(up, (((inset.t - inset.b) / 2) * mpp) / R).normalize();
    }
    anim = { t0: performance.now(), d0: camera.position.clone().normalize(), d1, a0: alt, a1: a };
  };
  /**
   * Fly so the unit directions `pts` fill the part of the screen that the overlays leave free: `inset` is the px each side
   * is covered (the sidebar), `pad` the gap kept round the points. Flat approximation of the ground: good for areas up to a few thousand km.
   */
  const flyToFit = (pts: THREE.Vector3[], inset: { l: number; r: number; t: number; b: number }, pad: number) => {
    const n = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).normalize();
    const east = new THREE.Vector3(0, 1, 0).cross(n).normalize(), north = n.clone().cross(east);
    const up = north.clone().multiplyScalar(Math.cos(heading)).addScaledVector(east, Math.sin(heading)); // screen up and right, as the arrow keys use
    const right = n.clone().cross(up).multiplyScalar(-1).normalize();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      const x = R * p.dot(right), y = R * p.dot(up);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const vw = el.clientWidth, vh = el.clientHeight;
    const w = Math.max(vw - inset.l - inset.r - 2 * pad, 100), h = Math.max(vh - inset.t - inset.b - 2 * pad, 100);
    const k = 2 * Math.tan(rad(camera.fov / 2)); // altitude -> ground height on screen
    const a = THREE.MathUtils.clamp((Math.max((x1 - x0) / w, (y1 - y0) / h) * vh) / k, MIN_ALT, MAX_ALT);
    const mpp = (a * k) / vh; // metres per pixel on arrival
    // the points' centre goes to the centre of the free area, not of the screen
    const tx = (x0 + x1) / 2 - ((inset.l - inset.r) / 2) * mpp, ty = (y0 + y1) / 2 + ((inset.t - inset.b) / 2) * mpp;
    flyToDir(n.clone().addScaledVector(right, tx / R).addScaledVector(up, ty / R), a);
  };
  const latLon = (v: THREE.Vector3) => ({ lat: THREE.MathUtils.radToDeg(Math.asin(v.y / v.length())), lon: THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z)) });
  const ray = new THREE.Raycaster(), planet = new THREE.Sphere(new THREE.Vector3(), R), hit = new THREE.Vector3();

  return {
    attachInput, latLon,
    /** Camera altitude (m), the tilt (radians from straight down) and the heading (radians clockwise from north). */
    get alt() { return alt; },
    get tilt() { return tilt; },
    get heading() { return heading; },
    set heading(h: number) { turn = null; heading = h; },
    /** Turns to north up by the short way round, easing over 0.6 s. */
    turnToNorth() {
      const h0 = Math.atan2(Math.sin(heading), Math.cos(heading)); // wrapped to (-π, π]
      heading = h0;
      turn = { h0, t0: performance.now() };
    },
    /** Back to straight down and north up, flying to `home`. */
    goHome() { tilt = heading = 0; flyToDir(home.dir, home.alt); },
    zoomBy: (f: number) => zoomTo(altGoal * f),
    flyToDir, flyToFit,
    /** The lat/lon of the ground under a screen point, if it is on the planet. */
    pick(ndc: THREE.Vector2) {
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectSphere(planet, hit) ? latLon(hit) : null;
    },
    /** Once a frame: moves the camera for the zoom, flight, tilt and heading. */
    step(dt: number, now: number) {
      if (turn) {
        const t = Math.min(1, (now - turn.t0) / 600);
        heading = turn.h0 * (1 - ease(t));
        if (t === 1) { heading = 0; turn = null; }
      }
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
      const fwd = +held.has('ArrowUp') - +held.has('ArrowDown'), side = +held.has('ArrowRight') - +held.has('ArrowLeft');
      if (controls.enabled && (fwd || side)) {
        anim = anchor = null;
        const n = camera.position.clone().normalize();
        const east = new THREE.Vector3(0, 1, 0).cross(n).normalize(), north = n.clone().cross(east);
        const up = north.clone().multiplyScalar(Math.cos(heading)).addScaledVector(east, Math.sin(heading)); // screen up on the ground
        const right = n.clone().cross(up).multiplyScalar(-1).normalize(); // screen right
        const dir = up.multiplyScalar(fwd).addScaledVector(right, side).normalize();
        // about 0.8 altitudes a second, so it crosses the screen in the same time at any height
        camera.position.applyAxisAngle(n.cross(dir).normalize(), dt * Math.min(0.8 * alt / R, 1));
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
