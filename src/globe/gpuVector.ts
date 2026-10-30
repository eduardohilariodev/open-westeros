import { Q } from '../quality';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { PLANET } from '../config';
import { toVector } from '../geo';
import { lifted } from './lift';
import { shape, type Ring } from './viewLayer';

// Vector layers as GPU geometry: polygons are triangulated once and draped on the sphere, outlines are screen-width lines.
// Nothing is rasterised, so edges stay sharp at every zoom and moving the camera never redraws anything.
// Layers only depth-test against the ocean sphere (which lies below them) and are drawn in renderOrder, so they never z-fight.

// Triangle edges are split so their chords stay on the sphere (a chord of e degrees dips ~R·e²/8): at most 0.6° (~90 m) across
// the map, plenty from the 400 km floor (docs/decisions/0003).
const EDGE_LIMIT = 0.6; // degrees

export const inRing = (lon: number, lat: number, ring: Ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Loose rings (outlines and holes together, any winding) -> polygons [outline, ...holes], by nesting depth. */
export function polygons(rings: Ring[]): Ring[][] {
  const info = rings.map((ring) => {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    return { ring, area: Math.abs(a), box: shape(ring).box, parent: -1, depth: 0 };
  });
  info.forEach((c, i) => info.forEach((p, j) => {
    const [x, y] = c.ring[0];
    if (j === i || p.area <= c.area || x < p.box.lon0 || x > p.box.lon1 || y < p.box.lat0 || y > p.box.lat1 || !inRing(x, y, p.ring)) return;
    c.depth++;
    if (c.parent < 0 || p.area < info[c.parent].area) c.parent = j;
  }));
  const out = new Map<number, Ring[]>();
  info.forEach((c, i) => { if (c.depth % 2 === 0) out.set(i, [c.ring]); });
  info.forEach((c) => { if (c.depth % 2 === 1) out.get(c.parent)?.push(c.ring); });
  return [...out.values()];
}

/** Triangles of the polygons on a sphere of radius r. */
export function fillGeometry(polys: Ring[][], r: number) {
  const out: number[] = [], v = new THREE.Vector3();
  // how much an edge exceeds its allowed length (> 1: split it). The limit depends only on where the edge is, so
  // both triangles sharing it agree and no cracks open.
  const over = (a: THREE.Vector2, b: THREE.Vector2) => {
    const lat = (a.y + b.y) / 2, d = Math.hypot((b.x - a.x) * Math.cos(THREE.MathUtils.degToRad(lat)), b.y - a.y);
    return d / EDGE_LIMIT;
  };
  const emit = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) => {
    const stack = [[a, b, c]];
    while (stack.length) {
      const [p, q, s] = stack.pop()!, e = [over(p, q), over(q, s), over(s, p)], m = e.indexOf(Math.max(...e));
      if (e[m] <= 1) { for (const t of [p, q, s]) out.push(...toVector(t.y, t.x, r, v).toArray()); continue; }
      // split the worst edge at its midpoint
      const [u, w, x] = m === 0 ? [p, q, s] : m === 1 ? [q, s, p] : [s, p, q], mid = new THREE.Vector2((u.x + w.x) / 2, (u.y + w.y) / 2);
      stack.push([u, mid, x], [mid, w, x]);
    }
  };
  for (const poly of polys) {
    const rings = poly.map((ring) => ring.map(([lon, lat]) => new THREE.Vector2(lon, lat)));
    const faces = THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1)); // trims the closing duplicates in place
    const pts = rings.flat();
    for (const [a, b, c] of faces) emit(pts[a], pts[b], pts[c]);
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
}

/** Rings (or open polylines) as line segments at radius r. */
export function lineGeometry(rings: Ring[], r: number, close: boolean) {
  const out: number[] = [], a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const ring of rings) {
    const n = close ? ring.length : ring.length - 1;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
      out.push(...toVector(y0, x0, r, a).toArray(), ...toVector(y1, x1, r, b).toArray());
    }
  }
  return new LineSegmentsGeometry().setPositions(out);
}

