import * as THREE from 'three';
import B from './relief-bounds.json';
import { PLANET } from '../config';
import { DISPLACE, LIFT, LIFT_GLSL, NOISE_GLSL } from './lift';
import { createReliefMesh, MESH_VERT } from './reliefMesh';
import { RIVER_VERT, riverGeometry, syncPixel } from './rivers';
import type { Ring } from './viewLayer';
import { WALL_VERT, wallGeometry } from './wall';
import world from '../vector-world.json';

// Canon relief: the globe's land and water shaded from maps baked offline by tools/world/relief-bake.mjs (height guessed
// from the canon map and its geology, then eroded): slope, cast shadow and ambient occlusion for a fixed sun in the
// north-west, water flow, erosion/deposition, forest, moisture and snow masks, bare-rock colour, distance out to sea. The shader colours the ground by rules on
// those (the Terrain-Decorator idea: rock where steep and eroded, green along water and on deposits, snow high up) and
// lights it. The land itself is a 3D mesh raised by the baked height (reliefMesh.ts); the map layers ride on it (lift.ts).
// Until the maps load, and whenever relief is switched off, the globe shows the flat parchment map.

// Terrain classes in terrain.ts's drawing order; 'land' is the plains base under all the others.
export const CLASSES = ['land', 'desert', 'hills', 'mountains', 'forest', 'swamp', 'snow'];

const VERT = `#include <common>
#include <logdepthbuf_pars_vertex>
${LIFT_GLSL}
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  #ifdef LIFT
  gl_Position = projectionMatrix * modelViewMatrix * vec4(lift(position), 1.0);
  #else
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #endif
  #include <logdepthbuf_vertex>
}`;

const COMMON = `#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D tA, tB, tC, tD; // A: slope east, slope north, sun light, ambient occlusion. B: height, flow, erosion, sea distance.
                                  // C: forest, moisture, snow. D: bare-rock colour (geology), erodibility
uniform vec4 uBounds;           // lon0, lon1, lat0, lat1 (degrees) of the baked grid
uniform float uExaggeration, uGradMax, uHeightMax, uSeaMax;
uniform vec3 uSun;              // towards the sun, in east/north/up
varying vec3 vDir;
vec2 gridUV(vec3 d) {
  float lon = degrees(atan(d.x, d.z)), lat = degrees(asin(clamp(d.y, -1.0, 1.0)));
  return vec2((lon - uBounds.x) / (uBounds.y - uBounds.x), (uBounds.w - lat) / (uBounds.w - uBounds.z));
}
bool inGrid(vec2 uv) { return all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0))); }
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
${NOISE_GLSL}
uniform float uCloud;           // cloud opacity for the camera's height: 0 once below them
float detail(vec3 p);
// wisps of cloud ~60 km up, stretched east-west by a warped fbm: mostly clear sky
float clouds(vec3 d) {
  vec3 q = d * 6915.0 / 380.0;
  q += vec3(detail(q * 0.5), detail(q * 0.5 + 7.3), detail(q * 0.5 + 3.1)) * 1.6;
  return smoothstep(0.62, 0.86, detail(q * vec3(1.0, 2.6, 1.0)));
}
// the ground under a cloud's shadow, cast along the sun from 60 km up
float cloudShade(vec3 d) {
  if (uCloud < 0.01) return 1.0;
  vec3 east = normalize(vec3(d.z, 0.0, -d.x)), north = cross(d, east);
  return 1.0 - 0.4 * uCloud * clouds(normalize(d + (east * uSun.x + north * uSun.y) / uSun.z * 60.0 / 6915.0));
}
// fbm that fades each octave to its mean once it is finer than a pixel
float detail(vec3 p) {
  float w = length(fwidth(p)), s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * mix(vnoise(p), 0.5, smoothstep(0.3, 0.6, w)); p = p * 2.03 + 17.1; w *= 2.03; a *= 0.5; }
  return s / 0.97;
}
vec3 finish(vec3 c) { // the renderer's tone mapping, then output colour space
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  return gl_FragColor.rgb;
}
`;

