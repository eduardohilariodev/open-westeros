// PROTOTYPE, throwaway (see index.html). Two passes, as in the Shadertoy: pass A evaluates the erosion filter per texel on top of our baked
// heights into a float buffer (height, ridge map, erosion occlusion, water depth); pass B raymarches that buffer.
// The Phacelle noise and the ErosionFilter are Rune Skovbo Johansen's (MPL-2.0), https://www.shadertoy.com/view/wXcfWn.
import { FS_D } from './shadertoy-look.js';
const q = new URLSearchParams(location.search), num = (k, d) => (q.has(k) ? +q.get(k) : d);
const VARIANTS = { A: 'the Shadertoy way: filter + drainage lines, no river objects', B: 'rivers from filter creases x baked flow, water by height', C: 'canon corridor field (relief-e), water by height: the globe now', D: 'the Shadertoy render (water plane lakes, trees, atmosphere) on our heights' };
const KEYS = Object.keys(VARIANTS);
let variant = KEYS.includes(q.get('variant')) ? q.get('variant') : 'A';
const P = {
  lat: num('lat', 40.24), lon: num('lon', -13.57), km: num('km', 24), vex: num('vex', 6), S: num('S', 0), str: num('str', 0.012), onset: num('onset', 30), roll: num('roll', 0), lake: num('lake', 0.15), distD: num('dist', 3.0),
  res: num('res', 1024), yaw: num('az', 0.6), pitch: num('el', 0.45), dist: num('dist', 1.25), dmax: 40,
};
P.S ||= P.km / 7;

const canvas = document.getElementById('c'), info = document.getElementById('info'), label = document.getElementById('label');
const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
if (!gl || !gl.getExtension('EXT_color_buffer_float')) { info.textContent = 'needs WebGL2 with EXT_color_buffer_float'; throw new Error('no float render targets'); }
gl.getExtension('OES_texture_float_linear');