export const fillMesh = (geometry: THREE.BufferGeometry, color: string, order: number, opacity = 1) => {
  const m = new THREE.Mesh(geometry, lifted(new THREE.MeshBasicMaterial({
    color, opacity, transparent: opacity < 1, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  })));
  m.renderOrder = order; m.frustumCulled = false;
  return m;
};

const lineMats: LineMaterial[] = [];
export const lineMesh = (geometry: LineSegmentsGeometry, color: string, width: number, order: number, opacity = 1) => {
  const material = lifted(new LineMaterial({ color, linewidth: width, opacity, transparent: opacity < 1, depthWrite: false, toneMapped: false }));
  lineMats.push(material);
  const l = new LineSegments2(geometry, material);
  l.renderOrder = order; l.frustumCulled = false;
  return l;
};
/** Line widths are in screen pixels, so the materials need the viewport size. Cheap; call every frame. */
export const syncLines = () => lineMats.forEach((m) => m.resolution.set(innerWidth, innerHeight));

// ---------- paper: the flat map's land is printed on aged paper ----------
// One photo of paper (public/textures/paper.jpg) read at three scales from the ground's own lon/lat, so it follows the globe at any
// zoom: blotches ~1,800 km across, mottling ~300 km, grain ~35 km, each turned its own way. Only its lightness is used (1 = no change), and only the middle
// of the photo, folded back and forth, so its dark edges and the tile seams never show.
const PAPER = { uPaper: { value: null as THREE.Texture | null }, uPaperOn: { value: 0 } };
new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/paper.jpg`, (t) => {
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Q.aniso;
  PAPER.uPaper.value = t; PAPER.uPaperOn.value = 1;
});
const PAPER_GLSL = `
uniform sampler2D uPaper; uniform float uPaperOn; varying vec3 vP;
vec2 foldUv(vec2 x) { return 0.15 + 0.7 * abs(fract(x * 0.5) * 2.0 - 1.0); }
// each scale is turned its own way and its folds bent by a slow wobble, so no straight seams line up into a grid
float paperL(vec2 uv, float ang) {
  uv = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * uv;
  uv += 0.25 * vec2(sin(uv.y * 1.9 + ang), sin(uv.x * 1.3 - ang));
  return dot(texture2D(uPaper, foldUv(uv)).rgb, vec3(0.2126, 0.7152, 0.0722)) / 0.41 - 1.0; // 0.41: the photo's mean lightness
}
float paperFactor(vec3 p) {
  if (uPaperOn < 0.5) return 1.0;
  vec3 d = normalize(p);
  vec2 a = vec2(atan(d.x, d.z), asin(clamp(d.y, -1.0, 1.0))) ; // radians; the photo is square
  float R = ${(PLANET.radius / 1000).toFixed(1)}; // km per radian
  return 1.0 + paperL(a * R / 1800.0, 0.4) * 0.34 + paperL(a * R / 300.0, 1.1) * 0.2 + paperL(a * R / 35.0, 2.3) * 0.12;
}`;
/** The mesh's material also takes the paper's lightness (a MeshBasicMaterial: a lifted fill, or the ocean sphere). */
export const papered = <T extends THREE.Mesh>(m: T) => {
  const mat = m.material as THREE.MeshBasicMaterial, prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (s, r) => {
    prev?.call(mat, s, r); // the ocean sphere is not lifted: no hook before ours
    Object.assign(s.uniforms, PAPER);
    s.vertexShader = s.vertexShader.replace('void main() {', 'varying vec3 vP;\nvoid main() {').replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = transformed;');
    s.fragmentShader = s.fragmentShader.replace('void main() {', `${PAPER_GLSL}\nvoid main() {`).replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= paperFactor(vP);');
  };
  mat.customProgramCacheKey = () => 'paper';
  return m;
};
