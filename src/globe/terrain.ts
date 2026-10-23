import world from '../vector-world.json';
import terrainData from '../terrain.json';
import roadData from '../roads.json'; // tools/blog/roads-trace.mjs
import * as THREE from 'three';
import { fillGeometry, fillMesh, lineGeometry, lineMesh, papered, polygons, syncLines } from './gpuVector';
import type { Ring } from './viewLayer';
import { chaikin } from './rivers';
import { wallLine } from './wallLine';

// The vector map: sea, land, lakes and rivers from the Known World SVG maps (src/vector-world.json), with terrain (plains,
// forest, swamp, desert, hills, mountains, snow) from src/terrain.json and the roads from src/roads.json, as GPU geometry draped on the planet. The layers are
// drawn bottom to top by renderOrder and sit 7 m under the surface, just below the ground of the 3D sites.
export const TERRAIN_SEA = 0x12181c;
// Weathered parchment and gold on a dark teal-charcoal sea (the Game of Thrones map, darkened to sit with the interface), drawn bottom to top.
const TERRAIN: [id: string, fill: string, stroke?: string][] = [
  ['desert', '#c8984f'], ['hills', '#b4a070'], ['mountains', '#9a8860', '#4a3320'], ['forest', '#486a5e'], ['swamp', '#5c7867'], ['snow', '#dcd8c6'],
];
const LAND = '#c7b27c', WATER = '#' + TERRAIN_SEA.toString(16).padStart(6, '0'), COAST = '#7a5428', RIVER = '#3b6f97', ROAD = '#f0d9a0', ROAD_CASING = '#2a1a08', WALL = '#1f160d';

// The flat map is inked like an old chart: sepia lines (coast, rivers, mountains, roads) on parchment, roads with a pale halo.
const INK = '#4a3320', HALO = '#ead7a4';
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
  const fills: Record<string, THREE.Mesh> = { land: add(papered(fillMesh(fillGeometry(polygons(world.land as Ring[]), r), LAND, order++))) };
  const strokes: THREE.Object3D[] = [];
  for (const [id, fill, stroke] of TERRAIN) {
    const polys = terrainPolys.get(id) ?? [];
    fills[id] = add(papered(fillMesh(fillGeometry(polys, r), fill, order++)));
    if (stroke) strokes.push(add(lineMesh(lineGeometry(polys.flat(), r, true), stroke, 0.9, order++)));
  }
  // coast lines belong to the flat map only: in relief the shoreline is the terrain itself (relief.ts hides `strokes`)
  strokes.push(add(lineMesh(lineGeometry(world.land as Ring[], r, true), COAST, 1.2, order++)));
  // the Wall, on the line of the 3D mesh (wall.ts); like the coast, flat map only: in relief the mesh stands there
  strokes.push(add(lineMesh(lineGeometry([dense(chaikin(wallLine()))], r, false), WALL, 5, order++)));
  const lakeRings = world.lakes.flatMap((l) => l.rings as Ring[]);
  fills.lakes = add(papered(fillMesh(fillGeometry(world.lakes.flatMap((l) => polygons(l.rings as Ring[])), r), WATER, order++)));
  strokes.push(add(lineMesh(lineGeometry(lakeRings, r, true), COAST, 1, order++)));
  const rivers = add(lineMesh(lineGeometry(world.rivers as Ring[], r, false), RIVER, 2, order++));
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
    // Drawn last and without the depth test, so the relief's heights never hide it. It is in the transparent pass: the opaque
    // pass comes first whatever the renderOrder, and the river ribbons (relief.ts), clouds and atmosphere are all transparent.
    for (const [color, width, top] of [[ROAD_CASING, 6, 1], [ROAD_LIT, 3.4, 2]] as const) {
      const m = lineMesh(g, color, width, 10_000 + top);
      Object.assign(m.material, { depthTest: false, transparent: true });
      lit.add(m);
    }
  };
  /** Roads and tracks: heavier ink with a pale halo on the flat map, the light road with a dark edge over the relief. */
  const restyle = (flat: boolean) => {
    // [halo width, line width] px: on the flat map a road is as heavy as a river (2)
    const widths = flat ? { roads: [3.6, 2], tracks: [2.6, 1.4] } : { roads: [3, 1.4], tracks: [2.2, 1] };
    for (const [name, g] of [['roads', roads], ['tracks', tracks]] as const) {
      const [casing, line] = (g.children as THREE.Mesh[]).map((m) => m.material as THREE.Material & { color: THREE.Color; linewidth: number });
      casing.color.set(flat ? HALO : ROAD_CASING); line.color.set(flat ? INK : ROAD);
      [casing.linewidth, line.linewidth] = widths[name];
    }
  };
  // roads and tracks fade in and out with the height (fadeRoads), so they are drawn in the transparent pass from the start
  const roadMeshes = [roads, tracks].map((g) => g.children as THREE.Mesh[]);
  for (const m of roadMeshes.flat()) (m.material as THREE.Material).transparent = true;
  /** Roads (or tracks) at opacity f: hidden at 0. */
  const fadeRoads = (which: 'roads' | 'tracks', f: number) => {
    const g = which === 'roads' ? roads : tracks;
    g.visible = f > 0.002;
    for (const m of g.children as THREE.Mesh[]) (m.material as THREE.Material).opacity = f;
  };
  /** The flat map's river lines are thin from high up and reach full weight (2 px) from 600 km down. */
  const setRiverWidth = (alt: number) => {
    const f = THREE.MathUtils.clamp(Math.log(6_000_000 / Math.max(alt, 1)) / Math.log(6_000_000 / 600_000), 0, 1);
    (rivers.material as THREE.Material & { linewidth: number }).linewidth = 0.7 + 1.3 * f;
  };
  return { object: group, restyle, setRiverWidth, fadeRoads, refresh: syncLines, fills, strokes, rivers, roads, tracks, highlight };
}
