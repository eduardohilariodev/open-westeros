import world from '../vector-world.json';
import terrainData from '../terrain.json';
import roadData from '../roads.json'; // tools/blog/roads-trace.mjs
import * as THREE from 'three';
import { fillGeometry, fillMesh, lineGeometry, lineMesh, polygons, syncLines } from './gpuVector';
import type { Ring } from './viewLayer';
import { chaikin } from './rivers';
import { wallLine } from './wallLine';

// The vector map: sea, land, lakes and rivers from the Known World SVG maps (src/vector-world.json), with terrain (plains,
// forest, swamp, desert, hills, mountains, snow) from src/terrain.json and the roads from src/roads.json, as GPU geometry draped on the planet. The layers are
// drawn bottom to top by renderOrder and sit 7 m under the surface, just below the ground of the 3D sites.
export const TERRAIN_SEA = 0x0f2f4c;
// Parchment and gold on a deep teal sea, illuminated-manuscript style, drawn bottom to top.
const TERRAIN: [id: string, fill: string, stroke?: string][] = [
  ['desert', '#d4b06a'], ['hills', '#c9b483'], ['mountains', '#b39a68', '#6b5a3a'], ['forest', '#4f7a70'], ['swamp', '#6f8a72'], ['snow', '#f1ead6'],
];
const LAND = '#d8c79a', WATER = '#' + TERRAIN_SEA.toString(16).padStart(6, '0'), COAST = '#b8954f', RIVER = '#1f5552', ROAD = '#f0d9a0', ROAD_CASING = '#2a1a08', WALL = '#5fa3c0';

const ROAD_LIT = '#e02020';
const ROAD_LIFT = 350; // m above the baked ground
/** The line with a vertex at least every `step` degrees (~3.5 km). */
const dense = (pts: Ring, step = 0.03): Ring => pts.flatMap((a, i) => {
  if (!i) return [a];
  const b = pts[i - 1], n = Math.max(1, Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1]) / step));
  return Array.from({ length: n }, (_, k): [number, number] => [b[0] + ((a[0] - b[0]) * (k + 1)) / n, b[1] + ((a[1] - b[1]) * (k + 1)) / n]);
});

/**
 * A track as a country lane: densified, then pushed sideways by a few sines of varying wavelength (phases seeded from its end
 * points, so it is the same every load), fading to nothing at both ends so it still meets its place and its road.
 * ponytail: amplitude is degrees, not metres (a lane drifts ~0.8 km at most), and the coast is not rechecked; shrink AMP if one wades.
 */
const AMP = 0.007;
const wiggle = (pts: Ring): Ring => {
  const d = dense(pts, 0.01), n = d.length - 1;
  if (n < 3) return d;
  const seed = Math.abs(Math.sin(d[0][0] * 12.9898 + d[0][1] * 78.233 + d[n][0] * 3.1 + d[n][1] * 7.7)) * 6283;
  const len = d.reduce((s, p, i) => s + (i ? Math.hypot(p[0] - d[i - 1][0], p[1] - d[i - 1][1]) : 0), 0);
  let run = 0;
  return d.map((p, i): [number, number] => {
    if (i) run += Math.hypot(p[0] - d[i - 1][0], p[1] - d[i - 1][1]);
    const a = d[Math.max(0, i - 1)], b = d[Math.min(n, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
    const t = run / len, fade = Math.sin(Math.PI * t) ** 0.5; // 0 at the ends, ~1 along the middle
    const w = (Math.sin(run * 70 + seed) * 0.75 + Math.sin(run * 170 + seed * 1.7) * 0.25) * AMP * fade;
    return [p[0] - (ty / tl) * w, p[1] + (tx / tl) * w];
  });
};

const terrainPolys =new Map<string, Ring[][]>(); // class -> polygons [outline, ...holes]
for (const f of terrainData.features) {
  const polys = (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]) as unknown as Ring[][];
  terrainPolys.set(f.properties.c, [...(terrainPolys.get(f.properties.c) ?? []), ...polys]);
}

export function createTerrain(R: number) {
  const r = R - 7, group = new THREE.Group();
  let order = 1;
  const add = <T extends THREE.Object3D>(o: T) => (group.add(o), o);
  // fills by class ('land' and 'lakes' included), class outlines and rivers, for relief.ts and the look lab to restyle
  const fills: Record<string, THREE.Mesh> = { land: add(fillMesh(fillGeometry(polygons(world.land as Ring[]), r), LAND, order++)) };
  const strokes: THREE.Object3D[] = [];
  for (const [id, fill, stroke] of TERRAIN) {
    const polys = terrainPolys.get(id) ?? [];
    fills[id] = add(fillMesh(fillGeometry(polys, r), fill, order++));
    if (stroke) strokes.push(add(lineMesh(lineGeometry(polys.flat(), r, true), stroke, 0.9, order++)));
  }
  // coast lines belong to the flat map only: in relief the shoreline is the terrain itself (relief.ts hides `strokes`)
  strokes.push(add(lineMesh(lineGeometry(world.land as Ring[], r, true), COAST, 1.2, order++)));
  // the Wall, on the line of the 3D mesh (wall.ts); like the coast, flat map only: in relief the mesh stands there
  strokes.push(add(lineMesh(lineGeometry([dense(chaikin(wallLine()))], r, false), WALL, 2.4, order++)));
  const lakeRings = world.lakes.flatMap((l) => l.rings as Ring[]);
  fills.lakes = add(fillMesh(fillGeometry(world.lakes.flatMap((l) => polygons(l.rings as Ring[])), r), WATER, order++));
  strokes.push(add(lineMesh(lineGeometry(lakeRings, r, true), COAST, 1, order++)));
  const rivers = add(lineMesh(lineGeometry(world.rivers as Ring[], r, false), RIVER, 1.1, order++));
  // The relief lifts a line at its vertices only, so the road is cut into short pieces to follow the heights between them, and
  // rides ROAD_LIFT above the baked ground to stay clear of the mesh's finer detail.
  const roadLines = lineGeometry((roadData.roads.map((l) => l.pts) as Ring[]).map((l) => dense(l)), r + ROAD_LIFT, false);
  // a dark edge under a light line, so the road reads on forest and parchment alike (both opaque: translucent lines draw after opaque ones)
  const roads = add(new THREE.Group().add(lineMesh(roadLines, ROAD_CASING, 3, order++), lineMesh(roadLines, ROAD, 1.4, order++)));
  // the tracks from places to the main roads: thinner, and kept to closer views
  const trackLines = lineGeometry((roadData.minor.map((l) => l.pts) as Ring[]).map(wiggle), r + ROAD_LIFT, false);
  const tracks = add(new THREE.Group().add(lineMesh(trackLines, ROAD_CASING, 2.2, order++), lineMesh(trackLines, ROAD, 1, order++)));
  // the road picked by its name: its whole length, lit over the network
  const lit = add(new THREE.Group());
  lit.visible = false;
  /** Light the given road (lon/lat points), or none. */
  const highlight = (pts: Ring | null) => {
    lit.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
    lit.clear();
    lit.visible = !!pts;
    if (!pts) return;
    const g = lineGeometry([dense(pts)], r + ROAD_LIFT, false);
    // drawn last and without the depth test, so close in the relief's own heights never hide it
    for (const [color, width, top] of [[ROAD_CASING, 6, 1], [ROAD_LIT, 3.4, 2]] as const) {
      const m = lineMesh(g, color, width, 10_000 + top);
      (m.material as THREE.Material).depthTest = false;
      lit.add(m);
    }
  };
  return { object: group, refresh: syncLines, fills, strokes, rivers, roads, tracks, highlight };
}
