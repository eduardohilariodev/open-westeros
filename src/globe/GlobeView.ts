import { Q, loadTexture } from '../quality';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PLANET } from '../config';
import { createDeclutter, offset, RINGS, setShown } from '../declutter';
import { eastNorth, toVector } from '../geo';
import { PLACE_SNAP } from '../place-snap';
import world from '../vector-world.json';
import { PLACES } from '../world-data';
import { chaikin } from './rivers';
import roadData from '../roads.json';
import type { Ring } from './viewLayer';
import { AREA_KINDS, easeFont, FONT_DEFAULT, FONT_PX, wrap } from './labelText';
import { PIN_BOX, PLACE_ICONS, PLACE_KINDS } from './placeIcons';
import { PLACE_INFO } from '../place-info';
import PLACE_ALT from '../place-alt.json';
import { createCameraRig, MIN_ALT } from './cameraRig';
import { createCharacterLayer } from './characterPath';
import { createMeasure } from './measure';
import { createRegions, regionAt, regionNamed } from './regions';
import { createHouseLayer } from './houses';
import { stateAt } from '../state/changes';
import HOUSE_ROWS from '../houses.json';
import { createRelief } from './relief';
import { B } from './bake';
import { papered } from './gpuVector';
import { createTerrain, TERRAIN_SEA } from './terrain';
import { WALL_CASTLES } from './wall';
import { CASTLES } from './wallLine';
import { getPeriod, onPeriod, START } from '../state/time';

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
  // Atmosphere: the shell's far side is drawn over everything, and each pixel's ray is marched through it (up to the ground if it
  // hits the planet). From space that is a blue glow round the limb; from low down it fades the distant ground into the sky.
  const ATMO = 1.09; // the shell is ~5x thicker than Earth's 100 km so the limb glow is wide enough to see; coefficients are divided by that so a look straight down is still Earth-like
  const atmoMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uGround: { value: R }, uTop: { value: R * ATMO }, uGroundA: { value: 1 }, uSun: { value: toVector((B.lat0 + B.lat1) / 2, (B.lon0 + B.lon1) / 2, 1) }, /* noon over the middle of the map: the night is the far side of the planet */ uNight: { value: 1 }, tDepth: { value: null as THREE.Texture | null }, uDepthOn: { value: 0 }, uView: { value: new THREE.Vector2(1, 1) }, uLogFar: { value: 1 }, uFwd: { value: new THREE.Vector3(0, 0, -1) } },
    vertexShader: `varying vec3 vW;
      void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
    // Single scattering after Hillaire / Bruneton: Rayleigh (1/lambda^4, scale height 8 km), Mie (grey, Cornette-Shanks phase, scale height
    // 1.2 km) and ozone absorption (a tent layer at 25 km), Earth's coefficients at (680, 550, 440) nm. Heights are stretched to the shell (uTop - uGround = 100 km x KS).
    // Each sample's sun light is attenuated by its own march to the sun and cut by the planet's shadow; a small isotropic term stands in for
    // multiple scattering. No LUTs: one ray per pixel is cheap enough here.
    fragmentShader: `uniform float uGround, uTop, uNight, uGroundA, uDepthOn, uLogFar;
      uniform vec3 uSun, uFwd; uniform vec2 uView; uniform sampler2D tDepth; varying vec3 vW;
      const vec3 BR = vec3(8.67e-6, 15.14e-6, 31.6e-6), BO = vec3(1.4e-6, 1.9e-6, 0.2e-6); // Rayleigh (1/lambda^4) and ozone sampled at 615, 535 and 445 nm, the dominant wavelengths of the cone responses (Schueler, thetenthplanet.de/archives/4519)
      const float BMS = 3.996e-6, BMA = 0.444e-6, G = 0.8, SUN = 9.0, EXPOSURE = 1.0, DK = 1.5, HAZE = 8.0; // DK: how much denser than Earth's air, so the limb and the distance read; HAZE: how much denser again over the ground, close to it
      float HR, HM, KS; // scale heights of the air and of the haze, and the planet's size against Earth's
      vec2 sphere(vec3 o, vec3 d, float r) { float b = dot(o, d), h = b * b - (dot(o, o) - r * r); return h < 0.0 ? vec2(1e30, -1e30) : vec2(-b - sqrt(h), -b + sqrt(h)); }
      vec3 extinction(float h) {
        float oz = max(0.0, 1.0 - abs(h / KS - 25000.0) / 15000.0);
        return DK * (BR * exp(-h / HR) + (BMS + BMA) * exp(-h / HM) + BO * oz) / KS;
      }
      vec3 sunTransmittance(vec3 p) { // optical depth from p towards the sun, to the top of the air
        vec2 s = sphere(p, uSun, uTop);
        float dt = s.y / 3.0; vec3 tau = vec3(0.0);
        for (int i = 0; i < 3; i++) tau += extinction(length(p + uSun * (float(i) + 0.5) * dt) - uGround) * dt;
        return exp(-tau);
      }
      vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      void main() {
        KS = (uTop - uGround) / 1e5; HR = 8000.0 * KS; HM = 1200.0 * KS;
        vec3 ro = cameraPosition, rd = normalize(vW - cameraPosition);
        vec2 top = sphere(ro, rd, uTop), gr = sphere(ro, rd, uGround);
        float t0 = max(top.x, 0.0), t1 = top.y;
        float night = 0.0; bool hit = false;
        if (gr.x > 0.0 && gr.x < 1e29) { // the ground ends the ray
          t1 = gr.x; hit = true;
          night = 0.97 * uNight * smoothstep(0.0, -0.2, dot(normalize(ro + rd * t1), uSun)); // the unlit half: N.L < 0, with a soft terminator
        }
        #ifndef SKY_PASS
        // The land's own depth (relief.depth: the log-depth buffer of the mesh, half size) ends the ray where the ground really is, so a tilted
        // view is hazed by the distance to what is drawn, ridges above the smooth planet's horizon included, not by the smooth sphere's hit.
        if (uDepthOn > 0.5) {
          float dz = texture2D(tDepth, gl_FragCoord.xy / uView).r;
          if (dz < 0.99999) {
            float tz = (exp2(dz * uLogFar) - 1.0) / max(dot(rd, uFwd), 1e-3); // view depth to distance along the ray
            if (!hit || tz < t1) {
              t1 = tz; hit = true;
              night = 0.97 * uNight * smoothstep(0.0, -0.2, dot(normalize(ro + rd * t1), uSun));
            }
          }
        }
        #endif
        // Two passes share this shader: the haze over the ground (rays that hit it), drawn over everything, and the sky (rays that miss), drawn
        // behind the relief with the depth test, so a ridge standing above the smooth planet's horizon is not painted out by it.
        #ifdef SKY_PASS
        if (hit) discard;
        #else
        if (!hit) discard;
        #endif
        float mu = dot(rd, uSun), g2 = G * G;
        float pr = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu);
        float pm = 3.0 / (8.0 * 3.14159) * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * G * mu, 1.5));
        #ifdef SKY_PASS
        const int N = 24;
        #else
        const int N = 12; // the ground's rays are short and smooth
        #endif
        float dt = (t1 - t0) / float(N);
        vec3 tau = vec3(0.0), L = vec3(0.0);
        for (int i = 0; i < N; i++) {
          vec3 q = ro + rd * (t0 + (float(i) + 0.5) * dt);
          float h = length(q) - uGround;
          vec3 ext = extinction(h) * dt, T = exp(-tau - 0.5 * ext);
          vec3 sc = DK * BR * exp(-h / HR) / KS, sm = DK * BMS * exp(-h / HM) / KS * vec3(1.0);
          vec2 sh = sphere(q, uSun, uGround);
          float lit = sh.x > 0.0 && sh.y > 0.0 ? 0.0 : 1.0; // the planet's shadow
          vec3 Ts = sunTransmittance(q) * lit;
          vec3 phase = sc * pr + sm * pm, ms = (sc + sm) * 0.3 / (4.0 * 3.14159); // multiple scattering: isotropic, a third of the first order
          L += T * Ts * (phase + ms) * dt;
          tau += ext;
        }
        vec3 T = exp(-tau);
        // The veil knows only the smooth planet, not the relief standing on it, so near the ground it is capped: no fog wall at the horizon for mountains to sink into.
        // w: 1 inside the air, 0 well above it (smooth in between), so the sky never switches on or off at some height; above, the march alone decides
        float H = uTop - uGround, w = 1.0 - smoothstep(0.15 * H, 1.2 * H, length(ro) - uGround);
        float cap = mix(0.95, 0.35, w);
        if (hit) cap = mix(cap, 0.8, smoothstep(6e5, 3e6, t1)); // far ground fades into the horizon's haze, from any height: a tilted view from high up needs the depth cue as much
        if (hit) cap *= uGroundA; // the flat map is not washed pale by it (setEnabled below)
        float Tm = dot(T, vec3(0.3333)), hz = hit ? mix(1.0, HAZE, w * w * w) : 1.0; // hz: the air over the ground is this much denser (tilted views near the ground); higher up it washed the ground white
        float gain = (1.0 - pow(Tm, hz)) / max(1.0 - Tm, 1e-5); // the light scattered in grows with the extinction, or the ground would only darken
        vec3 col = aces(L * gain * SUN * EXPOSURE);
        float a = (1.0 - pow(Tm, hz)) * cap;
        if (!hit) { a = mix(a, 1.0, w); cap = mix(cap, 1.0, w); } // from low down the sky is the scattering itself, not the flat colour behind it
        float A = 1.0 - (1.0 - a) * (1.0 - night); // the night veil lies under the haze
        gl_FragColor = vec4(col * cap / max(A, 1e-4), A); // premultiplied scattering over the night veil
        #include <colorspace_fragment>
      }`,
  });
  const skyMat = new THREE.ShaderMaterial({ uniforms: atmoMat.uniforms, defines: { SKY_PASS: '' }, vertexShader: atmoMat.vertexShader, fragmentShader: atmoMat.fragmentShader, side: THREE.BackSide, transparent: true, depthTest: true, depthWrite: false });
  const skyShell = new THREE.Mesh(new THREE.SphereGeometry(R * ATMO, 96, 48), skyMat);
  skyShell.renderOrder = -0.4; // over the stars (-1) and the sun and moon (-0.5), under the relief
  skyShell.frustumCulled = false;
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(R * ATMO, 96, 48), atmoMat);
  atmosphere.renderOrder = 300; // after the relief, its lines and its clouds (200), which it veils
  atmosphere.frustumCulled = false;
  const stars = (() => { // Milky Way panorama on a sphere round the scene
    const map = loadTexture(`${import.meta.env.BASE_URL}textures/milky_way.jpg`, Q.skyPx);
    map.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.SphereGeometry(2e8, 64, 32), new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false }));
    m.renderOrder = -1;
    return m;
  })();
  // Sun and moon: sprites on a sphere inside the star dome, hidden by the planet like anything behind it. The sun stands over the
  // middle of the map (where the haze shader puts noon); the moon is the full-moon photo, added so its black sky drops out.
  const sky = (() => {
    const SKY_R = 1.5e8, tex = (size: number, draw: (g: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      draw(c.getContext('2d')!);
      return new THREE.CanvasTexture(c);
    };
    const mat = (map: THREE.Texture, depthTest = true) => new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, depthWrite: false, depthTest, toneMapped: false, fog: false });
    const at = (d: THREE.Vector3, deg: number, map: THREE.Texture) => {
      const s = new THREE.Sprite(mat(map));
      s.position.copy(d).multiplyScalar(SKY_R);
      s.scale.setScalar(2 * SKY_R * Math.tan(rad(deg / 2)));
      s.renderOrder = -0.5; // over the stars (-1), under everything else
      return s;
    };
    const radial = (g: CanvasRenderingContext2D, stops: [number, string][]) => {
      const n = g.canvas.width / 2, gr = g.createRadialGradient(n, n, 0, n, n, n);
      for (const [o, c] of stops) gr.addColorStop(o, c);
      g.fillStyle = gr; g.fillRect(0, 0, 2 * n, 2 * n);
    };
    const sunDir = atmoMat.uniforms.uSun.value as THREE.Vector3; // over the middle of the map, where the haze shader puts noon
    // the real disc: 0.53° across, darker and redder towards its limb, I = 1 - 0.6 (1 - mu)
    const disc = at(sunDir, 0.53, tex(64, (g) => radial(g, [0, 0.5, 0.8, 0.95, 1].map((r): [number, string] => {
      const I = 1 - 0.6 * (1 - Math.sqrt(1 - r * r));
      return [r * 0.96, `rgb(${255 * I | 0},${(250 - 60 * (1 - I)) * I | 0},${(235 - 120 * (1 - I)) * I | 0})`];
    }).concat([[1, 'rgba(255,200,130,0)']]))));
    // the shine: a wide, soft, gaussian-like bloom and a starburst of spokes, both blurred
    const bloom = at(sunDir, 18, tex(256, (g) => radial(g, [[0, 'rgba(255,244,220,0.95)'], [0.03, 'rgba(255,240,205,0.6)'], [0.1, 'rgba(255,226,170,0.28)'], [0.25, 'rgba(255,214,150,0.1)'], [0.55, 'rgba(255,205,140,0.025)'], [1, 'rgba(255,200,130,0)']])));
    const rays = at(sunDir, 38, tex(256, (g) => {
      g.translate(128, 128);
      g.filter = 'blur(1.5px)';
      g.lineCap = 'round';
      for (let i = 0; i < 12; i++) {
        const L = i % 2 ? 80 : 124, gr = g.createLinearGradient(-L, 0, L, 0);
        gr.addColorStop(0, 'rgba(255,235,200,0)'); gr.addColorStop(0.5, `rgba(255,240,215,${i % 2 ? 0.45 : 0.7})`); gr.addColorStop(1, 'rgba(255,235,200,0)');
        g.strokeStyle = gr; g.lineWidth = i % 2 ? 1.5 : 2.5;
        g.rotate(Math.PI / 12 + (i % 3) * 0.004);
        g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
      }
    }));
    // lens flare: ghosts on the line through the middle of the screen, at k times the sun's screen position; size is a share of the screen height
    const ghosts = ([[0.55, 0.05, '170,120,255', 0, 0.4], [-0.35, 0.12, '255,190,120', 1, 0.3], [-0.8, 0.04, '255,220,140', 0, 0.6], [-1.4, 0.18, '120,170,255', 1, 0.18], [1.6, 0.07, '255,150,90', 0, 0.25]] as const).map(([k, size, rgb, ring, a]) => {
      const s = new THREE.Sprite(mat(tex(128, (g) => radial(g, ring ? [[0, `rgba(${rgb},0)`], [0.6, `rgba(${rgb},0.02)`], [0.82, `rgba(${rgb},0.7)`], [1, `rgba(${rgb},0)`]] : [[0, `rgba(${rgb},0.8)`], [0.5, `rgba(${rgb},0.3)`], [1, `rgba(${rgb},0)`]])), false));
      s.renderOrder = 400; // in the lens: over the haze and the planet
      return { s, k, size, a };
    });
    const moonMap = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/moon.jpg`);
    moonMap.colorSpace = THREE.SRGBColorSpace;
    // The moon and the comet are fixed among the stars (the planet never turns), set by where they stand on the home view's screen:
    // tangents of the angle right of and above the view's centre (the planet), 45° tall, so 1 px = 1/1062 of a 880 px-high window.
    const ahead = HOME.dir.clone().negate(), upHome = new THREE.Vector3(0, 1, 0).addScaledVector(ahead, -ahead.y).normalize(), rightHome = new THREE.Vector3().crossVectors(ahead, upHome);
    // the camera is off the sphere's middle, so the spot is found from the camera, then taken as a direction from the middle
    const home = (right: number, up: number) => camera.position.clone().addScaledVector(ahead.clone().addScaledVector(rightHome, right).addScaledVector(upHome, up).normalize(), SKY_R).normalize();
    const moon = at(home(-0.452, -0.221), 3.82, moonMap); // the jpg is cropped to the disc (673 of the photo's 704 px)
    moon.material.color.setScalar(0.85);
    // the red comet (photo by sreekuttan09, see Credits): 820 x 570 crop with its sky subtracted, so additive blending leaves only the comet
    const cometMap = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/red_comet.png`);
    cometMap.colorSpace = THREE.SRGBColorSpace;
    const comet = at(home(0.652, 0.178), 15, cometMap);
    comet.scale.y *= 570 / 820;
    const group = new THREE.Group();
    group.add(bloom, rays, disc, moon, comet, ...ghosts.map((x) => x.s));
    const ndc = new THREE.Vector3(), p = new THREE.Vector3();
    /** Place the ghosts for this camera; they fade out as the sun leaves the screen or goes behind the planet. */
    const flare = (cam: THREE.PerspectiveCamera) => {
      const o = cam.position, b = o.dot(sunDir), d = b * b - (o.lengthSq() - R * R);
      ndc.copy(sunDir).multiplyScalar(SKY_R).project(cam);
      const behind = d > 0 && -b - Math.sqrt(d) > 0;
      bloom.visible = rays.visible = !behind; // the planet in front of the sun: no corona poking out round the limb
      const v = behind || ndc.z > 1 ? 0 : 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(ndc.x), Math.abs(ndc.y)), 0.8, 1.5);
      const D = 1e7, h = 2 * D * Math.tan(rad(cam.fov / 2));
      for (const { s, k, size, a } of ghosts) {
        s.visible = v > 0;
        if (!s.visible) continue;
        s.position.copy(p.set(ndc.x * k, ndc.y * k, 0.5).unproject(cam).sub(o).normalize().multiplyScalar(D).add(o));
        s.scale.setScalar(h * size);
        s.material.opacity = v * a;
      }
    };
    return { group, flare };
  })();
  const headlight = new THREE.DirectionalLight(0xffffff, 1.6);
  const regions = createRegions(R), terrain = createTerrain(R);
  const relief = createRelief(terrain.fills, terrain.strokes, ocean, terrain.rivers); // shaded canon relief; off = the flat parchment map
  relief.setEnabled(true);
  // From space the haze lies over the ground too; the flat map keeps its own dark colours, so it gets a third of that
  const setRelief = relief.setEnabled;
  relief.setEnabled = (on: boolean) => { setRelief(on); atmoMat.uniforms.uGroundA.value = on ? 1 : 0.2; terrain.restyle(!on); };
  scene.onBeforeRender = (r, _s, cam) => {
    relief.update(cam as THREE.PerspectiveCamera, r, rig.tilt); // the relief's detail follows the camera drawn
    const u = atmoMat.uniforms, low = cam.position.length() - R < 800e3; // above that the smooth sphere is as good as the land and the pass is not worth its vertices
    u.tDepth.value = low ? relief.depth(r, cam) : null;
    u.uDepthOn.value = u.tDepth.value ? 1 : 0;
    if (u.uDepthOn.value) { r.getDrawingBufferSize(u.uView.value); u.uLogFar.value = Math.log2((cam as THREE.PerspectiveCamera).far + 1); cam.getWorldDirection(u.uFwd.value); }
  };
  scene.add(ocean, relief.object, terrain.object, regions.object, atmosphere, skyShell, stars, sky.group, new THREE.AmbientLight(0xffffff, 1.3), headlight);

  // ---------- place names ----------
  // From the maps (src/world-data.ts). Each kind has a height band, so the screen only holds what is readable at that
  // zoom, and only on the near side of the planet: [shown below, fly-to height, hidden below], metres. Big lettering
  // (oceans, regions) gives way to the places inside it once you are well within it, like Google Maps.
  // The whole Known World is ~17,000 km across; at 22,000 km up it all fits the screen, at 3,000 km about Westeros-and-a-half.
  const LOD: Record<string, [number, number, number?]> = {
    // fitted to the 600 km camera floor (cameraRig.ts MIN_ALT): every kind comes in above it, the finest just above it, and the
    // fly-to heights are at or over it; regions and oceans give way to the places in them at 1,000-1,200 km instead of 500
    continent: [10_000_000, 8_000_000, 6_000_000], ocean: [10_000_000, 8_000_000, 1_200_000], region: [6_000_000, 3_500_000, 1_000_000], city: [3_500_000, 1_100_000], capital: [4_000_000, 1_000_000],
    island: [1_600_000, 1_300_000], archipelago: [3_000_000, 1_300_000, 700_000], inn: [1_000_000, 650_000], mountain: [2_800_000, 1_500_000], forest: [2_800_000, 1_500_000], wild: [2_800_000, 2_000_000],
    sea: [3_500_000, 1_500_000], lake: [2_000_000, 1_200_000], river: [2_000_000, 1_400_000], road: [2_000_000, 1_400_000],
    castle: [1_600_000, 800_000], town: [1_600_000, 800_000], ruin: [1_600_000, 850_000], landmark: [1_800_000, 900_000],
    minor: [1_000_000, 650_000], battle: [2_800_000, 850_000], monument: [1_800_000, 900_000], population: [2_500_000, 1_500_000],
  };
  const ROADS_BELOW = 8_000_000, TRACKS_BELOW = LOD.castle[0]; // main roads and the tracks to places are drawn from these altitudes down (tracks with the castles); road names come in at 1,600 km (LOD)
  type Gen = (typeof PLACES)[number];
  const WATER = new Set(['ocean', 'sea', 'lake']); // one word a line, every word counted
  // the castles of the Wall stand on it (wall.ts)
  const labelText = (name: string, kind: string, oneLine: boolean) => (WATER.has(kind) ? wrap(name, 1, []) : oneLine ? name : wrap(name));
  const layout = ([name, kind, lat, lon]: Gen) => ({ up: toVector(...((kind === "island" ? undefined : WALL_CASTLES[name]) ?? PLACE_SNAP[name] ?? [lat, lon]), 1), rot: 0, scale: 1 });
  const places = PLACES.map((g, i) => {
    const [name, kind] = g;
    const outline = kind === 'region' ? regionNamed(name) : undefined; // a region with an outline is named at its centre
    const gen: Gen = outline ? [name, kind, ...outline.center] : g;
    const lay = layout(gen), lod = LOD[kind] ?? LOD.town;
    const el = document.createElement('div');
    // Regions are just lettering over the area (like Google Maps); everything else gets a symbol on its spot.
    const area = AREA_KINDS.has(kind);
    // the Wall's castles stand ~16 miles apart in a row, so their names are slanted up off the line, one line each (style.css)
    const onWall = kind !== 'island' && name in WALL_CASTLES;
    el.className = `globe-place k-${kind}${area ? ' globe-area' : ''}${onWall ? ' on-wall' : ''}`;
    el.innerHTML = `<span></span>${area ? '' : `<svg viewBox="0 0 512 512">${PLACE_ICONS[kind] ?? PLACE_ICONS.town}</svg>`}`;
    el.firstElementChild!.textContent = labelText(name, kind, area || onWall);
    const alt = (PLACE_ALT as Record<string, string>)[name];
    if (alt) { const s = document.createElement("small"); s.textContent = `(${alt})`; el.firstElementChild!.append(s); } // Dothraki or original name, in parentheses under the label
    el.onclick = (e) => {
      if (pickForMeasure(i, e)) return;
      view.flyToPlace(i);
    };
    const obj = new CSS2DObject(el); // centred: a point label's box is just its symbol, the text hangs off its right side
    scene.add(obj);
    labelsEl.append(el); // in the page from the start, so it can be measured before it is first shown
    el.style.display = 'none';
    return { name, kind, gen, ...lay, obj: obj as THREE.Object3D, lod, flat: false, onWall, oneLine: area || onWall, gone: false, shownName: name, dx: 0, dy: 0, side: 0, outline, fit: 1, zs: 1, size: [0, 0, 0, 0], line: null as LineLabel | null };
  });
  type Place = (typeof places)[number];
  /** A river's or road's name bent along its polyline: unit directions of the smoothed line, and the SVG texts (repeats) that ride on it. */
  type LineCopy = { path: SVGPathElement; text: SVGTextElement; tp: SVGTextPathElement };
  /** `ctr`, `cap` (rad) and `ball` bound the line, so a whole line off the screen or past the horizon is skipped; `step` is its mean vertex spacing, m. */
  type LineLabel = { dirs: THREE.Vector3[]; pos: THREE.Vector3[]; copies: LineCopy[]; pts: Ring; mid: THREE.Vector3; ctr: THREE.Vector3; cap: number; ball: THREE.Sphere; step: number };
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
  document.fonts.ready.then(() => { measure(); labelVersion++; }); // async: labelVersion is declared by then
  // When names overlap on screen, the higher tier keeps its spot: continents, oceans, regions, cities, then ever smaller places.
  const RANK = ['continent', 'ocean', 'region', 'archipelago', 'population', 'capital', 'city', 'sea', 'island', 'castle', 'town', 'mountain', 'forest', 'wild', 'lake', 'river', 'road', 'monument', 'landmark', 'battle', 'inn', 'ruin', 'minor'];
  const ranked = [...places].sort((a, b) => RANK.indexOf(a.kind) - RANK.indexOf(b.kind));
  let order = ranked; // ranked, with the pinned place first
  const pt = new THREE.Vector3();
  let seatBox: number[][] = []; // the focused house's seat name on screen, which its sigils keep clear of
  const WALL_SLANT = rad(60); // the Wall's castle names rise this far off the horizontal (style.css .on-wall)
  /**
   * Where a point name may sit, tried in turn: right of its symbol, left, below, above (style.css `.t-*`); where none is free,
   * the symbol and name are drawn off the place in rings of SHIFT px (below and above first), on a leader line back to it.
   * Screen only: the place keeps its coordinates.
   */
  const SHIFT = 18, SIDES = ['', 't-left', 't-below', 't-above'];
  const SPOTS = RINGS.flatMap(([a, b]) => SIDES.map((side) => [side, a * SHIFT, b * SHIFT] as const));
  /** Draws a place's symbol and name `dx`, `dy` px off its spot (style.css --dx, --dy), with a leader line back when it is moved. */
  const shift = (p: Place, dx: number, dy: number) => {
    if (dx === p.dx && dy === p.dy) return;
    p.dx = dx; p.dy = dy;
    offset((p.obj as CSS2DObject).element, dx, dy);
  };
  const toScreen = (p: Place) => { pt.copy(p.obj.position).project(camera); return [((pt.x + 1) / 2) * innerWidth, ((1 - pt.y) / 2) * innerHeight]; };
  /** A name's box on screen: [left, top, right, bottom], px, with the name at SPOTS[spot]; a chain of boxes for a slanted name. */
  const screenBox = (p: Place, spot = 0): number[] | number[][] => {
    const [side, sx, sy] = SPOTS[spot], [x0, y0] = toScreen(p), x = x0 + (p.onWall ? p.dx : sx), y = y0 + (p.onWall ? p.dy : sy), s = p.scale * p.fit * p.zs, [w, h, tw, th] = p.size;
    if (AREA_KINDS.has(p.kind)) return [x - (tw * s) / 2, y - (th * s) / 2, x + (tw * s) / 2, y + (th * s) / 2];
    if (p.onWall) { // the symbol, then text-high squares up the slant (WALL_SLANT, style.css), so slanted neighbours can stand side by side
      const boxes = [[x - w / 2, y - h / 2, x + w / 2, y + h / 2]], c = Math.cos(WALL_SLANT), sn = Math.sin(WALL_SLANT), e = (th * s) / 2;
      for (let d = w / 2 + 4 + e; d < w / 2 + 4 + tw * s; d += 2 * e) { const cx = x + d * c, cy = y - d * sn; boxes.push([cx - e, cy - e, cx + e, cy + e]); }
      return boxes;
    }
    const hh = Math.max(h, th * s) / 2, hw = Math.max(w, tw * s) / 2;
    // text 4px beside the symbol, or 2px under or over it (style.css)
    if (side === 't-below') return [x - hw, y - h / 2, x + hw, y + h / 2 + 2 + th * s];
    if (side === 't-above') return [x - hw, y - h / 2 - 2 - th * s, x + hw, y + h / 2];
    return side ? [x - w / 2 - 4 - tw * s, y - hh, x + w / 2, y + hh] : [x - w / 2, y - hh, x + w / 2 + 4 + tw * s, y + hh];
  };
  // The Wall's castles, west to east. Each frame they are slid along the Wall's line on screen, as little as will keep slanted
  // neighbours a name's height apart: isotonic regression (pool adjacent violators) of t_i - i·gap.
  const wallRow = CASTLES.map((n) => places.find((p) => p.onWall && p.name === n)!).filter(Boolean);
  // Castles the Watch has abandoned are drawn grey (style.css .abandoned). "Only Eastwatch, Castle Black, and the Shadow Tower were
  // manned when I left the Wall" (ASOS, Jon); "The Watch now had garrisons at Icemark, Long Barrow, Sable Hall, Greyguard, and
  // Deep Lake ... but ten castles still stood empty and abandoned" (ADWD, Jon).
  const MANNED = ['Eastwatch-by-the-Sea', 'Castle Black', 'Shadow Tower'], REMANNED = ['Icemark', 'Long Barrow', 'Sable Hall', 'Greyguard', 'Deep Lake'];
  const markManned = () => {
    const manned = new Set([...MANNED, ...(getPeriod() === 'adwd' ? REMANNED : [])]);
    wallRow.forEach((p) => (p.obj as CSS2DObject).element.classList.toggle('abandoned', !manned.has(p.name)));
  };
  markManned(); onPeriod(markManned);
  const spreadWall = () => {
    const xy = wallRow.map(toScreen), [ax, ay] = [xy.at(-1)![0] - xy[0][0], xy.at(-1)![1] - xy[0][1]], len = Math.hypot(ax, ay) || 1;
    const ux = ax / len, uy = ay / len, q = wallRow[0], th = q.size[3] * q.scale * q.zs;
    // apart across the slant: the gap along the line over the sine between the line and the slant
    const gap = (th + 4) / Math.max(0.3, Math.abs(ux * Math.sin(WALL_SLANT) + uy * Math.cos(WALL_SLANT)));
    const t = xy.map(([x, y]) => (x - xy[0][0]) * ux + (y - xy[0][1]) * uy), blocks: { sum: number; n: number }[] = [];
    t.forEach((ti, i) => {
      blocks.push({ sum: ti - i * gap, n: 1 });
      while (blocks.length > 1 && blocks.at(-2)!.sum / blocks.at(-2)!.n > blocks.at(-1)!.sum / blocks.at(-1)!.n) { const b = blocks.pop()!; blocks.at(-1)!.sum += b.sum; blocks.at(-1)!.n += b.n; }
    });
    const moved = blocks.flatMap((b) => Array(b.n).fill(b.sum / b.n)).map((u, i) => u + i * gap - t[i]);
    // ponytail: too far out the row won't fit; then nothing slides and the overlap check hides names. Fan out with leader lines if wanted
    const fits = Math.max(...moved.map(Math.abs)) < 3 * gap;
    wallRow.forEach((p, i) => shift(p, fits ? Math.round(moved[i] * ux) : 0, fits ? Math.round(moved[i] * uy) : 0));
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
      text.style.cssText = s === 1 ? '' : `display:inline-block;${AREA_KINDS.has(p.kind) ? 'transform-origin:50% 50%;' : ''}transform:scale(${s})`; // a point name's origin is its side's (style.css)
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
    const dirs = pos.map((v) => v.clone().normalize());
    const ctr = dirs.reduce((s, d) => s.add(d), new THREE.Vector3()).normalize();
    const cap = Math.max(...dirs.map((d) => Math.acos(Math.min(1, ctr.dot(d)))));
    const ball = new THREE.Sphere(ctr.clone().multiplyScalar(R + 3000), 2 * (R + 3000) * Math.sin(Math.min(cap, Math.PI) / 2) + 1000);
    p.line = { pos, dirs, copies, pts: best.line, mid: mid.normalize(), ctr, cap, ball, step: len / Math.max(1, pos.length - 1) };
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
  const lineStretches = (r: LineLabel, tw: number, th: number, off: number, cosLimit: number, cam: THREE.Vector3, stride: number) => {
    let run: Ring = [], bestRun = run; // the longest run of vertices on the near side, in screen px (every `stride`th vertex: finer than a pixel is lost to the simplify below)
    const v = new THREE.Vector3(), n = r.pos.length;
    for (let k = 0; k < n; k = k === n - 1 ? n : Math.min(k + stride, n - 1)) {
      if (cam.dot(r.dirs[k]) <= cosLimit) { run = []; continue; }
      v.copy(r.pos[k]).project(camera);
      run.push([((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight]);
      if (run.length > bestRun.length) bestRun = run;
    }
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
  pinEl.innerHTML = `<div class="pin-head"><span></span></div><svg viewBox="${PIN_BOX}">${PLACE_ICONS.pin}</svg>`; // name above the hand, like Google Maps; a house's sigil to the left of the name
  const pinName = pinEl.querySelector('span')!, pinSigil = Object.assign(new Image(), { className: 'pin-sigil', alt: '', draggable: false, hidden: true }); // made here, not in the markup: it has no src until a seat is pinned
  pinName.before(pinSigil);
  const pin = new CSS2DObject(pinEl);
  pin.center.set(0.5, 1); // the tip
  pin.visible = false;
  scene.add(pin);
  let pinned: Place | null = null;
  const setPin = (p: Place | null) => { // the pin takes the place of the place's own symbol
    if (pinned) (pinned.obj as CSS2DObject).element.classList.remove('pinned');
    pinned = p;
    const held = p ? stateAt(p.name) : null, seatHouse = held?.holder ? HOUSE_ROWS.find((h) => h.id === held.holder) : undefined;
    // the holder at the moment; a place whose holder was set by the timeline and is now empty has no arms
    const sigil = p && !AREA_KINDS.has(p.kind) ? (seatHouse?.sigil ?? (held?.holder === null && stateAt(p.name, START).holder ? undefined : PLACE_INFO[p.name]?.houses?.[0]?.[1])) : undefined;
    pinSigil.hidden = !sigil;
    if (sigil) pinSigil.src = `${import.meta.env.BASE_URL}sigils/${sigil.replace(/\.[^.]+$/, '.webp')}`;
    labelVersion++;
    order =p ? [p, ...ranked.filter((q) => q !== p)] : ranked;
    pin.visible = !!p && (!AREA_KINDS.has(p.kind) || !!p.line); // area lettering marks itself; a river or road with a line gets a pin at its middle
    if (!p) return;
    pinName.textContent = held?.name ?? p.name;
    pin.position.copy(p.line?.mid ?? p.up).multiplyScalar(R + 3000);
    (p.obj as CSS2DObject).element.classList.add('pinned');  };
  let showNames = true;
  const hiddenKinds = new Set<string>();
  let labelVersion = 0, labelSig = '', labelSince = 0; // bumped by anything besides the camera that changes which names show
  // The moment (state/changes.ts): a place not there yet, or not yet known to the reader, is hidden; a ruin wears the ruin
  // symbol; a renamed place shows its name of the moment.
  const atMoment = () => {
    for (const p of places) {
      const s = stateAt(p.name), el = (p.obj as CSS2DObject).element, ruin = s.state === 'ruin' && !AREA_KINDS.has(p.kind);
      p.gone = s.state === 'gone';
      if (el.classList.contains('ruined') !== ruin) { el.classList.toggle('ruined', ruin); el.querySelector('svg')!.innerHTML = PLACE_ICONS[ruin ? 'ruin' : p.kind] ?? PLACE_ICONS.town; }
      const name = s.name ?? p.name;
      if (name !== p.shownName) { p.shownName = name; el.firstElementChild!.textContent = labelText(name, p.kind, p.oneLine); }
    }
    measure(); labelVersion++;
  };
  atMoment(); onPeriod(() => { atMoment(); if (pinned) setPin(pinned); });

  const tmp = new THREE.Vector3(), frustum = new THREE.Frustum(), viewProj = new THREE.Matrix4();
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
    const side = document.getElementById('side')!.getBoundingClientRect(), place = document.getElementById('place')!, house = document.getElementById('house')!;
    const card = house && !house.hidden ? house : place; // the house card is the sheet while it is open
    if (phone.matches) return { l: 0, r: 0, t: side.bottom, b: card.hidden ? 0 : Math.min(card.offsetHeight, innerHeight * 0.44) };
    const wide = side.width > innerWidth * 0.6, free = side.width > 0;
    return { l: free && !wide ? side.right : 0, r: 0, t: free && wide ? side.bottom : 0, b: 0 };
  };

  // A character's journey (characterPath.ts); the character panel opens and plays it
  const characters = createCharacterLayer({ scene, R, groundAt: (p) => relief.groundAt(p), rig, covered });

  // The houses overlay (houses.ts): over whatever terrain look is on; its panel (ui/housePanel.ts) listens through onHouseFocus.
  const houseListeners: ((id: string | null) => void)[] = [];
  const houses = createHouseLayer({ R, pick: rig.pick, dom: renderer.domElement, blocked: () => wool.active, onPick: (id) => view.flyToHouse(id), onFocus: (id) => { labelVersion++; houseListeners.forEach((fn) => fn(id)); } });
  scene.add(houses.object);

  const view = {
    scene, camera, controls, labels, attachInput: rig.attachInput, ocean, terrain, relief, wool, characters, houses,
    onHouseFocus(fn: (id: string | null) => void) { houseListeners.push(fn); },
    /** Lights a house and its sworn houses and frames them. */
    flyToHouse(id: string) {
      const extent = houses.extent(id);
      houses.focus(id);
      if (extent.length) rig.flyToFit(extent.map(([lon, lat]) => toVector(lat, lon, 1)), covered(), 16);
    },
    nav: {
      heading: () => rig.heading,
      resetNorth() { rig.turnToNorth(); },
      zoom: rig.zoomBy,
      canTilt: false,
      tilt: () => rig.tilt,
      setTilt(t: number) { rig.tilt = t; },
      toggleTilt() {},
      home: rig.goHome,
      altitude: () => rig.alt,
      pick: rig.pick,
      metresPerPixel: () => (2 * rig.alt * Math.tan(rad(camera.fov / 2))) / innerHeight,
    },
    setNamesVisible(v: boolean) { showNames = v; labelVersion++; },
    setBordersVisible: (_v: boolean) => {}, // replaced below, once the region interaction exists
    setKindVisible(kind: string, v: boolean) { if (v) hiddenKinds.delete(kind); else hiddenKinds.add(kind); labelVersion++; },
    /** How many names of each kind the maps have (for the legend). */
    kindCounts: places.reduce((c, p) => ((c[p.kind] = (c[p.kind] ?? 0) + 1), c), {} as Record<string, number>),
    /** Every named place on the maps, for search: [name, kind] in the order flyToPlace expects. */
    places: places.map((p) => ({ name: p.name, kind: p.kind })),
    /** Whether a place is hidden at the moment (not there yet, or not yet known). */
    placeGone: (i: number) => places[i].gone,
    /** Flies to a place: a spot comes close, a road, river or region is framed whole. */
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
      const extent = p.line ? p.line.pts : p.outline?.shapes.flatMap((s) => s.ring); // a road, river or bordered region is framed whole
      if (extent) {
        rig.flyToFit(extent.map(([lon, lat]) => toVector(lat, lon, 1)), covered(), 16);
        return;
      }
      rig.flyToDir(at, AREA_KINDS.has(p.kind) && !(p.kind === 'region' && !p.outline) ? p.lod[1] : p.lod[1] / 3, phone.matches ? covered() : undefined); // a spot comes close, an area stays whole; a region with no border to frame comes close too
    },
    /** Sky: blue near the ground, space above the atmosphere, by camera altitude. */
    setSky() {
      const f = THREE.MathUtils.clamp(Math.log(200_000 / Math.max(rig.alt, 1)) / Math.log(200_000 / 60_000), 0, 1); // never reached from the 400 km floor: space, as from the ISS
      (scene.background as THREE.Color).copy(SPACE).lerp(SKY, f);
      stars.visible = f < 1; // dimmed by the sky as it brightens
      (stars.material as THREE.MeshBasicMaterial).opacity = 1 - f;
      sky.group.visible = f < 1; // like the stars, gone once the blue sky is in
    },
    update(dt: number, now: number) {
      rig.step(dt, now);
      sky.flare(camera);
      const alt = rig.alt;
      terrain.setRiverWidth(alt);
      headlight.position.copy(camera.position).addScaledVector(camera.up, R);
      terrain.refresh(); regions.refresh(); // line widths are in screen pixels
      wool.update(camera, view.nav.metresPerPixel());
      terrain.setTrackDots(view.nav.metresPerPixel());
      // from this far out the roads are a tangle; they fade in over the last quarter of the way down, tracks over the last third
      terrain.fadeRoads('roads', 1 - THREE.MathUtils.smoothstep(alt, ROADS_BELOW * 0.75, ROADS_BELOW));
      terrain.fadeRoads('tracks', 1 - THREE.MathUtils.smoothstep(alt, TRACKS_BELOW * 0.67, TRACKS_BELOW));
      // a place faces the camera when the camera is above its horizon: cos(angle) > R / |camera|
      const cosLimit = R / camera.position.length(), cam = tmp.copy(camera.position).normalize();
      characters.update(dt, cam, cosLimit);
      houses.update(camera, alt, cosLimit, now, seatBox);
      camera.updateMatrixWorld();
      // The name pass depends only on the camera, the window and `labelVersion`: once none has changed for 400 ms (past the
      // 300 ms fade-outs, so every name has settled) it is skipped until one does.
      const { position: cp, quaternion: cq } = camera;
      const st = alt * 4e-6, sa = 1e-5; // steps of ~1% of a pixel, so the zoom's float-precision creep doesn't count as motion
      const sig = `${labelVersion}|${+houses.visible}|${Math.round(Math.log(alt) / 1e-5)}|${Math.round(cp.x / st)}|${Math.round(cp.y / st)}|${Math.round(cp.z / st)}|${Math.round(cq.x / sa)}|${Math.round(cq.y / sa)}|${Math.round(cq.z / sa)}|${Math.round(cq.w / sa)}|${innerWidth}|${innerHeight}`;
      if (sig !== labelSig) { labelSig = sig; labelSince = now; }
      else if (now - labelSince > 400) return;
      // a river or road is only laid out if its bounding ball is not past the horizon and is in the view: otherwise it has no stretch on screen anyway
      const horizon = Math.acos(Math.min(1, cosLimit)), mpp = view.nav.metresPerPixel();
      frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const lineSeen = (l: LineLabel) => Math.acos(Math.min(1, cam.dot(l.ctr))) - l.cap <= horizon && frustum.intersectsSphere(l.ball);
      const taken = createDeclutter(); // ponytail: each name is tested against every placed box, O(n²); a screen grid if names reach the thousands
      spreadWall();
      seatBox = [];
      const floor = alt < MIN_ALT * 1.1; // at the camera floor every place is named, even over a neighbour, and goes first: lettering on areas and lines makes way
      for (const p of floor ? [...order.filter((q) => !AREA_KINDS.has(q.kind)), ...order.filter((q) => AREA_KINDS.has(q.kind))] : order) {
        const seat = houses.visible && p.name === houses.seat; // houses mode names only the focused house's seat, at any height
        let on = showNames && !p.gone && (!houses.visible || seat) && !hiddenKinds.has(p.kind) && (seat || (alt < p.lod[0] && alt > (p.lod[2] ?? 0))) && cam.dot(p.up) > cosLimit;
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
          if (on && p !== pinned && lineSeen(p.line)) { // the focused river's or road's name is on its pin
            const tw = p.size[2] * p.scale * p.zs, th = p.size[3] * p.scale * p.zs;
            // the line is a few px wide this far out (metres of a typical river over metres per pixel); the name sits just above it
            const off = Math.max(1.3, LINE_WIDTH_M[p.kind] / view.nav.metresPerPixel()) / 2 + 2;
            for (const pts of lineStretches(p.line, tw, th, off, cosLimit, cam, Math.max(1, Math.floor((0.75 * mpp) / p.line.step)))) {
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
        if (on && (AREA_KINDS.has(p.kind) || p.onWall)) on = taken.claim(screenBox(p), floor && !AREA_KINDS.has(p.kind));
        else if (on) { // the first free spot; at the floor, if none is, right of the symbol on its place anyway
          let spot = SPOTS.findIndex((_, k) => taken.claim(screenBox(p, k)));
          if (spot < 0 && floor) { taken.claim(screenBox(p), true); spot = 0; }
          on = spot >= 0;
          if (seat) seatBox = on ? [screenBox(p, spot) as number[]] : []; // the sigils make way for it (houses.update), a frame later
          if (on && spot !== p.side) {
            const el = (p.obj as CSS2DObject).element, [was] = SPOTS[p.side], [side, dx, dy] = SPOTS[spot];
            if (was) el.classList.remove(was);
            if (side) el.classList.add(side);
            p.side = spot;
            shift(p, dx, dy);
          }
        }
        // fade rather than pop (style.css); the name leaves the page once its fade-out is done
        setShown(p.obj as CSS2DObject, on, now);
      }
    },
  };
  // ---------- region borders: click the region's name to select it ----------
  let bordersOn = true;
  const clearPlace = () => { regions.selected = null; setPin(null); terrain.highlight(null); showCard(null); };
  const deselect = () => { clearPlace(); houses.focus(null); };
  addEventListener('keydown', (e) => { if (e.key === 'Escape') deselect(); });
  view.setBordersVisible = (v: boolean) => { bordersOn = v; regions.object.visible = v; if (!v) regions.selected = null; };

  return Object.assign(view, { deselect, clearPlace });
}
