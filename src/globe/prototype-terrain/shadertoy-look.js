// PROTOTYPE, throwaway. The image pass of "Advanced Terrain Erosion Filter" by Rune Skovbo Johansen (https://www.shadertoy.com/view/wXcfWn,
// MPL-2.0; the terrain rendering is derived from Fewes, https://www.shadertoy.com/view/7ljcRW), adapted to read our float buffer
// (R height km, G ridge map 0..1, B erosion 0..1, A unused) instead of its packed Buffer A. Heights are remapped into the Shadertoy's
// 0.37..0.66 range so its water level, grass line, snow line and strata box work unchanged; the lake level comes from a height quantile.
export const FS_D = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uBuf;
uniform vec2 uRes;
uniform float uHmin, uHmax, uBufRes, uWater, uRel;
uniform vec3 uCam;          // yaw pitch dist
uniform sampler2D uV, uC;   // relief-v: biome albedo; relief-c: canopy, moisture, snow (the globe's own bakes)
uniform vec4 uBounds;       // lon0 lon1 lat0 lat1 of those bakes
uniform vec3 uCenter;       // lat lon windowKm
uniform float uBiome, uSat;      // 1 = colour by biome, 0 = the Shadertoy's fixed greens
in vec2 vUv; out vec4 o;

#define PI 3.14159265358979
#define clamp01(x) clamp(x, 0.0, 1.0)
#define sq(x) ((x)*(x))
#define M_GROUND 0
#define M_STRATA 1
#define M_WATER  2
#define CLIFF_COLOR    vec3(0.22, 0.2, 0.2)
#define DIRT_COLOR     vec3(0.6, 0.5, 0.4)
#define TREE_COLOR     vec3(0.12, 0.26, 0.1)
#define GRASS_COLOR1   vec3(0.15, 0.3, 0.1)
#define GRASS_COLOR2   vec3(0.4, 0.5, 0.2)
#define SAND_COLOR     vec3(0.8, 0.7, 0.6)
#define WATER_COLOR vec3(0.0, 0.05, 0.1)
#define WATER_SHORE_COLOR vec3(0.0, 0.25, 0.25)
#define SUN_COLOR (vec3(1.0, 0.98, 0.95) * 2.0)
#define AMBIENT_COLOR (vec3(0.3, 0.5, 0.7) * 0.1)
#define WATER_HEIGHT uWater
#define GRASS_HEIGHT 0.465
#define DRAINAGE_WIDTH 0.3
#define RAYMARCH_QUALITY 2.0
#define C_RAYLEIGH (vec3(5.802, 13.558, 33.100) * 1e-6)
#define C_MIE (vec3(3.996,  3.996,  3.996) * 1e-6)