const LAND_FRAG = `${COMMON}
#ifdef COVER
varying float vCover; // the 3D mesh's land cover: below half is sea
#endif
void main() {
  #ifdef COVER
  if (vCover < 0.5) discard;
  #endif
  #include <logdepthbuf_fragment>
  vec2 uv = gridUV(vDir);
  vec3 p = vDir * 6915.0; // km
  if (!inGrid(uv)) { finish(srgb(vec3(0.5, 0.56, 0.34)) * 0.9); return; }
  vec4 A = texture2D(tA, uv), Bm = texture2D(tB, uv), C = texture2D(tC, uv);
  vec2 e = A.rg * 2.0 - 1.0, g = sign(e) * e * e * uGradMax;   // true slope (km/km), east and north
  float slope = length(g), sun = A.b, ao = A.a;
  float h = Bm.r * uHeightMax, flow = Bm.g, ero = Bm.b * 2.0 - 1.0; // ero < 0 eroded, > 0 deposited
  #ifdef COVER
  { // the mesh's procedural detail (detailH), lit per pixel down to what a pixel can show
    float px = max(length(fwidth(p)), 0.03); // km per pixel
    vec3 east = normalize(vec3(vDir.z, 0.0, -vDir.x)), north = cross(vDir, east);
    float d0 = detailH(vDir, h, px);
    g += vec2(detailH(normalize(vDir + east * px / 6915.0), h, px) - d0, detailH(normalize(vDir + north * px / 6915.0), h, px) - d0) / px;
    slope = length(g);
  }
  #endif
  float forest = C.r, moist = C.g, snowClass = C.b;
  float lat = degrees(abs(asin(clamp(vDir.y, -1.0, 1.0))));
  float n1 = detail(p / 6.0), n2 = detail(p / 1.2), n3 = detail(p / 0.35); // breakup noise, ~6 km, ~1 km, ~350 m

  // ground colour by rules (sRGB picks, made linear), like a painted satellite map: deep greens in the north warming to
  // yellow-greens in the Reach, tan Dorne, pale rock on the ranges, grey-white ice beyond the Wall
  float south = 1.0 - smoothstep(32.0, 50.0, lat + (n1 - 0.5) * 4.0);
  vec3 lush = mix(srgb(vec3(0.2, 0.31, 0.13)), srgb(vec3(0.36, 0.43, 0.17)), south);
  vec3 dry = mix(srgb(vec3(0.4, 0.44, 0.25)), srgb(vec3(0.6, 0.56, 0.3)), south);
  vec3 c = mix(dry, lush, smoothstep(0.25, 0.7, moist + (n1 - 0.5) * 0.3)) * (0.82 + 0.22 * n2 + 0.14 * n3); // grain
  c = mix(c, lush * 0.85, smoothstep(0.25, 0.8, flow) * 0.5);                                  // lush along water
  c = mix(c, lush * vec3(0.72, 0.8, 0.7) * (0.7 + 0.3 * n2 + 0.4 * n3), smoothstep(0.3, 0.8, forest + (n1 - 0.5) * 0.5 + (n3 - 0.5) * 0.3) * 0.6);
  float desert = smoothstep(0.24, 0.06, moist + (n1 - 0.5) * 0.15);
  c = mix(c, srgb(vec3(0.76, 0.56, 0.34)) * (0.86 + 0.18 * n2 + 0.1 * n3), desert);
  c = mix(c, srgb(vec3(0.25, 0.33, 0.2)), smoothstep(0.85, 0.97, moist));                      // swamp
  vec3 rock = mix(srgb(texture2D(tD, uv).rgb * 0.85), srgb(vec3(0.68, 0.66, 0.62)), 0.55);    // the geology's rock, pale
  rock = mix(rock, srgb(vec3(0.72, 0.5, 0.32)), max(desert, south * 0.4)) * (0.8 + 0.25 * n2 + 0.15 * n3); // red-brown in the south
  c = mix(c, mix(c, rock, 0.5), smoothstep(0.7, 1.8, h + (n1 - 0.5) * 0.4) * 0.7);            // uplands go stony
  float bare = smoothstep(0.05, 0.16, slope + (n1 - 0.5) * 0.05) * (1.0 - smoothstep(0.2, 0.7, flow));
  bare = max(bare, smoothstep(-0.2, -0.6, ero) * smoothstep(0.8, 1.8, h) * 0.6);              // scoured high ground
  c = mix(c, rock, clamp(bare + smoothstep(1.8, 2.6, h) * 0.6, 0.0, 1.0));
  float snowLine = mix(3.2, 0.6, smoothstep(40.0, 68.0, lat));
  float snow = smoothstep(snowLine, snowLine + 0.3, h + (n1 - 0.5) * 0.5) * (1.0 - smoothstep(0.2, 0.45, slope));
  c = mix(c, srgb(vec3(0.86, 0.88, 0.9)) * (0.92 + 0.1 * n2), max(snow, smoothstep(0.3, 0.7, snowClass) * (0.85 + 0.15 * n2)));

  // light: hard hillshade from the north-west sun (baked cast shadow, cloud shadows) over a dim cool sky, so ridges catch
  // the light bright and their far sides drop into shadow
  vec3 n = normalize(vec3(-g * uExaggeration * 1.5, 1.0));
  float ndl = max(dot(n, uSun), 0.0);
  vec3 light = vec3(1.0, 0.95, 0.85) * 2.0 * ndl * sun * cloudShade(vDir) + vec3(0.6, 0.7, 0.85) * 0.3 * (0.6 + 0.4 * n.z) * ao + vec3(0.04);
  finish(c * light);
}`;

