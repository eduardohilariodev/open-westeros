import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { SITES, type SiteId } from '../config';
import { siteLatLon, toVector } from '../geo';
import { lifted } from './lift';
import { shape, type Ring } from './viewLayer';

// Vector layers as GPU geometry: polygons are triangulated once and draped on the sphere, outlines are screen-width lines.
// Nothing is rasterised, so edges stay sharp at every zoom and moving the camera never redraws anything.
// Layers only depth-test against the ocean sphere (which lies below them) and are drawn in renderOrder, so they never z-fight.

// Triangle edges are split so their chords stay on the sphere (a chord of e degrees dips ~R·e²/8): at most 0.6° (~90 m) across
// the map, finer towards the 3D sites, where the map must meet their flat ground within a metre or so.
const sites = (Object.keys(SITES) as SiteId[]).map(siteLatLon);
const edgeLimit = (lon: number, lat: number) => {
  let d = Infinity;
  for (const s of sites) d = Math.min(d, Math.hypot((lon - s.lon) * Math.cos(THREE.MathUtils.degToRad(lat)), lat - s.lat));
  return Math.min(0.6, 0.03 + 0.2 * d); // degrees
};

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
    return d / edgeLimit((a.x + b.x) / 2, lat);
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
