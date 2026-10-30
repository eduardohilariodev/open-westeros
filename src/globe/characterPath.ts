import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { toVector } from '../geo';
import { lineGeometry, lineMesh } from './gpuVector';
import { chevrons, densify, makeRoute, pointAt, segmentsUpTo, type Pt } from './pathMath';
import { chaikin } from './rivers';

// A character's journey drawn on the map (src/characters.json, tools/characters): the whole route faint, the part walked so far
// bright with arrowheads along it, and the house sigil as the head at the character's position. A player walks the steps
// one by one; the camera follows the head (cameraRig.follow) and the line draws on behind it.
export interface CharStep { chapters: [number, number]; pts: Pt[]; kind: 'travel' | 'stay' | 'death' | 'lost'; from?: string; to?: string; at?: string }
export interface Character { id: string; name: string; wiki: string; house: [string, string, string]; color: string; steps: CharStep[] }
type Inset = { l: number; r: number; t: number; b: number };

const LIFT = 343; // m above the baked ground, like terrain.highlight (R - 7 + 350)
const STEP_DEG = 0.01; // a vertex every ~1.2 km, so the drawn line is never far behind the head
const M_PER_S = 260_000; // a leg plays at about 260 km per second of screen time, within MIN_S..MAX_S
const MIN_S = 2, MAX_S = 9, DWELL_S = 1.4;
const CASING = '#2a1a08', ARROW = '#fff3cf';