const VS = `#version 300 es
out vec2 vUv;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

// ---------- pass A: height + erosion filter ----------
const FILTER = `
#define TAU 6.28318530717959
#define clamp01(x) clamp(x, 0.0, 1.0)
vec2 hash(in vec2 x) {
  const vec2 k = vec2(0.3183099, 0.3678794);
  x = x * k + k.yx;
  return -1.0 + 2.0 * fract(16.0 * k * fract(x.x * x.y * (x.x + x.y)));
}
vec4 PhacelleNoise(in vec2 p, vec2 normDir, float freq, float offset, float normalization) {
  vec2 sideDir = normDir.yx * vec2(-1.0, 1.0) * freq * TAU;
  offset *= TAU;
  vec2 pInt = floor(p), pFrac = fract(p), phaseDir = vec2(0.0);
  float weightSum = 0.0;
  for (int i = -1; i <= 2; i++) for (int j = -1; j <= 2; j++) {
    vec2 gridOffset = vec2(i, j), gridPoint = pInt + gridOffset;
    vec2 randomOffset = hash(gridPoint) * 0.5;
    vec2 v = pFrac - gridOffset - randomOffset;
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
  for (int i = 0; i < octaves; i++) {
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
}`;

const FS_A = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uH, uB, uE;
uniform vec4 uBounds;      // lon0 lon1 lat0 lat1
uniform vec3 uCenter;      // lat lon windowKm
uniform float uHeightMax, uDistMax, uS, uStr, uOnset;
uniform int uVariant;      // 0 A, 1 B, 2 C
in vec2 vUv; out vec4 o;
const float KMDEG = 120.57;
${FILTER}
vec2 toRelief(vec2 km) {
  float lat = uCenter.x + km.y / KMDEG, lon = uCenter.y + km.x / (KMDEG * cos(radians(uCenter.x)));
  return vec2((lon - uBounds.x) / (uBounds.y - uBounds.x), (uBounds.w - lat) / (uBounds.w - uBounds.z));
}
// cubic B-spline through four bilinear fetches
vec4 cubic(sampler2D t, vec2 uv) {
  vec2 sz = vec2(textureSize(t, 0)), c = uv * sz, i = floor(c - 0.5), f = c - 0.5 - i;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0, w1 = (3.0 * f * f * f - 6.0 * f * f + 4.0) / 6.0;
  vec2 w2 = (-3.0 * f * f * f + 3.0 * f * f + 3.0 * f + 1.0) / 6.0, w3 = f * f * f / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3, h0 = (i - 0.5 + w1 / g0) / sz, h1 = (i + 1.5 + w3 / g1) / sz;
  return g0.y * (g0.x * texture(t, vec2(h0.x, h0.y)) + g1.x * texture(t, vec2(h1.x, h0.y)))
       + g1.y * (g0.x * texture(t, vec2(h0.x, h1.y)) + g1.x * texture(t, vec2(h1.x, h1.y)));
}
uniform float uSlopeE; uniform float uRoll;       // km of rolling hills added to the base (prototype of the bake's lowland swells, at the scale the filter needs)
vec2 h2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return -1.0 + 2.0 * fract(sin(p) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(h2(i), f), dot(h2(i + vec2(1, 0)), f - vec2(1, 0)), u.x), mix(dot(h2(i + vec2(0, 1)), f - vec2(0, 1)), dot(h2(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y); }
// the Shadertoy's base: fractal gradient noise (Inigo Quilez), value in x, derivative in yz; freq in cycles per window
vec3 noised(in vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0), du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = hash(i), gb = hash(i + vec2(1.0, 0.0)), gc = hash(i + vec2(0.0, 1.0)), gd = hash(i + vec2(1.0, 1.0));
  float va = dot(ga, f), vb = dot(gb, f - vec2(1.0, 0.0)), vc = dot(gc, f - vec2(0.0, 1.0)), vd = dot(gd, f - vec2(1.0, 1.0));
  return vec3(va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd),
    ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * (va - vb - vc + vd) + vec2(vb, vc) - va));
}
uniform int uZ; // always 0: a loop bound that is not a compile-time constant keeps ANGLE from unrolling the octaves (14 inlined copies made the shader compile for minutes)
vec3 fractalNoise(vec2 p, float freq, int octaves, float lac, float gain) {
  vec3 n = vec3(0.0); float nf = freq, na = 1.0;
  for (int i = 0; i < octaves + uZ; i++) { n += noised(p * nf) * na * vec3(1.0, nf, nf); na *= gain; nf *= lac; }
  return n;
}
uniform int uSynth;   // 1: the synthetic testbed tile instead of the baked heights
float synthH(vec2 km) { // west: alpine belt, then foothills, rolling plains, a coast in the east (x, y in -0.5..0.5 of the window)
  vec2 p = km / uCenter.z; float x = p.x;
  float m = smoothstep(0.08, -0.40, x), fh = smoothstep(0.30, -0.18, x), pl = smoothstep(0.45, -0.3, x);
  vec3 n = fractalNoise(p + 7.3, 4.0, 6, 2.0, 0.5); float rid = max(1.0 - abs(n.x * 2.4), 0.0);
  float h = 0.02 + 0.22 * fh * (0.55 + n.x) + 0.2 * pl * fractalNoise(p * 0.9 + 3.1, 3.0, 5, 2.0, 0.45).x;
  h += m * (1.6 + 3.0 * pow(rid, 1.5) + 1.2 * n.x);
  return h - 0.08 * smoothstep(0.30, 0.5, x);
}
float decodeD(vec4 t) { return ((t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0 * 2.0 - 1.0) * uDistMax; }
float roll(vec2 km) { return uRoll * fractalNoise(km / uCenter.z + 0.37, 3.0, 7, 2.0, 0.45).x * 1.6; }
float baseH(vec2 km) { if (uSynth == 1) return synthH(km); vec4 t = cubic(uH, toRelief(km)); return (t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0 * uHeightMax + roll(km); }
void main() {
  vec2 km = (vUv - 0.5) * uCenter.z;
  float h0 = baseH(km), e = uSlopeE; // a slope over ~3.6 km: the 4.2 km bake grid must not set the gully direction
  float hx = (baseH(km + vec2(e, 0.0)) - baseH(km - vec2(e, 0.0))) / (2.0 * e);
  float hy = (baseH(km + vec2(0.0, e)) - baseH(km - vec2(0.0, e))) / (2.0 * e);
  float hb = 0.0;
  for (int k = 0; k < 4; k++) { float a = float(k) * 1.5707963 + 0.4; hb += baseH(km + 3.0 * vec2(cos(a), sin(a))); }
  hb /= 4.0;
  float fade = clamp((h0 - hb) / 0.04, -1.0, 1.0), ridge, dbg;
  float mt = uSynth == 1 ? smoothstep(0.5, 1.8, h0) : 1.0, strg = mix(uStr * 0.35, uStr, mt), ons = mix(uOnset * 2.2, uOnset, mt); // soft in the lowlands, sharp in the mountains
  vec4 d = ErosionFilter(km + vec2(9.37, 5.11), vec3(h0, hx, hy), fade, strg, 0.55, 1.5, vec4(0.1, 0.0, 0.1, 2.0),
    vec4(ons, ons, ons * 2.0, ons * 1.2), vec2(0.1, 1.0), uS, 5, 2.0, 0.5, 0.7, 0.5, ridge, dbg);
  float h = h0 + d.x + mix(-0.3, -fade, 0.7) * d.w, occl = d.x / max(d.w, 1e-5), water = 0.0, ridge01 = ridge * 0.5 + 0.5;
  vec2 ruv = toRelief(km);
  if (uVariant == 1) { // B: the filter's creases where the baked flow is large
    float flowN = texture(uB, ruv).g;
    float dw = mix(0.12, 0.5, flowN), drain = clamp((1.0 - clamp(ridge01 / dw, 0.0, 1.0)) * 1.5, 0.0, 1.0);
    float chan = smoothstep(0.30, 0.62, flowN) * drain, depth = chan * (0.003 + 0.02 * flowN);
    h -= depth; if (chan > 0.35) water = depth * 0.8;
  } else if (uVariant == 2) { // C: the corridor field of relief-e, the way the globe draws it
    vec2 sz = vec2(textureSize(uE, 0)), pos = ruv * sz - 0.5, i0 = floor(pos), f = pos - i0;
    float dsum = 0.0, dabs = 0.0, minAbs = 1e9, qn = 0.0, best = -1.0; bool hasPos = false, hasNeg = false;
    for (int cy = 0; cy < 2; cy++) for (int cx = 0; cx < 2; cx++) {
      vec4 t = texelFetch(uE, ivec2(i0) + ivec2(cx, cy), 0);
      float v = decodeD(t), w = (cx == 0 ? 1.0 - f.x : f.x) * (cy == 0 ? 1.0 - f.y : f.y);
      dsum += v * w; dabs += abs(v) * w; minAbs = min(minAbs, abs(v));
      if (v > 0.0) hasPos = true; else hasNeg = true;
      if (w > best) { best = w; qn = t.b; }
    }
    float dist = (hasPos && hasNeg && minAbs > 3.2) ? dabs : dsum;
    float wid = mix(0.12, 1.6, pow(qn, 1.8)), half_ = wid * 0.5;
    dist += 0.6 * wid * sin(km.x * 2.3 + 1.7 * sin(km.y * 1.9)) ;
    float prof = clamp(1.0 - pow(abs(dist) / half_, 2.0), 0.0, 1.0), depth = (0.003 + 0.017 * pow(qn, 1.8)) * prof;
    h -= depth; if (abs(dist) < half_ * 0.9) water = depth * 0.8;
  }
  o = vec4(h, ridge01, occl * 0.5 + 0.5, water);
}`;

// ---------- pass B: raymarch (after the Shadertoy's image buffer) ----------
const FS_B = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uBuf;
uniform vec2 uRes;
uniform float uKm, uVex, uHmin, uBufRes;
uniform vec3 uCam;          // yaw pitch dist
uniform int uVariant;
in vec2 vUv; out vec4 o;
const vec3 CLIFF = vec3(0.22, 0.20, 0.20), DIRT = vec3(0.60, 0.50, 0.40), GRASS1 = vec3(0.15, 0.30, 0.10), GRASS2 = vec3(0.40, 0.50, 0.20), TREE = vec3(0.12, 0.26, 0.10);
const vec3 SUN = normalize(vec3(-0.6, 0.5, -0.55)), SUN_COLOR = vec3(1.0, 0.98, 0.95) * 2.0;
vec4 buf(vec2 xz) { return texture(uBuf, clamp(vec2(xz.x + 0.5, 0.5 - xz.y), 0.002, 0.998)); }
float H(vec2 xz) { vec4 b = buf(xz); float w = step(0.0002, b.a); return ((b.r + b.a * w) - uHmin) * uVex / uKm + 0.03; }
float G(vec2 xz) { vec4 b = buf(xz); return (b.r - uHmin) * uVex / uKm + 0.03; }
vec2 hash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return -1.0 + 2.0 * fract(sin(p) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(hash2(i), f), dot(hash2(i + vec2(1, 0)), f - vec2(1, 0)), u.x), mix(dot(hash2(i + vec2(0, 1)), f - vec2(0, 1)), dot(hash2(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y); }
vec2 box(vec3 ro, vec3 rd) { vec3 m = 1.0 / rd, n = m * ro, k = abs(m) * vec3(0.5, 1.0, 0.5), t1 = -n - k + vec3(0.0, 1.0, 0.0) * 0.0, t2 = -n + k;
  // the box spans y 0..1: shift the centre to 0.5
  vec3 ro2 = ro - vec3(0.0, 0.5, 0.0); n = m * ro2; k = abs(m) * vec3(0.5, 0.5, 0.5); t1 = -n - k; t2 = -n + k;
  float tN = max(max(t1.x, t1.y), t1.z), tF = min(min(t2.x, t2.y), t2.z); return (tN > tF || tF < 0.0) ? vec2(-1.0) : vec2(tN, tF); }
float march(vec3 ro, vec3 rd, out float tHit) {
  vec2 bx = box(ro, rd); if (bx.y < 0.0) { tHit = -1.0; return -1.0; }
  float t = max(0.0, bx.x) + 1e-4, tp = t;
  for (int i = 0; i < 320; i++) {
    vec3 p = ro + rd * t; float alt = p.y - H(p.xz);
    if (alt < 0.0) { float a = tp, b = t; for (int k = 0; k < 10; k++) { float m = 0.5 * (a + b); vec3 pm = ro + rd * m; if (pm.y - H(pm.xz) < 0.0) b = m; else a = m; } tHit = b; return 1.0; }
    tp = t; t += max(alt * 0.4, 0.0004);
    if (t > bx.y) break;
  }
  tHit = -1.0; return -1.0;
}
float shadow(vec3 p) { float t = 0.004; for (int i = 0; i < 64; i++) { vec3 q = p + SUN * t; if (q.y > 1.0) return 1.0; float a = q.y - H(q.xz); if (a < 0.0) return 0.0; t += max(a * 0.5, 0.003); } return 1.0; }
vec3 aces(vec3 x) { return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); }
void main() {
  vec2 uv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float yaw = uCam.x, pitch = uCam.y;
  vec3 target = vec3(0.0, 0.10, 0.0), ro = target + uCam.z * vec3(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw));
  vec3 fw = normalize(target - ro), rt = normalize(cross(fw, vec3(0, 1, 0))), up = cross(rt, fw);
  vec3 rd = normalize(fw + (uv.x * rt + uv.y * up) * 0.7);
  vec3 sky = mix(vec3(0.55, 0.68, 0.85), vec3(0.25, 0.42, 0.72), clamp(rd.y * 1.6, 0.0, 1.0));
  float t; vec3 col = sky;
  if (march(ro, rd, t) > 0.0) {
    vec3 p = ro + rd * t; vec2 xz = p.xz; vec4 b = buf(xz); float e = 1.5 / uBufRes;
    vec3 n = normalize(vec3(H(xz - vec2(e, 0)) - H(xz + vec2(e, 0)), 2.0 * e, H(xz - vec2(0, e)) - H(xz + vec2(0, e))));
    float hkm = b.r, occ = clamp(b.b * 2.0 - 1.0 + 0.5, 0.0, 1.0), ridge01 = b.g;
    float breakup = vnoise(xz * 900.0) * 0.5 + vnoise(xz * 250.0) * 0.5;
    vec3 albedo; float spec = 0.0, rough = 1.0;
    if (b.a > 0.0002) { // water: depth from the buffer, shore tint and foam near the edge
      float depth = b.a, shore = exp(-depth * 260.0);
      albedo = mix(vec3(0.0, 0.07, 0.12), vec3(0.04, 0.28, 0.27), shore);
      albedo = mix(albedo, vec3(0.9), smoothstep(0.0012, 0.0, depth + breakup * 0.0006) * 0.7);
      n = normalize(n + vec3(breakup * 0.05, 0.0, breakup * 0.05)); spec = 1.0; rough = 0.05;
    } else {
      albedo = mix(CLIFF * 1.6, DIRT, smoothstep(0.7, 0.1, occ + breakup * 0.4));
      float flat_ = smoothstep(0.72, 0.95, n.y);
      vec3 grass = mix(GRASS1, GRASS2, clamp(0.35 + occ * 0.6 + breakup * 0.3, 0.0, 1.0));
      albedo = mix(albedo, grass, flat_ * smoothstep(2.2, 1.4, hkm));
      float tree = step(0.35, vnoise(xz * 1600.0)) * flat_ * smoothstep(0.55, 0.3, occ) * smoothstep(1.6, 0.8, hkm);
      albedo = mix(albedo, TREE, tree * 0.55);
      albedo = mix(albedo, vec3(1.0), smoothstep(2.4, 3.0, hkm + breakup * 0.2));
      if (uVariant == 0) { float drain = clamp((1.0 - clamp(ridge01 / 0.22, 0.0, 1.0)) * 1.5, 0.0, 1.0); albedo = mix(albedo, vec3(0.9, 0.95, 1.0), drain * 0.85); }
    }
    float sh = shadow(p + n * 0.0008), nl = max(dot(n, SUN), 0.0);
    vec3 amb = albedo * mix(vec3(0.18, 0.2, 0.26), vec3(0.34, 0.4, 0.5), n.y) * (0.55 + 0.45 * occ);
    vec3 h = normalize(SUN - rd);
    col = amb + albedo * SUN_COLOR * nl * sh * 0.55 + (spec > 0.0 ? SUN_COLOR * pow(max(dot(n, h), 0.0), 120.0) * sh * 0.8 + sky * 0.25 : vec3(0.0));
    col = mix(col, sky, 1.0 - exp(-t * 0.05));
  }
  o = vec4(pow(aces(col), vec3(1.0 / 2.2)), 1.0);
}`;

// ---------- plumbing ----------
function program(fs) {
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const m = gl.getShaderInfoLog(s); info.textContent = m; throw new Error(m); } return s; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { info.textContent = gl.getProgramInfoLog(p); throw new Error(gl.getProgramInfoLog(p)); }
  return p;
}
async function loadTexture(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  return t;
}
const progA = program(FS_A), progB = program(FS_B), progD = program(FS_D), u = (p, n) => gl.getUniformLocation(p, n);
const bounds = await (await fetch('/src/globe/relief-bounds.json')).json();
const [tH, tB, tE, tV, tC] = await Promise.all(['relief-h', 'relief-b', 'relief-e', 'relief-v', 'relief-c'].map((n) => loadTexture(`/world/${n}.webp`)));

const R = P.res, bufTex = gl.createTexture(), fbo = gl.createFramebuffer();
gl.bindTexture(gl.TEXTURE_2D, bufTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, R, R, 0, gl.RGBA, gl.FLOAT, null);
for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bufTex, 0);
const vao = gl.createVertexArray(); gl.bindVertexArray(vao);

let hmin = 0, hmax = 1, water = 0.45, tA = 0, hqLakeV = 0;
const hqLake = () => hqLakeV;
function renderBuffer() {
  const t0 = performance.now();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, R, R); gl.useProgram(progA);
  [['uH', tH], ['uB', tB], ['uE', tE]].forEach(([n, t], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u(progA, n), i); });
  gl.uniform4f(u(progA, 'uBounds'), bounds.lon0, bounds.lon1, bounds.lat0, bounds.lat1);
  gl.uniform3f(u(progA, 'uCenter'), P.lat, P.lon, P.km);
  gl.uniform1f(u(progA, 'uHeightMax'), bounds.heightMax); gl.uniform1f(u(progA, 'uDistMax'), bounds.riverDistMax ?? 40);
  gl.uniform1f(u(progA, 'uS'), P.S); gl.uniform1f(u(progA, 'uStr'), P.str); gl.uniform1f(u(progA, 'uOnset'), P.onset); gl.uniform1i(u(progA, 'uSynth'), P.synth ? 1 : 0); gl.uniform1f(u(progA, 'uRoll'), P.roll); gl.uniform1f(u(progA, 'uSlopeE'), num('e', 6));
  gl.uniform1i(u(progA, 'uVariant'), variant === 'D' ? 2 : KEYS.indexOf(variant)); // D carries the baked river field too
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Float32Array(R * R * 4); gl.readPixels(0, 0, R, R, gl.RGBA, gl.FLOAT, px); // the window's lowest ground, to anchor the box
  const hs = []; for (let i = 0; i < px.length; i += 4 * 7) hs.push(px[i]); hs.sort((a, b) => a - b);
  hmin = hs[0]; hmax = hs[hs.length - 1]; hqLakeV = hs[Math.floor(hs.length * P.lake)]; // lake level: a height quantile of the window
  tA = performance.now() - t0;
}
function renderImage(tile) { // tile = [x, y, w, h] in canvas pixels (contact sheet), else the whole window
  const rel = Math.min(0.29, ((hmax - hmin) * P.vex) / P.km); water = 0.37 + (rel * (hqLake() - hmin)) / Math.max(hmax - hmin, 1e-4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let w, h, vx = 0, vy = 0;
  if (tile) { [vx, vy, w, h] = tile; } else { w = canvas.width = Math.round(innerWidth * Math.min(devicePixelRatio, 1.5)); h = canvas.height = Math.round(innerHeight * Math.min(devicePixelRatio, 1.5)); }
  gl.viewport(vx, vy, w, h);
  if (variant === 'D') {
    gl.useProgram(progD); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bufTex); gl.uniform1i(u(progD, 'uBuf'), 0);
    gl.uniform2f(u(progD, 'uRes'), w, h); gl.uniform1f(u(progD, 'uHmin'), hmin); gl.uniform1f(u(progD, 'uHmax'), hmax); gl.uniform1f(u(progD, 'uBufRes'), R);
    [['uV', tV], ['uC', tC]].forEach(([n, t], i) => { gl.activeTexture(gl.TEXTURE1 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u(progD, n), 1 + i); });
    gl.uniform4f(u(progD, 'uBounds'), bounds.lon0, bounds.lon1, bounds.lat0, bounds.lat1); gl.uniform3f(u(progD, 'uCenter'), P.lat, P.lon, P.km);
    gl.uniform1f(u(progD, 'uBiome'), q.get('biome') === '0' || P.synth ? 0 : 1); // ?biome=0: the Shadertoy's fixed greens; the synthetic testbed has no biome
    gl.uniform1f(u(progD, 'uSat'), num('sat', 2.2)); // biome colour saturation: 1 = the bake's, higher pulls the biomes apart
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(u(progD, 'uWater'), water); gl.uniform1f(u(progD, 'uRel'), rel); gl.uniform3f(u(progD, 'uCam'), P.yaw, P.pitch, P.distD);
    const t1 = performance.now(); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.finish(); return performance.now() - t1;
  }
  gl.useProgram(progB);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bufTex); gl.uniform1i(u(progB, 'uBuf'), 0);
  gl.uniform2f(u(progB, 'uRes'), w, h); gl.uniform1f(u(progB, 'uKm'), P.km); gl.uniform1f(u(progB, 'uVex'), P.vex); gl.uniform1f(u(progB, 'uHmin'), hmin); gl.uniform1f(u(progB, 'uBufRes'), R);
  gl.uniform3f(u(progB, 'uCam'), P.yaw, P.pitch, P.dist); gl.uniform1i(u(progB, 'uVariant'), KEYS.indexOf(variant));
  const t0 = performance.now(); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.finish(); return performance.now() - t0;
}
// ---------- the sample of the world: one preset per height / terrain class (lat lon from `npm run lore -- search`) ----------
// km = window width, vex = vertical exaggeration, str/onset = erosion filter, roll = rolling hills the bake lacks, lake = height quantile
// flooded in the Shadertoy look (0 = none; canon lakes are not baked as water yet), distD = camera distance, el = camera elevation
const PRESETS = {
  'testbed':        { note: 'synthetic tile: alpine belt, foothills, plains, coast, lake, river with tributaries', synth: true, lat: 40, lon: -8, km: 60, vex: 3, str: 0.035, onset: 9, S: 4, lake: 0.12, el: 0.42 },
  'giants-lance':   { note: 'alpine, 5.6 km above the Vale floor (AGOT: 3.5 mi)', lat: 42.34, lon: -6.18, km: 60, vex: 2.2, str: 0.04, onset: 8, lake: 0, el: 0.45 },
  'vale-moon':      { note: 'Mountains of the Moon over the Vale, lake in the valley', lat: 42.0, lon: -6.6, km: 45, vex: 2.5, str: 0.04, onset: 8, lake: 0.12, el: 0.5 },
  'bone-mountains': { note: 'the tallest range (WOIAF), ~8 km', lat: 33.64, lon: 57.67, km: 120, vex: 1.6, str: 0.035, onset: 6, lake: 0, el: 0.4 },
  'frostfangs':     { note: 'Himalaya analogue, far north', lat: 66.57, lon: -22.49, km: 90, vex: 1.8, str: 0.035, onset: 7, lake: 0, el: 0.42 },
  'north-mtns':     { note: 'Northern Mountains, 3-4 km', lat: 58.53, lon: -14.4, km: 70, vex: 2.4, str: 0.035, onset: 8, lake: 0.05, el: 0.45 },
  'red-mountains':  { note: 'dry Dornish range', lat: 27.42, lon: -11.99, km: 60, vex: 2.4, str: 0.03, onset: 9, lake: 0, el: 0.45 },
  'mother-mtns':    { note: 'Mother of Mountains, Essos', lat: 39.01, lon: 54.22, km: 90, vex: 2.0, str: 0.035, onset: 7, lake: 0, el: 0.42 },
  'riverrun':       { note: 'riverlands: rolling plains and canon rivers', lat: 40.24, lon: -13.57, km: 28, vex: 5, str: 0.03, onset: 14, roll: 0.12, lake: 0, el: 0.42 },
  'gods-eye':       { note: "God's Eye lake and the Trident", lat: 38.79, lon: -10.65, km: 55, vex: 5, str: 0.03, onset: 14, roll: 0.1, lake: 0.1, el: 0.42 },
  'reach':          { note: 'Highgarden: the Reach, flat farmland', lat: 29.8, lon: -16.51, km: 40, vex: 6, str: 0.02, onset: 18, roll: 0.07, lake: 0, el: 0.4 },
  'neck':           { note: 'the Neck: low swamp, many streams', lat: 45.85, lon: -14.08, km: 40, vex: 7, str: 0.02, onset: 20, roll: 0.05, lake: 0.2, el: 0.4 },
  'north-plain':    { note: 'Winterfell: cold rolling plain', lat: 54.75, lon: -13.32, km: 45, vex: 5, str: 0.03, onset: 14, roll: 0.1, lake: 0, el: 0.42 },
  'barrowlands':    { note: 'Barrowlands and Sheepshead hills', lat: 51.47, lon: -13.26, km: 50, vex: 5, str: 0.03, onset: 12, roll: 0.12, lake: 0, el: 0.42 },
  'dorne-coast':    { note: 'Sunspear: arid coast, sea', lat: 23.89, lon: -2.35, km: 60, vex: 5, str: 0.02, onset: 18, roll: 0.06, lake: 0.18, el: 0.4 },
  'storms-end':     { note: "Storm's End: stormlands and the Narrow Sea", lat: 31.16, lon: -3.96, km: 55, vex: 5, str: 0.03, onset: 14, roll: 0.1, lake: 0.15, el: 0.4 },
  'iron-isles':     { note: 'Pyke: sea cliffs and islands', lat: 41.66, lon: -20.58, km: 45, vex: 4, str: 0.03, onset: 12, roll: 0.1, lake: 0.35, el: 0.4 },
  'dothraki-sea':   { note: 'grass sea, Essos: almost flat', lat: 33.64, lon: 46.53, km: 80, vex: 8, str: 0.015, onset: 20, roll: 0.04, lake: 0, el: 0.38 },
  'painted-mtns':   { note: 'Painted Mountains, Essos', lat: 28.49, lon: 27.07, km: 80, vex: 2.4, str: 0.035, onset: 8, lake: 0, el: 0.42 },
  'wall-north':     { note: "Castle Black and the Gift: the Wall's ground", lat: 62.13, lon: -8.87, km: 40, vex: 5, str: 0.03, onset: 12, roll: 0.1, lake: 0, el: 0.42 },
  'dagger-lake':    { note: 'Dagger Lake, Essos', lat: 32.24, lon: 14.33, km: 60, vex: 5, str: 0.03, onset: 14, roll: 0.1, lake: 0.12, el: 0.42 },
};
const PKEYS = Object.keys(PRESETS), PDEF = { roll: 0, lake: 0.15, str: 0.012, onset: 30, el: 0.45, distD: 1.25 };
function applyPreset(name) {
  const p = { ...PDEF, ...PRESETS[name] }; Object.assign(P, { lat: p.lat, lon: p.lon, km: p.km, vex: p.roll > 0 ? Math.min(p.vex, 3.5) : p.vex, str: p.roll > 0 ? 0.012 : p.str, onset: p.roll > 0 ? 20 : p.onset, roll: p.roll * 3.5, lake: p.lake, pitch: p.el, S: p.S ?? (p.roll > 0 ? 2.5 : p.km / 7), synth: !!p.synth });
  P.distD = 3.0;
}
const sheet = q.get('sheet'), presetSel = document.getElementById('preset');
for (const k of PKEYS) presetSel.add(new Option(k, k));
function drawSheet() {
  const cols = +sheet || 4, rows = Math.ceil(PKEYS.length / cols), W = canvas.width = Math.round(innerWidth), Hh = canvas.height = Math.round(innerHeight);
  const tw = Math.floor(W / cols), th = Math.floor(Hh / rows); document.getElementById('tiles').innerHTML = '';
  PKEYS.forEach((k, i) => {
    applyPreset(k); renderBuffer();
    const x = (i % cols) * tw, y = Hh - (Math.floor(i / cols) + 1) * th;
    gl.enable(gl.SCISSOR_TEST); gl.scissor(x, y, tw, th); renderImage([x, y, tw, th]); gl.disable(gl.SCISSOR_TEST);
    const d = document.createElement('div'); d.className = 'tile'; d.style.cssText = `left:${x}px;top:${Hh - y - th}px;width:${tw}px`; d.textContent = `${k}  ${PRESETS[k].lat}, ${PRESETS[k].lon}  ${P.km} km`; document.getElementById('tiles').append(d);
  });
  info.textContent = `PROTOTYPE contact sheet: ${PKEYS.length} presets of the world (variant D). Remove ?sheet to explore one. ${presetSel ? '' : ''}`;
}
function draw(rebuild) {
  if (sheet) { drawSheet(); return; }
  if (rebuild) renderBuffer();
  const ms = renderImage();
  label.textContent = `${variant} (${VARIANTS[variant]})`;
  info.textContent = `PROTOTYPE  variant ${variant}: ${VARIANTS[variant]}\nwindow ${P.km} km around ${P.lat}, ${P.lon}  |  buffer ${R}² (${(P.km / R * 1000).toFixed(0)} m/texel)  |  vex ${P.vex}\nfilter scale ${P.S.toFixed(2)} km, strength ${P.str}, onset ${P.onset}, roll ${P.roll}  |  pass A ${tA.toFixed(0)} ms, pass B ${ms.toFixed(0)} ms\nterrain ground ${hmin.toFixed(3)} km at the lowest; drag = orbit, wheel = zoom, ←/→ = variant, URL params in index.html`;
}
function setVariant(v) { variant = v; const url = new URL(location.href); url.searchParams.set('variant', v); history.replaceState(null, '', url); draw(true); }
const cycle = (d) => setVariant(KEYS[(KEYS.indexOf(variant) + d + KEYS.length) % KEYS.length]);
document.getElementById('prev').onclick = () => cycle(-1); document.getElementById('next').onclick = () => cycle(1);
addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') cycle(-1); else if (e.key === 'ArrowRight') cycle(1); else if (e.key.toLowerCase() === 'h') info.hidden = !info.hidden; });
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('pointermove', (e) => { if (!drag) return; P.yaw -= (e.clientX - drag[0]) * 0.006; P.pitch = Math.min(1.5, Math.max(0.05, P.pitch + (e.clientY - drag[1]) * 0.005)); drag = [e.clientX, e.clientY]; draw(false); });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (variant === 'D') P.distD = Math.min(6, Math.max(0.8, P.distD * Math.exp(e.deltaY * 0.001))); else P.dist = Math.min(4, Math.max(0.25, P.dist * Math.exp(e.deltaY * 0.001))); draw(false); }, { passive: false });
addEventListener('resize', () => draw(false));
presetSel.onchange = () => { const url = new URL(location.href); url.searchParams.set('preset', presetSel.value); for (const k of ['lat', 'lon', 'km', 'vex', 'S', 'str', 'onset', 'roll', 'lake', 'el', 'az', 'dist']) url.searchParams.delete(k); history.replaceState(null, '', url); applyPreset(presetSel.value); draw(true); };
const startPreset = q.get('preset') || (q.has('lat') || sheet ? null : 'testbed');
if (startPreset && PRESETS[startPreset]) { presetSel.value = startPreset; applyPreset(startPreset); for (const k of ['vex', 'str', 'onset', 'roll', 'lake', 'km', 'S']) if (q.has(k)) P[k] = +q.get(k); }
if (!q.has('variant')) variant = 'D';
draw(true);
window.__proto = { P, draw, setVariant, PRESETS };
