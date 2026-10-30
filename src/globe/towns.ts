import { Q } from '../quality';
import * as THREE from 'three';
import { PLANET } from '../config';
import { enuFrame, toVector } from '../geo';
import { PLACES } from '../world-data';
import { PLACE_SNAP } from '../place-snap';
import { LIFT_GLSL } from './lift';

// Aerial pictures of towns, laid on the relief where the town stands. Each is a patch of the globe (a grid of vertices that
// follow the ground through lift()) with the picture on it, north up, at the size canon allows. A walled town gets the walled
// picture; the village picture is for unwalled places (none has a stated size yet, so TOWNS lists none).
//
// Size: the picture's own walls enclose WALLED_PX px² of its 1402 px width, and the town's walled area is its population over
// the density the repo already uses for King's Landing (config.ts SITES: ~400,000 people in 12.25 sq mi). A population that
// canon only bounds from below gives a lower bound of the size. Canon is silent on the rest of the walled towns' populations,
// so they have no picture (Gulltown, White Harbor, Duskendale, Maidenpool, Stoney Sept).

const SQ_MI = 1609.344 ** 2, DENSITY = 400_000 / (12.25 * SQ_MI); // people per m²
const PICTURE = { walled: { src: 'walled.webp', px: 1402, wallsPx: (Math.PI / 4) * 1115 * 900, aspect: 1122 / 1402 }, village: { src: 'village.webp', px: 1402, wallsPx: 0, aspect: 1122 / 1402 } };

type Town = { name: string; picture: keyof typeof PICTURE; population: number; quote: string };
export const TOWNS: Town[] = [
  { name: 'Oldtown', picture: 'walled', population: 100_000, quote: 'Fire & Blood, Aegon III: King\'s Landing, a city of a hundred thousand souls, "only Oldtown and Lannisport were larger"; the walls: "The greatest city in all of Westeros, Oldtown was ringed about with massive walls"' },
  { name: 'Lannisport', picture: 'walled', population: 100_000, quote: 'Fire & Blood, Aegon III: "only Oldtown and Lannisport were larger" than a hundred thousand; the walls: "built great walls around their city" (World of Ice & Fire)' },
];

const VERT = `#include <common>
#include <logdepthbuf_pars_vertex>
${LIFT_GLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(lift(position) + normalize(position) * 12.0, 1.0);
  #include <logdepthbuf_vertex>
}`;
const FRAG = `#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D tPicture;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  vec4 c = texture2D(tPicture, vUv);
  if (c.a < 0.02) discard;
  gl_FragColor = vec4(c.rgb, c.a);
  #include <colorspace_fragment>
}`;

/** One patch per town with a picture, sharing the relief's uniforms (the lift). */
export function townsMesh(uniforms: Record<string, THREE.IUniform>) {
  const group = new THREE.Group(), loader = new THREE.TextureLoader(), tex: Partial<Record<keyof typeof PICTURE, THREE.Texture>> = {};
  const N = 24; // cells a side: the patch follows the ground at this resolution
  for (const t of TOWNS) {
    const place = PLACES.find((p) => p[0] === t.name);
    if (!place) { console.warn(`towns: no place ${t.name}`); continue; }
    const pic = PICTURE[t.picture], s = Math.sqrt(t.population / DENSITY / pic.wallsPx), w = pic.px * s, h = w * pic.aspect; // m per px, picture size in m
    const [lat, lon] = PLACE_SNAP[t.name] ?? [place[2], place[3]], { east, north } = enuFrame(lat, lon);
    const centre = toVector(lat, lon, PLANET.radius - 7), pos: number[] = [], uv: number[] = [], idx: number[] = [], p = new THREE.Vector3();
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const u = i / N, v = j / N;
      p.copy(centre).addScaledVector(east, (u - 0.5) * w).addScaledVector(north, (0.5 - v) * h).setLength(PLANET.radius - 7);
      pos.push(p.x, p.y, p.z); uv.push(u, 1 - v);
      if (i < N && j < N) { const a = j * (N + 1) + i, b = a + N + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    }
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)).setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)).setIndex(idx);
    const map = (tex[t.picture] ??= loader.load(`${import.meta.env.BASE_URL}towns/${pic.src}`, (x) => { x.colorSpace = THREE.SRGBColorSpace; x.anisotropy = Q.aniso; x.needsUpdate = true; }));
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: { ...uniforms, tPicture: { value: map } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.name = t.name;
    group.add(mesh);
  }
  return group;
}
