import * as THREE from 'three';
import { PLANET } from '../config';
import { LIFT, LIFT_GLSL, RIVER_GLSL } from './lift';

// The detail buffers: the Shadertoy "Advanced Terrain Erosion Filter" (Rune Skovbo Johansen, https://www.shadertoy.com/view/wXcfWn,
// blog.runevision.com/2026/03/fast-and-gorgeous-erosion-filter.html, MPL-2.0) run on the GPU round the camera's focus, at the
// resolution the camera can show, on top of the baked heights. Three nested windows, coarse to fine; each is rendered once when the
// camera's focus leaves its middle and read by the mesh, the vector layers and the land shader (lift.ts DETAIL_GLSL).
//   R  height delta over the baked height (km): the filter's gullies and offset, a fractal prior for rolling ground, the river channel
//   G  ridge map (0 on creases)      B  erosion offset (0 eroded .. 1 deposited, 0.5 none)      A  river water depth (km)
// All three levels run the same filter from the same 20 km scale; the finer ones add octaves, so where windows overlap they agree.
// Not committed to a baked texture: the baked relief gives the ~4 km shape and the buffers everything finer, near the camera.

const SIZE = 768;
const LEVELS = [
  // sized for a camera at 400 km and up (docs/decisions/0003), where a pixel is 150-450 m
  { km: 1200, octaves: 4, below: 5000e3 }, // 1.6 km texels: wavelengths 20 km down to 2.5 km
  { km: 400, octaves: 5, below: 2500e3 },  // 520 m: down to 1.25 km
  { km: 160, octaves: 6, below: 1200e3 },  // 208 m: down to 625 m
];
const KMDEG = 120.57;

// The filter and Phacelle noise, as in the Shadertoy (the parameters are ours, in km: heights in km, slopes in km per km).
const FILTER_GLSL = `
#define TAU 6.28318530717959
#define clamp01(x) clamp(x, 0.0, 1.0)
vec2 hash(in vec2 x) { const vec2 k = vec2(0.3183099, 0.3678794); x = x * k + k.yx; return -1.0 + 2.0 * fract(16.0 * k * fract(x.x * x.y * (x.x + x.y))); }
vec4 PhacelleNoise(in vec2 p, vec2 normDir, float freq, float offset, float normalization) {
  vec2 sideDir = normDir.yx * vec2(-1.0, 1.0) * freq * TAU;
  offset *= TAU;
  vec2 pInt = floor(p), pFrac = fract(p), phaseDir = vec2(0.0);
  float weightSum = 0.0;
  for (int i = -1; i <= 2; i++) for (int j = -1; j <= 2; j++) {
    vec2 gridOffset = vec2(i, j), gridPoint = pInt + gridOffset;
    vec2 v = pFrac - gridOffset - hash(gridPoint) * 0.5;
    float weight = max(0.0, exp(-dot(v, v) * 2.0) - 0.01111);
    weightSum += weight;
    float waveInput = dot(v, sideDir) + offset;
    phaseDir += vec2(cos(waveInput), sin(waveInput)) * weight;
  }
  vec2 interpolated = phaseDir / weightSum;
  float magnitude = max(1.0 - normalization, sqrt(dot(interpolated, interpolated)));
  return vec4(interpolated / magnitude, sideDir);
}
float pow_inv(float t, float power) { return 1.0 - pow(1.0 - clamp01(t), power); }
float ease_out(float t) { float v = 1.0 - clamp01(t); return 1.0 - v * v; }
float smooth_start(float t, float smoothing) { if (t >= smoothing) return t - 0.5 * smoothing; return 0.5 * t * t / smoothing; }
vec2 safe_normalize(vec2 n) { float l = length(n); return (abs(l) > 1e-10) ? (n / l) : n; }
vec4 ErosionFilter(in vec2 p, vec3 heightAndSlope, float fadeTarget, float strength, float gullyWeight, float detail, vec4 rounding, vec4 onset,
    vec2 assumedSlope, float scale, int octaves, float lacunarity, float gain, float cellScale, float normalization, out float ridgeMap, out float debug) {
  strength *= scale;
  fadeTarget = clamp(fadeTarget, -1.0, 1.0);
  vec3 inputHeightAndSlope = heightAndSlope;
  float freq = 1.0 / (scale * cellScale);
  float slopeLength = max(length(heightAndSlope.yz), 1e-10);
  float magnitude = 0.0, roundingMult = 1.0;
  float roundingForInput = mix(rounding.y, rounding.x, clamp01(fadeTarget + 0.5)) * rounding.z;
  float combiMask = ease_out(smooth_start(slopeLength * onset.x, roundingForInput * onset.x));
  float ridgeMapCombiMask = ease_out(slopeLength * onset.z);
  float ridgeMapFadeTarget = fadeTarget;
  vec2 gullySlope = mix(heightAndSlope.yz, heightAndSlope.yz / slopeLength * assumedSlope.x, assumedSlope.y);
  for (int i = 0; i < 12; i++) {
    if (i >= octaves) break;
    vec4 phacelle = PhacelleNoise(p * freq, safe_normalize(gullySlope), cellScale, 0.25, normalization);
    phacelle.zw *= -freq;
    float sloping = abs(phacelle.y);
    gullySlope += sign(phacelle.y) * phacelle.zw * strength * gullyWeight;
    vec3 gullies = vec3(phacelle.x, phacelle.y * phacelle.zw);
    vec3 fadedGullies = mix(vec3(fadeTarget, 0.0, 0.0), gullies * gullyWeight, combiMask);
    heightAndSlope += fadedGullies * strength;
    magnitude += strength;
    fadeTarget = fadedGullies.x;
    float roundingForOctave = mix(rounding.y, rounding.x, clamp01(phacelle.x + 0.5)) * roundingMult;
    float newMask = ease_out(smooth_start(sloping * onset.y, roundingForOctave * onset.y));
    combiMask = pow_inv(combiMask, detail) * newMask;
    ridgeMapFadeTarget = mix(ridgeMapFadeTarget, gullies.x, ridgeMapCombiMask);
    ridgeMapCombiMask = ridgeMapCombiMask * ease_out(sloping * onset.w);
    strength *= gain; freq *= lacunarity; roundingMult *= rounding.w;
  }
  ridgeMap = ridgeMapFadeTarget * (1.0 - ridgeMapCombiMask);
  debug = fadeTarget;
  return vec4(heightAndSlope - inputHeightAndSlope, magnitude);
}
// the Shadertoy's base terrain: fractal gradient noise, value in x and its derivative in yz
vec3 noised(in vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0), du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = hash(i), gb = hash(i + vec2(1.0, 0.0)), gc = hash(i + vec2(0.0, 1.0)), gd = hash(i + vec2(1.0, 1.0));
  float va = dot(ga, f), vb = dot(gb, f - vec2(1.0, 0.0)), vc = dot(gc, f - vec2(0.0, 1.0)), vd = dot(gd, f - vec2(1.0, 1.0));
  return vec3(va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd),
    ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * (va - vb - vc + vd) + vec2(vb, vc) - va));
}
vec3 fractalNoise(vec2 p, float freq, int octaves, float lac, float gain) {
  vec3 n = vec3(0.0); float nf = freq, na = 1.0;
  for (int i = 0; i < 4; i++) { if (i >= octaves) break; n += noised(p * nf) * na * vec3(1.0, nf, nf); na *= gain; nf *= lac; }
  return n;
}`;

