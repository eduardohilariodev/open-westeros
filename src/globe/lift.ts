import * as THREE from 'three';
import { PLANET, SITES, type SiteId } from '../config';
import { siteLatLon, toVector } from '../geo';

// Height for everything draped on the planet. The relief mesh (reliefMesh.ts) rises by the baked height plus procedural
// detail through raise(); the vector layers (gpuVector.ts) and the relief's lakes follow it through lift(), which reads
// the baked height and sits a hair above the mesh. uDisplace is 0 until the relief loads and while it is off, so nothing
// moves then. Both fade to nothing at the 3D sites, whose flat ground the globe has to meet.
export const DISPLACE = 6; // vertical exaggeration of the 3D relief (the shading's own is relief-bounds.json's)
export const PEAKS = 0.8; // and more again for high ground, up to 1 + PEAKS times: plains stay calm, ranges tower
const sites = (Object.keys(SITES) as SiteId[]).map((id) => { const { lat, lon } = siteLatLon(id); return toVector(lat, lon, PLANET.radius); });

export const LIFT = {
  tH: { value: null as THREE.Texture | null }, // R height / uHeightMax, G land cover; texel centres on the bake's pixels
  uBounds: { value: new THREE.Vector4() }, // lon0, lon1, lat0, lat1 of the baked grid
  uHeightMax: { value: 0 },
  uDisplace: { value: 0 },
  uSites: { value: sites },
};

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
    float n = 1.0 - abs(vnoise(p * f) * 2.0 - 1.0);
    s += a * (n * n - 0.4) * smoothstep(2.0, 4.0, 1.0 / (f * spacing));
    a *= 0.5; f *= 2.0;
  }
  return s * amp;
}
`;

export const LIFT_GLSL = `
uniform sampler2D tH;
uniform vec4 uBounds;
uniform float uHeightMax, uDisplace;
uniform vec3 uSites[${sites.length}];
${NOISE_GLSL}
float siteFade(vec3 p) { // 0 within 20 km of a site, 1 from 60 km out
  float f = 1.0;
  for (int i = 0; i < ${sites.length}; i++) f = min(f, smoothstep(20e3, 60e3, distance(p, uSites[i])));
  return f;
}
vec3 raise(vec3 p, float km) {
  km *= 1.0 + ${PEAKS.toFixed(2)} * smoothstep(0.3, 3.0, km);
  return p + normalize(p) * km * 1000.0 * uDisplace * siteFade(p);
}
// baked height (km), smooth between pixels: cubic B-spline from four bilinear taps
float baseHeight(vec2 uv) {
  vec2 size = vec2(textureSize(tH, 0)), st = uv * size - 0.5, i = floor(st), f = st - i;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0, w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
  vec2 w3 = f * f * f / 6.0, w2 = 1.0 - w0 - w1 - w3, s0 = w0 + w1, s1 = w2 + w3;
  vec2 a = (i - 0.5 + w1 / s0) / size, b = (i + 1.5 + w3 / s1) / size;
  return uHeightMax * (s0.y * (s0.x * textureLod(tH, vec2(a.x, a.y), 0.0).r + s1.x * textureLod(tH, vec2(b.x, a.y), 0.0).r)
                     + s1.y * (s0.x * textureLod(tH, vec2(a.x, b.y), 0.0).r + s1.x * textureLod(tH, vec2(b.x, b.y), 0.0).r));
}
vec3 lift(vec3 p) {
  vec3 d = normalize(p);
  vec2 uv = vec2((degrees(atan(d.x, d.z)) - uBounds.x) / (uBounds.y - uBounds.x), (uBounds.w - degrees(asin(clamp(d.y, -1.0, 1.0)))) / (uBounds.w - uBounds.z));
  float km = all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0))) ? baseHeight(uv) : 0.0;
  return raise(p, km + 0.03);
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
