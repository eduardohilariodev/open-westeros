import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { arc, imperial, metric, nice } from '../measureUnits';

// Measuring wool: click a place (or the ground), click another, and a wool thread is laid between them.
// Each leg is a chain of joints joined by fixed-length bars, run with the Joint/Bar model of the Babylon playground this was
// ported from (gravity, elastic bars, damping). Gravity pulls toward the bottom of the screen wherever you are on the planet,
// as in the playground, so loose wool hangs in a belly; and the ground (the drawn relief) stops the joints, so a taut thread
// lies on the surface along the shortest way (a great circle). While a leg is open its free end is a hand following the
// cursor, holding the wool up with slack; a click pins it down and the bar length reels in to the ground distance, so the
// thread stretches straight (gravity fades as the slack goes). Distances are on the ground of the planet (radius R), not
// along the thread, so relief does not lengthen a measurement. Each placed point carries a push pin (public/textures/pin.png).

const N = 64, S = 3, SIDES = 6; // joints per leg; drawn samples between joints; sides of the thread
const M = N * S + 1;
const DAMPING = 0.93, ELASTICITY = 0.3, STEPS_PER_SECOND = 240; // the playground's bars and damping, run at a fixed rate so the wool settles in the same time at any frame rate
const GRAVITY_PX = 240; // our own gravity: a pull toward the bottom of the screen in screen px per second squared, so loose wool falls the same at any zoom, frame rate or joint count
const FRICTION = 0.85, REEL = 0.07, SLACK = 1.05; // on the ground; how fast the wool is drawn tight; wool let out per metre of leg while the hand holds it (a loose belly)
const BULGE = 0.12; // slack wool puffs up a little: up to this much fatter than a taut thread
const PIN_PX = 46, PIN_TIP = 0.525, PIN_SINK = 0.08; // the pin's height on screen (px); where its needle is across the picture (0 left, 1 right); the share of its height pushed into the ground
const PIN_ASPECT = 160 / 345; // the picture's width over its height
const PIN_HEAD = 0.77; // how high the centre of the pin's head is, as a share of its height
const WIRE_PX = 5, TWIST_PX = 12.5, MAX_KNOTS = 16; // thread width on screen (px), and the length of one twist of its plies
const CLICK_SLOP_PX = 4; // a press that moves further than this is a drag of the globe, not a click

type V3 = [number, number, number];
export type Leg = { from: string; to: string; m: number; live: boolean };
export type MeasureState = { legs: Leg[]; total: number; active: boolean };

/** Twisted wool in the interface's burgundy: dark diagonal plies and a few light fuzz strokes, one gold-lit ply. */
function woolTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8c2535'; g.fillRect(0, 0, 64, 32);
  g.lineWidth = 4; g.strokeStyle = '#561420';
  for (let x = -32; x < 96; x += 16) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 32, 0); g.stroke(); }
  g.lineWidth = 1.2; g.strokeStyle = '#e3b04b';
  for (let x = -32; x < 96; x += 16) { g.beginPath(); g.moveTo(x + 7, 32); g.lineTo(x + 39, 0); g.stroke(); }
  g.strokeStyle = '#4a0f1a'; g.lineWidth = 1;
  for (let i = 0; i < 40; i++) { const x = (i * 37) % 64, y = (i * 13) % 32; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 3, y - 2); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Across the shadow ribbon: dark in the middle, fading to nothing at both edges. */
function ribbonTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 32;
  const g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0, 'rgba(10,6,2,0)'); grad.addColorStop(0.5, 'rgba(10,6,2,0.6)'); grad.addColorStop(1, 'rgba(10,6,2,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft dark spot, fading to nothing at its edge: the pin's shadow on the ground. */
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(10,6,2,0.75)'); grad.addColorStop(0.45, 'rgba(10,6,2,0.4)'); grad.addColorStop(1, 'rgba(10,6,2,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Leg3 {
  p = new Float64Array((N + 1) * 3); // joint positions, planet-centred m
  v = new Float64Array((N + 1) * 3);
  floor = new Float64Array(N + 1);
  seeded = false; // joints are placed on the first frame, when the scale is known
  rest = 0; target = 0; len = 0; // bar length of the whole chain now / reeling to (m); ground distance (m)
  g = 0; // gravity this frame (m per step squared)
  bulge = 1; // thickness now, as a multiple of the taut thread's
  gravity = 1; // 1 while the wool is slack, fading to 0 as it is drawn straight
  asleep = false; dirty = true;
  bDir: THREE.Vector3; // the free end's direction: the hand, or the pin
  pinned = false;
  mesh: THREE.Mesh;
  pos: Float32Array; nor: Float32Array; uv: Float32Array;
  shade: THREE.Mesh; shadePos = new Float32Array((N + 1) * 2 * 3); shadeMid = new Float64Array((N + 1) * 3); // the shadow on the ground: a ribbon, two vertices a joint, and its centreline
  knots: THREE.Mesh[] = [];
  tag = document.createElement('div');
  tagObj: CSS2DObject;
  tagText = '';
  q = new Float64Array(M * 3); cum = new Float64Array(M); // drawn samples and their distance along the thread

  constructor(public a: THREE.Vector3, hand: THREE.Vector3, material: THREE.Material, shadowMaterial: THREE.Material, public group: THREE.Group) {
    this.bDir = hand.clone();
    const sGeo = new THREE.BufferGeometry(), sIndex: number[] = [], sUv = new Float32Array((N + 1) * 2 * 2);
    for (let i = 0; i <= N; i++) { sUv[i * 4 + 1] = 0; sUv[i * 4 + 3] = 1; } // v runs across the ribbon: the soft edge is in the texture
    for (let i = 0; i < N; i++) sIndex.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    sGeo.setAttribute('position', new THREE.BufferAttribute(this.shadePos, 3).setUsage(THREE.DynamicDrawUsage));
    sGeo.setAttribute('uv', new THREE.BufferAttribute(sUv, 2));
    sGeo.setIndex(sIndex);
    this.shade = new THREE.Mesh(sGeo, shadowMaterial);
    this.shade.frustumCulled = false; this.shade.renderOrder = 249; // under the wool, over the map
    group.add(this.shade);
    const verts = M * (SIDES + 1);
    this.pos = new Float32Array(verts * 3); this.nor = new Float32Array(verts * 3); this.uv = new Float32Array(verts * 2);
    const index: number[] = [];
    for (let m = 0; m < M - 1; m++) for (let j = 0; j < SIDES; j++) {
      const i0 = m * (SIDES + 1) + j, i1 = i0 + 1, i2 = i0 + SIDES + 1, i3 = i2 + 1;
      index.push(i0, i2, i1, i1, i2, i3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 250;
    group.add(this.mesh);
    this.tag.className = 'measure-tag';
    this.tagObj = new CSS2DObject(this.tag);
    group.add(this.tagObj);
  }

  dispose() {
    this.group.remove(this.mesh, this.shade, this.tagObj, ...this.knots);
    this.mesh.geometry.dispose(); this.shade.geometry.dispose();
    this.tag.remove();
  }
}

/**
 * `groundAt(p)`: height of the drawn ground (m) under a point. `pick(ndc)`: lat/lon of the ground under a screen point.
 * `el`: the canvas, where clicks add points. `labelsEl`: the place names' layer, where the pointer may also rest.
 * `sun`: toward the sun in east/north/up, the one the relief is lit by, so the wool's shadow falls the way the mountains' do.
 */
export function createMeasure(scene: THREE.Scene, el: HTMLElement, labelsEl: HTMLElement, R: number, groundAt: (p: THREE.Vector3) => number, pick: (ndc: THREE.Vector2) => { lat: number; lon: number } | null, sun: number[]) {
  const group = new THREE.Group();
  scene.add(group);
  // The wool is drawn over the relief, never into it (no depth test, and in the transparent pass so it comes after the map's
  // lines), so a ridge cannot cut it. Without a depth test the far side of the planet would show through, so the shader drops
  // what is past the horizon.
  const horizon = { value: -1 }; // cos of the angle from the camera's direction to the horizon (R / camera distance)
  const overTerrain = (m: THREE.Material) => {
    m.depthTest = false; m.depthWrite = false; m.transparent = true;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uHorizon = horizon;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; uniform float uHorizon;').replace('void main() {', 'void main() {\n if (dot(normalize(vWp), normalize(cameraPosition)) < uHorizon) discard;');
    };
    return m;
  };
  const wool = overTerrain(new THREE.MeshLambertMaterial({ map: woolTexture(), emissive: 0x2b0a12 }));
  const knotMat = overTerrain(new THREE.MeshLambertMaterial({ color: 0x240a10 }));
  const shadowRibbon = overTerrain(new THREE.MeshBasicMaterial({ map: ribbonTexture(), toneMapped: false, side: THREE.DoubleSide }));
  const SUN_RUN = Math.hypot(sun[0], sun[1]) / sun[2]; // metres a shadow runs along the ground per metre of height (the relief's sun: lower is longer)
  const SUN_STRETCH = Math.hypot(sun[0], sun[1], sun[2]) / sun[2]; // a round shadow is this much longer than wide
  const knotGeo = new THREE.SphereGeometry(1, 10, 8);
  // A push pin, one per placed point. The picture's last PIN_SINK of its height is cut off, so the needle looks pushed into the
  // ground, and it throws a shadow like the wool's (castShade): a soft streak for the needle, a blob for the head, a dark spot
  // where it goes in. Drawn over the relief like a map marker (so no depth test: hidden on the far side by hand, in update).
  // The pin is a group one pin-height tall, so scaling the group sizes the picture.
  const loadPin = () => {
    const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/pin.png`);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const pinTex = loadPin();
  pinTex.repeat.set(1, 1 - PIN_SINK); pinTex.offset.set(0, PIN_SINK); // keep the top of the picture: uv starts at the bottom
  const pinMat = new THREE.SpriteMaterial({ map: pinTex, depthTest: false, transparent: true, toneMapped: false });
  const castMat = overTerrain(new THREE.MeshBasicMaterial({ map: shadowTexture(), toneMapped: false, side: THREE.DoubleSide }));
  const makePin = (material: THREE.SpriteMaterial = pinMat) => {
    const pin = new THREE.Group(), body = new THREE.Sprite(material);
    body.center.set(PIN_TIP, 0); body.scale.set(PIN_ASPECT, 1 - PIN_SINK, 1); body.renderOrder = 260;
    pin.add(body);
    const cast = new THREE.Mesh(new THREE.BufferGeometry(), castMat); // three flat quads on the ground, soft-edged by the texture
    cast.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    cast.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]), 2));
    cast.geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
    cast.frustumCulled = false; cast.renderOrder = 249;
    group.add(pin, cast);
    return { pin, cast };
  };
  const dropPin = (p: { pin: THREE.Group; cast: THREE.Mesh }) => { group.remove(p.pin, p.cast); p.cast.geometry.dispose(); };
  // The pin on the pointer while measuring: the same pin at the same size, in the scene, so the atmosphere veils it as it does the
  // placed ones. Its needle's tip is on the ground point under the pointer, where the wool's free end is; pressing the button clips the
  // bottom off it (it eases into the clipped pin a click leaves) and the dark spot where it goes in grows; releasing lays the
  // point. It has its own texture and material, for the crop that animates.
  const handTex = loadPin(), handMat = new THREE.SpriteMaterial({ map: handTex, depthTest: false, transparent: true, toneMapped: false });
  const handPin = makePin(handMat), handBody = handPin.pin.children[0] as THREE.Sprite;
  handPin.pin.visible = handPin.cast.visible = false; handBody.renderOrder = 261;
  let press = 0, pressGoal = 0; // 0: standing, 1: pressed in
  const points: { dir: THREE.Vector3; name?: string; pin: THREE.Group; cast: THREE.Mesh }[] = [];
  const legs: Leg3[] = [];
  let live: Leg3 | null = null, active = false, radius = 0, lastEmit = 0, lastFrame = performance.now(), lastKey = '';
  const pull = new THREE.Vector3(), lastPull = new THREE.Vector3(0, -1, 0); // the way gravity pulls: the bottom of the screen
  const pointer = { x: 0, y: 0, over: false };
  const ndc = new THREE.Vector2(), tv = new THREE.Vector3();
  const toDir = (ll: { lat: number; lon: number }) => {
    const p = THREE.MathUtils.degToRad(ll.lat), l = THREE.MathUtils.degToRad(ll.lon);
    return new THREE.Vector3(Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l));
  };
  const nameOf = (d: THREE.Vector3) => {
    const lat = THREE.MathUtils.radToDeg(Math.asin(d.y)), lon = THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z));
    return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  };
  const arcOf = (a: THREE.Vector3, b: THREE.Vector3) => arc([a.x, a.y, a.z], [b.x, b.y, b.z], R);
  const CLEAR = 5; // the thread's centre rides this many of its radii above the ground (a bulging thread is up to 1.6 radii thick): clear of it, and high enough that its shadow falls well apart from it
  const ground = (dir: THREE.Vector3) => R + groundAt(tv.copy(dir).multiplyScalar(R)) + radius * CLEAR;

  const state = (): MeasureState => {
    const out: Leg[] = legs.map((l, i) => ({ from: points[i].name ?? nameOf(points[i].dir), to: points[i + 1].name ?? nameOf(points[i + 1].dir), m: l.len, live: false }));
    if (live) out.push({ from: points[points.length - 1].name ?? nameOf(points[points.length - 1].dir), to: 'the cursor', m: live.len, live: true });
    return { legs: out, total: out.reduce((s, l) => s + (l.live ? 0 : l.m), 0), active }; // the open leg, still following the cursor, is shown but not counted
  };
  const api = {
    onChange: (_: MeasureState) => {},
    get active() { return active; },
    get state() { return state(); },
  };
  const emit = () => { lastEmit = performance.now(); api.onChange(state()); };

  const newLive = (from: THREE.Vector3) => { live = new Leg3(from, from, wool, shadowRibbon, group); };
  const drop = (l: Leg3 | null) => l?.dispose();

  /** Lay a point: the first starts the wool, each later one pins the open leg and opens the next. */
  function add(dir: THREE.Vector3, name?: string) {
    if (!active) return;
    const d = dir.clone().normalize();
    const last = points[points.length - 1];
    if (last && arcOf(last.dir, d) < 1e-3 * R) return; // the same spot twice
    points.push({ dir: d, name, ...makePin() });
    if (live) { live.bDir.copy(d); live.pinned = true; live.asleep = false; legs.push(live); }
    newLive(d);
    emit();
  }
  function undo() {
    if (!points.length) return;
    dropPin(points.pop()!); drop(live); live = null;
    if (legs.length) drop(legs.pop()!);
    if (!active && points.length < 2) clear(); // a lone pin is not a measurement
    else if (points.length && active) newLive(points[points.length - 1].dir);
    emit();
  }
  function clear() {
    legs.forEach(drop); legs.length = 0; drop(live); live = null;
    points.forEach(dropPin); points.length = 0;
    emit();
  }
  function setActive(on: boolean) {
    if (on === active) return;
    if (on) clear();
    else if (legs.length) { drop(live); live = null; }
    else clear(); // a lone pin is not a measurement
    active = on;
    document.body.classList.toggle('measuring', on);
    emit();
  }

  // ---------- pointer: a click (not a drag) on the ground lays a point; the hand follows the pointer ----------
  let down: { x: number; y: number } | null = null;
  const ndcOf = (e: PointerEvent | { x: number; y: number }) => {
    const x = 'clientX' in e ? e.clientX : e.x, y = 'clientY' in e ? e.clientY : e.y;
    return ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  };
  const overMap = (t: EventTarget | null) => t === el || (t instanceof Element && labelsEl.contains(t)); // not over a card or a button
  addEventListener('pointermove', (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.over = overMap(e.target);
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) pressGoal = 0; // it is a drag of the globe: the pin lifts
  });
  addEventListener('pointerdown', (e) => { // capture: before a place's name takes the press
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.over = overMap(e.target);
    if (active && pointer.over && e.isPrimary && e.button === 0 && !e.shiftKey) pressGoal = 1;
  }, true);
  const release = () => { pressGoal = 0; };
  addEventListener('pointerup', release, true);
  addEventListener('pointercancel', release, true);
  el.addEventListener('pointerdown', (e) => { down = e.isPrimary && e.button === 0 && !e.shiftKey ? { x: e.clientX, y: e.clientY } : null; });
  el.addEventListener('pointerup', (e) => {
    if (!active || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return;
    down = null;
    const hit = pick(ndcOf(e));
    if (hit) add(toDir(hit));
  });
  addEventListener('keydown', (e) => {
    if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
    const z = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
    if (z && points.length) { e.preventDefault(); undo(); } // Ctrl+Z takes back the last pin, measuring or not
    else if (active && e.key === 'Escape') setActive(false); // the first Esc stops measuring and keeps the result...
    else if (!active && e.key === 'Escape' && !e.repeat && points.length && confirm(`Remove all ${points.length} points from the map?`)) clear(); // ...the next clears it, once confirmed
    else if (active && e.key === 'Backspace') { e.preventDefault(); undo(); }
  });

  // ---------- physics ----------
  function simulate(l: Leg3, A: V3, B: V3, steps: number) {
    const { p, v, floor } = l;
    p.set(A, 0); p.set(B, N * 3); v.fill(0, 0, 3); v.fill(0, N * 3);
    let fastest = 0;
    for (let s = 0; s < steps; s++) {
      l.rest += (l.target - l.rest) * REEL;
      const link = l.rest / N;
      for (let i = 1; i < N; i++) { // speeds from the forces of this step...
        const o = i * 3, x = p[o], y = p[o + 1], z = p[o + 2], g = l.g * l.gravity;
        let vx = v[o] + pull.x * g, vy = v[o + 1] + pull.y * g, vz = v[o + 2] + pull.z * g;
        for (const k of [o - 3, o + 3]) { // each bar pulls or pushes toward its rest length
          const dx = p[k] - x, dy = p[k + 1] - y, dz = p[k + 2] - z, d = Math.hypot(dx, dy, dz);
          if (d > 1e-9) { const f = ((d - link) * ELASTICITY) / d; vx += dx * f; vy += dy * f; vz += dz * f; }
        }
        v[o] = vx * DAMPING; v[o + 1] = vy * DAMPING; v[o + 2] = vz * DAMPING;
      }
      for (let i = 1; i < N; i++) { // ...then applied; the ground stops a joint and drags on it
        const o = i * 3;
        p[o] += v[o]; p[o + 1] += v[o + 1]; p[o + 2] += v[o + 2];
        const r = Math.hypot(p[o], p[o + 1], p[o + 2]);
        if (r < floor[i]) {
          const k = floor[i] / r, nx = p[o] * k / floor[i], ny = p[o + 1] * k / floor[i], nz = p[o + 2] * k / floor[i];
          p[o] *= k; p[o + 1] *= k; p[o + 2] *= k;
          const vr = v[o] * nx + v[o + 1] * ny + v[o + 2] * nz;
          if (vr < 0) { v[o] -= nx * vr; v[o + 1] -= ny * vr; v[o + 2] -= nz * vr; }
          v[o] *= FRICTION; v[o + 1] *= FRICTION; v[o + 2] *= FRICTION;
        }
        fastest = Math.max(fastest, Math.abs(v[o]) + Math.abs(v[o + 1]) + Math.abs(v[o + 2]));
      }
    }
    if (l.pinned && Math.abs(l.rest - l.target) < 1e-3 * l.target && fastest < (l.rest / N) * 1e-3) l.asleep = true;
  }

  // ---------- drawing ----------
  const n = new THREE.Vector3(), b = new THREE.Vector3(), t = new THREE.Vector3(), up = new THREE.Vector3();
  function rebuild(l: Leg3, r: number) {
    const { p, q, cum } = l;
    for (let i = 0; i < N; i++) for (let s = 0; s < S; s++) { // sample each bar, bent round the planet: a straight bar would cut under the ground
      const f = s / S, o = i * 3, m = (i * S + s) * 3;
      const x = p[o] + (p[o + 3] - p[o]) * f, y = p[o + 1] + (p[o + 4] - p[o + 1]) * f, z = p[o + 2] + (p[o + 5] - p[o + 2]) * f;
      const ra = Math.hypot(p[o], p[o + 1], p[o + 2]), rb = Math.hypot(p[o + 3], p[o + 4], p[o + 5]), k = (ra + (rb - ra) * f) / (Math.hypot(x, y, z) || 1);
      q[m] = x * k; q[m + 1] = y * k; q[m + 2] = z * k;
    }
    q.set(p.subarray(N * 3, N * 3 + 3), (M - 1) * 3);
    cum[0] = 0;
    for (let m = 1; m < M; m++) cum[m] = cum[m - 1] + Math.hypot(q[m * 3] - q[m * 3 - 3], q[m * 3 + 1] - q[m * 3 - 2], q[m * 3 + 2] - q[m * 3 - 1]);
    const pitch = r * (TWIST_PX / WIRE_PX) * 2;
    for (let m = 0; m < M; m++) {
      const a = Math.max(0, m - 1) * 3, c = Math.min(M - 1, m + 1) * 3, o = m * 3;
      t.set(q[c] - q[a], q[c + 1] - q[a + 1], q[c + 2] - q[a + 2]).normalize();
      up.set(q[o], q[o + 1], q[o + 2]).normalize();
      n.crossVectors(up, t);
      if (n.lengthSq() < 1e-12) n.set(1, 0, 0).cross(t);
      n.normalize(); b.crossVectors(t, n).normalize();
      for (let j = 0; j <= SIDES; j++) {
        const ang = (j / SIDES) * Math.PI * 2, c0 = Math.cos(ang), s0 = Math.sin(ang), vi = (m * (SIDES + 1) + j) * 3;
        const dx = n.x * c0 + b.x * s0, dy = n.y * c0 + b.y * s0, dz = n.z * c0 + b.z * s0;
        l.pos[vi] = q[o] + dx * r; l.pos[vi + 1] = q[o + 1] + dy * r; l.pos[vi + 2] = q[o + 2] + dz * r;
        l.nor[vi] = dx; l.nor[vi + 1] = dy; l.nor[vi + 2] = dz;
        const ui = (m * (SIDES + 1) + j) * 2;
        l.uv[ui] = cum[m] / pitch; l.uv[ui + 1] = j / SIDES;
      }
    }
    const g = l.mesh.geometry;
    for (const name of ['position', 'normal', 'uv']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    placeKnots(l, r);
    placeShade(l, r);
    l.dirty = false;
  }
  /**
   * The wool's shadow: each joint's spot on the ground, moved away from the sun (the relief's, in the north-west) by its height
   * above the ground times SUN_RUN, as a soft ribbon the thread's width. A thread lying on the ground shades just beside itself;
   * wool held up in a belly throws its shadow well clear.
   */
  function placeShade(l: Leg3, r: number) {
    const { p, floor, shadeMid: c, shadePos: out } = l, onGround = radius * 0.2;
    for (let i = 0; i <= N; i++) {
      const o = i * 3, len = Math.hypot(p[o], p[o + 1], p[o + 2]) || 1, ux = p[o] / len, uy = p[o + 1] / len, uz = p[o + 2] / len;
      const g = floor[i] - radius * CLEAR, h = Math.max(0, len - g), run = (h * SUN_RUN) / Math.hypot(sun[0], sun[1]);
      const eh = Math.hypot(ux, uz) || 1, ex = uz / eh, ez = -ux / eh; // east, then north = up x east
      const nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex;
      const ox = -(sun[0] * ex + sun[1] * nx) * run, oy = -(sun[1] * ny) * run, oz = -(sun[0] * ez + sun[1] * nz) * run;
      const at = g + onGround, x = ux * at + ox, y = uy * at + oy, z = uz * at + oz, k = at / (Math.hypot(x, y, z) || 1);
      c[o] = x * k; c[o + 1] = y * k; c[o + 2] = z * k; // back on the ground's sphere
    }
    for (let i = 0; i <= N; i++) {
      const o = i * 3, a = Math.max(0, i - 1) * 3, b = Math.min(N, i + 1) * 3;
      t.set(c[b] - c[a], c[b + 1] - c[a + 1], c[b + 2] - c[a + 2]).normalize();
      up.set(c[o], c[o + 1], c[o + 2]).normalize();
      n.crossVectors(up, t).normalize(); // across the shadow, along the ground
      if (!(n.lengthSq() > 0)) n.set(1, 0, 0);
      const w = r * 1.2;
      out[i * 6] = c[o] - n.x * w; out[i * 6 + 1] = c[o + 1] - n.y * w; out[i * 6 + 2] = c[o + 2] - n.z * w;
      out[i * 6 + 3] = c[o] + n.x * w; out[i * 6 + 4] = c[o + 1] + n.y * w; out[i * 6 + 5] = c[o + 2] + n.z * w;
    }
    (l.shade.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
  /**
   * A pin's shadow, cast by the same sun as the wool's: a streak for the needle running to where the head's shadow falls, the
   * head's blob (a sphere's shadow, stretched 1/sin of the sun's height), and a dark spot where the needle goes in.
   * `base`: the ground's radius under the pin (m); `H`: the pin's height (m); `held`: how far the needle's tip is held above the
   * ground (m), which moves the whole shadow along; `spot`: the dark spot's size, 0 to 1 (none while the pin is in the air).
   */
  function castShade(cast: THREE.Mesh, dir: THREE.Vector3, base: number, H: number, held = 0, spot = 1) {
    const { x: ux, y: uy, z: uz } = dir, eh = Math.hypot(ux, uz) || 1, ex = uz / eh, ez = -ux / eh; // east; north = up x east
    const nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex, hs = Math.hypot(sun[0], sun[1]) || 1;
    const dx = -(sun[0] * ex + sun[1] * nx) / hs, dy = -(sun[1] * ny) / hs, dz = -(sun[0] * ez + sun[1] * nz) / hs; // along the ground, away from the sun
    const sx = uy * dz - uz * dy, sy = uz * dx - ux * dz, sz = ux * dy - uy * dx; // across it
    const pos = cast.geometry.getAttribute('position') as THREE.BufferAttribute;
    const quad = (q: number, along: number, a: number, b: number) => { // centre `along` m from the needle, half-length a along the shadow, half-width b across
      const cx = ux * base + dx * along, cy = uy * base + dy * along, cz = uz * base + dz * along;
      ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([i, j], k) => pos.setXYZ(q * 4 + k, cx + dx * a * i + sx * b * j, cy + dy * a * i + sy * b * j, cz + dz * a * i + sz * b * j));
    };
    const head = PIN_HEAD * H * SUN_RUN, r = (PIN_ASPECT * H) / 2, off = held * SUN_RUN; // where the head's shadow falls; the head's radius (it is nearly the picture's width); the shadow's shift for a pin held up
    quad(0, off + head / 2, head / 2, 0.06 * H);
    quad(1, off + head, r * SUN_STRETCH, r);
    quad(2, 0, 0.1 * H * spot, 0.1 * H * spot);
    pos.needsUpdate = true;
  }
  /** A dark knot at every nice distance along the thread, like the marks on a measuring cord (the ends are the pins). */
  function placeKnots(l: Leg3, r: number) {
    const step = l.len > 0 ? nice(l.len / 6) : 0, total = l.cum[M - 1];
    const at: { f: number }[] = [];
    if (step) for (let k = 1; k * step < l.len - step * 0.3 && at.length < MAX_KNOTS; k++) at.push({ f: (k * step) / l.len });
    while (l.knots.length < at.length) { const k = new THREE.Mesh(knotGeo, knotMat); k.renderOrder = 251; k.frustumCulled = false; l.knots.push(k); group.add(k); }
    l.knots.forEach((k, i) => {
      k.visible = i < at.length;
      if (!k.visible) return;
      const d = at[i].f * total;
      let m = 1;
      while (m < M - 1 && l.cum[m] < d) m++;
      const f = (d - l.cum[m - 1]) / (l.cum[m] - l.cum[m - 1] || 1), o = m * 3;
      k.position.set(l.q[o - 3] + (l.q[o] - l.q[o - 3]) * f, l.q[o - 2] + (l.q[o + 1] - l.q[o - 2]) * f, l.q[o - 1] + (l.q[o + 2] - l.q[o - 1]) * f);
      k.scale.setScalar(r * 1.25);
    });
    const mid = (M - 1) >> 1, text = `${metric(l.len)} · ${imperial(l.len)}`;
    if (text !== l.tagText) { l.tagText = text; l.tag.textContent = text; }
    l.tagObj.position.set(l.q[mid * 3], l.q[mid * 3 + 1], l.q[mid * 3 + 2]);
  }

  const camDir = new THREE.Vector3();
  const hideHand = () => { handPin.pin.visible = handPin.cast.visible = false; document.body.classList.remove('measure-pin'); };
  return Object.assign(api, {
    add, undo, clear, setActive,
    /** Once a frame, after the camera has moved. `mpp`: metres per screen pixel, which sets the thread's thickness. */
    update(camera: THREE.PerspectiveCamera, mpp: number) {
      if (!points.length && !active) { hideHand(); return; }
      const frameAt = performance.now(), dtSec = (frameAt - lastFrame) / 1000, steps = Math.min(8, Math.max(1, Math.round(dtSec * STEPS_PER_SECOND))); // ponytail: capped, so a very slow frame runs the wool slower, not the page
      lastFrame = frameAt;
      pull.set(0, -1, 0).applyQuaternion(camera.quaternion); // screen-down, in the planet's frame
      if (pull.dot(lastPull) < Math.cos(THREE.MathUtils.degToRad(3))) { // turned the view: loose wool hangs a new way
        lastPull.copy(pull);
        [...legs, live].forEach((l) => l && (l.asleep = false));
      }
      const raw = (mpp * WIRE_PX) / 2, r = 1.2 ** Math.round(Math.log(raw) / Math.log(1.2)); // in steps, so a zoom does not keep waking the wool
      if (r !== radius) { radius = r; [...legs, live].forEach((l) => l && (l.asleep = false, l.dirty = true)); }
      const cursor = active && pointer.over ? pick(ndcOf(pointer)) : null; // the ground under the pointer
      const cd = cursor ? toDir(cursor) : null;
      if (live && cd) live.bDir.copy(cd); // the wool's free end is exactly where the pin's needle is
      const cosLimit = R / camera.position.length(), cam = camDir.copy(camera.position).normalize();
      horizon.value = cosLimit;
      for (const l of [...legs, live]) {
        if (!l) continue;
        l.len = arcOf(l.a, l.bDir);
        l.target = l.pinned ? l.len : l.len * SLACK + 10 * radius;
        l.g = (GRAVITY_PX * mpp) / STEPS_PER_SECOND ** 2;
        l.gravity = !l.pinned ? 1 : l.target > 0 ? Math.min(1, Math.max(0, (l.rest / l.target - 1) * 25)) : 0; // a drawn-straight thread does not sag
        if (!l.asleep) {
          const A = ground(l.a), B = ground(l.bDir);
          if (!l.seeded) { // coiled at the start, with a nudge so the bars have a direction to unfold in
            l.seeded = true; l.rest = l.target;
            for (let i = 0; i <= N; i++) {
              const j = (((i * 0.37) % 1) - 0.5) * radius;
              l.p[i * 3] = l.a.x * A + j; l.p[i * 3 + 1] = l.a.y * A + j * 0.7; l.p[i * 3 + 2] = l.a.z * A - j * 0.5;
            }
          }
          for (let i = 0; i <= N; i++) { tv.set(l.p[i * 3], l.p[i * 3 + 1], l.p[i * 3 + 2]); l.floor[i] = R + groundAt(tv) + radius * CLEAR; }
          simulate(l, [l.a.x * A, l.a.y * A, l.a.z * A], [l.bDir.x * B, l.bDir.y * B, l.bDir.z * B], steps);
          l.dirty = true;
        }
        // slack wool puffs up and thins as it is drawn tight
        l.bulge = 1 + BULGE * Math.min(1, Math.max(0, (l.rest / Math.max(l.len, 10 * radius) - 1) / 0.3));
        if (l.dirty) rebuild(l, radius * l.bulge);
        // the length tag shows only on the near side of the planet
        const mid = ((M - 1) >> 1) * 3;
        tv.set(l.q[mid], l.q[mid + 1], l.q[mid + 2]).normalize();
        l.tag.style.display = tv.dot(cam) > cosLimit && l.len > 0 ? '' : 'none';
      }
      for (const p of points) { // each pin: its needle's entry on the ground, a fixed height on screen, only on the near side
        const base = R + groundAt(tv.copy(p.dir).multiplyScalar(R)), H = PIN_PX * mpp;
        p.pin.position.copy(p.dir).multiplyScalar(base);
        p.pin.scale.setScalar(H);
        p.cast.visible = p.pin.visible = p.dir.dot(cam) > cosLimit;
        if (p.pin.visible) castShade(p.cast, p.dir, base, H);
      }
      // the pin on the pointer: standing on the ground point, clipped at the bottom while the button is held
      press += (pressGoal - press) * Math.min(1, dtSec * 20);
      const showHand = !!cd && cd.dot(cam) > cosLimit;
      handPin.pin.visible = handPin.cast.visible = showHand;
      document.body.classList.toggle('measure-pin', showHand); // the native cursor gives way to it (style.css)
      if (cd && showHand) {
        const base = R + groundAt(tv.copy(cd).multiplyScalar(R)), H = PIN_PX * mpp, sink = PIN_SINK * press;
        handPin.pin.position.copy(cd).multiplyScalar(base);
        handPin.pin.scale.setScalar(H);
        handBody.scale.set(PIN_ASPECT, 1 - sink, 1); // the needle's tip stays on the ground point; the clip takes the bottom off it
        handTex.repeat.set(1, 1 - sink); handTex.offset.set(0, sink);
        castShade(handPin.cast, cd, base, H, 0, press);
      }
      const key = metric(live?.len ?? 0), now = performance.now();
      if (live && key !== lastKey && now - lastEmit > 100) { lastKey = key; emit(); }
    },
  });
}
