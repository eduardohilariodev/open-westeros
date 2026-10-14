import world from '../vector-world.json';
import terrainData from '../terrain.json';
import * as THREE from 'three';
import { fillGeometry, fillMesh, lineGeometry, lineMesh, polygons, syncLines } from './gpuVector';
import type { Ring } from './viewLayer';

// The vector map: sea, land, lakes and rivers from the Known World SVG maps (src/vector-world.json), with terrain (plains,
// forest, swamp, desert, hills, mountains, snow) from src/terrain.json, as GPU geometry draped on the planet. The layers are
// drawn bottom to top by renderOrder and sit 7 m under the surface, just below the ground of the 3D sites.
export const TERRAIN_SEA = 0xaadaff;
// Google-Maps-like flat colours, drawn bottom to top.
const TERRAIN: [id: string, fill: string, stroke?: string][] = [
  ['desert', '#f2e2b5'], ['hills', '#dccdac'], ['mountains', '#bfa98c', '#a8927a'], ['forest', '#a9cf94'], ['swamp', '#8fc3ad'], ['snow', '#ffffff'],
];
const LAND = '#f1efe2', WATER = '#' + TERRAIN_SEA.toString(16), COAST = '#8fb3d1', RIVER = '#7fb6e0';

const terrainPolys = new Map<string, Ring[][]>(); // class -> polygons [outline, ...holes]
for (const f of terrainData.features) {
  const polys = (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]) as unknown as Ring[][];
  terrainPolys.set(f.properties.c, [...(terrainPolys.get(f.properties.c) ?? []), ...polys]);
}

export function createTerrain(R: number) {
  const r = R - 7, group = new THREE.Group();
  let order = 1;
  const add = (...o: THREE.Object3D[]) => o.forEach((x) => group.add(x));
  add(fillMesh(fillGeometry(polygons(world.land as Ring[]), r), LAND, order++));
  for (const [id, fill, stroke] of TERRAIN) {
    const polys = terrainPolys.get(id) ?? [];
    add(fillMesh(fillGeometry(polys, r), fill, order++));
    if (stroke) add(lineMesh(lineGeometry(polys.flat(), r, true), stroke, 0.9, order++));
  }
  add(lineMesh(lineGeometry(world.land as Ring[], r, true), COAST, 1.2, order++));
  const lakeRings = world.lakes.flatMap((l) => l.rings as Ring[]);
  add(fillMesh(fillGeometry(world.lakes.flatMap((l) => polygons(l.rings as Ring[])), r), WATER, order++));
  add(lineMesh(lineGeometry(lakeRings, r, true), COAST, 1, order++));
  add(lineMesh(lineGeometry(world.rivers as Ring[], r, false), RIVER, 1.1, order++));
  return { object: group, refresh: syncLines };
}