vec2 hash(in vec2 x) { const vec2 k = vec2(0.3183099, 0.3678794); x = x * k + k.yx; return -1.0 + 2.0 * fract(16.0 * k * fract(x.x * x.y * (x.x + x.y))); }
vec3 noised(in vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0), du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = hash(i), gb = hash(i + vec2(1.0, 0.0)), gc = hash(i + vec2(0.0, 1.0)), gd = hash(i + vec2(1.0, 1.0));
  float va = dot(ga, f), vb = dot(gb, f - vec2(1.0, 0.0)), vc = dot(gc, f - vec2(0.0, 1.0)), vd = dot(gd, f - vec2(1.0, 1.0));
  return vec3(va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd),
    ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * (va - vb - vc + vd) + vec2(vb, vc) - va));
}
vec2 boxIntersection(in vec3 ro, in vec3 rd, vec3 boxSize, out vec3 outNormal) {
  vec3 m = 1.0 / rd, n = m * ro, k = abs(m) * boxSize, t1 = -n - k, t2 = -n + k;
  float tN = max(max(t1.x, t1.y), t1.z), tF = min(min(t2.x, t2.y), t2.z);
  if (tN > tF || tF < 0.0) return vec2(-1.0);
  outNormal = -sign(rd) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
  return vec2(tN, tF);
}
vec3 SkyColor(vec3 rd, vec3 sun) { float costh = dot(rd, sun); return AMBIENT_COLOR * PI * (1.0 - abs(costh) * 0.8); }
vec3 Tonemap_ACES(vec3 x) { return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); }
float pow5(float x) { float x2 = x * x; return x2 * x2 * x; }
float D_GGX(float linearRoughness, float NoH, const vec3 h) { float oneMinusNoHSquared = 1.0 - NoH * NoH; float a = NoH * linearRoughness; float k = linearRoughness / (oneMinusNoHSquared + a * a); return k * k * (1.0 / PI); }
float V_SmithGGXCorrelated(float linearRoughness, float NoV, float NoL) { float a2 = linearRoughness * linearRoughness; float GGXV = NoL * sqrt((NoV - a2 * NoV) * NoV + a2); float GGXL = NoV * sqrt((NoL - a2 * NoL) * NoL + a2); return 0.5 / (GGXV + GGXL); }
vec3 F_Schlick(const vec3 f0, float VoH) { return f0 + (vec3(1.0) - f0) * pow5(1.0 - VoH); }
float F_Schlick(float f0, float f90, float VoH) { return f0 + (f90 - f0) * pow5(1.0 - VoH); }
float Fd_Burley(float linearRoughness, float NoV, float NoL, float LoH) { float f90 = 0.5 + 2.0 * linearRoughness * LoH * LoH; return F_Schlick(1.0, f90, NoL) * F_Schlick(1.0, f90, NoV) * (1.0 / PI); }
float Fd_Lambert() { return 1.0 / PI; }
vec3 Shade(vec3 diffuse, vec3 f0, float smoothness, vec3 n, vec3 v, vec3 l, vec3 lc) {
  vec3 h = normalize(v + l);
  float NoV = abs(dot(n, v)) + 1e-5, NoL = clamp01(dot(n, l)), NoH = clamp01(dot(n, h)), LoH = clamp01(dot(l, h));
  float roughness = 1.0 - smoothness, linearRoughness = roughness * roughness;
  vec3 Fr = (D_GGX(linearRoughness, NoH, h) * V_SmithGGXCorrelated(linearRoughness, NoV, NoL)) * F_Schlick(f0, LoH);
  vec3 Fd = diffuse * Fd_Burley(linearRoughness, NoV, NoL, LoH);
  return (Fd + Fr) * lc * NoL;
}
float PhaseRayleigh(float costh) { return 3.0 * (1.0 + costh * costh) / (16.0 * PI); }
float PhaseMie(float costh, float g) { g = min(g, 0.9381); float k = 1.55 * g - 0.55 * g * g * g; float kcosth = k * costh; return (1.0 - k * k) / ((4.0 * PI) * (1.0 - kcosth) * (1.0 - kcosth)); }

