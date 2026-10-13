import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ATLAS_MAP, KNOWN_WORLD, PLANET, SITE_SWITCH, SITES, type SiteId } from '../config';
import { ATLAS_BOUNDS, KNOWN_WORLD_BOUNDS as B, enuFrame, siteLatLon, toVector } from '../geo';
import { PLACES } from '../world-data';
import { PLACE_ICONS } from './placeIcons';

// Planet-centred frame, metres. The Known World map is draped as a lat/lon patch over an ocean sphere.
const R = PLANET.radius;
const MIN_ALT = 150_000, MAX_ALT = 40_000_000;
const rad = THREE.MathUtils.degToRad;

export type GlobeView = ReturnType<typeof createGlobeView>;

export function createGlobeView(renderer: THREE.WebGLRenderer, labelsEl: HTMLElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060c);
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 100, 3e8);
  const HOME = { dir: toVector(32, 45, 1), alt: 22_000_000 }; // over the Known World
  camera.position.copy(HOME.dir).multiplyScalar(R + HOME.alt);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false; // altitude-based zoom below; OrbitControls zooms by distance to the centre
  controls.enableDamping = true;
  const labels = new CSS2DRenderer({ element: labelsEl });

  // ---------- planet ----------
  const oceanMat = new THREE.MeshLambertMaterial({ color: KNOWN_WORLD.ocean });
  const ocean = new THREE.Mesh(new THREE.SphereGeometry(R * 0.9996, 128, 64), oceanMat);
  const loadTex = (url: string) => {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };
  const styles = {
    painted: { map: loadTex('/world/known-world.jpg'), ocean: KNOWN_WORLD.ocean },
    outline: { map: loadTex('/world/known-world-outline.jpg'), ocean: KNOWN_WORLD.outline.sea },
    atlas: { map: loadTex('/world/known-world-atlas.jpg'), ocean: ATLAS_MAP.sea },
  };
  const mapMat = new THREE.MeshLambertMaterial({ map: styles.painted.map });
  // A lat/lon patch of the planet. SphereGeometry's phi=0 points at -X; our longitude 0 faces +Z, hence the +90° offset.
  const patch = (b: typeof B, material: THREE.Material) => new THREE.Mesh(
    new THREE.SphereGeometry(R, 512, 256, rad(b.west) + Math.PI / 2, rad(b.east - b.west), Math.PI / 2 - rad(b.north), rad(b.north - b.south)),
    material,
  );
  const knownWorld = patch(B, mapMat); // painted + outline styles share this patch
  const atlasWorld = patch(ATLAS_BOUNDS, new THREE.MeshLambertMaterial({ map: styles.atlas.map }));
  atlasWorld.visible = false;
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
  scene.add(ocean, knownWorld, atlasWorld, atmosphere, stars, new THREE.AmbientLight(0xffffff, 1.3), headlight);

  // ---------- site markers ----------
  const ids = Object.keys(SITES) as SiteId[];
  const frames = Object.fromEntries(ids.map((id) => {
    const { lat, lon } = siteLatLon(id);
    return [id, enuFrame(lat, lon)];
  })) as Record<SiteId, ReturnType<typeof enuFrame>>;
  const markers = ids.map((id) => {
    const el = document.createElement('div');
    // Same look as the place names (name above, symbol on the spot); gold marks the places you can enter.
    const kind = SITES[id].kind;
    el.className = `globe-place globe-site k-${kind}`;
    el.innerHTML = `<span></span><svg viewBox="0 0 12 12">${PLACE_ICONS[kind]}</svg>`;
    el.firstElementChild!.textContent = SITES[id].name;
    el.onclick = () => view.flyTo(id);
    const obj = new CSS2DObject(el);
    obj.center.set(0.5, 0);
    obj.position.copy(frames[id].origin).multiplyScalar((R + 3000) / R);
    scene.add(obj);
    return { id, obj };
  });

  // ---------- place names ----------
  // From the maps (src/world-data.ts). Each kind is shown while the camera is below a height, so the screen only holds
  // what is readable at that zoom, and only on the near side of the planet. [shown below, fly-to height], metres.
  // The whole Known World is ~17,000 km across; at 22,000 km up it all fits the screen, at 3,000 km about Westeros-and-a-half.
  const LOD: Record<string, [number, number]> = {
    ocean: [60_000_000, 8_000_000], region: [9_000_000, 3_500_000], city: [7_000_000, 900_000], capital: [4_000_000, 700_000],
    island: [5_000_000, 1_300_000], mountain: [4_500_000, 1_500_000], forest: [4_500_000, 1_500_000], wild: [4_500_000, 2_000_000],
    sea: [5_000_000, 1_500_000], lake: [2_500_000, 1_000_000], river: [2_000_000, 1_500_000],
    castle: [2_200_000, 550_000], town: [2_200_000, 550_000], ruin: [2_200_000, 600_000], landmark: [2_500_000, 700_000],
    minor: [1_100_000, 450_000],
  };
  // A place has one position on the painted/outline maps and, if the two drawings differ, another on the political atlas;
  // the symbol always sits where the map being shown has it.
  const places = PLACES.map(([name, kind, lat, lon, aLat, aLon], i) => {
    const el = document.createElement('div');
    el.className = `globe-place k-${kind}`;
    el.innerHTML = `<span></span><svg viewBox="0 0 12 12">${PLACE_ICONS[kind] ?? PLACE_ICONS.town}</svg>`;
    el.firstElementChild!.textContent = name;
    el.onclick = () => view.flyToPlace(i);
    const obj = new CSS2DObject(el);
    obj.center.set(0.5, 0); // the symbol, at the bottom of the label, sits on the place
    scene.add(obj);
    const ups = [toVector(lat, lon, 1), aLat === undefined ? toVector(lat, lon, 1) : toVector(aLat, aLon!, 1)];
    return { name, kind, ups, up: ups[0], obj, lod: LOD[kind] ?? LOD.town };
  });
  const placePlaces = (atlas: boolean) => {
    for (const p of places) { p.up = p.ups[atlas ? 1 : 0]; p.obj.position.copy(p.up).multiplyScalar(R + 3000); }
  };
  placePlaces(false);
  let showNames = true;
  const hiddenKinds = new Set<string>();

  // ---------- altitude zoom ----------
  // Altitude eases toward altGoal in log space, so wheel and buttons zoom smoothly at any height.
  let alt = HOME.alt, altGoal = alt;
  const zoomTo = (a: number) => { anim = null; altGoal = THREE.MathUtils.clamp(a, MIN_ALT, MAX_ALT); };
  renderer.domElement.addEventListener('wheel', (e) => {
    if (!controls.enabled) return;
    e.preventDefault();
    zoomTo(altGoal * Math.pow(1.0015, e.deltaY));
  }, { passive: false });

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
    setStyle(style: keyof typeof styles) {
      knownWorld.visible = style !== 'atlas';
      atlasWorld.visible = style === 'atlas';
      if (style !== 'atlas') mapMat.map = styles[style].map;
      oceanMat.color.setHex(styles[style].ocean);
      placePlaces(style === 'atlas');
    },
    setNamesVisible(v: boolean) { showNames = v; },
    setKindVisible(kind: string, v: boolean) { if (v) hiddenKinds.delete(kind); else hiddenKinds.add(kind); },
    /** How many names of each kind the maps have (for the legend). */
    kindCounts: places.reduce((c, p) => ((c[p.kind] = (c[p.kind] ?? 0) + 1), c), {} as Record<string, number>),
    /** Every named place on the maps, for search: [name, kind] in the order flyToPlace expects. */
    places: places.map((p) => ({ name: p.name, kind: p.kind })),
    flyToPlace(i: number) { flyToDir(places[i].up, places[i].lod[1]); },
    flyTo: (id: SiteId) => flyToDir(frames[id].up, SITE_SWITCH.enterDistance * 0.8),
    jumpTo(id: SiteId) {
      anim = null;
      camera.position.copy(frames[id].up);
      alt = altGoal = SITE_SWITCH.enterDistance * 0.8;
    },
    /** The site the camera is close enough to enter, if any. */
    siteInRange: () => ids.find((id) => camera.position.distanceTo(frames[id].origin) < SITE_SWITCH.enterDistance),
    /** Current camera expressed in a site frame (x east, y up, z south), looking at the point below it. */
    siteCamera(id: SiteId) {
      const f = frames[id], o = tmp.copy(camera.position).sub(f.origin);
      const position = new THREE.Vector3(o.dot(f.east), o.dot(f.up), -o.dot(f.north));
      const n = camera.position.clone().setLength(R).sub(f.origin);
      return { position, target: new THREE.Vector3(n.dot(f.east), 0, -n.dot(f.north)) };
    },
    /** Arrive from a site: place the globe camera where the site camera was. */
    enterFromSite(id: SiteId, sitePos: THREE.Vector3) {
      const f = frames[id];
      anim = null;
      camera.position.copy(f.origin).addScaledVector(f.east, sitePos.x).addScaledVector(f.up, sitePos.y).addScaledVector(f.north, -sitePos.z);
      alt = altGoal = Math.max(camera.position.length() - R, SITE_SWITCH.exitDistance);
      controls.update();
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
      controls.rotateSpeed = THREE.MathUtils.clamp(alt / 10_000_000, 0.02, 1);
      controls.update();
      headlight.position.copy(camera.position).add(camera.up.clone().multiplyScalar(R));
      for (const m of markers) { // hide markers on the far side of the planet
        const f = frames[m.id];
        m.obj.visible = tmp.copy(camera.position).sub(f.origin).dot(f.up) > 0;
      }
      // a place faces the camera when the camera is above its horizon: cos(angle) > R / |camera|
      const cosLimit = R / camera.position.length(), cam = camera.position.clone().normalize();
      for (const p of places) p.obj.visible = showNames && !hiddenKinds.has(p.kind) && alt < p.lod[0] && cam.dot(p.up) > cosLimit;
    },
  };
  view.setStyle('outline'); // the default look: the atlas outline map
  return view;
}
