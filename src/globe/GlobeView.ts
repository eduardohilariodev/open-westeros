import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PLANET, SITES, type SiteId } from '../config';
import { createDeclutter, setShown } from '../declutter';
import { eastNorth, enuFrame, siteLatLon, toVector } from '../geo';
import { PLACE_SNAP } from '../place-snap';
import world from '../vector-world.json';
import { PLACES } from '../world-data';
import { chaikin } from './rivers';
import roadData from '../roads.json';
import type { Ring } from './viewLayer';
import { AREA_KINDS, easeFont, FONT_DEFAULT, FONT_PX, wrap } from './labelText';
import { PIN_BOX, PLACE_ICONS, PLACE_KINDS } from './placeIcons';
import { createCameraRig } from './cameraRig';
import { createMeasure } from './measure';
import { createRegions, regionAt, regionNamed } from './regions';
import { createRelief } from './relief';
import B from './relief-bounds.json';
import { papered } from './gpuVector';
import { createTerrain, TERRAIN_SEA } from './terrain';
import { WALL_CASTLES } from './wall';

// Planet-centred frame, metres. The vector map (terrain.ts, regions.ts) is draped as lat/lon patches over an ocean sphere.
const R = PLANET.radius;
const rad = THREE.MathUtils.degToRad;

export type GlobeView = ReturnType<typeof createGlobeView>;
/** What the place panel shows: a place on the map, a landmark of a 3D place. `null` hides it. */
export type Card = { kind: string; name: string; text?: string; lat?: number; lon?: number; region?: string } | null;
const KIND_NAME = Object.fromEntries(PLACE_KINDS.map(([k, , one]) => [k, one]));

