import world from '../vector-world.json';
import terrainData from '../terrain.json';
import * as THREE from 'three';
import { fillGeometry, fillMesh, lineGeometry, lineMesh, polygons, syncLines } from './gpuVector';
import type { Ring } from './viewLayer';

// The vector map: sea, land, lakes and rivers from the Known World SVG maps (src/vector-world.json), with terrain (plains,
// forest, swamp, desert, hills, mountains, snow) from src/terrain.json, as GPU geometry draped on the planet. The layers are
// drawn bottom to top by renderOrder and sit 7 m under the surface, just below the ground of the 3D sites.
export const TERRAIN_SEA = 0x0f2f4c;
// Parchment and gold on a deep teal sea, illuminated-manuscript style, drawn bottom to top.
const TERRAIN: [id: string, fill: string, stroke?: string][] = [
  ['desert', '#d4b06a'], ['hills', '#c9b483'], ['mountains', '#b39a68', '#6b5a3a'], ['forest', '#4f7a70'], ['swamp', '#6f8a72'], ['snow', '#f1ead6'],
];
const LAND = '#d8c79a', WATER = '#' + TERRAIN_SEA.toString(16).padStart(6, '0'), COAST = '#b8954f', RIVER = '#1f5552';

const terrainPolys = new Map<string, Ring[][]>(); // class -> polygons [outline, ...holes]
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
  add(lineMesh(lineGeometry(world.land as Ring[], r, true), COAST, 1.2, order++));
  const lakeRings = world.lakes.flatMap((l) => l.rings as Ring[]);
  fills.lakes = add(fillMesh(fillGeometry(world.lakes.flatMap((l) => polygons(l.rings as Ring[])), r), WATER, order++));
  add(lineMesh(lineGeometry(lakeRings, r, true), COAST, 1, order++));
  const rivers = add(lineMesh(lineGeometry(world.rivers as Ring[], r, false), RIVER, 1.1, order++));
  return { object: group, refresh: syncLines, fills, strokes, rivers };
}
