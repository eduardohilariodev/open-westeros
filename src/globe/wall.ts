import * as THREE from 'three';
import { METRES_PER_DEGREE, MILE } from '../config';
import { toVector } from '../geo';
import { LIFT_GLSL } from './lift';
import { chaikin } from './rivers';
import type { Ring } from './viewLayer';

// The Wall, in 3D on the relief: 300 miles long, 700 ft (213 m) of ice, ~540 ft at the foot tapering to ~60 ft on top
// (300 ft on average), raised by the relief's own exaggeration so it stands up as the hills do. Its line is traced off
// the canon map of the Gift (pixels of a 632×333 crop, north up), read at one true scale that makes it 300 miles, about
// Eastwatch where the maps put it by the sea. The castles along it are placed off the same drawing.
const HEIGHT_M = 213, BASE_M = 165, TOP_M = 18, SINK_M = 300; // SINK: how far the foot goes under the ground
const MIN_PX = 2.5; // never narrower than this on screen
const LINE: [number, number][] = [ // the foot of the Wall on the drawing, west to east: the Gorge to the Bay of Seals
  [22, 228], [45, 215], [70, 198], [100, 184], [130, 173], [165, 164], [200, 159], [240, 156], [280, 153], [315, 151],
  [360, 151], [420, 151], [480, 150], [530, 153], [548, 156],
];
const EASTWATCH = { x: 530, y: 153, lat: 62.11, lon: -5.47 };
const M_PER_PX = (300 * MILE) / LINE.slice(1).reduce((s, [x, y], i) => s + Math.hypot(x - LINE[i][0], y - LINE[i][1]), 0);

/** A pixel of the drawing -> [lon, lat] on the globe, at true distance from Eastwatch. */
export const drawingAt = ([x, y]: [number, number]): [number, number] => {
  const lat = EASTWATCH.lat + ((EASTWATCH.y - y) * M_PER_PX) / METRES_PER_DEGREE;
  return [EASTWATCH.lon + ((x - EASTWATCH.x) * M_PER_PX) / (METRES_PER_DEGREE * Math.cos(THREE.MathUtils.degToRad(lat))), lat];
};

/** The Wall's line on the globe, [lon, lat]. */
export const wallLine = (): Ring => LINE.map(drawingAt);

// The nineteen castles, west to east. Westwatch, the Shadow Tower, Castle Black and Eastwatch sit at their points of the
// drawing (LINE[0], [1], [9], [13]); the rest are spaced evenly along the Wall between them.
const CASTLES = ['Westwatch-by-the-Bridge', 'Shadow Tower', 'Sentinel Stand', 'Greyguard', 'Stonedoor', 'Hoarfrost Hill', 'Icemark', 'The Nightfort',
  'Deep Lake', 'Queensgate', 'Castle Black', 'Oakenshield', 'Woodswatch-by-the-Pool', 'Sable Hall', 'Rimegate', 'Long Barrow', 'The Torches', 'Eastwatch-by-the-Sea'];
const FIXED: Record<string, number> = { 'Westwatch-by-the-Bridge': 0, 'Shadow Tower': 1, 'Castle Black': 9, 'Eastwatch-by-the-Sea': 13 };
const ARC = LINE.reduce((a, [x, y], i) => (a.push(i ? a[i - 1] + Math.hypot(x - LINE[i - 1][0], y - LINE[i - 1][1]) : 0), a), [] as number[]);
const onLine = (s: number): [number, number] => {
  const i = Math.max(1, ARC.findIndex((a) => a >= s)), t = (s - ARC[i - 1]) / (ARC[i] - ARC[i - 1]);
  return [LINE[i - 1][0] + t * (LINE[i][0] - LINE[i - 1][0]), LINE[i - 1][1] + t * (LINE[i][1] - LINE[i - 1][1])];
};