export function createGlobeView(renderer: THREE.WebGLRenderer, labelsEl: HTMLElement, showCard: (c: Card) => void) {
  const scene = new THREE.Scene();
  const SPACE = new THREE.Color(0x041011), SKY = new THREE.Color(0x86b6e8);
  scene.background = SPACE.clone();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 100, 3e8);
  const HOME = { dir: toVector(30, 27, 1), alt: 22_000_000 }; // over the Known World
  camera.position.copy(HOME.dir).multiplyScalar(R + HOME.alt);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false; // altitude-based zoom in the camera rig; OrbitControls zooms by distance to the centre
  controls.enableDamping = true;
  const labels = new CSS2DRenderer({ element: labelsEl });

  // ---------- planet ----------
  const ocean = papered(new THREE.Mesh(new THREE.SphereGeometry(R * 0.9996, 128, 64), new THREE.MeshBasicMaterial({ color: TERRAIN_SEA, toneMapped: false })));
  // Haze: the shell's far side is drawn over everything, and each pixel's ray is marched through it for the air it crosses
  // (up to the ground if it hits the planet). From space that is a glow round the limb; from low down it fades the distant
  // ground into the sky and gives the horizon a gradient above it. Colour goes from teal to SKY as the camera comes down.
  const atmoMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uGround: { value: R }, uTop: { value: R * 1.025 }, uTeal: { value: new THREE.Color(0x4a8af0) }, uSky: { value: SKY }, uLow: { value: 0 }, uFade: { value: 1 }, uGroundA: { value: 1 }, uSun: { value: toVector((B.lat0 + B.lat1) / 2, (B.lon0 + B.lon1) / 2, 1) }, /* noon over the middle of the map: the night is the far side of the planet */ uNight: { value: 1 } },
    vertexShader: `varying vec3 vW;
      void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
    fragmentShader: `uniform float uGround, uTop, uLow, uFade, uNight, uGroundA; uniform vec3 uTeal, uSky, uSun; varying vec3 vW;
      const float HS = 15000.0, TAU0 = 30000.0; // scale height of the air (Earth's 8.5 km, stretched for looks); the path (m of sea-level air) that is ~63% haze
      void main() {
        vec3 ro = cameraPosition, rd = normalize(vW - cameraPosition);
        float b = dot(ro, rd), c = dot(ro, ro);
        float h = sqrt(max(b * b - (c - uTop * uTop), 0.0));
        float t0 = max(-b - h, 0.0), t1 = -b + h;
        float g = b * b - (c - uGround * uGround);
        float night = 0.0; bool hit = false;
        if (g > 0.0 && -b - sqrt(g) > 0.0) { // the ground ends the ray
          t1 = -b - sqrt(g); hit = true;
          vec3 p = normalize(ro + rd * t1);
          night = 0.97 * uNight * smoothstep(0.0, -0.2, dot(p, uSun)); // the unlit half: N.L < 0, with a soft terminator
        }
        // only sunlit air glows: each sample counts by the sun at its own point, so the night air is clear, not a dark veil
        float dt = (t1 - t0) / 32.0, tau = 0.0;
        for (int i = 0; i < 32; i++) {
          vec3 q = ro + rd * (t0 + (float(i) + 0.5) * dt);
          float lit = mix(1.0, smoothstep(-0.25, 0.05, dot(q, uSun) / length(q)), uNight);
          tau += exp((uGround - length(q)) / HS) * lit * dt;
        }
        // The veil knows only the smooth planet, not the relief standing on it, so near the ground it is capped: no fog wall at the horizon for mountains to sink into.
        float a = mix(0.95, 0.35, uLow) * mix(0.25, 1.0, uFade) * (1.0 - exp(-tau / TAU0)); // uFade: the glow thins below ~1,500 km
        if (hit) a *= uGroundA; // the flat map is not washed pale by it (setEnabled below)
        vec3 haze = mix(mix(uTeal, vec3(0.55, 0.72, 1.0), a * a), uSky, uLow);
        float A = 1.0 - (1.0 - a) * (1.0 - night); // the night veil lies under the haze
        gl_FragColor = vec4(haze * a / max(A, 1e-4), A);
        #include <colorspace_fragment>
      }`,
  });
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(R * 1.025, 96, 48), atmoMat);
  atmosphere.renderOrder = 300; // after the relief, its lines and its clouds (200), which it veils
  atmosphere.frustumCulled = false;
  const stars = (() => { // Milky Way panorama on a sphere round the scene
    const map = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/milky_way.jpg`);
    map.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.SphereGeometry(2e8, 64, 32), new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false }));
    m.renderOrder = -1;
    return m;
  })();
  const headlight = new THREE.DirectionalLight(0xffffff, 1.6);
  const regions = createRegions(R), terrain = createTerrain(R);
  const relief = createRelief(terrain.fills, terrain.strokes, ocean, terrain.rivers); // shaded canon relief; off = the flat parchment map
  relief.setEnabled(true);
  // From space the haze lies over the ground too; the flat map keeps its own dark colours, so it gets a third of that
  const setRelief = relief.setEnabled;
  relief.setEnabled = (on: boolean) => { setRelief(on); atmoMat.uniforms.uGroundA.value = on ? 1 : 0.2; terrain.restyle(!on); };
  scene.onBeforeRender = (r, _s, cam) => relief.update(cam as THREE.PerspectiveCamera, r, rig.tilt); // the relief's detail follows the camera drawn
  scene.add(ocean, relief.object, terrain.object, regions.object, atmosphere, stars, new THREE.AmbientLight(0xffffff, 1.3), headlight);

  // ---------- sites: ordinary places on the map whose scene loads when the camera comes close ----------
  const ids = Object.keys(SITES) as SiteId[];
  const frames = Object.fromEntries(ids.map((id) => {
    const { lat, lon } = siteLatLon(id);
    return [id, enuFrame(lat, lon)];
  })) as Record<SiteId, ReturnType<typeof enuFrame>>;
  /** Rotation from a site's frame (x east, y up, z south) to the planet's. */
  const frameQuat = Object.fromEntries(ids.map((id) => {
    const f = frames[id];
    return [id, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.east, f.up, f.north.clone().negate()))];
  })) as Record<SiteId, THREE.Quaternion>;

  // ---------- place names ----------
  // From the maps (src/world-data.ts). Each kind has a height band, so the screen only holds what is readable at that
  // zoom, and only on the near side of the planet: [shown below, fly-to height, hidden below], metres. Big lettering
  // (oceans, regions) gives way to the places inside it once you are well within it, like Google Maps.
  // The whole Known World is ~17,000 km across; at 22,000 km up it all fits the screen, at 3,000 km about Westeros-and-a-half.
  const LOD: Record<string, [number, number, number?]> = {
    continent: [10_000_000, 8_000_000, 6_000_000], ocean: [10_000_000, 8_000_000, 500_000], region: [6_000_000, 3_500_000, 500_000], city: [3_500_000, 900_000], capital: [4_000_000, 700_000],
    island: [3_000_000, 1_300_000], mountain: [2_800_000, 1_500_000], forest: [2_800_000, 1_500_000], wild: [2_800_000, 2_000_000],
    sea: [3_500_000, 1_500_000], lake: [1_600_000, 1_000_000], river: [1_600_000, 1_400_000], road: [1_600_000, 1_400_000],
    castle: [1_200_000, 550_000], town: [1_200_000, 550_000], ruin: [1_200_000, 600_000], landmark: [1_500_000, 700_000],
    minor: [700_000, 450_000], battle: [1_200_000, 600_000], monument: [1_500_000, 700_000], population: [2_500_000, 1_500_000],
  };
  const ROADS_BELOW = 8_000_000, TRACKS_BELOW = LOD.castle[0]; // main roads and the tracks to places are drawn from these altitudes down (tracks with the castles); road names come in at 1,600 km (LOD)
  type Gen = (typeof PLACES)[number];
  const WATER = new Set(['ocean', 'sea', 'lake']); // one word a line, every word counted
  // the castles of the Wall stand on it (wall.ts)
  const layout = ([name, kind, lat, lon]: Gen) => ({ up: toVector(...((kind === "island" ? undefined : WALL_CASTLES[name]) ?? PLACE_SNAP[name] ?? [lat, lon]), 1), rot: 0, scale: 1 });
  const places = PLACES.map((g, i) => {
    const [name, kind] = g;
    const outline = kind === 'region' ? regionNamed(name) : undefined; // a region with an outline is named at its centre
    const gen: Gen = outline ? [name, kind, ...outline.center] : g;
    const lay = layout(gen), lod = LOD[kind] ?? LOD.town;
    const el = document.createElement('div');
    // Regions are just lettering over the area (like Google Maps); everything else gets a symbol on its spot.
    const area = AREA_KINDS.has(kind);
    el.className = `globe-place k-${kind}${area ? ' globe-area' : ''}`;
    el.innerHTML = `<span></span>${area ? '' : `<svg viewBox="0 0 512 512">${PLACE_ICONS[kind] ?? PLACE_ICONS.town}</svg>`}`;
    el.firstElementChild!.textContent = WATER.has(kind) ? wrap(name, 1, []) : area ? name : wrap(name);
    el.onclick = (e) => {
      if (pickForMeasure(i, e)) return;
      view.flyToPlace(i);
    };
    const obj = new CSS2DObject(el); // centred: a point label's box is just its symbol, the text hangs off its right side
    scene.add(obj);
    labelsEl.append(el); // in the page from the start, so it can be measured before it is first shown
    el.style.display = 'none';
    return { name, kind, gen, ...lay, obj: obj as THREE.Object3D, lod, flat: false, outline, fit: 1, zs: 1, size: [0, 0, 0, 0], line: null as LineLabel | null };
  });
  type Place = (typeof places)[number];
  /** A river's or road's name bent along its polyline: unit directions of the smoothed line, and the SVG texts (repeats) that ride on it. */
  type LineCopy = { path: SVGPathElement; text: SVGTextElement; tp: SVGTextPathElement };
  type LineLabel = { dirs: THREE.Vector3[]; pos: THREE.Vector3[]; copies: LineCopy[]; pts: Ring; mid: THREE.Vector3 };
  /**
   * Type size by altitude, in px per kind: an exponential ease (base FONT_B) from the small end at the top of a kind's
   * height band to the large end at its bottom, so names grow gently as you come down, like zoom-interpolated text-size in
   * a vector style. Oceans and continents are the biggest lettering, water bodies and regions next, rivers and small places least.
   */
  const basePx = new Map<string, number>(); // the CSS size of each kind (style.css), which `zoomScale` divides out
  const zoomScale = (p: Place, h: number) => {
    if (!basePx.has(p.kind)) basePx.set(p.kind, parseFloat(getComputedStyle((p.obj as CSS2DObject).element.firstElementChild!).fontSize) || 16);
    return Math.round((easeFont(FONT_PX[p.kind] ?? FONT_DEFAULT, p.lod[0], p.lod[2] ?? p.lod[1] / 2, h) / basePx.get(p.kind)!) * 50) / 50; // 2% steps, so the style isn't rewritten every frame
  };
  /** [symbol w, h, text w, h] in px, unscaled. All names at once, so it is one reflow; again once the web font is in. */
  const measure = () => {
    const els = places.map((p) => (p.obj as CSS2DObject).element), shown = els.map((e) => e.style.display);
    els.forEach((e) => (e.style.display = ''));
    places.forEach((p, i) => { const t = els[i].firstElementChild as HTMLElement; p.size = [els[i].offsetWidth, els[i].offsetHeight, t.offsetWidth, t.offsetHeight]; });
    els.forEach((e, i) => (e.style.display = shown[i]));
  };
  measure();
  document.fonts.ready.then(measure);
  // When names overlap on screen, the higher tier keeps its spot: continents, oceans, regions, cities, then ever smaller places.
  const RANK = ['continent', 'ocean', 'region', 'population', 'capital', 'city', 'sea', 'island', 'castle', 'town', 'mountain', 'forest', 'wild', 'lake', 'river', 'road', 'monument', 'landmark', 'battle', 'ruin', 'minor'];
  const ranked = [...places].sort((a, b) => RANK.indexOf(a.kind) - RANK.indexOf(b.kind));
  let order = ranked; // ranked, with the pinned place first
  const pt = new THREE.Vector3();
  /** A name's box on screen: [left, top, right, bottom], px. */
  const screenBox = (p: Place) => {
    pt.copy(p.obj.position).project(camera);
    const x = ((pt.x + 1) / 2) * innerWidth, y = ((1 - pt.y) / 2) * innerHeight, s = p.scale * p.fit * p.zs, [w, h, tw, th] = p.size;
    if (AREA_KINDS.has(p.kind)) return [x - (tw * s) / 2, y - (th * s) / 2, x + (tw * s) / 2, y + (th * s) / 2];
    const hh = Math.max(h, th * s) / 2;
    return [x - w / 2, y - hh, x + w / 2 + 4 + tw * s, y + hh]; // text 4px right of the symbol (style.css)
  };
  const put = (p: Place) => {
    p.obj.position.copy(p.up).multiplyScalar(R + 3000);
    if (p.flat) { // lie on the ground, text running east, turned by rot
      const { east, north } = eastNorth(p.up);
      p.obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, north, p.up))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad(p.rot)));
      p.obj.scale.set(p.scale, p.scale, 1);
    } else { // scale only the text, so the symbol stays on the spot
      const text = (p.obj as CSS2DObject).element.firstElementChild as HTMLElement;
      const s = p.scale * p.fit * p.zs;
      text.style.cssText = s === 1 ? '' : `display:inline-block;transform-origin:${AREA_KINDS.has(p.kind) ? '50% 50%' : '0 50%'};transform:scale(${s})`;
    }
  };
  places.forEach(put);
  // Rivers and roads are named along their line, not at a point. A river's name rides on the map polyline nearest its spot, a
  // road's on the named road of the same name (src/roads.json `named`, one line per road), both Chaikin-smoothed (a river's
  // water ribbon is too). One SVG layer holds all the texts; `update` bends each along the part of its line that is on screen.
  const NS = 'http://www.w3.org/2000/svg', lineLayer = document.createElementNS(NS, 'svg'), lineDefs = document.createElementNS(NS, 'defs');
  lineLayer.setAttribute('class', 'line-labels');
  lineLayer.append(lineDefs);
  labelsEl.append(lineLayer);
  const pool = (lines: { pts: Ring; name?: string }[]) => lines.filter((l) => l.pts.length > 1).map((l) => ({ raw: l.pts.map(([lon, lat]) => toVector(lat, lon, 1)), line: l.pts, name: l.name }));
  /** The lines a kind of name can ride on. */
  const LINES: Record<string, ReturnType<typeof pool>> = {
    river: pool((world.rivers as Ring[]).map((pts) => ({ pts }))),
    road: pool(roadData.named as unknown as { name: string; pts: Ring }[]),
  };
  /** How wide the line is drawn, metres: a river's ribbon grows with the zoom; a road is a hairline at any height. */
  const LINE_WIDTH_M: Record<string, number> = { river: 1500, road: 0 };
  const MATCH_COS = Math.cos(rad(2)); // a name without a line of its own must sit within 2° (~240 km) of one
  const LINE_COPIES = 3; // a long line carries its name up to this many times
  const LINE_ANCHORS = [0.5, 0.25, 0.75, 0.375, 0.625, 0.125, 0.875]; // where along a line (0 start, 1 end) its name may hang, in order of preference
  places.forEach((p, i) => {
    const lines = LINES[p.kind];
    if (!lines) return;
    let best = lines.find((l) => l.name === p.name) ?? null, bestCos = MATCH_COS;
    if (!best) for (const l of lines) for (const v of l.raw) { const c = v.dot(p.up); if (c > bestCos) { bestCos = c; best = l; } }
    if (!best) return; // no line near it: stays a plain label
    const pos = chaikin(best.line, 2).map(([lon, lat]) => toVector(lat, lon, R + 3000));
    const copies = Array.from({ length: LINE_COPIES }, (_, c): LineCopy => {
      const path = document.createElementNS(NS, 'path'), text = document.createElementNS(NS, 'text'), tp = document.createElementNS(NS, 'textPath');
      path.id = `line-path-${i}-${c}`;
      tp.setAttribute('href', `#${path.id}`);
      tp.setAttribute('startOffset', '50%');
      tp.setAttribute('text-anchor', 'middle');
      tp.textContent = p.name;
      text.setAttribute('class', `line-text k-${p.kind} off`);
      text.append(tp);
      text.onclick = (e) => { if (!pickForMeasure(i, e)) view.flyToPlace(i); };
      lineDefs.append(path);
      lineLayer.append(text);
      return { path, text, tp };
    });
    const len = pos.reduce((s, v, k) => s + (k ? v.distanceTo(pos[k - 1]) : 0), 0);
    let run = 0, mid = pos[0].clone();
    for (let k = 1; k < pos.length; k++) { // the point half the road's length along it
      const seg = pos[k].distanceTo(pos[k - 1]);
      if (run + seg >= len / 2) { mid = pos[k - 1].clone().lerp(pos[k], (len / 2 - run) / (seg || 1)); break; }
      run += seg;
    }
    p.line = { pos, dirs: pos.map((v) => v.clone().normalize()), copies, pts: best.line, mid: mid.normalize() };
  });
  /** Douglas-Peucker: drop points within `eps` px of the chord. Screen-space, so the tolerance is the same at every altitude. */
  const simplify = (pts: Ring, eps: number): Ring => {
    const keep = new Uint8Array(pts.length), stack: [number, number][] = [[0, pts.length - 1]];
    keep[0] = keep[pts.length - 1] = 1;
    while (stack.length) {
      const [a, b] = stack.pop()!, [ax, ay] = pts[a], [bx, by] = pts[b], len = Math.hypot(bx - ax, by - ay) || 1;
      let far = 0, at = -1;
      for (let k = a + 1; k < b; k++) {
        const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / len;
        if (d > far) { far = d; at = k; }
      }
      if (far > eps) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
    return pts.filter((_, k) => keep[k]);
  };
  const MAX_BEND = rad(30); // largest turn between neighbouring stretches of a name (Mapbox's text-max-angle)
  const LINE_SPACING = 350; // px of clear line between repeats of a name (symbol-spacing)
  const Q_W = { curve: 1, offset: 0.5, orient: 0.3, spacing: 0.3 }; // weights of Q(L) = w1 C + w2 O + w3 I + w4 S
  /**
   * Where a river's or road's name goes on screen: up to LINE_COPIES stretches of the on-screen line, best first. The line is
   * simplified (Douglas-Peucker, 1.5 px) and re-smoothed (Chaikin) in screen space, then windows the width of the name
   * (`tw` px, `th` tall) are scored by Q(L): C curvature (turns between samples, none over MAX_BEND), O the baseline
   * offset `off` px above the line leaving the screen, I slant from horizontal, S distance from the middle of the visible
   * line. Repeats must be LINE_SPACING px apart. Samples run left to right so the text reads upright.
   * ponytail: windows every tw/4 and a greedy pick; a global optimiser if names still sit badly
   */
  const lineStretches = (r: LineLabel, tw: number, th: number, off: number, cosLimit: number, cam: THREE.Vector3) => {
    let run: Ring = [], bestRun = run; // the longest run of vertices on the near side, in screen px
    const v = new THREE.Vector3();
    r.pos.forEach((q, k) => {
      if (cam.dot(r.dirs[k]) <= cosLimit) { run = []; return; }
      v.copy(q).project(camera);
      run.push([((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight]);
      if (run.length > bestRun.length) bestRun = run;
    });
    if (bestRun.length < 2) return [];
    const line = chaikin(simplify(bestRun, 1.5), 2), s = [0];
    for (let k = 1; k < line.length; k++) s.push(s[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
    const L = s[s.length - 1];
    if (L < tw * 1.1) return [];
    const at = (d: number): [number, number] => {
      let k = 1;
      while (k < line.length - 1 && s[k] < d) k++;
      const f = (d - s[k - 1]) / ((s[k] - s[k - 1]) || 1);
      return [line[k - 1][0] + (line[k][0] - line[k - 1][0]) * f, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * f];
    };
    const N = 12, inside = (x: number, y: number) => x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
    const picked: Ring[] = [], pickedS: number[] = [];
    // Names hang on fixed anchors along the whole line (not on whatever stretch is visible), tried in a fixed order, so
    // a name stays on its spot of the line as the globe turns or zooms and only fades in or out.
    for (const f of LINE_ANCHORS) {
      if (picked.length === LINE_COPIES) break;
      const k = Math.round(f * (r.pos.length - 1));
      if (cam.dot(r.dirs[k]) <= cosLimit) continue;
      v.copy(r.pos[k]).project(camera);
      const ax = ((v.x + 1) / 2) * innerWidth, ay = ((1 - v.y) / 2) * innerHeight;
      let near = 0, nd = Infinity; // the anchor's place on the screen line
      line.forEach(([x, y], j) => { const d = (x - ax) ** 2 + (y - ay) ** 2; if (d < nd) { nd = d; near = j; } });
      if (nd > 25 ** 2) continue; // the simplified line has left the anchor behind
      const sc = s[near];
      let best: { s0: number; q: number; pts: Ring } | null = null;
      for (const shift of [-tw / 4, 0, tw / 4]) { // a little give around the anchor, for the best fit
        const s0 = sc - tw / 2 + shift;
        if (s0 < 0 || s0 > L - tw) continue;
        const c = score(s0);
        if (c && (!best || c.q < best.q)) best = c;
      }
      if (best && pickedS.every((p) => Math.abs(best!.s0 - p) >= tw + LINE_SPACING)) { picked.push(best.pts); pickedS.push(best.s0); }
    }
    function score(s0: number) {
      const pts = Array.from({ length: N + 1 }, (_, k) => at(s0 + (tw * k) / N));
      if (pts[N][0] < pts[0][0]) pts.reverse(); // keep upright: never read right to left
      if (pts.some(([x, y]) => !inside(x, y))) return null; // the whole name on screen
      let max = 0, sum = 0;
      for (let k = 2; k <= N; k++) {
        const a = Math.atan2(pts[k][1] - pts[k - 1][1], pts[k][0] - pts[k - 1][0]) - Math.atan2(pts[k - 1][1] - pts[k - 2][1], pts[k - 1][0] - pts[k - 2][0]);
        const t = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
        max = Math.max(max, t); sum += t;
      }
      if (max > MAX_BEND) return null;
      let out = 0; // samples whose text-centre (off + th/2 above the line, "above" being left of the way it runs) is off screen
      for (let k = 1; k <= N; k++) {
        const dx = pts[k][0] - pts[k - 1][0], dy = pts[k][1] - pts[k - 1][1], d = Math.hypot(dx, dy) || 1, h = off + th / 2;
        if (!inside(pts[k][0] + (dy / d) * h, pts[k][1] - (dx / d) * h)) out++;
      }
      const C = (0.5 * max + (0.5 * sum) / (N - 1)) / MAX_BEND;
      const O = out / N, I = Math.abs(Math.atan2(pts[N][1] - pts[0][1], pts[N][0] - pts[0][0])) / (Math.PI / 2);
      const S = Math.abs(s0 + tw / 2 - L / 2) / (L / 2);
      return { s0, pts, q: Q_W.curve * C + Q_W.offset * O + Q_W.orient * I + Q_W.spacing * S };
    }
    return picked;
  };
  // map pin on the place a search or a click flew to
  const pinEl = document.createElement('div');
  pinEl.className = 'globe-pin';
  pinEl.innerHTML = `<span></span><svg viewBox="${PIN_BOX}">${PLACE_ICONS.pin}</svg>`; // name above the hand, like Google Maps
  const pinName = pinEl.firstElementChild!;
  const pin = new CSS2DObject(pinEl);
  pin.center.set(0.5, 1); // the tip
  pin.visible = false;
  scene.add(pin);
  let pinned: Place | null = null;
  const setPin = (p: Place | null) => { // the pin takes the place of the place's own symbol
    if (pinned) (pinned.obj as CSS2DObject).element.classList.remove('pinned');
    pinned = p;
    order = p ? [p, ...ranked.filter((q) => q !== p)] : ranked;
    pin.visible = !!p && (!AREA_KINDS.has(p.kind) || !!p.line); // area lettering marks itself; a river or road with a line gets a pin at its middle
    if (!p) return;
    pinName.textContent = p.name;
    pin.position.copy(p.line?.mid ?? p.up).multiplyScalar(R + 3000);
    (p.obj as CSS2DObject).element.classList.add('pinned');  };
  let showNames = true;
  const hiddenKinds = new Set<string>();

  const tmp = new THREE.Vector3();
  const rig = createCameraRig(camera, controls, renderer.domElement, R, HOME, (p) => relief.groundAt(p));

  [renderer.domElement, labelsEl].forEach(rig.attachInput);

  // Measuring wool (measure.ts). While it is on, a click on a place's name lays a point on that place instead of flying to it.
  const wool = createMeasure(scene, renderer.domElement, labelsEl, R, (p) => relief.groundAt(p), rig.pick, B.sun);
  const pickForMeasure = (i: number, e: MouseEvent) => {
    if (!wool.active) return false;
    const p = places[i];
    let at = p.up; // a point's name is at its own spot; an area's lettering at its centre
    if (p.line) { // a river's or road's name sits on its line: the pin goes on the line's own point nearest the click
      const hit = rig.pick(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
      const d = hit ? toVector(hit.lat, hit.lon, 1) : p.line.mid;
      at = p.line.dirs.reduce((best, v) => (v.dot(d) > best.dot(d) ? v : best));
    }
    wool.add(at, p.name);
    return true;
  };

  // Px of the screen the place card covers right now, so a flight lands the place in the middle of the map that is left: a column
  // on the left on a wide screen, a band on top on a narrow one, and on a phone the search box above and the sheet (at rest height) below.
  const phone = matchMedia('(max-width: 700px)');
  const covered = () => {
    const side = document.getElementById('side')!.getBoundingClientRect(), card = document.getElementById('place')!;
    if (phone.matches) return { l: 0, r: 0, t: side.bottom, b: card.hidden ? 0 : Math.min(card.offsetHeight, innerHeight * 0.44) };
    const wide = side.width > innerWidth * 0.6, free = side.width > 0;
    return { l: free && !wide ? side.right : 0, r: 0, t: free && wide ? side.bottom : 0, b: 0 };
  };

  const view = {
    scene, camera, controls, labels, attachInput: rig.attachInput, ocean, terrain, relief, wool,
    nav: {
      heading: () => rig.heading,
      resetNorth() { rig.heading = 0; },
      zoom: rig.zoomBy,
      canTilt: false,
      tilt: () => rig.tilt,
      toggleTilt() {},
      home: rig.goHome,
      altitude: () => rig.alt,
      pick: rig.pick,
      metresPerPixel: () => (2 * rig.alt * Math.tan(rad(camera.fov / 2))) / innerHeight,
    },
    setNamesVisible(v: boolean) { showNames = v; },
    setBordersVisible: (_v: boolean) => {}, // replaced below, once the region interaction exists
    setKindVisible(kind: string, v: boolean) { if (v) hiddenKinds.delete(kind); else hiddenKinds.add(kind); },
    /** How many names of each kind the maps have (for the legend). */
    kindCounts: places.reduce((c, p) => ((c[p.kind] = (c[p.kind] ?? 0) + 1), c), {} as Record<string, number>),
    /** Every named place on the maps, for search: [name, kind] in the order flyToPlace expects. */
    places: places.map((p) => ({ name: p.name, kind: p.kind })),
    /** A place with a 3D scene is approached until the scene takes over. */
    flyToPlace(i: number) {
      const p = places[i];
      wool.setActive(false); // focusing a place ends measuring
      regions.selected = p.outline && bordersOn ? p.outline.id : null; // a region is outlined however it was reached
      setPin(p);
      // a river or road is lit along its whole length; a river's water is drawn smoothed (rivers.ts), so the light follows that curve
      terrain.highlight(p.line ? (p.kind === 'river' ? chaikin(p.line.pts) : p.line.pts) : null);
      const at = p.line?.mid ?? p.up;
      const { lat, lon } = rig.latLon(at);
      showCard({ kind: KIND_NAME[p.kind] ?? p.kind, name: p.name, lat, lon, region: p.outline ? undefined : regionAt(lat, lon)?.name });
      const site = ids.find((id) => SITES[id].name === p.name);
      const extent = p.line ? p.line.pts : p.outline?.shapes.flatMap((s) => s.ring); // a road, river or bordered region is framed whole
      if (extent && !site) {
        rig.flyToFit(extent.map(([lon, lat]) => toVector(lat, lon, 1)), covered(), 16);
        return;
      }
      rig.flyToDir(at,site ? SITES[site].drawDistance * 0.4 : AREA_KINDS.has(p.kind) && !(p.kind === 'region' && !p.outline) ? p.lod[1] : p.lod[1] / 3, phone.matches ? covered() : undefined); // a spot comes close, an area stays whole; a region with no border to frame comes close too
    },
    /** The site whose centre the camera is within `d` metres of (a number, or one per site), if any. */
    siteWithin: (d: number | ((id: SiteId) => number)) =>
      ids.find((id) => camera.position.distanceTo(frames[id].origin) < (typeof d === 'number' ? d : d(id))),
    /** Current camera expressed in a site frame (x east, y up, z south), looking at the point below it. */
    siteCamera(id: SiteId) {
      const f = frames[id], o = tmp.copy(camera.position).sub(f.origin);
      const position = new THREE.Vector3(o.dot(f.east), o.dot(f.up), -o.dot(f.north));
      const n = camera.position.clone().setLength(R).sub(f.origin);
      return { position, target: new THREE.Vector3(n.dot(f.east), 0, -n.dot(f.north)), quaternion: frameQuat[id].clone().invert().multiply(camera.quaternion) };
    },
    /** Fly to the spot (x east, z south, m) in a site's frame, ending `a` m up. */
    flyToSite(id: SiteId, x: number, z: number, a: number) {
      const f = frames[id];
      rig.flyToDir(f.origin.clone().addScaledVector(f.east, x).addScaledVector(f.north, -z), a);
    },
    /** Sky: blue near the ground, space above the atmosphere, by camera altitude. */
    setSky() {
      const f = THREE.MathUtils.clamp(Math.log(600_000 / Math.max(rig.alt, 1)) / Math.log(600_000 / 150_000), 0, 1);
      (scene.background as THREE.Color).copy(SPACE).lerp(SKY, f);
      atmoMat.uniforms.uLow.value = f;
      atmoMat.uniforms.uFade.value = THREE.MathUtils.smoothstep(Math.log(rig.alt), Math.log(600_000), Math.log(1_500_000));
      stars.visible = f < 1; // dimmed by the sky as it brightens
      (stars.material as THREE.MeshBasicMaterial).opacity = 1 - f;
    },
    update(dt: number, now: number) {
      rig.step(dt, now);
      const alt = rig.alt;
      terrain.setRiverWidth(alt);
      headlight.position.copy(camera.position).addScaledVector(camera.up, R);
      atmoMat.uniforms.uNight.value = THREE.MathUtils.smoothstep(alt, 2_000_000, 12_000_000); // coming down, the shadow slips behind the horizon
      terrain.refresh(); regions.refresh(); // line widths are in screen pixels
      wool.update(camera, view.nav.metresPerPixel());
      // from this far out the roads are a tangle; they fade in over the last quarter of the way down, tracks over the last third
      terrain.fadeRoads('roads', 1 - THREE.MathUtils.smoothstep(alt, ROADS_BELOW * 0.75, ROADS_BELOW));
      terrain.fadeRoads('tracks', 1 - THREE.MathUtils.smoothstep(alt, TRACKS_BELOW * 0.67, TRACKS_BELOW));
      // a place faces the camera when the camera is above its horizon: cos(angle) > R / |camera|
      const cosLimit = R / camera.position.length(), cam = tmp.copy(camera.position).normalize();
      camera.updateMatrixWorld();
      const taken = createDeclutter(); // ponytail: each name is tested against every placed box, O(n²); a screen grid if names reach the thousands
      for (const p of order) {
        let on = showNames && !hiddenKinds.has(p.kind) && alt < p.lod[0] && alt > (p.lod[2] ?? 0) && cam.dot(p.up) > cosLimit;
        const zs = zoomScale(p, alt);
        if (on && zs !== p.zs) { p.zs = zs; put(p); }
        if (on && p.outline) {
          // keep a region's name inside its borders: shrink it to the area's on-screen width (at most its natural size)
          const room = (p.outline.span * rad(1) * R * Math.cos(rad(p.outline.center[0]))) / view.nav.metresPerPixel();
          const fit = Math.min(1, Math.max(0.1, (0.9 * room) / (p.size[2] * p.scale * p.zs || 1)));
          if (Math.abs(fit - p.fit) > 0.01) { p.fit = fit; put(p); }
        }
        if (p.line) { // a river or road with a line is named along it, not at a point (its plain label stays off)
          const shown: number[][][] = [];
          if (on && p !== pinned) { // the focused river's or road's name is on its pin
            const tw = p.size[2] * p.scale * p.zs, th = p.size[3] * p.scale * p.zs;
            // the line is a few px wide this far out (metres of a typical river over metres per pixel); the name sits just above it
            const off = Math.max(1.3, LINE_WIDTH_M[p.kind] / view.nav.metresPerPixel()) / 2 + 2;
            for (const pts of lineStretches(p.line, tw, th, off, cosLimit, cam)) {
              const h = off + th, xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
              const b = [Math.min(...xs), Math.min(...ys) - h, Math.max(...xs), Math.max(...ys) + h];
              if (!taken.claim(b)) continue;
              const c = p.line.copies[shown.length];
              c.path.setAttribute('d', `M${pts.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L')}`);
              c.tp.setAttribute('dy', String(-off));
              c.text.style.fontSize = `${basePx.get(p.kind)! * p.scale * p.zs}px`;
              shown.push(pts);
            }
          }
          p.line.copies.forEach((c, k) => c.text.classList.toggle('off', k >= shown.length));
          on = false;
        }
        if (on) {
          const b = screenBox(p);
          on = taken.claim(b);
        }
        // fade rather than pop (style.css); the name leaves the page once its fade-out is done
        setShown(p.obj as CSS2DObject, on, now);
      }
    },
  };
  // ---------- region borders: click the region's name to select it ----------
  let bordersOn = true;
  const deselect = () => { regions.selected = null; setPin(null); terrain.highlight(null); showCard(null); };
  addEventListener('keydown', (e) => { if (e.key === 'Escape') deselect(); });
  view.setBordersVisible = (v: boolean) => { bordersOn = v; regions.object.visible = v; if (!v) regions.selected = null; };

  return Object.assign(view, { deselect });
}
