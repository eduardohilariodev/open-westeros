import * as THREE from 'three';
import { L0, LCC_N, MAX_MATERIALS, Q, RF, RHO0 } from './groundMap';

// Ground textures for the land (Poly Haven, CC0; tools/world/ground-fetch.mjs fetches them and writes
// public/textures/ground/manifest.json). The world is textured at every height, from orbit down, like satellite imagery: each
// photo is tiled at fixed sizes in the world (1 m, 16 m, 256 m ... each 16x the last) and a level fades in only as zooming makes
// its detail big enough to resolve, so the pattern never changes, it just gains resolution. It is a look, not a scale. The
// shader divides each level's photo by its mean colour and multiplies the baked biome colour by that (the lore palette stays),
// pulls the hue a little towards the photo's, and bends the hillshade's normal by its normal map.
// The 512 px layers of all materials load in the background as soon as the relief is drawn.

type Entry = { id: string; env: string; role: string; name: string; metres: number; mean: number[]; authors: string[]; url: string };
const SIZE = 512, FADE = 0.8; // px of a layer; s to fade a new material in

export async function loadGround() {
  const base = `${import.meta.env.BASE_URL}textures/ground/`;
  const manifest: Entry[] = await fetch(`${base}manifest.json`).then((r) => { if (!r.ok) throw new Error(`ground manifest: ${r.status}`); return r.json(); });
  if (manifest.length > MAX_MATERIALS) throw new Error('ground: too many materials');

  const dummy = () => { const t = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1); t.needsUpdate = true; return t; };
  const uniforms = {
    tG: { value: dummy() }, tGN: { value: dummy() },
    uGMean: { value: Array.from({ length: MAX_MATERIALS }, (_, i) => new THREE.Vector3(...(manifest[i]?.mean ?? [1, 1, 1]))) },
    uGReady: { value: new Array<number>(MAX_MATERIALS).fill(0) }, // 1 once the layer is in
    uGOn: { value: 0 },
  };

  const array = (colour: boolean) => {
    const t = new THREE.DataArrayTexture(new Uint8Array(SIZE * SIZE * 4 * manifest.length), SIZE, SIZE, manifest.length);
    t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace; // the photo's colour comes out linear
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8;
    return t;
  };
  let layers: [THREE.DataArrayTexture, THREE.DataArrayTexture] | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  const pixels = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    ctx ??= new OffscreenCanvas(SIZE, SIZE).getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
    bmp.close();
    return ctx.getImageData(0, 0, SIZE, SIZE).data;
  };

  const target = new Array<number>(MAX_MATERIALS).fill(0); // 1 once a layer is in; uGReady eases up to it
  const linear = (v: number) => ((v / 255 + 0.055) / 1.055) ** 2.4;
  /** The photo's mean in linear light (the sampler returns linear; the manifest's is sRGB), from every 16th pixel. */
  const meanOf = (d: Uint8ClampedArray) => { const m = [0, 0, 0]; let n = 0; for (let p = 0; p < d.length; p += 64, n++) for (let c = 0; c < 3; c++) m[c] += linear(d[p + c]); return m.map((v) => v / n); };
  let next = 0, busy = false, last = performance.now();
  const api = {
    uniforms, manifest,
    /** Called when a layer has arrived: the render loop is idle until something asks for a frame. */
    onChange: null as (() => void) | null,
    /** GLSL consts naming each material's layer (M_<id>), for the shader's environment rules. */
    glsl: manifest.map((m, i) => `#define M_${m.id} ${i}`).join('\n'),
    /** Loads the next layer, one at a time, and fades the arrivals in over FADE s; called every frame. */
    update() {
      const now = performance.now(), step = Math.min(0.1, (now - last) / 1000) / FADE;
      last = now;
      let fading = false;
      for (let i = 0; i < manifest.length; i++) {
        const r = uniforms.uGReady.value, to = target[i];
        if (r[i] !== to) { r[i] = to > r[i] ? Math.min(to, r[i] + step) : Math.max(to, r[i] - step); fading = true; }
      }
      if (fading) api.onChange?.(); // keep drawing until they are in
      if (busy || next >= manifest.length) return;
      busy = true;
      const i = next++, id = manifest[i].id;
      Promise.all([pixels(`${base}${id}_diff_512.jpg`), pixels(`${base}${id}_nor_512.jpg`)]).then(([d, n]) => {
        layers ??= [array(true), array(false)];
        uniforms.tG.value = layers[0]; uniforms.tGN.value = layers[1];
        const stride = SIZE * SIZE * 4;
        (layers[0].image.data as Uint8Array).set(d, i * stride); (layers[1].image.data as Uint8Array).set(n, i * stride);
        layers[0].addLayerUpdate(i); layers[1].addLayerUpdate(i);
        layers[0].needsUpdate = layers[1].needsUpdate = true;
        uniforms.uGMean.value[i].set(...(meanOf(d) as [number, number, number]));
        target[i] = 1; uniforms.uGOn.value = 1;
      }).catch((e) => console.warn(`ground: ${id} stays unloaded,`, e)) // a failed layer is not retried
        .finally(() => { busy = false; api.onChange?.(); });
    },
  };
  return api;
}

export type Ground = Awaited<ReturnType<typeof loadGround>>;

/** The fragment shader's side: samples one material at the scale the pixel calls for, and (relief.ts) picks the
 * environment's two materials. Expects the vertex shader's vG (m from the node origin), vGo (the origin, mod Q) and vZ (the
 * drawn height, m): see reliefMesh.ts. */