const VERT_A = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG_A = `precision highp float;
${LIFT_GLSL}
${RIVER_GLSL}
${FILTER_GLSL}
uniform vec3 uWin;      // centre lon, centre lat (degrees), window km
uniform int uOctaves;
varying vec2 vUv;
const float UNIT = 40.0; // km: the fractal prior's unit
vec2 reliefUV(vec2 km) {
  float lat = uWin.y + km.y / KMDEG, lon = uWin.x + km.x / (KMDEG * cos(radians(uWin.y)));
  return vec2((lon - uBounds.x) / (uBounds.y - uBounds.x), (uBounds.w - lat) / (uBounds.w - uBounds.z));
}
vec3 dirAt(vec2 km) {
  float lat = radians(uWin.y + km.y / KMDEG), lon = radians(uWin.x + km.x / (KMDEG * cos(radians(uWin.y))));
  return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
}
float baseAt(vec2 km) { return baseHeight(reliefUV(km)); }
void main() {
  vec2 km = (vUv - 0.5) * uWin.z;
  vec2 ruv = reliefUV(km);
  vec3 dir = dirAt(km);
  float cover = textureLod(tH, ruv, 0.0).g, base = baseAt(km);
  if (cover < 0.5 || base < 0.002) { gl_FragColor = vec4(0.0, 1.0, 0.5, 0.0); return; } // sea and shore: nothing to add
  // the noise frame of the bake and of lift.ts: km east of 25 E (sinusoidal), north
  float lat = radians(uWin.y + km.y / KMDEG), lon = radians(uWin.x + km.x / (KMDEG * cos(radians(uWin.y))));
  vec2 q = vec2((lon - 0.436332) * cos(lat), lat) * ${(PLANET.radius / 1000).toFixed(1)};
  // slope of the baked ground over ~3.6 km, and the local mean: the 4.2 km bake must not set the gully direction, and its steps must not show
  const float e = 1.8;
  float hx = (baseAt(km + vec2(e, 0.0)) - baseAt(km - vec2(e, 0.0))) / (2.0 * e), hy = (baseAt(km + vec2(0.0, e)) - baseAt(km - vec2(0.0, e))) / (2.0 * e);
  float sl = length(vec2(hx, hy)), hb = 0.0;
  for (int k = 0; k < 8; k++) { float a = float(k) * 0.7853982; hb += baseAt(km + 3.0 * vec2(cos(a), sin(a))); }
  hb /= 8.0;
  // what the ground is: plains stay calm, hills roll, mountains carry their own relief and only get gullies
  float m = smoothstep(0.01, 0.2, sl);                                           // 0 plains .. 1 mountains
  float inland = smoothstep(0.004, 0.04, base);
  float roll = mix(0.03, 0.10, smoothstep(0.0, 0.06, sl)) * (1.0 - smoothstep(0.1, 0.3, sl)) * inland; // km of rolling ground
  vec3 fr = fractalNoise(q / UNIT, 3.0, 4, 2.0, 0.4) * roll * 1.6;               // value (km) and slope (per unit)
  float h0 = base + fr.x;
  vec2 grad = vec2(hx, hy) + fr.yz / UNIT;
  float fade = clamp((h0 - hb) / 0.04, -1.0, 1.0), ridge, dbg;
  float strength = mix(0.0004, 0.04, m * m) * inland, onset = mix(40.0, 8.0, m);
  vec4 d = ErosionFilter(q, vec3(h0, grad), fade, strength, 0.55, 1.5, vec4(0.1, 0.0, 0.1, 2.0), vec4(onset, onset, onset * 2.0, onset * 1.2),
    vec2(0.1, 1.0), 20.0, uOctaves, 2.0, 0.5, 0.7, 0.5, ridge, dbg);
  float h = h0 + d.x + mix(-0.3, -fade, 0.7) * d.w, occl = d.x / max(d.w, 1e-5), water = 0.0;
  // the river, cut as before (lift.ts RIVER_GLSL), but now into the buffer: water where the channel is under the river's surface
  float carve, flat_, deff, halfW, depth, creek; vec2 rg;
  riverAt(ruv, dir, base, cover, carve, flat_, deff, halfW, depth, rg, creek);
  h -= carve;
  if (carve > 0.0 && deff < halfW * 0.92) water = carve * 0.8;
  gl_FragColor = vec4(h - base, ridge * 0.5 + 0.5, clamp(occl * 0.5 + 0.5, 0.0, 1.0), water);
}`;

