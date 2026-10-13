import * as THREE from 'three';
import { KNOWN_WORLD as K, METRES_PER_DEGREE, MILE, PLANET, SITES, type SiteId } from './config';

// The Known World map is treated as a plate carrée patch: latitude and longitude are linear in pixels.
// Latitude scale comes from the Wall->Dorne distance; longitude uses the same ground scale at the meridian city.
const pxPerDegLat = (K.dorneCoast.y - K.castleBlack.y) / ((K.wallToDorneMiles * MILE) / METRES_PER_DEGREE);
export const latAt = (y: number) => K.castleBlack.lat - (y - K.castleBlack.y) / pxPerDegLat;
const pxPerDegLon = pxPerDegLat * Math.cos(THREE.MathUtils.degToRad(latAt(K.meridian.y)));
export const lonAt = (x: number) => K.meridian.lon + (x - K.meridian.x) / pxPerDegLon;

/** Ground metres per source pixel of the Known World map (same in both axes near the meridian). */
export const metresPerMapPixel = METRES_PER_DEGREE / pxPerDegLat;

export const KNOWN_WORLD_BOUNDS = {
  west: lonAt(K.crop),
  east: lonAt(K.source.width - K.crop),
  north: latAt(K.crop),
  south: latAt(K.source.height - K.crop),
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