const WATER_FRAG = `${COMMON}
void main() {
  #include <logdepthbuf_fragment>
  vec2 uv = gridUV(vDir);
  float sd = texture2D(tB, uv).a, d = inGrid(uv) ? sd * sd * uSeaMax : uSeaMax; // km out to sea (stored as its square root)
  vec3 p = vDir * 6915.0;
  float dn = d + (detail(p / 40.0) - 0.5) * 40.0;
  // a teal glow over the shelf, deepening fast to dark navy, mottled like a satellite sea
  vec3 c = mix(srgb(vec3(0.14, 0.42, 0.45)), srgb(vec3(0.06, 0.2, 0.3)), smoothstep(0.0, 25.0, dn));
  c = mix(c, srgb(vec3(0.035, 0.08, 0.15)), smoothstep(35.0, 280.0, dn));
  c *= (0.82 + 0.28 * detail(p / 14.0)) * (0.92 + 0.12 * detail(p / 2.0));
  c = mix(c, srgb(vec3(0.5, 0.66, 0.62)), (1.0 - smoothstep(0.2, 1.5, d)) * 0.35);           // a hint of surf
  finish(c * 1.15 * cloudShade(vDir));
}`;

// The cloud layer: wisps over sea and land, gone as you come down through them (uCloud)
const CLOUD_FRAG = `${COMMON}
void main() {
  #include <logdepthbuf_fragment>
  float a = clouds(vDir) * uCloud;
  if (a < 0.01) discard;
  finish(srgb(vec3(0.93, 0.94, 0.95)) * (1.05 - 0.2 * clouds(vDir + vec3(0.002))));
  gl_FragColor.a = a * 0.85;
}`;

// Rivers (rivers.ts): deep blue down the middle, pale shallows at the banks, flow streaks once they are wide enough
const RIVER_FRAG = `${COMMON}
varying float vSide, vAlong, vPx;
void main() {
  #include <logdepthbuf_fragment>
  float a = abs(vSide), big = smoothstep(3.0, 12.0, vPx), depth = 1.0 - a * a;
  vec3 c = mix(srgb(vec3(0.3, 0.5, 0.5)), srgb(vec3(0.08, 0.27, 0.34)), smoothstep(0.0, 0.5, depth));
  c = mix(c, srgb(vec3(0.03, 0.13, 0.2)), smoothstep(0.5, 1.0, depth));                      // the deep channel
  c = mix(srgb(vec3(0.05, 0.19, 0.26)), c, big);                                             // thin: one dark teal line
  c *= mix(1.0, 0.85 + 0.3 * vnoise(vec3(vAlong * 1.2, vSide * 2.5, 0.0)), smoothstep(10.0, 30.0, vPx)); // flow streaks
  c += srgb(vec3(0.5, 0.55, 0.5)) * smoothstep(0.12, 0.0, abs(vSide + 0.35)) * big * 0.5;     // sun glint off the water
  c = mix(c, srgb(vec3(0.24, 0.27, 0.16)), smoothstep(0.86, 1.0, a) * big * 0.7);             // muddy banks
  finish(c * 1.1);
  gl_FragColor.a = 1.0 - smoothstep(1.0 - 2.0 / max(vPx, 1.0), 1.0, a); // a pixel of soft edge
}`;

// The Wall (wall.ts): pale blue-white ice, lit by the same sun, the crest dusted with snow
const WALL_FRAG = `${COMMON}
varying vec3 vN;
void main() {
  #include <logdepthbuf_fragment>
  vec3 east = normalize(vec3(vDir.z, 0.0, -vDir.x)), north = cross(vDir, east);
  vec3 n = vec3(dot(vN, east), dot(vN, north), dot(vN, vDir));
  vec3 c = mix(srgb(vec3(0.62, 0.74, 0.82)), srgb(vec3(0.9, 0.92, 0.94)), smoothstep(0.8, 0.95, n.z));
  finish(c * (vec3(1.0, 0.95, 0.85) * 1.6 * max(dot(n, uSun), 0.0) + vec3(0.6, 0.7, 0.85) * 0.45));
}`;

/** Swaps the terrain fills, lakes and ocean between the relief shaders and their flat materials, and shows the 3D relief
 * mesh (`object`) in place of the land fills. */