export function createCharacterLayer(o: {
  scene: THREE.Scene; R: number; groundAt: (p: THREE.Vector3) => number;
  rig: { follow(dir: (() => THREE.Vector3) | null, alt?: number, inset?: () => Inset): void; flyToFit(pts: THREE.Vector3[], inset: Inset, pad: number): void; readonly alt: number };
  covered: () => Inset;
}) {
  const { scene, R, groundAt, rig } = o, r = R - 7 + LIFT;
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const headEl = document.createElement('div');
  headEl.className = 'char-head';
  const headImg = document.createElement('img'); // its src is the character's house sigil, set when one is opened
  headImg.alt = '';
  headEl.append(headImg, document.createElement('b'));
  headImg.onerror = () => headEl.classList.add('noimg');
  headImg.onload = () => headEl.classList.remove('noimg');
  const head = new CSS2DObject(headEl);
  head.visible = false;
  scene.add(head);

  // ---- state of the open character ----
  let ch: Character | null = null;
  let route = makeRoute([]);
  let stepLeg: number[] = [], stepFrom: number[] = [], stepTo: number[] = [], stepLen: number[] = [];
  let lineGeo: ReturnType<typeof lineGeometry> | null = null;
  let arrowGeo: ReturnType<typeof lineGeometry> | null = null;
  let arrowAt: number[] = [], arrowBucket = -1;
  let ghost: THREE.Mesh | null = null, casing: THREE.Mesh | null = null, line: THREE.Mesh | null = null, aCasing: THREE.Mesh | null = null, arrows: THREE.Mesh | null = null;
  const state = { i: -1, p: 0, playing: false, mode: 'all' as 'all' | 'step' };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((f) => f());
  const headDir = new THREE.Vector3(0, 0, 1);

  const clear = () => {
    for (const m of [ghost, casing, line, aCasing, arrows]) m?.geometry.dispose();
    group.clear();
    ghost = casing = line = aCasing = arrows = lineGeo = arrowGeo = null;
    arrowBucket = -1;
  };
  const front = (m: THREE.Mesh) => { Object.assign(m.material, { depthTest: false, transparent: true }); group.add(m); return m; };

  const build = (c: Character) => {
    const legs: Pt[][] = [];
    stepLeg = []; stepFrom = []; stepTo = []; stepLen = [];
    let s = 0;
    for (const st of c.steps) {
      if (st.kind === 'travel') {
        const leg = densify(chaikin(st.pts, 2), STEP_DEG);
        stepLeg.push(legs.push(leg) - 1);
      } else stepLeg.push(-1);
    }
    route = makeRoute(legs);
    c.steps.forEach((_, i) => {
      stepFrom.push(s);
      if (stepLeg[i] >= 0) s += route.cum[stepLeg[i]].at(-1)!;
      stepTo.push(s);
      stepLen.push(stepTo[i] - stepFrom[i]);
    });
    clear();
    const color = c.color === '#808080' || !c.color ? '#e9c46a' : c.color;
    lineGeo = lineGeometry(legs, r, false);
    ghost = front(lineMesh(lineGeometry(legs, r, false), color, 2.4, 10_020, 0.45));
    casing = front(lineMesh(lineGeo, CASING, 6, 10_021));
    line = front(lineMesh(lineGeo, color, 3.4, 10_022));
    aCasing = front(lineMesh(lineGeometry([[[0, 0], [0, 0]]], r, false), CASING, 5, 10_023));
    arrows = front(lineMesh(aCasing.geometry as ReturnType<typeof lineGeometry>, ARROW, 2.2, 10_024));
    // the arrowhead and its casing share one geometry, swapped when the spacing changes
    arrowGeo = aCasing.geometry as ReturnType<typeof lineGeometry>;
    headEl.style.setProperty('--c', color);
    headImg.src = `${import.meta.env.BASE_URL}sigils/${c.house[1]}.webp`;
  };

  /**
   * Arrowheads for the camera's height, so they read at any zoom and never merge. Spacing steps by powers of two and tips sit
   * on its multiples, so zooming only adds or drops every other arrow and never slides one; size follows height in 5% steps.
   */
  const fitArrows = () => {
    if (!arrows || !aCasing || !route.total) return;
    const want = THREE.MathUtils.clamp(rig.alt * 0.12, 6_000, 400_000);
    const sp = Math.pow(2, Math.round(Math.log2(want)));
    const bucket = Math.round(Math.log(want) / Math.log(1.05));
    if (bucket === arrowBucket) return;
    arrowBucket = bucket;
    const { rings, at } = chevrons(route, sp, Math.pow(1.05, bucket) * 0.24);
    arrowAt = at;
    arrowGeo?.dispose();
    arrowGeo = rings.length ? lineGeometry(rings, r, false) : lineGeometry([[[0, 0], [0, 0]]], r, false);
    aCasing.geometry = arrowGeo;
    arrows.geometry = arrowGeo;
  };

  const posAt = (i: number, p: number) => (i < 0 ? route.total : stepFrom[i] + p * stepLen[i]);

  /** Where the head is: a stay at its own point (a distance along the route cannot say which end of a gap it means), a leg by distance. */
  const headAt = (i: number, p: number): Pt => {
    const st = ch!.steps[i < 0 ? ch!.steps.length - 1 : i];
    if (i < 0) return st.pts.at(-1)!;
    if (st.kind !== 'travel') return st.pts[0];
    const leg = route.legs[stepLeg[i]];
    return p <= 0 ? leg[0] : p >= 1 ? leg.at(-1)! : pointAt(route, stepFrom[i] + p * stepLen[i]).p;
  };

  const apply = () => {
    if (!ch || !lineGeo || !arrowGeo) return;
    const s = posAt(state.i, state.p);
    const p = headAt(state.i, state.p);
    lineGeo.instanceCount = segmentsUpTo(route, s);
    fitArrows();
    let n = 0;
    while (n < arrowAt.length && arrowAt[n] <= s) n++;
    arrowGeo.instanceCount = 2 * n;
    toVector(p[1], p[0], 1, headDir);
  };

  const followAlt = (i: number) => THREE.MathUtils.clamp(stepLen[i] * 0.9 || 250_000, 150_000, 2_500_000);
  const enter = (i: number) => {
    state.i = i; state.p = stepLeg[i] >= 0 ? 0 : 1;
    rig.follow(() => headDir, followAlt(i), o.covered);
    emit();
  };
  const duration = (i: number) => (stepLeg[i] >= 0 ? THREE.MathUtils.clamp(stepLen[i] / M_PER_S, MIN_S, MAX_S) : DWELL_S);

  return {
    get character() { return ch; },
    get step() { return state.i; },
    get playing() { return state.playing; },
    /** True while anything animates, so the render loop knows to keep drawing. */
    get busy() { return !!ch && state.playing; },
    onChange(f: () => void) { listeners.add(f); return () => listeners.delete(f); },
    /** Show a character: the whole route, then the camera frames it. */
    open(c: Character) {
      if (!c.steps.some((s) => s.kind === 'travel')) return;
      ch = c;
      build(c);
      group.visible = true;
      state.i = -1; state.p = 0; state.playing = false;
      apply();
      head.visible = true;
      rig.follow(null);
      rig.flyToFit(c.steps.flatMap((s) => s.pts).map(([lon, lat]) => toVector(lat, lon, 1)), o.covered(), 24);
      emit();
    },
    close() {
      if (!ch) return;
      ch = null; state.i = -1; state.playing = false;
      rig.follow(null);
      clear();
      group.visible = false;
      head.visible = false;
      emit();
    },
    /** Walk step `i` (its leg draws on, the camera follows); with `all` the walk goes on to the next steps. */
    goTo(i: number, all = false) {
      if (!ch) return;
      i = Math.max(0, Math.min(ch.steps.length - 1, i));
      state.mode = all ? 'all' : 'step';
      enter(i);
      state.playing = stepLeg[i] >= 0 || all;
      apply();
      emit();
    },
    /** Play from the current step (or the start) to the end. */
    play() {
      if (!ch) return;
      const i = state.i < 0 || (state.i === ch.steps.length - 1 && state.p >= 1) ? 0 : state.i;
      state.mode = 'all';
      if (i !== state.i || state.p >= 1) enter(i);
      state.playing = true;
      emit();
    },
    pause() { if (state.playing) { state.playing = false; emit(); } },
    next() { if (ch) this.goTo(state.i + 1); },
    prev() { if (ch) this.goTo(state.i - 1); },
    /** Once a frame. `cam` is the camera's unit direction, `cosLimit` the cosine of its horizon angle. */
    update(dt: number, cam: THREE.Vector3, cosLimit: number) {
      if (!ch) return;
      if (state.playing) {
        state.p += dt / duration(state.i);
        if (state.p >= 1) {
          state.p = 1;
          if (state.mode === 'all' && state.i < ch.steps.length - 1) enter(state.i + 1);
          else { state.playing = false; emit(); }
        }
      }
      apply();
      head.position.copy(headDir).multiplyScalar(R + Math.max(0, groundAt(headDir.clone().multiplyScalar(R))) + 900);
      head.visible = cam.dot(headDir) > cosLimit;
    },
  };
}