// ----- map access: our buffer, heights remapped into the Shadertoy's range -----
vec2 toRelief(vec2 muv) { // buffer uv -> the bakes' uv, as the filter pass does
  vec2 km = (muv - 0.5) * uCenter.z;
  float lat = uCenter.x + km.y / 120.57, lon = uCenter.y + km.x / (120.57 * cos(radians(uCenter.x)));
  return vec2((lon - uBounds.x) / (uBounds.y - uBounds.x), (uBounds.w - lat) / (uBounds.w - uBounds.z));
}
float Hn(float hkm) { return 0.37 + uRel * (hkm - uHmin) / max(uHmax - uHmin, 1e-4); }
vec2 GetUV(vec3 p) { return clamp(vec2(p.x + 0.5, 0.5 - p.z), 0.004, 0.996); }
float mapHeight(vec2 uv) { vec4 b = texture(uBuf, uv); return Hn(b.r + (b.a > 0.0002 ? b.a : 0.0)); } // a river's water surface sits above its carved bed
vec4 breakupTex(vec2 uv) { vec3 c = vec3(0.0); float a = 0.5, f = 2.0; for (int i = 0; i < 8; i++) { c += noised(uv * f) * a; a *= 0.95; f *= 2.0; } return vec4(c, 1.0); }
float GetTreesAmount(float height, float normalY, float occlusion, float ridgeMap) {
  return ((smoothstep(GRASS_HEIGHT + 0.05, GRASS_HEIGHT + 0.01, height + 0.01 + (occlusion - 0.8) * 0.05) * smoothstep(0.0, 0.4, occlusion)
    * smoothstep(0.95, 1.0, normalY) * smoothstep(-1.4, 0.0, ridgeMap) * smoothstep(WATER_HEIGHT, WATER_HEIGHT + 0.007, height)) - 0.5) / 0.6;
}
vec4 map(vec2 uv, out float erosion, out float ridgemap, out float trees, out float debug) {
  vec4 b = texture(uBuf, uv);
  float height = Hn(b.r), e = 1.0 / uBufRes;
  float h1 = mapHeight(uv + vec2(e, 0.0)), h2 = mapHeight(uv + vec2(0.0, e));
  vec3 v1 = vec3(e, 0.0, h1 - height), v2 = vec3(0.0, e, h2 - height);
  vec3 normal = normalize(cross(v1, v2)).xzy;   // (x east, y up, z north in uv); flip z below for our box
  erosion = b.b * 2.0 - 1.0; ridgemap = b.g;
  vec2 deriv = vec2(h1 - height, h2 - height) / e;
  float normalY = 1.0 / sqrt(1.0 + dot(deriv, deriv));
  float treesAmount = GetTreesAmount(height, normalY, erosion * 0.5 + 0.5, ridgemap * 2.0 - 1.0);
  trees = (1.0 - pow(noised((uv + 0.5) * 200.0).x * 0.5 + 0.5, 2.0) - 1.0 + treesAmount) * 1.5;
  debug = 0.0;
  return vec4(height, normal.x, normal.y, -normal.z);
}

vec3 boxSize = vec3(0.5, 1.0, 0.5);
float march(vec3 ro, vec3 rd, out vec3 normal, out int material, out float s_t) {
  s_t = 9999.0;
  vec3 boxNormal; vec2 box = boxIntersection(ro - vec3(0.0, 0.5, 0.0), rd, vec3(0.5, 0.5, 0.5), boxNormal); // the box spans y 0..1 (the original's top is also 1)
  float tStart = max(0.0, box.x) + 1e-2, tEnd = box.y - 1e-2;
  material = M_GROUND;
  float stepSize = 0.0, stepScale = 1.0 / RAYMARCH_QUALITY, t = tStart, altitude = 0.0;
  int samples = int(48.0 * RAYMARCH_QUALITY);
  for (int i = 0; i < 96; i++) {
    if (i >= samples) break;
    vec3 pos = ro + rd * t;
    altitude = pos.y - mapHeight(GetUV(pos));
    s_t = max(0.0, min(s_t, altitude / t));
    if (altitude < 0.0) {
      if (i < 1) { if (pos.y < 0.35) { s_t = 9999.0; return -1.0; } normal = boxNormal; material = M_STRATA; break; }
      stepScale *= 0.5; t -= stepSize * stepScale;
    } else { stepSize = abs(altitude) + min(1e-2, abs(altitude) * 0.01); t += stepSize * stepScale; }
  }
  vec3 waterNormal; vec2 water = boxIntersection(ro - vec3(0.0, WATER_HEIGHT * 0.5, 0.0), rd, vec3(boxSize.x, WATER_HEIGHT * 0.5, boxSize.z), waterNormal);
  if ((water.y > 0.0 && (water.x < t || t < 0.0)) && material != M_STRATA) { t = max(0.0, water.x); normal = waterNormal; material = M_WATER; }
  if (box.y < 0.0) { s_t = 9999.0; return -1.0; }
  if (t > tEnd) return -1.0;
  return t;
}
vec3 GetReflection(vec3 p, vec3 r, vec3 sun, float smoothness) {
  vec3 refl = SkyColor(r, sun) * 4.0, foo; float r_t; int r_material;
  march(p, r, foo, r_material, r_t);
  return refl * (1.0 - exp(-r_t * 10.0 * sq(smoothness)));
}

