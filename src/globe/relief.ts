import * as THREE from 'three';
import B from './relief-bounds.json';
import { PLANET } from '../config';
import { toVector } from '../geo';
import { bindBake, exaggerate, LIFT, LIFT_GLSL, NOISE_GLSL, raisedMetres, setDisplace } from './lift';
import { GROUND_FRAG_GLSL, loadGround, type Ground } from './ground';
import { createReliefMesh, MESH_VERT } from './reliefMesh';
import { RIVER_VERT, riverGeometry, syncPixel } from './rivers';
import type { Ring } from './viewLayer';
import { WALL_VERT, wallGeometry } from './wall';
import { townsMesh } from './towns';
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
#ifdef SEA
varying vec3 vPos;
#endif
void main() {
  vDir = normalize(position);
  #ifdef SEA
  // The ocean mesh as a shell just outside the sea sphere (its flat faces, up to 2.5 degrees across, then all lie over the sphere,
  // not under it), so it covers every pixel the sea does; the fragment shader finds the sphere's own hit and drops the misses.
  vec3 seaP = normalize(position) * ${((PLANET.radius - 10) / Math.cos(THREE.MathUtils.degToRad(2.5))).toFixed(1)};
  vPos = (modelMatrix * vec4(seaP, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(seaP, 1.0);
  #elif defined(LIFT)
  gl_Position = projectionMatrix * modelViewMatrix * vec4(lift(position), 1.0);
  #else
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #endif
  #include <logdepthbuf_vertex>
}`;

const COMMON = `#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D tA, tB, tC, tD, tV; // A: slope east, slope north, sun light, ambient occlusion. B: height, flow, erosion, sea distance.
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
float detail(vec3 p, float w);
uniform sampler2D tCloud;       // Earth's cloud cover (equirectangular), projected onto this planet ~60 km up
float cloudTex(vec3 d) {
  vec2 uv = vec2(atan(d.x, d.z) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5);
  vec2 uv2 = vec2(fract(uv.x + 0.5) - 0.5, uv.y); // continuous across the date line, so the mip level has no seam
  vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  bool seam = dot(dx, dx) + dot(dy, dy) > dot(dx2, dx2) + dot(dy2, dy2);
  return textureGrad(tCloud, uv, seam ? dx2 : dx, seam ? dy2 : dy).r;
}
float clouds(vec3 d) { return smoothstep(0.2, 0.8, cloudTex(d)); }
// 1 over the unmapped world, outside the baked grid (ragged edge, starting a little inside it), 0 over the Known World
float hideMask(vec3 d) {
  float lon = degrees(atan(d.x, d.z)), lat = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float out_ = max(max(uBounds.x - lon, lon - uBounds.y), max(uBounds.z - lat, lat - uBounds.w));
  float n = detail(d * 7.0, length(fwidth(d)) * 7.0);
  return smoothstep(-3.0, 5.0, out_ + (n - 0.5) * 10.0);
}
// Earth's cloud cover, thickened and broken up with fine puffs over the unmapped world (m: hideMask). \`w\` is
// length(fwidth(d)), taken by the caller outside any branch.
float cloudField(vec3 d, float w, float m) {
  return cloudTex(d) + m * (0.15 + (detail(d * 35.0, w * 35.0) - 0.5) * 0.3);
}
// the ground under a cloud's shadow, cast along the sun from 60 km up
float cloudShade(vec3 d) {
  if (uCloud < 0.01) return 1.0;
  vec3 east = normalize(vec3(d.z, 0.0, -d.x)), north = cross(d, east);
  return 1.0 - 0.4 * uCloud * clouds(normalize(d + (east * uSun.x + north * uSun.y) / uSun.z * 60.0 / 6915.0));
}
// fbm that fades each octave to its mean once it is finer than a pixel. \`w\` is p's size on a pixel, length(fwidth(p)): the
// caller takes that derivative once, outside any branch (a derivative in a branch makes the compiler run both sides), and
// scales it with p.
float detail(vec3 p, float w) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    if (w >= 0.6) { s += a * (1.0 - exp2(float(i - 5))); break; } // this octave and every finer one is its mean, 0.5: their sum, in closed form
    s += a * mix(vnoise(p), 0.5, smoothstep(0.3, 0.6, w)); p = p * 2.03 + 17.1; w *= 2.03; a *= 0.5;
  }
  return s / 0.97;
}
vec3 finish(vec3 c) { // the renderer's tone mapping, then output colour space
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  return gl_FragColor.rgb;
}
`;

const landFrag = (ground: string) => `${COMMON}
${ground}
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
  float fw = length(fwidth(p)); // km per pixel; taken here, in uniform control flow, for the noise below
  #ifdef GROUND
  vec4 gd = vec4(dFdx(vG), dFdy(vG)); // metres per pixel in the ground texture's frame, taken here like fw
  vec2 gz = vec2(dFdx(vZ), dFdy(vZ));
  #endif
  if (!inGrid(uv)) { finish(srgb(vec3(0.5, 0.56, 0.34)) * 0.9); return; }
  vec4 A = texture2D(tA, uv), Bm = texture2D(tB, uv), C = texture2D(tC, uv);
  vec2 e = A.rg * 2.0 - 1.0, g = sign(e) * e * e * uGradMax;   // true slope (km/km), east and north
  float slope = length(g), sun = A.b, ao = A.a;
  float h = Bm.r * uHeightMax, flow = Bm.g, ero = Bm.b * 2.0 - 1.0; // ero < 0 eroded, > 0 deposited
  #ifdef COVER
  { // the mesh's procedural detail (detailH), lit per pixel down to what a pixel can show; kept in the lean program too, or the relief flattens while the camera moves
    float px = max(fw, 0.03); // km per pixel
    vec3 east = normalize(vec3(vDir.z, 0.0, -vDir.x)), north = cross(vDir, east);
    float d0 = detailH(vDir, h, px);
    g += vec2(detailH(normalize(vDir + east * px / 6915.0), h, px) - d0, detailH(normalize(vDir + north * px / 6915.0), h, px) - d0) / px;
    slope = length(g);
  }
  #endif
  float forest = C.r, moist = C.g, snowClass = C.b;
  float lat = degrees(abs(asin(clamp(vDir.y, -1.0, 1.0))));
  float n1 = detail(p / 6.0, fw / 6.0); // breakup noise, ~6 km, ~1 km, ~350 m
  #ifdef LEAN
  float n2 = 0.5, n3 = 0.5, wob = 0.5; // the lean program (drawn while the camera moves on a slow GPU): the finer noise is its mean, which is what it fades to when a pixel is bigger than it anyway
  #else
  float n2 = detail(p / 1.2, fw / 1.2), n3 = detail(p / 0.35, fw / 0.35), wob = detail(p / 1.2 + 4.7, fw / 1.2);
  #endif

  // ground colour by biome (relief-v: the fan vegetation map's biomes as albedo, tools/world/vegetation.mjs), sampled
  // through a ~30 km wobble so borders read as country rather than lines; then trees by the biome's cover, greener
  // ground along water, stony uplands and the geology's rock on steep ground, reddened in arid lands
  // the biome map's ~12 km pixels melt into ragged borders: a ~30 km and a ~5 km wobble, then four taps ~14 km apart
  // (the grid spans about twice as many degrees east-west as north-south, hence r.y = 2 r.x)
  vec2 w = uv + (vec2(n1, detail(p / 6.0 + 9.1, fw / 6.0)) - 0.5) * 0.002 + (vec2(n2, wob) - 0.5) * 0.0004;
  vec2 r = vec2(0.0007, 0.0014);
  vec3 v = 0.25 * (texture2D(tV, w + vec2(r.x, 0.0)).rgb + texture2D(tV, w - vec2(r.x, 0.0)).rgb
                 + texture2D(tV, w + vec2(0.0, r.y)).rgb + texture2D(tV, w - vec2(0.0, r.y)).rgb);
  float arid = smoothstep(0.02, 0.13, v.r - v.g);
  vec3 c = srgb(v) * (0.82 + 0.22 * n2 + 0.14 * n3);                                          // grain
  c = mix(c, c * vec3(0.75, 0.95, 0.7), smoothstep(0.25, 0.8, flow) * 0.5 * (1.0 - arid * 0.5));
  c *= mix(1.0, 0.62 + 0.38 * n3 + 0.15 * n2, smoothstep(0.2, 0.9, forest + (n3 - 0.5) * 0.5)); // canopy: clumps and clearings
  vec3 rock = mix(srgb(texture2D(tD, uv).rgb * 0.85), srgb(vec3(0.68, 0.66, 0.62)), 0.55);    // the geology's rock, pale
  rock = mix(rock, srgb(vec3(0.72, 0.5, 0.32)), arid) * (0.8 + 0.25 * n2 + 0.15 * n3);        // red-brown where dry
  c = mix(c, mix(c, rock, 0.5), smoothstep(0.7, 1.8, h + (n1 - 0.5) * 0.4) * 0.5);            // uplands go stony
  float bare = smoothstep(0.05, 0.16, slope + (n1 - 0.5) * 0.05) * (1.0 - smoothstep(0.2, 0.7, flow));
  bare = max(bare, smoothstep(-0.2, -0.6, ero) * smoothstep(0.8, 1.8, h) * 0.6);              // scoured high ground
  c = mix(c, rock, clamp(bare + smoothstep(1.8, 2.6, h) * 0.6, 0.0, 1.0));
  float snowLine = mix(3.2, 0.6, smoothstep(40.0, 68.0, lat));
  float snow = smoothstep(snowLine, snowLine + 0.3, h + (n1 - 0.5) * 0.5) * (1.0 - smoothstep(0.2, 0.45, slope));
  c = mix(c, srgb(vec3(0.86, 0.88, 0.9)) * (0.92 + 0.1 * n2), max(snow, smoothstep(0.3, 0.7, snowClass) * (0.85 + 0.15 * n2)));

  // real-scale ground photos (ground.ts) as a detail layer: the two materials the land's environment calls for, by the
  // channels above, each laid at its true size; the biome colour is multiplied by photo / its mean, the normal bent by the photo's
  vec2 gN = vec2(0.0);
  #ifdef GROUND
  if (uGOn > 0.5) {
    float sea = Bm.a * Bm.a * uSeaMax; // km out to sea
    float lum = dot(v, vec3(0.299, 0.587, 0.114));
    float wSnow = max(snow, smoothstep(0.3, 0.7, snowClass));
    float wRock = clamp(bare + smoothstep(1.8, 2.6, h) * 0.6, 0.0, 1.0);
    float open = (1.0 - wSnow) * (1.0 - wRock);
    float sc[8]; int ma[8], mb[8]; float wv[8]; // each environment's score, and its two materials: ma at 1 - wv, mb at wv
    sc[0] = wSnow;                                                    ma[0] = M_snow_02;              mb[0] = M_snow_field_aerial;  wv[0] = smoothstep(0.3, 0.7, n2);
    sc[1] = wRock * (1.0 - 0.8 * wSnow);                              ma[1] = M_rock_boulder_dry;     mb[1] = M_aerial_rocks_02;    wv[1] = max(smoothstep(0.18, 0.36, slope), smoothstep(1.8, 2.8, h) * 0.7);
    sc[2] = arid * open;                                              ma[2] = M_red_sand;             mb[2] = M_sandstone_cracks;   wv[2] = max(smoothstep(0.4, 0.8, n1), smoothstep(0.1, 0.25, slope));
    sc[3] = smoothstep(0.35, 0.8, forest) * open;                     ma[3] = M_forest_leaves_02;     mb[3] = M_forrest_ground_03;  wv[3] = smoothstep(44.0, 52.0, lat);
    sc[4] = smoothstep(0.55, 0.85, moist) * (1.0 - smoothstep(0.15, 0.45, h)) * (1.0 - arid) * open; ma[4] = M_mud_forest; mb[4] = M_brown_mud_leaves_01; wv[4] = smoothstep(0.3, 0.7, n1);
    sc[5] = (1.0 - smoothstep(0.3, 2.0, sea)) * (1.0 - wSnow);        ma[5] = M_aerial_beach_01;      mb[5] = M_seaside_rock;       wv[5] = smoothstep(0.08, 0.22, slope);
    sc[6] = 1.0 - smoothstep(0.06, 0.14, lum);                        ma[6] = M_burned_ground_01;     mb[6] = M_dark_rock_02;       wv[6] = smoothstep(0.3, 0.7, n1); // Valyria's black
    sc[7] = 0.35 * open;                                              ma[7] = M_leafy_grass;          mb[7] = M_grass_ground;       wv[7] = smoothstep(-0.04, 0.05, v.r - v.g);
    // the two strongest environments, each weighted by how far it stands above the third, so one coming up from third starts at nothing
    int ia = 0; for (int j = 1; j < 8; j++) if (sc[j] > sc[ia]) ia = j;
    int ib = ia == 0 ? 1 : 0; for (int j = 0; j < 8; j++) if (j != ia && sc[j] > sc[ib]) ib = j;
    int ic = (ia != 0 && ib != 0) ? 0 : ((ia != 1 && ib != 1) ? 1 : 2); for (int j = 0; j < 8; j++) if (j != ia && j != ib && sc[j] > sc[ic]) ic = j;
    float wa = sc[ia] - 0.9 * sc[ic], wb = sc[ib] - 0.9 * sc[ic], tb = wb / max(wa + wb, 1e-4);
    float th = G_N * (atan(vDir.x, vDir.z) - G_L0), cs = cos(th), sn = sin(th); // the cone's grid is turned from east/north by this
    float side = smoothstep(0.8, 1.8, slope * uDisplace * (1.0 + uPeaks * smoothstep(0.3, 3.0, h))); // steepness as drawn, exaggeration and all
    vec2 gGrid = vec2(g.x * cs - g.y * sn, g.x * sn + g.y * cs), wall = abs(gGrid.yx) / (abs(gGrid.x) + abs(gGrid.y) + 1e-5);
    vec3 rA, mA, rB = vec3(1.0), mB = vec3(1.0); vec2 nA, nB = vec2(0.0); float vA, vB = 1.0;
    groundMix(ma[ia], mb[ia], wv[ia], gd, gz, side, wall, rA, nA, mA, vA);
    if (tb > 0.02) groundMix(ma[ib], mb[ib], wv[ib], gd, gz, side, wall, rB, nB, mB, vB);
    vec3 meanC = mix(mA, mB, tb);
    vec3 hue = meanC * (dot(c, vec3(0.299, 0.587, 0.114)) / dot(meanC, vec3(0.299, 0.587, 0.114))); // the photo's average colour at the biome's brightness
    c = mix(c, hue, 0.55 * mix(vA, vB, tb)) * mix(rA, rB, tb);
    vec2 ng = mix(nA, nB, tb);                                        // the photo's normal, in the texture grid's x, y
    gN = 1.1 * vec2(ng.x * cs + ng.y * sn, -ng.x * sn + ng.y * cs);
  }
  #endif

  #ifdef COVER
  { // the sea cliff's face (reliefMesh.ts, the mesh falls to the water between cover 0.6 and 0.5, and wherever the coast is high): bare rock, darker towards the water; plain colour, so the lean program pays nothing
    float cliff = (1.0 - smoothstep(0.5, 0.66, vCover)) * smoothstep(0.02, 0.1, h);
    c = mix(c, rock * mix(0.45, 0.9, smoothstep(0.5, 0.66, vCover)), cliff);
  }
  #endif

  // light: hard hillshade from the north-west sun (baked cast shadow, cloud shadows) over a dim cool sky, so ridges catch
  // the light bright and their far sides drop into shadow
  vec3 n = normalize(vec3(-g * uExaggeration * 1.5 + gN, 1.0));
  float ndl = max(dot(n, uSun), 0.0);
  vec3 light = vec3(1.0, 0.95, 0.85) * 2.0 * ndl * sun * cloudShade(vDir) + vec3(0.6, 0.7, 0.85) * 0.3 * (0.6 + 0.4 * n.z) * ao + vec3(0.04);
  finish(c * light);
}`;

const WATER_FRAG = `${COMMON}
#ifdef SEA
varying vec3 vPos;
#endif
void main() {
  #include <logdepthbuf_fragment>
  #ifdef SEA
  // The ocean mesh is a shell outside the sea (VERT's SEA branch). Under the relief the sea is at the land mesh's shore
  // (R - 7 m), so take the camera ray's hit on a true sphere 3 m under that: its depth, and its direction, which is what the
  // sea is shaded by. The step that leaves at the coast is hidden by colour (rock on the land, surf on the water).
  // Solved from the shell point along the ray (s metres back towards the camera, negative when the hit lies ahead), in a form
  // that keeps float precision at planet scale. A ray that misses the sphere is not sea: dropped.
  vec3 vd = vDir;
  { vec3 rd = normalize(vPos - cameraPosition);
    float r = length(vPos), b = dot(vPos, rd), c = (r - ${(PLANET.radius - 10).toFixed(1)}) * (r + ${(PLANET.radius - 10).toFixed(1)});
    if (b * b < c) discard;
    float q = sqrt(max(b * b - c, 0.0)), s = b > 0.0 ? b + q : -c / max(q - b, 1e-3);
    float t = distance(vPos, cameraPosition) - s; // the hit's distance along the ray: behind the camera (it is inside the shell when low) is sky, not sea
    if (t <= 0.0) discard;
    vd = normalize(vPos - rd * s);
    float w = t * dot(rd, -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])); // view depth
    gl_FragDepth = log2(1.0 + w) * logDepthBufFC * 0.5; }
  #else
  vec3 vd = vDir;
  #endif
  vec2 uv = gridUV(vd);
  float sd = texture2D(tB, uv).a, d = inGrid(uv) ? sd * sd * uSeaMax : uSeaMax; // km out to sea (stored as its square root)
  vec3 p = vd * 6915.0;
  float fw = length(fwidth(p));
  float dn = d + (detail(p / 40.0, fw / 40.0) - 0.5) * 40.0;
  // a teal glow over the shelf, deepening fast to dark navy, mottled like a satellite sea
  vec3 c = mix(srgb(vec3(0.14, 0.42, 0.45)), srgb(vec3(0.06, 0.2, 0.3)), smoothstep(0.0, 25.0, dn));
  c = mix(c, srgb(vec3(0.035, 0.08, 0.15)), smoothstep(35.0, 280.0, dn));
  c *= (0.82 + 0.28 * detail(p / 14.0, fw / 14.0)) * (0.92 + 0.12 * detail(p / 2.0, fw / 2.0));
  c = mix(c, srgb(vec3(0.5, 0.66, 0.62)), (1.0 - smoothstep(0.1, 1.2, d)) * 0.5);            // surf along the shore
  finish(c * 1.15 * cloudShade(vd));
}`;

// The cloud layer: wisps over sea and land, gone as you come down through them (uCloud)
const CLOUD_FRAG = `${COMMON}
uniform vec3 uNoon;
void main() {
  #include <logdepthbuf_fragment>
  float w = length(fwidth(vDir)), m = hideMask(vDir), h0 = cloudField(vDir, w, m);
  float a = smoothstep(0.2, 0.8, h0) * uCloud;
  if (a < 0.01) discard;
  // low sun: the side turned to it is warm and bright, the lee side cool (cover one step towards the sun, ~80 km)
  vec3 east = normalize(vec3(vDir.z, 0.0, -vDir.x)), north = cross(vDir, east);
  float h1 = cloudField(normalize(vDir + (east * uSun.x + north * uSun.y) * 0.012), w, m);
  float lit = clamp(0.65 + (h0 - h1) * 3.0, 0.0, 1.0);
  float night = 0.97 * smoothstep(0.0, -0.2, dot(vDir, uNoon)); // the atmosphere's night veil does not reach clouds past the limb
  finish(mix(srgb(vec3(0.62, 0.68, 0.78)), srgb(vec3(0.98, 0.94, 0.88)), lit) * (1.0 - night));
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
uniform sampler2D uIce;
// The ice photo laid as overlapping tiles with negative spacing: each tile reaches past its neighbours and fades out softly
// (a blur between them), each is shifted by its own random offset, and the sum is re-contrasted, so there is no seam or grid.
vec2 iceHash(vec2 c) { return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453); }
vec3 iceBlend(vec2 p) {
  vec2 i = floor(p);
  vec3 sum = vec3(0.0); float w1 = 0.0, w2 = 0.0;
  for (int y = -1; y <= 2; y++) for (int x = -1; x <= 2; x++) {
    vec2 cell = i + vec2(float(x), float(y));
    float w = smoothstep(1.7, 0.2, length(p - cell)); // reach 1.7 cells, the spacing being 1
    sum += w * texture2D(uIce, (p - cell) * 0.45 + iceHash(cell)).rgb; w1 += w; w2 += w * w;
  }
  vec3 mean = vec3(0.78, 0.88, 0.95);
  return max(mean + (sum / w1 - mean) * w1 / sqrt(w2), 0.0); // keeps the contrast an overlap of tiles would average away
}
varying vec3 vN;
varying vec2 vIce;
void main() {
  #include <logdepthbuf_fragment>
  vec3 east = normalize(vec3(vDir.z, 0.0, -vDir.x)), north = cross(vDir, east);
  vec3 n = vec3(dot(vN, east), dot(vN, north), dot(vN, vDir));
  vec3 c = mix(srgb(vec3(0.62, 0.74, 0.82)), srgb(vec3(0.9, 0.92, 0.94)), smoothstep(0.8, 0.95, n.z));
  vec3 ice = iceBlend(vIce / 420.0) * (0.75 + 0.25 * iceBlend(vIce / 3000.0 + 7.3).g / 0.88);
  c = mix(c, ice * 1.15, 0.8 * (1.0 - smoothstep(0.9, 0.97, n.z) * 0.6));
  finish(c * (vec3(1.0, 0.95, 0.85) * 1.6 * max(dot(n, uSun), 0.0) + vec3(0.6, 0.7, 0.85) * 0.45));
}`;

/** Swaps the terrain fills, lakes and ocean between the relief shaders and their flat materials, and shows the 3D relief
 * mesh (`object`) in place of the land fills. */
export function createRelief(fills: Record<string, THREE.Mesh>, strokes: THREE.Object3D[], ocean: THREE.Mesh, riverLines: THREE.Object3D) {
  let enabled = false;
  let swaps: { mesh: THREE.Mesh; flat: THREE.Material; relief: THREE.Material }[] = [];
  const object = new THREE.Group();
  let updateMesh: ((camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) => void) | null = null;
  let bakedHeight: ((lon: number, lat: number) => number) | null = null;
  const uCloud = { value: 0 };
  let leanMat: THREE.ShaderMaterial | null = null, richMat: THREE.ShaderMaterial | null = null, reliefMesh: THREE.Mesh | null = null;
  let cloudLayer: THREE.Mesh | null = null; // not drawn at all once below the clouds: its shader would only discard
  const uExaggeration = { value: B.exaggeration }; // hillshade slope scale, eased with the camera by update()
  const apply = () => {
    const on = enabled && swaps.length > 0;
    for (const s of swaps) s.mesh.material = enabled ? s.relief : s.flat;
    for (const s of strokes) s.visible = !on; // the relief draws its own ranges
    for (const id of CLASSES) fills[id].visible = !(on && object.children.length); // the mesh draws the land
    riverLines.visible = !(on && object.children.length); // and its own rivers
    object.visible = on;
    setDisplace(on && object.children.length > 0);
  };
  // data, not pictures: no premultiplied alpha, no colour management
  const loader = new THREE.ImageBitmapLoader().setOptions({ premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  let done = 0; // loading bar: 5 maps, the height mesh, then the rivers and clouds
  const STEPS = 7;
  const load = (name: string) => loader.loadAsync(`${import.meta.env.BASE_URL}world/${name}.webp`).then((bitmap) => {
    done++;
    const t = new THREE.Texture(bitmap);
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  });
  const cloudTexture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/earth_clouds.jpg`);
  cloudTexture.wrapS = THREE.RepeatWrapping;
  cloudTexture.anisotropy = 8;
  let ground: Ground | null = null, groundChanged: (() => void) | null = null;
  const ready = Promise.all([...['relief-a', 'relief-b', 'relief-c', 'relief-d', 'relief-v'].map(load), loadGround().catch((e) => { console.warn('ground textures off,', e); return null; })]).then(([tA, tB, tC, tD, tV, g]) => {
    ground = g as Ground | null;
    if (ground) ground.onChange = () => groundChanged?.();
    const landGround = landFrag(ground ? GROUND_FRAG_GLSL(ground) : '');
    const uniforms = {
      ...LIFT, tA: { value: tA as THREE.Texture }, tB: { value: tB as THREE.Texture }, tC: { value: tC as THREE.Texture }, tD: { value: tD as THREE.Texture }, tV: { value: tV as THREE.Texture },
      uExaggeration, uGradMax: { value: B.gradMax }, uSeaMax: { value: B.seaMax },
      uSun: { value: new THREE.Vector3(...B.sun) }, uCloud, tCloud: { value: cloudTexture },
      uNoon: { value: toVector((B.lat0 + B.lat1) / 2, (B.lon0 + B.lon1) / 2, 1) }, // where the atmosphere puts noon (GlobeView)
    };
    swaps = [...CLASSES.map((id) => fills[id]), fills.lakes, ocean].map((mesh) => {
      const flat = mesh.material as THREE.Material;
      return {
        mesh, flat, relief: new THREE.ShaderMaterial({
          uniforms, vertexShader: VERT, fragmentShader: mesh === fills.lakes || mesh === ocean ? WATER_FRAG : landFrag(''),
          defines: mesh === ocean ? { SEA: '' } : { LIFT: '' }, // the map layers ride on the 3D relief, the sea at sea level
          side: mesh === ocean ? THREE.DoubleSide : flat.side, // the sea shell is round the camera when it is low: both faces
          depthWrite: flat.depthWrite, // as the flat one: the ocean sphere writes depth, the map fills don't
        }),
      };
    });
    apply();
    const material = new THREE.ShaderMaterial({ uniforms: { ...uniforms, ...ground?.uniforms }, vertexShader: MESH_VERT, fragmentShader: landGround, defines: ground ? { COVER: '', GROUND: '' } : { COVER: '' } });
    return createReliefMesh(`${import.meta.env.BASE_URL}world/relief-h.webp`, PLANET.radius - 7, B, material).then(({ mesh, texture, heightAt, update }) => {
      done++;
      bindBake(texture, B);
      reliefMesh = mesh; richMat = material; // the lean program shares the rich one's uniforms (the mesh's cell size is among them)
      leanMat = new THREE.ShaderMaterial({ uniforms: material.uniforms, vertexShader: MESH_VERT, fragmentShader: landGround, defines: ground ? { COVER: '', LEAN: '', GROUND: '' } : { COVER: '', LEAN: '' } });
      updateMesh = update;
      bakedHeight = heightAt;
      const uPixel = { value: 0 };
      const rivers = new THREE.Mesh(riverGeometry(world.rivers as Ring[], PLANET.radius - 7, heightAt, world.lakes.flatMap((l) => l.rings as Ring[])), new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uPixel }, vertexShader: RIVER_VERT, fragmentShader: RIVER_FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      rivers.renderOrder = riverLines.renderOrder; rivers.frustumCulled = false;
      rivers.onBeforeRender = syncPixel(uPixel);
      const uIce = { value: new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/ice.jpg`, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.anisotropy = 8; t.needsUpdate = true; }) };
      const wall = new THREE.Mesh(wallGeometry(PLANET.radius - 7), new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uPixel, uIce }, vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, side: THREE.DoubleSide,
      }));
      wall.frustumCulled = false;
      wall.onBeforeRender = syncPixel(uPixel);
      const clouds = new THREE.Mesh(new THREE.SphereGeometry(PLANET.radius + 60e3, 256, 128), new THREE.ShaderMaterial({
        uniforms, vertexShader: VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
      }));
      clouds.renderOrder = 200; // over the map layers and borders
      cloudLayer = clouds;
      object.add(mesh, rivers, wall, townsMesh(uniforms), clouds);
      apply();
    });
  }).catch((e) => console.warn('relief: staying on the flat map,', e));
  return {
    object, ready, progress: () => Math.min(1, done / STEPS), setEnabled(on: boolean) { enabled = on; apply(); },
    /** The land drawn by its lean program (no fine procedural detail, about half the cost per pixel) while true. */
    get lean() { return !!reliefMesh && reliefMesh.material === leanMat; },
    /** Called when a ground texture has arrived, to ask for a frame. */
    set onGround(f: (() => void) | null) { groundChanged = f; },
    set lean(on: boolean) { if (reliefMesh && leanMat && richMat) reliefMesh.material = on ? leanMat : richMat; },
    /** Compiles the lean program now (behind the loading screen), so the first drag on a slow GPU doesn't stall on it. */
    warm(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
      if (!reliefMesh || !leanMat) return;
      const s = new THREE.Scene();
      s.add(new THREE.Mesh(reliefMesh.geometry, leanMat));
      renderer.compile(s, camera);
    },
    /** Height of the drawn ground above sea level (m) under a point; the baked height as raise() lifts it (flat at the 3D sites), without the fine detail. */
    groundAt(p: THREE.Vector3) {
      if (!enabled || !bakedHeight) return 0;
      const n = p.clone().normalize(), km = bakedHeight(THREE.MathUtils.radToDeg(Math.atan2(n.x, n.z)), THREE.MathUtils.radToDeg(Math.asin(n.y)));
      return raisedMetres(km, n.multiplyScalar(PLANET.radius)); // as drawn now
    },
    /** Picks the mesh's detail and the height exaggeration for the camera (`tilt`: radians from straight down); call before each render. */
    update(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, tilt = 0) {
      if (!enabled) return;
      if (object.children.length) { // the 3D relief is up: exaggerate to suit how it is seen
        uExaggeration.value = B.exaggeration * exaggerate(camera.position.length() - PLANET.radius, tilt);
      }
      updateMesh?.(camera, renderer);
      ground?.update(); // loads the ground photos, a layer a frame
      uCloud.value = THREE.MathUtils.smoothstep(camera.position.length() - PLANET.radius, 2000e3, 2500e3); // clear below them
      if (cloudLayer) cloudLayer.visible = uCloud.value >= 0.01;
    },
  };
}