/** [lat, lon] of each castle on the Wall, by name. */
export const WALL_CASTLES: Record<string, [number, number]> = {};
{
  const fixed = CASTLES.map((n, i) => [i, FIXED[n]] as const).filter(([, k]) => k !== undefined);
  for (let f = 0; f < fixed.length - 1; f++) {
    const [i0, k0] = fixed[f], [i1, k1] = fixed[f + 1];
    for (let i = i0; i <= i1; i++) {
      const [lon, lat] = drawingAt(onLine(ARC[k0] + ((ARC[k1] - ARC[k0]) * (i - i0)) / (i1 - i0)));
      WALL_CASTLES[CASTLES[i]] = [+lat.toFixed(3), +lon.toFixed(3)];
    }
  }
}

export const WALL_VERT = `#include <common>
#include <logdepthbuf_pars_vertex>
${LIFT_GLSL}
attribute vec3 dirT; // unit direction along the Wall
attribute vec3 wall; // side (-1 south face, 1 north face), top (0 foot, 1 crest), facing (-1, 1 the faces, 0 the crest)
uniform float uPixel;
varying vec3 vDir, vN;
void main() {
  vDir = normalize(position);
  // the ground as the relief mesh has it: baked height plus the detail a mesh about 6 px fine shows here
  vec2 uv = vec2((degrees(atan(vDir.x, vDir.z)) - uBounds.x) / (uBounds.y - uBounds.x), (uBounds.w - degrees(asin(clamp(vDir.y, -1.0, 1.0)))) / (uBounds.w - uBounds.z));
  float px = -(modelViewMatrix * vec4(position, 1.0)).z * uPixel, base = baseHeight(uv);
  vec3 c = raise(position, base + detailH(vDir, base, px * 6e-3));
  float w = mix(max(${BASE_M.toFixed(1)}, ${MIN_PX.toFixed(1)} * px), max(${TOP_M.toFixed(1)}, ${MIN_PX.toFixed(1)} * px), wall.y); // the crest too stays a few px wide from above
  vec3 across = cross(dirT, vDir); // north for a Wall running east
  vN = wall.z == 0.0 ? vDir : normalize(across * wall.z + vDir * 0.35);
  c += across * wall.x * w * 0.5 + vDir * mix(-${SINK_M.toFixed(1)}, ${HEIGHT_M.toFixed(1)}, wall.y) * uDisplace;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(c, 1.0);
  #include <logdepthbuf_vertex>
}`;

/** The Wall as a long tapered prism at radius r: two faces and the crest, about a vertex a kilometre. */
export function wallGeometry(r: number) {
  const smooth = chaikin(wallLine()).map(([lon, lat]) => toVector(lat, lon, r)), xyz: THREE.Vector3[] = [];
  for (let i = 0; i < smooth.length - 1; i++) {
    const n = Math.ceil(smooth[i].distanceTo(smooth[i + 1]) / 1000);
    for (let k = 0; k < n; k++) xyz.push(smooth[i].clone().lerp(smooth[i + 1], k / n));
  }
  xyz.push(smooth[smooth.length - 1]);
  // per point: south face foot, crest; crest south, north; north face crest, foot. Each face its own pair, so its own normal.
  const CORNERS = [[-1, 0, -1], [-1, 1, -1], [-1, 1, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]];
  const pos: number[] = [], dir: number[] = [], wall: number[] = [], idx: number[] = [], t = new THREE.Vector3();
  xyz.forEach((p, i) => {
    t.subVectors(xyz[Math.min(i + 1, xyz.length - 1)], xyz[Math.max(i - 1, 0)]).normalize();
    for (const c of CORNERS) { pos.push(...p.toArray()); dir.push(...t.toArray()); wall.push(...c); }
    if (i) for (let f = 0; f < 6; f += 2) {
      const a = (i - 1) * 6 + f, b = i * 6 + f;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  });
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    .setAttribute('dirT', new THREE.Float32BufferAttribute(dir, 3)).setAttribute('wall', new THREE.Float32BufferAttribute(wall, 3)).setIndex(idx);
}