void main() {
  vec2 suv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float yaw = uCam.x, pitch = uCam.y;
  vec3 lookAt = vec3(0.0, 0.40, 0.0), ro = lookAt + uCam.z * vec3(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw));
  vec3 fw = normalize(lookAt - ro), rt = normalize(cross(fw, vec3(0, 1, 0))), up = cross(rt, fw);
  vec3 rd = normalize(fw + (suv.x * rt + suv.y * up) * 0.2);
  vec3 foo, normal; int material;
  float t = march(ro, rd, normal, material, foo.x);
  vec3 sun = normalize(vec3(-1.0, 0.4, 0.05));
  vec3 fogColor = 1.0 - exp(-SkyColor(rd, sun) * 2.0), color;
  if (t < 0.0) {
    color = fogColor * (1.0 + pow(vUv.y, 3.0) * 3.0) * 0.5;
  } else {
    vec3 pos = ro + rd * t;
    float erosion, ridgemap, trees, debug;
    vec2 muv = GetUV(pos);
    vec4 mapData = map(muv, erosion, ridgemap, trees, debug);
    float drainage = clamp01((1.0 - clamp01(ridgemap / DRAINAGE_WIDTH)) * 1.5), diff = pos.y - mapData.x;
    vec4 bt = breakupTex(muv); float breakup = bt.x;
    if (material == M_WATER) { normal.xz += bt.zy * 0.1; normal = normalize(normal); }
    vec3 f0 = vec3(0.04); float smoothness = 0.0, occlusion = 1.0;
    vec3 r = reflect(rd, normal), diffuseColor = vec3(0.5);
    if (material == M_GROUND) {
      normal = mapData.yzw;
      occlusion = clamp01(erosion + 0.5);
      // biome: albedo and canopy of the vegetation map, through a ~1 km wobble so the ~8 km bake pixels do not show as blocks
      vec2 ruv = toRelief(muv + noised(muv * 9.0).yz * 0.02);
      vec3 biomeC = texture(uV, ruv).rgb; vec3 cnp = texture(uC, ruv).rgb; // canopy, moisture, snow
      vec3 dirtC = DIRT_COLOR, grass1 = GRASS_COLOR1, grass2 = GRASS_COLOR2, treeC = TREE_COLOR; float treeK = 1.0;
      if (uBiome > 0.5) {
        // pull the biomes apart: saturate around the colour's own grey, then warm and yellow where dry, cool and green where wet
        biomeC = max(mix(vec3(dot(biomeC, vec3(0.3, 0.59, 0.11))), biomeC, uSat), 0.0);
        biomeC *= mix(vec3(1.18, 1.04, 0.72), vec3(0.8, 1.06, 0.88), smoothstep(0.1, 0.9, cnp.g));
        dirtC = mix(DIRT_COLOR, biomeC, 0.45);
        grass1 = biomeC * 0.78; grass2 = biomeC * 1.12;
        treeC = biomeC * vec3(0.6, 0.75, 0.55);
        treeK = smoothstep(0.0, 0.45, cnp.r);                  // no trees in deserts and tundra, thick in rainforest
      }
      diffuseColor = CLIFF_COLOR * smoothstep(0.4, 0.52, pos.y);
      diffuseColor = mix(diffuseColor, dirtC, smoothstep(0.6, 0.0, occlusion + breakup * 1.5));
      diffuseColor = mix(diffuseColor, vec3(1.0), smoothstep(0.53, 0.6, pos.y + breakup * 0.1));
      diffuseColor = mix(diffuseColor, SAND_COLOR, smoothstep(WATER_HEIGHT + 0.005, WATER_HEIGHT, pos.y + breakup * 0.01));
      vec3 grassMix = mix(grass1, grass2,smoothstep(0.4, 0.6, pos.y - erosion * 0.05 + breakup * 0.3));
      diffuseColor = mix(diffuseColor, grassMix, smoothstep(GRASS_HEIGHT + 0.05, GRASS_HEIGHT + 0.02, pos.y + 0.01 + (occlusion - 0.8) * 0.05 - breakup * 0.02)
        * smoothstep(0.8, 1.0, 1.0 - (1.0 - normal.y) * (1.0 - trees) + breakup * 0.1));
      diffuseColor = mix(diffuseColor, treeC * pow(max(trees, 0.0), 8.0), clamp01(trees * 2.2 - 0.8) * 0.6 * treeK);
      if (uBiome > 0.5) diffuseColor = mix(diffuseColor, vec3(0.9), cnp.b * smoothstep(0.6, 0.9, normal.y) * 0.8); // snow cover of cold biomes
      diffuseColor *= 1.0 + breakup * 0.5;
      diffuseColor = mix(diffuseColor, vec3(1.0), drainage * 0.0); // the drainage lines of the original are off: rivers are drawn as water
      float wd = texture(uBuf, muv).a;
      if (wd > 0.0002) { // canon river (relief-e corridor): depth-tinted water with foam at the banks, as the Shadertoy's lakes
        float shoreR = exp(-wd * 260.0), foamR = smoothstep(0.0012, 0.0, wd + breakup * 0.0005);
        diffuseColor = mix(mix(WATER_COLOR, WATER_SHORE_COLOR, shoreR), vec3(1.0), foamR * 0.6);
        smoothness = 0.95; normal = normalize(vec3(0.0, 1.0, 0.0) + vec3(bt.z, 0.0, bt.y) * 0.05); occlusion = 1.0;
      }
    } else if (material == M_STRATA) {
      vec3 strata = smoothstep(0.0, 1.0, cos(diff * vec3(130.0, 190.0, 250.0)));
      diffuseColor = mix(mix(mix(vec3(0.3), vec3(0.50), strata.x), vec3(0.55), strata.y), vec3(0.60), strata.z);
      diffuseColor *= exp(diff * 10.0) * vec3(1.0, 0.9, 0.7);
    } else {
      float shore = normal.y > 1e-2 ? exp(-diff * 60.0) : 0.0;
      float foam = normal.y > 1e-2 ? smoothstep(0.005, 0.0, diff + breakup * 0.005) : 0.0;
      diffuseColor = mix(mix(WATER_COLOR, WATER_SHORE_COLOR, shore), vec3(1.0), foam);
      smoothness = 0.95;
    }
    float shadow = 1.0;
    if (material != M_STRATA) { float s_t; int s_material; march(pos + vec3(0.0, 1.0, 0.0) * 1e-4, sun, foo, s_material, s_t); shadow = 1.0 - exp(-s_t * 20.0); }
    color = diffuseColor * SkyColor(normal, sun) * Fd_Lambert();
    color *= occlusion;
    color += Shade(diffuseColor, f0, smoothness, normal, -rd, sun, SUN_COLOR * shadow);
    color += diffuseColor * SUN_COLOR * (dot(normal, sun * vec3(1.0, -1.0, 1.0)) * 0.5 + 0.5) * Fd_Lambert() / PI;
    color += GetReflection(pos, r, sun, smoothness) * F_Schlick(f0, dot(-rd, normal));
  }
  // atmosphere (the original's single-scattering loop)
  vec3 boxNormal; vec2 box = boxIntersection(ro - vec3(0.0, 0.5, 0.0), rd, vec3(0.5, 0.5, 0.5), boxNormal);
  float costh = dot(rd, sun), phaseR = PhaseRayleigh(costh), phaseM = PhaseMie(costh, 0.6);
  vec2 od = vec2(0.0); vec3 tsm = vec3(1.0), sct = vec3(0.0);
  float rayLength = (t > 0.0 ? t : box.y) - box.x, stepSize = rayLength / 16.0;
  for (float i = 0.0; i < 16.0; i++) {
    vec3 p = ro + rd * (box.x + (i + 0.5) * stepSize);
    float h = max(0.0, p.y - 0.35), d = 1.0 - clamp01(h / 0.2);
    if (p.y < 0.35) d = 0.0;
    float densityR = d * 5e4, densityM = d * 5e4;
    od += stepSize * vec2(densityR, densityM);
    tsm = exp(-(od.x * C_RAYLEIGH + od.y * C_MIE));
    sct += tsm * C_RAYLEIGH * phaseR * densityR * stepSize + tsm * C_MIE * phaseM * densityM * stepSize;
  }
  color = color * tsm + sct * 3.0;
  color = pow(Tonemap_ACES(color), vec3(1.0 / 2.2));
  o = vec4(color, 1.0);
}`;