type Level = { rt: THREE.WebGLRenderTarget; cx: number; cy: number; on: boolean; dirty: boolean };

/** The detail buffers' manager. `enabled` false keeps them off entirely (?detail=0). */
export function createDetail(enabled: boolean, bakedUniforms: Record<string, { value: unknown }>) {
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT_A, fragmentShader: FRAG_A, depthTest: false, depthWrite: false,
    uniforms: { ...bakedUniforms, uWin: { value: new THREE.Vector3() }, uOctaves: { value: 5 } },
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const levels: Level[] = LEVELS.map(() => {
    const rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true });
    rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    return { rt, cx: 0, cy: 0, on: false, dirty: false };
  });
  LIFT.tD0.value = levels[0].rt.texture; LIFT.tD1.value = levels[1].rt.texture; LIFT.tD2.value = levels[2].rt.texture;
  LIFT.uDR.value.set(SIZE, SIZE);
  const focus = new THREE.Vector3(), dir = new THREE.Vector3(), p = new THREE.Vector3();
  let rendered = 0;

  /** Call each frame before rendering: re-centres and redraws at most one level that the camera's focus has left. */
  function update(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
    if (!enabled) return;
    const alt = camera.position.length() - PLANET.radius;
    // the focus: where the view ray meets the planet (the ground in front of a tilted camera), else the point below
    camera.getWorldDirection(dir);
    const o = camera.position, b = o.dot(dir), c = o.lengthSq() - PLANET.radius * PLANET.radius, disc = b * b - c;
    if (disc > 0 && -b - Math.sqrt(disc) > 0) focus.copy(o).addScaledVector(dir, -b - Math.sqrt(disc)); else focus.copy(o);
    p.copy(focus).normalize();
    const lon = THREE.MathUtils.radToDeg(Math.atan2(p.x, p.z)), lat = THREE.MathUtils.radToDeg(Math.asin(p.y));
    for (const [k, L] of LEVELS.entries()) {
      const lv = levels[k], texKm = L.km / SIZE, on = alt < L.below;
      if (on !== lv.on) { lv.on = on; lv.dirty = on; }
      if (!on) { LIFT.uDL.value[k].w = 0; continue; }
      // re-centre when the focus has drifted a fifth of the window off the middle; centres sit on the texel grid, so the detail does not swim
      const dx = (lon - lv.cx) * Math.cos(THREE.MathUtils.degToRad(lat)) * KMDEG, dy = (lat - lv.cy) * KMDEG;
      if (!lv.dirty && Math.max(Math.abs(dx), Math.abs(dy)) > 0.2 * L.km) lv.dirty = true;
      if (lv.dirty && rendered < 1) {
        const stepLat = texKm / KMDEG, stepLon = texKm / (KMDEG * Math.cos(THREE.MathUtils.degToRad(lat)));
        lv.cx = Math.round(lon / stepLon) * stepLon; lv.cy = Math.round(lat / stepLat) * stepLat;
        material.uniforms.uWin.value.set(lv.cx, lv.cy, L.km); material.uniforms.uOctaves.value = L.octaves;
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(lv.rt); renderer.render(scene, cam); renderer.setRenderTarget(prev);
        lv.dirty = false; rendered++;
        LIFT.uDL.value[k].set(lv.cx, lv.cy, L.km, 1);
      } else if (!lv.dirty) LIFT.uDL.value[k].w = 1;
    }
    rendered = 0;
  }
  return { update, levels };
}
