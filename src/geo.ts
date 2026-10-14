import * as THREE from 'three';
import { PLANET, SITES, type SiteId } from './config';
import { PLACES } from './world-data';

/** Where a site's place sits on the map. */
export const siteLatLon = (id: SiteId) => {
  const [, , lat, lon] = PLACES.find((p) => p[0] === SITES[id].name)!;
  return { lat, lon };
};

/** A lat/lon patch of a sphere of radius r. SphereGeometry's phi=0 points at -X; our longitude 0 faces +Z, hence the +90° offset. */
export const latLonPatch = (r: number, b: { west: number; east: number; south: number; north: number }, wSeg: number, hSeg: number) => {
  const rad = THREE.MathUtils.degToRad;
  return new THREE.SphereGeometry(r, wSeg, hSeg, rad(b.west) + Math.PI / 2, rad(b.east - b.west), Math.PI / 2 - rad(b.north), rad(b.north - b.south));
};

/** Planet-centred position: +Y = north pole, longitude 0 faces +Z, east is +X there. */
export function toVector(lat: number, lon: number, r = PLANET.radius, out = new THREE.Vector3()) {
  const p = THREE.MathUtils.degToRad(lat), l = THREE.MathUtils.degToRad(lon);
  return out.set(r * Math.cos(p) * Math.sin(l), r * Math.sin(p), r * Math.cos(p) * Math.cos(l));
}

/** Local east/north/up frame at a point on the surface. Site scenes use x = east, y = up, z = south. */
export function enuFrame(lat: number, lon: number) {
  const up = toVector(lat, lon, 1);
  return { origin: up.clone().multiplyScalar(PLANET.radius), ...eastNorth(up), up };
}

/** East and north unit vectors at a surface direction `up`. */
export function eastNorth(up: THREE.Vector3) {
  const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
  return { east, north: up.clone().cross(east) };
}