export const GROUND_FRAG_GLSL = (g: Ground) => `
#ifdef GROUND
uniform sampler2DArray tG, tGN;              // 512 px photo and normal per material
uniform float uGReady[${MAX_MATERIALS}], uGOn, uDisplace, uPeaks;
uniform vec3 uGMean[${MAX_MATERIALS}];
varying vec2 vG, vGo;
varying float vZ;
const float G_Q = ${Q}.0, G_N = ${LCC_N.toFixed(9)}, G_L0 = ${L0.toFixed(9)}, G_RF = ${RF.toFixed(1)}, G_RHO0 = ${RHO0.toFixed(1)};
${g.glsl}
// The cone's grid at this pixel, in metres, from the direction alone: float32 is good to about a metre here, enough for tiles of kilometres.
vec2 gAbs() {
  float rho = G_RF * exp(-G_N * atanh(clamp(vDir.y, -0.999999, 0.999999))), th = G_N * (atan(vDir.x, vDir.z) - G_L0);
  return vec2(rho * sin(th), G_RHO0 - rho * cos(th));
}
// The tile coordinate for tiles of T metres (a power of two up to 2^14 divides G_Q, so the node's origin reduces without a seam).
vec2 gTile(float T, vec2 abs0) { return T <= 8192.0 ? fract(vGo / T) + vG / T : abs0 / T; }
// A material at the ground as detail levels fixed in the world, like satellite imagery's: the photo tiled at 1 m, 16 m, 256 m,
// 4 km, 64 km and so on, each at its own fixed offset. A level shows (weight 1) while its tile is between about 22 and 500 pixels
// wide, fades in as zooming makes it big enough to resolve (from 3 px) and out once it is too coarse to matter (from 500 px to
// 4000), so zooming only ever fades finer detail in over the same pattern and nothing is swapped. Up to three levels are live at
// once. ratio is what the biome colour is multiplied by (photo / its mean, each level's, at contrast); nrm the photo's normals
// summed (grid x, y). gd and gz are the pixel derivatives of vG and vZ. On a steep face (side 1) the photo is laid on the wall
// instead of the plan, which would smear it: across the face by the grid's x and y planes, weighted by wall, and up by vZ.
void groundTex(int m, vec4 gd, vec2 gz, float side, vec2 wall, out vec3 ratio, out vec2 nrm) {
  float lp = log2(max(max(length(gd.xy), length(gd.zw)), 1e-3)), m0 = ceil((lp + 1.5) / 4.0), layer = float(m);
  vec2 ab = 4.0 * (m0 + 2.0) > 13.0 ? gAbs() : vec2(0.0);
  ratio = vec3(1.0); nrm = vec2(0.0);
  for (int i = 0; i < 3; i++) {
    float mm = m0 + float(i), T = exp2(4.0 * mm), d = 4.0 * mm - lp;
    float w = smoothstep(1.5, 4.5, d) * (1.0 - smoothstep(9.0, 12.0, d)) * uGReady[m];
    if (w < 0.01) continue;
    vec2 off = fract(sin(vec2(12.9898, 78.233) * mm) * 43758.5453); // this level's own, fixed
    vec2 u = gTile(T, ab) + off, uv = vec2(u.x, -u.y), dx = vec2(gd.x, -gd.y) / T, dy = vec2(gd.z, -gd.w) / T;
    vec3 c = textureGrad(tG, vec3(uv, layer), dx, dy).rgb;
    vec2 n = textureGrad(tGN, vec3(uv, layer), dx, dy).xy * 2.0 - 1.0;
    if (side > 0.02) { // the wall: up the face by height, across it by whichever grid axis the face runs along
      float z = fract(vZ / T);
      vec2 ax = gTile(T, ab);
      vec3 wx = textureGrad(tG, vec3(vec2(ax.x, -z) + off, layer), vec2(gd.x, -gz.x) / T, vec2(gd.z, -gz.y) / T).rgb;
      vec3 wy = textureGrad(tG, vec3(vec2(ax.y, -z) + off, layer), vec2(gd.y, -gz.x) / T, vec2(gd.w, -gz.y) / T).rgb;
      c = mix(c, wall.x * wx + wall.y * wy, side);
      n *= 1.0 - side;
    }
    ratio *= mix(vec3(1.0), pow(clamp(c / uGMean[m], 0.3, 2.6), vec3(1.5)), w);
    nrm += n * w;
  }
  nrm *= 0.7;
}
// Two materials of one environment blended by w: the biome colour's multiplier, the normal, the photos' mean and how much to
// show. Each is sampled only where its weight is above a few percent.
void groundMix(int m1, int m2, float w, vec4 gd, vec2 gz, float side, vec2 wall, out vec3 ratio, out vec2 nrm, out vec3 mean, out float vis) {
  vec2 n1 = vec2(0.0), n2 = vec2(0.0); vec3 r1 = vec3(1.0), r2 = vec3(1.0);
  if (w < 0.98) groundTex(m1, gd, gz, side, wall, r1, n1);
  if (w > 0.02) groundTex(m2, gd, gz, side, wall, r2, n2);
  ratio = mix(r1, r2, w); nrm = mix(n1, n2, w); mean = mix(uGMean[m1], uGMean[m2], w); vis = mix(uGReady[m1], uGReady[m2], w);
}
#endif`;
