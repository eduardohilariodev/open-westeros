import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PLANET, SITE_SWITCH, SITES, type SiteId } from '../config';
import { eastNorth, enuFrame, siteLatLon, toVector } from '../geo';
import { PLACE_EDITS, type PlaceEdit } from '../place-edits';
import { PLACES } from '../world-data';
import { PLACE_ICONS } from './placeIcons';
import { createRegions, regionAt, regionNamed, type Region } from './regions';
import { createTerrain, TERRAIN_SEA } from './terrain';

// Planet-centred frame, metres. The vector map (terrain.ts, regions.ts) is draped as lat/lon patches over an ocean sphere.
const R = PLANET.radius;
const MIN_ALT = 150_000, MAX_ALT = 40_000_000;
const rad = THREE.MathUtils.degToRad;

export type GlobeView = ReturnType<typeof createGlobeView>;
/** What a card shows: a region, a landmark of a 3D place. `null` hides it. */
export type Card = { kind: string; name: string; text?: string } | null;

export function createGlobeView(renderer: THREE.WebGLRenderer, labelsEl: HTMLElement, showCard: (c: Card) => void) {
  const scene = new THREE.Scene();
  const SPACE = new THREE.Color(0x04060c), SKY = new THREE.Color(0xbcd0de);
  scene.background = SPACE.clone();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 100, 3e8);
  const HOME = { dir: toVector(30, 27, 1), alt: 22_000_000 }; // over the Known World
  camera.position.copy(HOME.dir).multiplyScalar(R + HOME.alt);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false; // altitude-based zoom below; OrbitControls zooms by distance to the centre
  controls.enableDamping = true;
  const labels = new CSS2DRenderer({ element: labelsEl });

  // ---------- planet ----------
  const ocean = new THREE.Mesh(new THREE.SphereGeometry(R * 0.9996, 128, 64), new THREE.MeshLambertMaterial({ color: TERRAIN_SEA }));
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.035, 96, 48),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <logdepthbuf_pars_fragment>
        varying vec3 vN; varying vec3 vV;
        void main() {
          #include <logdepthbuf_fragment>
          float rim = pow(1.0 - abs(dot(vN, vV)), 2.5);
          gl_FragColor = vec4(0.45, 0.65, 1.0, 1.0) * rim * 1.4;
        }`,
    }),
  );
  const stars = (() => {
    const p = new Float32Array(6000 * 3), v = new THREE.Vector3();
    for (let i = 0; i < 6000; i++) v.randomDirection().multiplyScalar(2e8).toArray(p, i * 3);
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(p, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false }));
  })();
  const headlight = new THREE.DirectionalLight(0xffffff, 1.6);
  const regions = createRegions(R), terrain = createTerrain(R);
  scene.add(ocean, terrain.object, regions.object, atmosphere, stars, new THREE.AmbientLight(0xffffff, 1.3), headlight);

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
  // From the maps (src/world-data.ts). Each kind is shown while the camera is below a height, so the screen only holds
  // what is readable at that zoom, and only on the near side of the planet. [shown below, fly-to height], metres.
  // The whole Known World is ~17,000 km across; at 22,000 km up it all fits the screen, at 3,000 km about Westeros-and-a-half.
  const LOD: Record<string, [number, number]> = {
    ocean: [30_000_000, 8_000_000], region: [6_000_000, 3_500_000], city: [3_500_000, 900_000], capital: [4_000_000, 700_000],
    island: [3_000_000, 1_300_000], mountain: [2_800_000, 1_500_000], forest: [2_800_000, 1_500_000], wild: [2_800_000, 2_000_000],
    sea: [3_500_000, 1_500_000], lake: [1_600_000, 1_000_000], river: [1_600_000, 1_400_000],
    castle: [1_200_000, 550_000], town: [1_200_000, 550_000], ruin: [1_200_000, 600_000], landmark: [1_500_000, 700_000],
    minor: [700_000, 450_000],
  };
  const AREA_KINDS = new Set(['ocean', 'sea', 'lake', 'river', 'region']);
  // Hand edits (src/place-edits.ts) override the generated positions; `edits` is what edit mode saves back.
  const edits: Record<string, PlaceEdit> = JSON.parse(JSON.stringify(PLACE_EDITS));
  type Gen = (typeof PLACES)[number];
  const layout = ([, , lat, lon]: Gen, e: PlaceEdit) => ({ up: toVector(...(e.p ?? [lat, lon]), 1), rot: e.rot ?? 0, scale: e.s ?? 1 });
  const places = PLACES.map((g, i) => {
    const [name, kind] = g;
    const outline = kind === 'region' ? regionNamed(name) : undefined; // a region with an outline is named at its centre
    const gen: Gen = outline ? [name, kind, ...outline.center] : g;
    const lay = layout(gen, edits[name] ?? {}), lod = LOD[kind] ?? LOD.town;
    const el = document.createElement('div');
    // Regions are just lettering over the area (like Google Maps); everything else gets a symbol on its spot.
    const area = AREA_KINDS.has(kind);
    el.className = `globe-place k-${kind}${area ? ' globe-area' : ''}`;
    el.innerHTML = `<span></span>${area ? '' : `<svg viewBox="0 0 12 12">${PLACE_ICONS[kind] ?? PLACE_ICONS.town}</svg>`}`;
    el.firstElementChild!.textContent = name;
    el.onclick = () => { if (!editing) view.flyToPlace(i); };
    if (outline) { // hovering the name lights up its area
      el.onmouseenter = () => { if (bordersOn && !editing) regions.hover = outline.id; };
      el.onmouseleave = () => { regions.hover = null; };
    }
    const obj = new CSS2DObject(el);
    if (!area) obj.center.set(0.5, 0); // the symbol, at the bottom of the label, sits on the place
    scene.add(obj);
    return { name, kind, gen, ...lay, obj: obj as THREE.Object3D, lod, flat: false, outline, fit: 1, nat: 0 };
  });
  type Place = (typeof places)[number];
  let editorSync = () => {}; // editorSync: edit mode's selection box, set below
  const put = (p: Place) => {
    p.obj.position.copy(p.up).multiplyScalar(R + 3000);
    if (p.flat) { // lie on the ground, text running east, turned by rot
      const { east, north } = eastNorth(p.up);
      p.obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, north, p.up))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad(p.rot)));
      p.obj.scale.set(p.scale, p.scale, 1);
    } else { // scale only the text, so the symbol stays on the spot
      const text = (p.obj as CSS2DObject).element.firstElementChild as HTMLElement;
      const s = p.scale * p.fit;
      text.style.cssText = s === 1 ? '' : `display:inline-block;transform-origin:50% 100%;transform:scale(${s})`;
    }
  };
  places.forEach(put);
  let showNames = true;
  const hiddenKinds = new Set<string>();

  const el = renderer.domElement;
  const toNdc = (e: MouseEvent) => {
    const r = el.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };

  // ---------- altitude zoom ----------
  // Altitude eases toward altGoal in log space, so wheel and buttons zoom smoothly at any height.
  let alt = HOME.alt, altGoal = alt;
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
  let grab: THREE.Vector3 | null = null, dragging = false, down = { x: 0, y: 0 };
  const release = () => (grab = null, dragging = false);
  for (const t of [el, labelsEl]) {
    t.addEventListener('pointerdown', (e) => {
      if (!controls.enabled || !e.isPrimary || e.button !== 0) return;
      anim = anchor = null;
      down = { x: e.clientX, y: e.clientY };
      ray.setFromCamera(toNdc(e), camera);
      grab = ray.ray.intersectSphere(planet, hit) ? hit.clone().normalize() : null;
    });
    t.addEventListener('pointermove', (e) => {
      if (!grab) return;
      if (!dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) return;
      if (!dragging) { dragging = true; el.setPointerCapture(e.pointerId); }
      pinTo(grab, toNdc(e));
    });
    t.addEventListener('pointerup', release);
    t.addEventListener('pointercancel', release);
    t.addEventListener('wheel', onWheel, { passive: false });
  }

  // ---------- flights ----------
  let anim: { t0: number; d0: THREE.Vector3; d1: THREE.Vector3; a0: number; a1: number } | null = null;
  const tmp = new THREE.Vector3();
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const flyToDir = (dir: THREE.Vector3, a: number) =>
    (anim = { t0: performance.now(), d0: camera.position.clone().normalize(), d1: dir.clone().normalize(), a0: alt, a1: a });
  const latLon = (v: THREE.Vector3) => ({ lat: THREE.MathUtils.radToDeg(Math.asin(v.y / v.length())), lon: THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z)) });
  const ray = new THREE.Raycaster(), planet = new THREE.Sphere(new THREE.Vector3(), R), hit = new THREE.Vector3();

  const view = {
    scene, camera, controls, labels,
    nav: {
      heading: () => 0, // the globe stays north-up
      resetNorth() {},
      zoom: (f: number) => zoomTo(altGoal * f),
      canTilt: false,
      tilt: () => 0,
      toggleTilt() {},
      home: () => flyToDir(HOME.dir, HOME.alt),
      altitude: () => alt,
      pick(ndc: THREE.Vector2) {
        ray.setFromCamera(ndc, camera);
        return ray.ray.intersectSphere(planet, hit) ? latLon(hit) : null;
      },
      metresPerPixel: () => (2 * alt * Math.tan(rad(camera.fov / 2))) / innerHeight,
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
      flyToDir(p.up, ids.some((id) => SITES[id].name === p.name) ? SITE_SWITCH.enterDistance * 0.8 : p.lod[1]);
    },
    /** The site whose centre the camera is within `d` metres of, if any. */
    siteWithin: (d: number) => ids.find((id) => camera.position.distanceTo(frames[id].origin) < d),
    /** Current camera expressed in a site frame (x east, y up, z south), looking at the point below it. */
    siteCamera(id: SiteId) {
      const f = frames[id], o = tmp.copy(camera.position).sub(f.origin);
      const position = new THREE.Vector3(o.dot(f.east), o.dot(f.up), -o.dot(f.north));
      const n = camera.position.clone().setLength(R).sub(f.origin);
      return { position, target: new THREE.Vector3(n.dot(f.east), 0, -n.dot(f.north)), quaternion: frameQuat[id].clone().invert().multiply(camera.quaternion) };
    },
    /** Put the globe camera where a site camera is, so both draw the same view. */
    followSite(id: SiteId, site: THREE.Camera) {
      const f = frames[id], p = site.position;
      anim = null;
      camera.position.copy(f.origin).addScaledVector(f.east, p.x).addScaledVector(f.up, p.y).addScaledVector(f.north, -p.z);
      camera.quaternion.copy(frameQuat[id]).multiply(site.quaternion);
      alt = altGoal = Math.max(camera.position.length() - R, 1);
    },
    /** Sky: blue near the ground, space above the atmosphere, by camera altitude. */
    setSky() {
      const f = THREE.MathUtils.clamp(Math.log(300_000 / Math.max(alt, 1)) / Math.log(300_000 / 20_000), 0, 1);
      (scene.background as THREE.Color).copy(SPACE).lerp(SKY, f);
      stars.visible = atmosphere.visible = f === 0;
    },
    update(dt: number, now: number) {
      if (anim) {
        const t = Math.min(1, (now - anim.t0) / 3500), e = ease(t);
        camera.position.copy(tmp.copy(anim.d0).lerp(anim.d1, e).normalize());
        alt = altGoal = Math.exp(THREE.MathUtils.lerp(Math.log(anim.a0), Math.log(anim.a1), e));
        if (t === 1) anim = null;
      } else {
        alt = Math.exp(THREE.MathUtils.lerp(Math.log(alt), Math.log(altGoal), Math.min(1, dt * 8)));
      }
      camera.position.setLength(R + alt);
      if (anim) anchor = null; else holdAnchor();
      controls.rotateSpeed = THREE.MathUtils.clamp(alt / 10_000_000, 0.02, 1);
      controls.update();
      headlight.position.copy(camera.position).addScaledVector(camera.up, R);
      terrain.refresh(); regions.refresh(); // line widths are in screen pixels
      // a place faces the camera when the camera is above its horizon: cos(angle) > R / |camera|
      const cosLimit = R / camera.position.length(), cam = tmp.copy(camera.position).normalize();
      for (const p of places) {
        p.obj.visible = showNames && !hiddenKinds.has(p.kind) && alt < p.lod[0] && cam.dot(p.up) > cosLimit;
        if (!p.obj.visible || !p.outline) continue;
        // keep a region's name inside its borders: shrink it to the area's on-screen width (at most its natural size)
        const text = (p.obj as CSS2DObject).element.firstElementChild as HTMLElement;
        const room = (p.outline.span * rad(1) * R * Math.cos(rad(p.outline.center[0]))) / view.nav.metresPerPixel();
        const fit = Math.min(1, Math.max(0.1, (0.9 * room) / ((p.nat ||= text.offsetWidth) * p.scale || 1))); // measured once: reading layout every frame forces a reflow
        if (Math.abs(fit - p.fit) > 0.01) { p.fit = fit; put(p); }
      }
      editorSync();
    },
  };
  // ---------- edit mode (dev server): drag a name to move it, turn lettering on the water; Save writes src/place-edits.ts ----------
  // The panel (main.ts) drives this through `editor`.
  let sel: Place | null = null, dirty = false;
  const select_ = (p: Place | null) => { sel = p; editor.onChange(); };
  const changed = () => { dirty = true; editor.onChange(); };
  const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
  const record = (p: Place, patch: PlaceEdit) => { edits[p.name] = { ...edits[p.name], ...patch }; };
  const editor = {
    onChange: () => {},
    setActive(v: boolean) { editing = v; document.body.classList.toggle('editing', v); if (!v) select_(null); },
    state: () => sel && { name: sel.name, kind: sel.kind, flat: sel.flat, rot: sel.rot, scale: sel.scale, edited: sel.name in edits },
    dirty: () => dirty,
    setRot(deg: number) {
      if (!sel?.flat) return;
      sel.rot = (((Math.round(deg * 10) / 10) % 360) + 360) % 360;
      record(sel, { rot: sel.rot });
      put(sel);
      changed();
    },
    setScale(s: number) {
      if (!sel) return;
      sel.scale = THREE.MathUtils.clamp(round(s, 2), 0.2, 8);
      record(sel, { s: sel.scale });
      put(sel);
      changed();
    },
    reset() {
      if (!sel) return;
      delete edits[sel.name];
      Object.assign(sel, layout(sel.gen, {}));
      put(sel);
      changed();
    },
    async save() {
      const ok = await fetch('/__place-edits', { method: 'POST', body: JSON.stringify(edits) }).then((r) => r.ok, () => false);
      if (ok) dirty = false;
      editor.onChange();
      return ok;
    },
  };
  const startMove = (p: Place) => {
    select_(p);
    anim = anchor = grab = null;
    const move = (ev: PointerEvent) => {
      ray.setFromCamera(toNdc(ev), camera);
      if (!ray.ray.intersectSphere(planet, hit)) return;
      const dir = hit.clone().normalize(), { lat, lon } = latLon(dir);
      p.up.copy(dir);
      record(p, { p: [round(lat), round(lon)] });
      put(p);
      changed();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', () => removeEventListener('pointermove', move), { once: true });
  };
  let editing = false;

  // Selection box with handles, drawn over the screen around the selected name: corners resize, the knob above turns water lettering.
  const box = document.createElement('div');
  box.className = 'edit-box';
  box.hidden = true;
  box.innerHTML = '<i class="stem"></i><i class="h nw" data-h="s"></i><i class="h ne" data-h="s"></i><i class="h sw" data-h="s"></i><i class="h se" data-h="s"></i><i class="h rot" data-h="r"></i>';
  document.body.append(box);
  let boxC = { x: 0, y: 0 }; // box centre on screen
  const toScreen = (v: THREE.Vector3) => { const n = v.clone().project(camera); return { x: ((n.x + 1) / 2) * innerWidth, y: ((1 - n.y) / 2) * innerHeight }; };
  const syncBox = () => {
    box.hidden = !(editing && sel?.obj.visible);
    if (box.hidden || !sel) return;
    let w: number, h: number, ang = 0;
    if (sel.flat) { // the lettering's quad, projected: its two axes give size and tilt on screen
      const m = sel.obj as THREE.Mesh, g = (m.geometry as THREE.PlaneGeometry).parameters;
      camera.updateMatrixWorld();
      const c = toScreen(m.position);
      const ax = (x: number, y: number) => toScreen(new THREE.Vector3(x, y, 0).applyQuaternion(m.quaternion).add(m.position));
      const px = ax((g.width / 2) * sel.scale, 0), py = ax(0, (g.height / 2) * sel.scale);
      boxC = c;
      w = 2 * Math.hypot(px.x - c.x, px.y - c.y); h = 2 * Math.hypot(py.x - c.x, py.y - c.y);
      ang = Math.atan2(px.y - c.y, px.x - c.x);
    } else { // a screen-facing label: the union of its text and symbol
      const rs = [...(sel.obj as CSS2DObject).element.children].map((n) => n.getBoundingClientRect());
      const l = Math.min(...rs.map((r) => r.left)), r = Math.max(...rs.map((r) => r.right));
      const t = Math.min(...rs.map((r) => r.top)), b = Math.max(...rs.map((r) => r.bottom));
      boxC = { x: (l + r) / 2, y: (t + b) / 2 };
      w = r - l; h = b - t;
    }
    w = Math.max(w, 24) + 12; h = Math.max(h, 18) + 8;
    box.classList.toggle('flat', sel.flat);
    box.style.width = `${w}px`; box.style.height = `${h}px`;
    box.style.transform = `translate(${boxC.x - w / 2}px,${boxC.y - h / 2}px) rotate(${ang}rad)`;
  };
  box.addEventListener('pointerdown', (e) => {
    const kind = (e.target as HTMLElement).dataset.h;
    if (!kind || !sel || !e.isPrimary) return;
    e.preventDefault(); e.stopPropagation();
    const { x: cx, y: cy } = boxC, s0 = sel.scale, r0 = sel.rot;
    const dist = (ev: PointerEvent) => Math.hypot(ev.clientX - cx, ev.clientY - cy) || 1;
    const angle = (ev: PointerEvent) => (Math.atan2(-(ev.clientY - cy), ev.clientX - cx) * 180) / Math.PI; // counter-clockwise on screen
    const d0 = dist(e), a0 = angle(e);
    const move = (ev: PointerEvent) => kind === 's' ? editor.setScale((s0 * dist(ev)) / d0) : editor.setRot(r0 + angle(ev) - a0);
    addEventListener('pointermove', move);
    addEventListener('pointerup', () => removeEventListener('pointermove', move), { once: true });
  });
  editorSync = syncBox;

  for (const p of places) {
    if (!p.flat) (p.obj as CSS2DObject).element.addEventListener('pointerdown', (e) => {
      if (!editing || !e.isPrimary || e.button !== 0) return;
      e.stopPropagation(); // not a globe drag
      startMove(p);
    });
  }
  el.addEventListener('pointerdown', (e) => { // lettering on the water is a mesh, so pick it with a ray
    if (!editing || !e.isPrimary || e.button !== 0) return;
    ray.setFromCamera(toNdc(e), camera);
    const hitMesh = ray.intersectObjects(places.filter((p) => p.flat && p.obj.visible).map((p) => p.obj), false)[0];
    const p = hitMesh && places.find((q) => q.obj === hitMesh.object);
    if (p) startMove(p); else select_(null);
  });
  addEventListener('keydown', (e) => { // Q/E turn the selected lettering (Shift: 1°), Ctrl+S saves
    if (!editing || (e.target as HTMLElement).closest('input[type=search]')) return;
    const k = e.key.toLowerCase();
    if (k === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); editor.save(); }
    else if (sel?.flat && (k === 'q' || k === 'e')) editor.setRot(sel.rot + (k === 'q' ? 1 : -1) * (e.shiftKey ? 1 : 5));
  });

  // ---------- region borders: hover and click to highlight, like Google Maps ----------
  let bordersOn = true, clickStart: { x: number; y: number; t: number } | null = null;
  const select = (r: Region | null) => {
    regions.selected = r?.id ?? null;
    showCard(r && { kind: 'Region', name: r.name });
  };
  const regionUnder = (e: PointerEvent) => {
    const p = view.nav.pick(toNdc(e));
    return p ? regionAt(p.lat, p.lon) : null;
  };
  el.addEventListener('pointermove', (e) => {
    if (!controls.enabled || !bordersOn || editing) return;
    const r = e.buttons ? null : regionUnder(e); // no hover while dragging the globe
    regions.hover = r?.id ?? null;
    el.style.cursor = r ? 'pointer' : '';
  });
  el.addEventListener('pointerleave', () => { regions.hover = null; });
  el.addEventListener('pointerdown', (e) => { clickStart = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  el.addEventListener('pointerup', (e) => {
    const d = clickStart; clickStart = null;
    if (!d || !controls.enabled || !bordersOn || editing) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5 && performance.now() - d.t < 500) select(regionUnder(e));
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') select(null); });
  view.setBordersVisible = (v: boolean) => { bordersOn = v; regions.object.visible = v; if (!v) { regions.hover = null; select(null); } };

  return Object.assign(view, { editor, deselect: () => select(null) });
}
