import world from '../vector-world.json';
import * as THREE from 'three';
import { fillGeometry, fillMesh, inRing, lineGeometry, lineMesh, polygons, syncLines } from './gpuVector';
import { shape, type Bounds, type Ring, type Shape } from './viewLayer';

// Region borders on the globe, highlighted when the region's name is clicked. The polygons come from the Known World
// SVG maps (src/vector-world.json) and are GPU geometry (gpuVector.ts), sharp at every zoom. Hit-testing is
// point-in-polygon on lat/lon.
export interface Region { id: string; name: string; shapes: Shape[]; box: Bounds; center: [number, number]; span: number }

const REGIONS: Region[] = world.regions.map((r) => {
  const shapes = (r.polygons as Ring[]).map(shape);
  const box = { lon0: Infinity, lon1: -Infinity, lat0: Infinity, lat1: -Infinity };
  for (const { box: b } of shapes) {
    box.lon0 = Math.min(box.lon0, b.lon0); box.lon1 = Math.max(box.lon1, b.lon1);
    box.lat0 = Math.min(box.lat0, b.lat0); box.lat1 = Math.max(box.lat1, b.lat1);
  }
  // label spot: area centroid of the biggest ring (the mainland, not an islet)
  let ring0: Ring = shapes[0].ring, best = 0, center: [number, number] = [(box.lat0 + box.lat1) / 2, (box.lon0 + box.lon1) / 2];
  for (const { ring } of shapes) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j], f = xj * yi - xi * yj;
      a += f; cx += (xj + xi) * f; cy += (yj + yi) * f;
    }
    if (Math.abs(a) > best) { best = Math.abs(a); center = [cy / (3 * a), cx / (3 * a)]; ring0 = ring; }
  }
  // width of the area through the centre, in degrees of longitude: the room its name has
  const xs: number[] = [];
  for (let i = 0, j = ring0.length - 1; i < ring0.length; j = i++) {
    const [xi, yi] = ring0[i], [xj, yj] = ring0[j];
    if (yi > center[0] !== yj > center[0]) xs.push(xi + ((center[0] - yi) * (xj - xi)) / (yj - yi));
  }
  xs.sort((p, q) => p - q);
  let span = box.lon1 - box.lon0;
  for (let k = 0; k + 1 < xs.length; k += 2) if (center[1] >= xs[k] && center[1] <= xs[k + 1]) span = xs[k + 1] - xs[k];
  return { id: r.id, name: r.name, shapes, box, center, span };
});
const ALIAS: Record<string, string> = { 'The Vale of Arryn': 'The Vale' };
/** The border region a place name stands for, if the maps have its outline. */
export const regionNamed = (name: string) => REGIONS.find((r) => r.name === (ALIAS[name] ?? name));

const inBox = (b: Bounds, lon: number, lat: number) => lon >= b.lon0 && lon <= b.lon1 && lat >= b.lat0 && lat <= b.lat1;
// Runs on every pointer move: the bounding boxes rule out almost every ring before the point-in-polygon test.
export const regionAt = (lat: number, lon: number) =>
  REGIONS.find((r) => inBox(r.box, lon, lat) && r.shapes.some((s) => inBox(s.box, lon, lat) && inRing(lon, lat, s.ring))) ?? null;

export function createRegions(R: number) {
  const r = R - 6, group = new THREE.Group();
  // no standing border lines: a region's outline shows only while it's selected
  // the selection reuses one fill + outline pair, pointed at the region's cached geometry
  const cache = new Map<string, { fill: THREE.BufferGeometry; line: ReturnType<typeof lineGeometry> }>();
  const geometryOf = (id: string) => {
    let g = cache.get(id);
    if (!g) {
      const rings = REGIONS.find((x) => x.id === id)!.shapes.map((s) => s.ring);
      cache.set(id, (g = { fill: fillGeometry(polygons(rings), r), line: lineGeometry(rings, r, true) }));
    }
    return g;
  };
  // width 0: fill only, so the outline doesn't sit beside the neighbour's border line
  const highlight = (fill: string, opacity: number, stroke: string, width: number, order: number) => {
    const f = fillMesh(new THREE.BufferGeometry(), fill, order, opacity), l = lineMesh(lineGeometry([[[0, 0], [0, 1]]], r, false), stroke, width, order + 1);
    f.visible = l.visible = false;
    // Over the relief, never into it: no depth test, so mountains don't poke through the wash. Both in the transparent pass
    // (the opaque one is drawn first whatever the renderOrder), after the river ribbons and under the clouds (relief.ts, 200).
    for (const m of [f, l]) Object.assign(m.material, { depthTest: false, transparent: true });
    group.add(f);
    if (width) group.add(l);
    let id: string | null = null;
    return {
      get id() { return id; },
      set id(v: string | null) {
        if (v === id) return;
        id = v; f.visible = l.visible = !!v;
        if (v) { const g = geometryOf(v); f.geometry = g.fill; l.geometry = g.line; }
      },
    };
  };
  const selected = highlight('#b3243b', 0.4, '#f6d98a', 5, 190); // burgundy wash, bright gold outline

  return {
    object: group,
    refresh: syncLines,
    set selected(id: string | null) { selected.id = id; },
    get selected() { return selected.id; },
  };
}
