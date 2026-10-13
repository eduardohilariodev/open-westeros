import * as THREE from 'three';
import { ATLAS_MAP as M, KNOWN_WORLD as K, METRES_PER_DEGREE, PLANET, SITES, type SiteId } from './config';
import { ATLAS_FIT, PAINTED_FIT as F } from './world-data';

// Both source maps are treated as plate carrée patches (latitude and longitude linear in pixels). Their placement is a
// consensus of the painted map's and the atlas map's own georeferences — see tools/world/consensus.mjs.
export const latAt = (y: number) => F.latPerPx * y + F.lat0;
export const lonAt = (x: number) => F.lonPerPx * x + F.lon0;

/** Ground metres per source pixel of the Known World map (same in both axes near the meridian). */
export const metresPerMapPixel = METRES_PER_DEGREE * Math.abs(F.latPerPx);

export const KNOWN_WORLD_BOUNDS = {
  west: lonAt(K.crop),
  east: lonAt(K.source.width - K.crop),
  north: latAt(K.crop),
  south: latAt(K.source.height - K.crop),
};

export const ATLAS_BOUNDS = {
  west: ATLAS_FIT.lonPerPx * M.crop + ATLAS_FIT.lon0,
  east: ATLAS_FIT.lonPerPx * (M.source.width - M.crop) + ATLAS_FIT.lon0,
  north: ATLAS_FIT.latPerPx * M.crop + ATLAS_FIT.lat0,
  south: ATLAS_FIT.latPerPx * (M.source.height - M.crop) + ATLAS_FIT.lat0,
};

export const siteLatLon = (id: SiteId) => ({ lat: latAt(SITES[id].map.y), lon: lonAt(SITES[id].map.x) });

/** Planet-centred position: +Y = north pole, longitude 0 faces +Z, east is +X there. */
export function toVector(lat: number, lon: number, r = PLANET.radius, out = new THREE.Vector3()) {
  const p = THREE.MathUtils.degToRad(lat), l = THREE.MathUtils.degToRad(lon);
  return out.set(r * Math.cos(p) * Math.sin(l), r * Math.sin(p), r * Math.cos(p) * Math.cos(l));
}

/** Local east/north/up frame at a point on the surface. Site scenes use x = east, y = up, z = south. */
export function enuFrame(lat: number, lon: number) {
  const up = toVector(lat, lon, 1);
  const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
  const north = up.clone().cross(east);
  return { origin: up.clone().multiplyScalar(PLANET.radius), east, north, up };
}
