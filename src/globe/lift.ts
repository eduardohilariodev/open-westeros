import * as THREE from 'three';
import world from '../vector-world.json';
import { PLANET } from '../config';

// Height for everything draped on the planet. The relief mesh (reliefMesh.ts) rises by the baked height plus procedural
// detail through raise(); the vector layers (gpuVector.ts) and the relief's lakes follow it through lift(), which reads
// the baked height and sits a hair above the mesh. uDisplace is 0 until the relief loads and while it is off, so nothing
// moves then.
export const DISPLACE = 6; // vertical exaggeration of the 3D relief seen from above (the shading's own is relief-bounds.json's)
export const PEAKS = 0.8; // and more again for high ground, up to 1 + PEAKS times: plains stay calm, ranges tower

/**
 * How much to exaggerate height for the camera, as the globe's relief is seen at different slants and distances.
 * From above, depth shows only through shading and slight parallax, so it takes a strong exaggeration (`DISPLACE`,
 * `PEAKS`, and the full hillshade) to read as mountains rather than a flat map. Tilted to the horizon the same geometry is
 * seen side-on, where that much looks like stretched spikes, so it eases to about 2-3.5x and the hillshade softens to
 * match. Near the camera's 600 km floor it eases a little, to 4.5x.
 * `tilt` is radians from straight down, `alt` the camera height in metres.
 */
export function exaggeration(alt: number, tilt: number) {
  const { lerp, smoothstep } = THREE.MathUtils;
  const far = smoothstep(alt, 600e3, 3000e3), slant = smoothstep(tilt, (8 * Math.PI) / 180, (65 * Math.PI) / 180);
  return {
    displace: lerp(lerp(4.5, DISPLACE, far), lerp(1.8, 2.7, far), slant), // geometry: metres per metre of baked height
    peaks: lerp(PEAKS, 0.3, slant) * lerp(0.5, 1, far),                 // extra for high ground
    shade: lerp(1, 0.65, slant),                                        // hillshade slope scale, relative to relief-bounds.json's
  };
}

export const LIFT = {
  tH: { value: null as THREE.Texture | null }, // R height / uHeightMax, G land cover; texel centres on the bake's pixels
  tL: { value: null as THREE.Texture | null }, // the canon lakes (vector-world.json) on the bake's grid: 1 over water
  uBounds: { value: new THREE.Vector4() }, // lon0, lon1, lat0, lat1 of the baked grid
  uHeightMax: { value: 0 },
  uDisplace: { value: 0 }, // set every frame from exaggeration(); 0 while the relief is off
  uPeaks: { value: PEAKS },
  // the detail buffers (detail.ts): three nested windows round the camera's focus, coarse to fine, each a height delta over the baked height
  tD0: { value: null as THREE.Texture | null }, tD1: { value: null as THREE.Texture | null }, tD2: { value: null as THREE.Texture | null },
  uDL: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, // per level: centre lon, centre lat (degrees), window km, 1 while it is drawn
  uDR: { value: new THREE.Vector2(1, 1) }, // a buffer's size in texels
};

/** Where the baked height texture and grid are, once the relief has loaded. */
/**
 * The canon lakes filled on the bake's grid (antialiased, 1 over water), so the mesh and the layers drop their procedural detail
 * there: the bake's lake floor lies under the lake's level, but the detail's bumps (tens of metres, times the exaggeration) rose
 * through the water sheet as islands. Drawn here from the outlines, so it needs no bake and follows any grid.
 */