export function createRelief(fills: Record<string, THREE.Mesh>, strokes: THREE.Object3D[], ocean: THREE.Mesh, riverLines: THREE.Object3D) {
  let enabled = false;
  let swaps: { mesh: THREE.Mesh; flat: THREE.Material; relief: THREE.Material }[] = [];
  const object = new THREE.Group();
  let updateMesh: ((camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) => void) | null = null;
  const uCloud = { value: 0 };
  const apply = () => {
    const on = enabled && swaps.length > 0;
    for (const s of swaps) s.mesh.material = enabled ? s.relief : s.flat;
    for (const s of strokes) s.visible = !on; // the relief draws its own ranges
    for (const id of CLASSES) fills[id].visible = !(on && object.children.length); // the mesh draws the land
    riverLines.visible = !(on && object.children.length); // and its own rivers
    object.visible = on;
    LIFT.uDisplace.value = on && object.children.length ? DISPLACE : 0;
  };
  // data, not pictures: no premultiplied alpha, no colour management
  const loader = new THREE.ImageBitmapLoader().setOptions({ premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const load = (name: string) => loader.loadAsync(`${import.meta.env.BASE_URL}world/${name}.webp`).then((bitmap) => {
    const t = new THREE.Texture(bitmap);
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  });
  const ready = Promise.all(['relief-a', 'relief-b', 'relief-c', 'relief-d'].map(load)).then(([tA, tB, tC, tD]) => {
    LIFT.uBounds.value.set(B.lon0, B.lon1, B.lat0, B.lat1);
    LIFT.uHeightMax.value = B.heightMax;
    const uniforms = {
      ...LIFT, tA: { value: tA }, tB: { value: tB }, tC: { value: tC }, tD: { value: tD },
      uExaggeration: { value: B.exaggeration }, uGradMax: { value: B.gradMax }, uSeaMax: { value: B.seaMax },
      uSun: { value: new THREE.Vector3(...B.sun) }, uCloud,
    };
    swaps = [...CLASSES.map((id) => fills[id]), fills.lakes, ocean].map((mesh) => {
      const flat = mesh.material as THREE.Material;
      return {
        mesh, flat, relief: new THREE.ShaderMaterial({
          uniforms, vertexShader: VERT, fragmentShader: mesh === fills.lakes || mesh === ocean ? WATER_FRAG : LAND_FRAG,
          defines: mesh === ocean ? {} : { LIFT: '' }, // the map layers ride on the 3D relief, the sea stays put
          side: flat.side, depthWrite: flat.depthWrite, // as the flat one: the ocean sphere writes depth, the map fills don't
        }),
      };
    });
    apply();
    const material = new THREE.ShaderMaterial({ uniforms: { ...uniforms }, vertexShader: MESH_VERT, fragmentShader: LAND_FRAG, defines: { COVER: '' } });
    return createReliefMesh(`${import.meta.env.BASE_URL}world/relief-h.webp`, PLANET.radius - 7, B, material).then(({ mesh, texture, heightAt, update }) => {
      LIFT.tH.value = texture;
      updateMesh = update;
      const uPixel = { value: 0 };
      const rivers = new THREE.Mesh(riverGeometry(world.rivers as Ring[], PLANET.radius - 7, heightAt), new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uPixel }, vertexShader: RIVER_VERT, fragmentShader: RIVER_FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      rivers.renderOrder = riverLines.renderOrder; rivers.frustumCulled = false;
      rivers.onBeforeRender = syncPixel(uPixel);
      const wall = new THREE.Mesh(wallGeometry(PLANET.radius - 7), new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uPixel }, vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, side: THREE.DoubleSide,
      }));
      wall.frustumCulled = false;
      wall.onBeforeRender = syncPixel(uPixel);
      const clouds = new THREE.Mesh(new THREE.SphereGeometry(PLANET.radius + 60e3, 256, 128), new THREE.ShaderMaterial({
        uniforms, vertexShader: VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
      }));
      clouds.renderOrder = 200; // over the map layers and borders
      object.add(mesh, rivers, wall, clouds);
      apply();
    });
  }).catch((e) => console.warn('relief: staying on the flat map,', e));
  return {
    object, ready, setEnabled(on: boolean) { enabled = on; apply(); },
    /** Picks the mesh's detail for the camera; call before each render. */
    update(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
      if (!enabled) return;
      updateMesh?.(camera, renderer);
      uCloud.value = THREE.MathUtils.smoothstep(camera.position.length() - PLANET.radius, 600e3, 3000e3); // clear below them
    },
  };
}