function lakeMask(W: number, H: number, b: { lon0: number; lon1: number; lat0: number; lat1: number }) {
  const ctx = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (const lake of world.lakes) for (const ring of lake.rings as [number, number][][])
    ring.forEach(([lon, lat], k) => ctx[k ? 'lineTo' : 'moveTo'](((lon - b.lon0) / (b.lon1 - b.lon0)) * W, ((b.lat1 - lat) / (b.lat1 - b.lat0)) * H));
  ctx.fill('evenodd'); // a lake's islands are holes
  const rgba = ctx.getImageData(0, 0, W, H).data, a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = rgba[i * 4 + 3];
  const t = new THREE.DataTexture(a, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
export function bindBake(texture: THREE.Texture, b: { lon0: number; lon1: number; lat0: number; lat1: number; heightMax: number }) {
  LIFT.tH.value = texture;
  const { width, height } = texture.image as { width: number; height: number };
  LIFT.tL.value = lakeMask(width, height, b);
  LIFT.uBounds.value.set(b.lon0, b.lon1, b.lat0, b.lat1);
  LIFT.uHeightMax.value = b.heightMax;
}
/** Switches the 3D height on (at `DISPLACE`) or off (0: nothing moves). */
export const setDisplace = (on: boolean) => { LIFT.uDisplace.value = on ? DISPLACE : 0; };
/** Sets the height exaggeration for the camera and returns the hillshade scale to go with it. */
export function exaggerate(alt: number, tilt: number) {
  const e = exaggeration(alt, tilt);
  LIFT.uDisplace.value = e.displace; LIFT.uPeaks.value = e.peaks;
  return e.shade;
}
/** TS twin of raise() below, so a TS query (the camera's clearance) sees the ground as the shader draws it: metres the ground is raised for baked height `km`. */
export const raisedMetres = (km: number) =>
  km * (1 + LIFT.uPeaks.value * THREE.MathUtils.smoothstep(km, 0.3, 3)) * 1000 * LIFT.uDisplace.value;

/** Value noise, and the relief's procedural detail below the bake's ~4 km pixels. Shared by vertex and fragment shaders. */
export const NOISE_GLSL = `
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
// ridged octaves from 4 km down to 125 m, km: rugged where the ground is high, a gentle swell in the lowlands. Octaves
// finer than about twice the spacing (km) can't be shown there and fade out, so coarse and fine nodes agree.
float detailH(vec3 d, float base, float spacing) {
  vec3 p = d * ${(PLANET.radius / 1000).toFixed(1)};
  float amp = 0.015 + 0.42 * smoothstep(0.3, 1.8, base), s = 0.0, a = 0.5, f = 0.25;
  for (int i = 0; i < 6; i++) {
    float fade = smoothstep(2.0, 4.0, 1.0 / (f * spacing));
    if (fade <= 0.0) break; // this octave and every finer one is out of reach: no need to evaluate them
    float n = 1.0 - abs(vnoise(p * f) * 2.0 - 1.0);
    s += a * (n * n - 0.4) * fade;
    a *= 0.5; f *= 2.0;
  }
  return s * amp;
}
// Phacelle noise and the gullies built on it: after Rune Skovbo Johansen's "Advanced Terrain Erosion Filter" and Phacelle Noise,
// https://blog.runevision.com/2026/03/fast-and-gorgeous-erosion-filter.html, Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/).
// Phacelle makes stripes along normDir: x is the stripe's cosine (height), y its sine (slope), zw the stripe's direction (per cell).
vec2 phHash(vec2 x) {
  const vec2 k = vec2(0.3183099, 0.3678794);
  x = x * k + k.yx;
  return -1.0 + 2.0 * fract(16.0 * k * fract(x.x * x.y * (x.x + x.y)));
}
vec4 phacelle(vec2 p, vec2 normDir, float offset) { // one stripe per cell, normalization 0.5
  vec2 sideDir = normDir.yx * vec2(-1.0, 1.0) * 6.28318530718, pInt = floor(p), pFrac = fract(p), phaseDir = vec2(0.0);
  float weightSum = 0.0;
  for (int i = -1; i <= 2; i++) for (int j = -1; j <= 2; j++) {
    vec2 grid = vec2(float(i), float(j)), v = pFrac - grid - phHash(pInt + grid) * 0.5;
    float w = max(0.0, exp(-dot(v, v) * 2.0) - 0.01111), a = dot(v, sideDir) + offset * 6.28318530718;
    weightSum += w;
    phaseDir += vec2(cos(a), sin(a)) * w;
  }
  vec2 interp = phaseDir / weightSum;
  return vec4(interp / max(0.5, length(interp)), sideDir);
}
// Gullies running down the baked slope e (km/km, east and north): three Phacelle octaves of 3.5, 1.75 and 0.9 km, big on
// steep ground and a few metres on the plains; octaves finer than \`spacing\` (km) fade out like detailH's. x: height (km),
// yz: its gradient (east, north). One evaluation is 16 cells per octave, so the callers take it once per vertex or pixel
// and use this gradient, not finite differences. Not the full stacked ErosionFilter: the octaves are independent.
vec3 gullies(vec3 d, vec2 e, float spacing) {
  float lat = asin(clamp(d.y, -1.0, 1.0)), sl = length(e), m = smoothstep(0.02, 0.15, sl), lam = 3.5, gain = 1.0;
  vec2 q = vec2((atan(d.x, d.z) - 0.436332) * cos(lat), lat) * ${(PLANET.radius / 1000).toFixed(1)}, dir = sl > 1e-4 ? e / sl : vec2(0.0, 1.0); // km, sinusoidal about 25°E like the bake's noise frame
  vec3 s = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fade = smoothstep(2.0, 4.0, lam / spacing);
    if (fade <= 0.0) break;
    vec4 ph = phacelle(q / lam, dir, 0.25);
    // 0.02 of the wavelength on steep ground (a 0.05 read as a hatch once the hillshade's exaggeration multiplied its slopes), varied slowly so gullies come and go
    float amp = mix(0.0015, 0.02, m) * lam * gain * fade * (0.4 + 1.2 * vnoise(vec3(q / (6.0 * lam), 3.7 * float(i))));
    s.x += amp * ph.x;
    s.yz += amp * -ph.y * ph.zw / lam;
    lam *= 0.5; gain *= 0.5;
  }
  return s;
}
`;

/**
 * Rivers from the bake's relief-e map, rebuilt as a channel at runtime (the 4.2 km pixels cannot hold a 0.12-1.6 km river):
 * R,G distance to the nearest river's centreline (km, 16 bit, signed about the middle when uRiverP.w is 1), B its discharge,
 * A the creek map. riverAt() returns the channel's depth to carve (km), how much to flatten the fine detail, the (meandered)
 * distance to the centreline, the channel's half width and depth, the slope of its banks and the creek value.
 * The four taps are decoded and blended in the shader (a 16-bit pair cannot be filtered as bytes, and the sign needs care). Nothing is drawn while the
 * map is missing (uRiverD.z is 0). Needs uBounds and NOISE_GLSL.
 */
export const RIVER_GLSL = `
uniform sampler2D tE;
uniform vec4 uRiverP; // distance range km, width min and max km, 1 when the distance is signed
uniform vec3 uRiverD; // depth min and max km, 1 once relief-e has loaded
uniform float uRiverLines; // 1 once the water is drawn as lines (relief.ts bakedRivers): the land shader leaves it out
vec4 riverTexel(ivec2 p, ivec2 size) {
  vec4 t = texelFetch(tE, clamp(p, ivec2(0), size - 1), 0);
  float v = (t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0;
  return vec4((uRiverP.w > 0.5 ? v * 2.0 - 1.0 : v) * uRiverP.x, t.b, t.a, 0.0);
}
void riverAt(vec2 uv, vec3 dir, float base, float cover, out float carve, out float flatten, out float deff, out float halfW, out float depth, out vec2 grad, out float creek) {
  carve = 0.0; flatten = 0.0; deff = 99.0; halfW = 0.1; depth = 0.0; grad = vec2(0.0); creek = 0.5;
  if (uRiverD.z < 0.5) return;
  ivec2 size = textureSize(tE, 0);
  vec2 st = uv * vec2(size) - 0.5, f = fract(st);
  ivec2 i = ivec2(floor(st));
  vec4 a = riverTexel(i, size), b = riverTexel(i + ivec2(1, 0), size), c = riverTexel(i + ivec2(0, 1), size), d = riverTexel(i + ivec2(1, 1), size);
  creek = mix(mix(a.z, b.z, f.x), mix(c.z, d.z, f.x), f.y);
  float lat = asin(clamp(dir.y, -1.0, 1.0)), km = ${(PLANET.radius / 1000).toFixed(1)} * 0.0174533;
  vec2 tex = vec2((uBounds.y - uBounds.x) / float(size.x) * cos(lat), (uBounds.w - uBounds.z) / float(size.y)) * km; // km per texel, east and north
  // The four taps are blended here, not by the hardware, because the sign is not smooth: where two rivers (or two arms) meet, the
  // bake's sign flips between neighbouring texels that are both far from any river, and a bilinear blend would cross zero there
  // and light up a thin channel. Where the signs are mixed, the signed blend s is trusted only near a river; farther out the
  // unsigned blend u (no zero) takes over. "Near" is a soft minimum of the four |d|, weighted by the bilinear weights, so it moves
  // smoothly with the position and no texel-cell border shows: where the signs agree s = +-u, so the blend changes nothing there.
  vec4 w4 = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y), dv = vec4(a.x, b.x, c.x, d.x), du = abs(dv);
  float dm = min(min(du.x, du.y), min(du.z, du.w)), texMax = max(tex.x, tex.y);
  float nearD = dm - 0.25 * log(max(dot(w4, exp(-(du - dm) / 0.25)), 1e-30)); // soft minimum
  bool mixedSign = min(min(dv.x, dv.y), min(dv.z, dv.w)) < 0.0 && max(max(dv.x, dv.y), max(dv.z, dv.w)) > 0.0;
  float conf = uRiverP.w > 0.5 ? (mixedSign ? 1.0 - smoothstep(0.55 * texMax, 0.72 * texMax, nearD) : 1.0) : 0.0; // how far the signed blend is trusted
  float ds = mix(dot(w4, du), dot(w4, dv), conf);
  if (abs(ds) > 14.0) return; // farther than a floodplain reaches
  vec4 vv = mix(du, dv, conf);
  vec2 gt = vec2((1.0 - f.y) * (vv.y - vv.x) + f.y * (vv.w - vv.z), (1.0 - f.x) * (vv.z - vv.x) + f.x * (vv.w - vv.y)); // per texel, x east, y south
  vec2 gk = vec2(gt.x / tex.x, -gt.y / tex.y); // the distance's gradient, km/km: about 1 beside a river, near 0 over a flat (a wide mask, a lake)
  // the discharge: of the rivers the four texels are near, weighted by closeness (a quadrant pick would step in squares)
  vec4 k4 = w4 * (exp(-du / 1.2) + 1e-6);
  float q = pow(clamp(dot(k4, vec4(a.y, b.y, c.y, d.y)) / dot(k4, vec4(1.0)), 0.0, 1.0), 1.8), width = mix(uRiverP.y, uRiverP.z, q);
  depth = mix(uRiverD.x, uRiverD.y, q); halfW = 0.5 * width;
  float n = 0.0; // no meander wobble: the bake's traced network already winds like the land (the noise wobble read as a squiggle from 400 km)
  deff = max(abs(ds + n * conf) + 0.5 * n * (1.0 - conf), 0.0);
  float land = smoothstep(0.62, 0.8, cover), t = deff / halfW;
  carve = min(depth * clamp(1.0 - t * t, 0.0, 1.0) * land, max(base - 0.0015, 0.0)); // never under the sea, so the channel fades out at a mouth
  flatten = (1.0 - smoothstep(1.0, 3.0, t)) * land * 0.8;
  if (t < 1.0) { // the banks' slope (km/km): h = base - carve, so dh = 2 D t / halfW times the distance's gradient
    grad = 2.0 * depth * t / halfW * land * sign(ds) * gk;
  }
}
`;

/**
 * Reading the detail buffers (detail.ts). Each level is a window of `L.z` km round (L.x, L.y); its texture holds, per texel, R: the
 * height delta over the baked height (km), G: the erosion filter's ridge map (0..1, 0 on creases), B: its erosion offset (0..1,
 * low where the ground is eroded), A: the depth of river water (km). The levels blend from the finest outward over a band at
 * each window's edge, and `W` is how much of the way the buffers cover a point (0 outside all of them): the caller keeps its own
 * detail for the rest.
 */
export const DETAIL_GLSL = `
uniform sampler2D tD0, tD1, tD2;
uniform vec4 uDL[3];
uniform vec2 uDR;
const float KMDEG = 120.57;
vec3 detailCoord(vec4 L, vec3 d) { // uv in the level's window, and how far inside it the point is (1 inside, 0 at the edge)
  float lon = degrees(atan(d.x, d.z)), lat = degrees(asin(clamp(d.y, -1.0, 1.0)));
  vec2 uv = vec2((lon - L.x) * cos(radians(L.y)), lat - L.y) * KMDEG / max(L.z, 1.0) + 0.5, e = min(uv, 1.0 - uv);
  return vec3(uv, L.w * smoothstep(0.0, 0.14, min(e.x, e.y)));
}
vec4 detailTap(int k, vec2 uv, float lod) { return k == 0 ? textureLod(tD0, uv, lod) : k == 1 ? textureLod(tD1, uv, lod) : textureLod(tD2, uv, lod); }
// the vertex shaders' read: height delta only, at the mip that suits vertices \`spacing\` km apart
float detailHV(vec3 d, float spacing, out float W) {
  float h = 0.0; W = 0.0;
  for (int k = 2; k >= 0; k--) {
    vec4 L = uDL[k]; if (L.w < 0.5) continue;
    vec3 c = detailCoord(L, d); float w = c.z * (1.0 - W); if (w <= 0.0) continue;
    h += w * detailTap(k, c.xy, max(0.0, log2(max(spacing, 1e-3) / (L.z / uDR.x)))).r; W += w;
  }
  return h;
}
`;
/** The land fragment shader's read of the buffers; call detailF() in uniform control flow (its mips come from derivatives). g: the delta's slope, km per km, east and north. */
export const DETAIL_FRAG_GLSL = `
struct Det { float h; vec2 g; float ridge, occ, water, w; };
Det detailF(vec3 d) {
  vec3 c[3]; float lod[3];
  for (int k = 0; k < 3; k++) { c[k] = detailCoord(uDL[k], d); lod[k] = max(0.0, log2(max(length(fwidth(c[k].xy)) * uDR.x, 1e-6))); }
  Det r = Det(0.0, vec2(0.0), 0.0, 0.0, 0.0, 0.0);
  for (int k = 2; k >= 0; k--) {
    if (uDL[k].w < 0.5) continue;
    float w = c[k].z * (1.0 - r.w); if (w <= 0.0) continue;
    vec2 t = 1.0 / uDR, uv = c[k].xy;
    vec4 s = detailTap(k, uv, lod[k]), x0 = detailTap(k, uv - vec2(t.x, 0.0), lod[k]), x1 = detailTap(k, uv + vec2(t.x, 0.0), lod[k]),
         y0 = detailTap(k, uv - vec2(0.0, t.y), lod[k]), y1 = detailTap(k, uv + vec2(0.0, t.y), lod[k]);
    float texKm = uDL[k].z / uDR.x;
    r.h += w * s.r; r.g += w * vec2(x1.r - x0.r, y1.r - y0.r) / (2.0 * texKm);
    r.ridge += w * s.g; r.occ += w * s.b; r.water += w * s.a; r.w += w;
  }
  return r;
}
`;
export const LIFT_GLSL = `
uniform sampler2D tH, tL;
uniform vec4 uBounds;
uniform float uHeightMax, uDisplace, uPeaks;
${NOISE_GLSL}
${DETAIL_GLSL}
vec3 raise(vec3 p, float km) {
  km *= 1.0 + uPeaks * smoothstep(0.3, 3.0, km);
  return p + normalize(p) * km * 1000.0 * uDisplace;
}
// baked height (km), smooth between pixels: cubic B-spline from four bilinear taps
float baseHeight(vec2 uv) {
  vec2 size = vec2(textureSize(tH, 0)), st = uv * size - 0.5, i = floor(st), f = st - i;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0, w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
  vec2 w3 = f * f * f / 6.0, w2 = 1.0 - w0 - w1 - w3, s0 = w0 + w1, s1 = w2 + w3;
  vec2 a = (i - 0.5 + w1 / s0) / size, b = (i + 1.5 + w3 / s1) / size;
  float h = uHeightMax * (s0.y * (s0.x * textureLod(tH, vec2(a.x, a.y), 0.0).r + s1.x * textureLod(tH, vec2(b.x, a.y), 0.0).r)
                        + s1.y * (s0.x * textureLod(tH, vec2(a.x, b.y), 0.0).r + s1.x * textureLod(tH, vec2(b.x, b.y), 0.0).r));
  // Sea level only at the shore line itself: the ground keeps its baked height right up to where cover is 0.5 and falls to the
  // water over the last ~tenth of a pixel, so a high coast is a sea cliff, not a ramp (the mesh sinks its sea-side vertices to
  // meet it, MESH_VERT).
  return h * smoothstep(0.5, 0.6, textureLod(tH, uv, 0.0).g);
}
vec3 lift(vec3 p) {
  vec3 d = normalize(p);
  vec2 uv = vec2((degrees(atan(d.x, d.z)) - uBounds.x) / (uBounds.y - uBounds.x), (uBounds.w - degrees(asin(clamp(d.y, -1.0, 1.0)))) / (uBounds.w - uBounds.z));
  float km = all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0))) ? baseHeight(uv) : 0.0, dW;
  km += km > 0.0 ? detailHV(d, 0.0, dW) * (1.0 - textureLod(tL, uv, 0.0).r) : 0.0; // the layers follow the detail buffer too, so a road across a gully is on its floor (not over a lake: tL)
  return raise(p, km + 0.004 + 0.026 * smoothstep(0.05, 0.4, km)); // the hair over the mesh: a few metres at the shore (it is scaled by uDisplace like the height, so 0.03 there would hold every coast line ~100 m above the sea), the full 0.03 in the hills where the mesh's detail is larger
}
`;

/** Makes a vector layer's material (MeshBasicMaterial or LineMaterial) follow the relief. */
export function lifted<M extends THREE.Material>(m: M) {
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, LIFT);
    s.vertexShader = s.vertexShader.replace('void main() {', `${LIFT_GLSL}\nvoid main() {`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = lift(transformed);')
      .replace('vec4( instanceStart, 1.0 )', 'vec4( lift(instanceStart), 1.0 )')
      .replace('vec4( instanceEnd, 1.0 )', 'vec4( lift(instanceEnd), 1.0 )');
  };
  return m;
}
