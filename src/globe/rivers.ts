import * as THREE from 'three';
import { toVector } from '../geo';
import { LIFT_GLSL } from './lift';
import type { Ring } from './viewLayer';

// Rivers as water, for the 3D relief: each map polyline is smoothed into curves (Chaikin), turned to run downhill on the
// baked height, and drawn as a ribbon that widens from source to mouth. The width is real (metres), so a river grows as
// you zoom in, but never gets thinner than MIN_PX on screen. The water lies at the height of its centre line, so rising
// banks hide its edges; relief.ts's RIVER_FRAG shades it deep in the middle and shallow at the banks.
const MIN_PX = 1.3;
const SOURCE_KM = 0.25, MOUTH_KM = 3; // width at a source, and at the mouth of the longest river

export const chaikin = (pts: Ring, rounds = 3): Ring => {
  for (let k = 0; k < rounds; k++) {
    const out: Ring = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
};

export const RIVER_VERT = `#include <common>
#include <logdepthbuf_pars_vertex>
${LIFT_GLSL}
attribute vec3 dirT; // unit direction of flow
attribute vec3 rib;  // side (-1 left bank, 1 right bank), width (km), distance from the source (km)
uniform float uPixel; // size of a screen pixel at 1 m from the camera
varying vec3 vDir;
varying float vSide, vAlong, vPx;
void main() {
  vDir = normalize(position);
  vec3 c = lift(position); // the water level: the ground under the centre line
  float px = -(modelViewMatrix * vec4(c, 1.0)).z * uPixel, w = max(rib.y * 1000.0, ${MIN_PX.toFixed(1)} * px);
  c += vDir * px * 4.0 * uDisplace / 5.0; // over the coarser far tiles, which cut across valleys
  vSide = rib.x; vAlong = rib.z; vPx = w / px;
  // across the river: flat on the ground once it is a few pixels wide, facing the camera while thin, so seen
  // edge-on far away it doesn't thin out to nothing
  vec3 ground = cross(vDir, dirT), facing = cross(normalize(cameraPosition - c), dirT);
  vec3 across = normalize(mix(facing, ground, smoothstep(2.0, 6.0, vPx)));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(c + across * rib.x * w * 0.5, 1.0);
  #include <logdepthbuf_vertex>
}`;

/** Ribbons for the river polylines at radius r, oriented downhill by `heightAt` (km at lon, lat). */
export function riverGeometry(rivers: Ring[], r: number, heightAt: (lon: number, lat: number) => number) {
  const lines = rivers.filter((l) => l.length > 1).map((l) => {
    const pts = chaikin(l);
    if (heightAt(...pts[0]) < heightAt(...pts[pts.length - 1])) pts.reverse(); // source first
    const xyz = pts.map(([lon, lat]) => toVector(lat, lon, r));
    const s = [0];
    for (let i = 1; i < xyz.length; i++) s.push(s[i - 1] + xyz[i].distanceTo(xyz[i - 1]) / 1000);
    return { xyz, s };
  });
  const longest = Math.max(...lines.map((l) => l.s[l.s.length - 1]));
  const pos: number[] = [], dir: number[] = [], rib: number[] = [], idx: number[] = [], t = new THREE.Vector3();
  for (const { xyz, s } of lines) {
    const len = s[s.length - 1], mouth = SOURCE_KM + (MOUTH_KM - SOURCE_KM) * Math.sqrt(len / longest);
    for (let i = 0; i < xyz.length; i++) {
      t.subVectors(xyz[Math.min(i + 1, xyz.length - 1)], xyz[Math.max(i - 1, 0)]).normalize();
      const w = SOURCE_KM + (mouth - SOURCE_KM) * (s[i] / len) ** 0.7, base = pos.length / 3;
      for (const side of [-1, 1]) { pos.push(...xyz[i].toArray()); dir.push(...t.toArray()); rib.push(side, w, s[i]); }
      if (i) idx.push(base - 2, base - 1, base, base, base - 1, base + 1);
    }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    .setAttribute('dirT', new THREE.Float32BufferAttribute(dir, 3)).setAttribute('rib', new THREE.Float32BufferAttribute(rib, 3)).setIndex(idx);
}

/** Keeps uPixel in step with the camera and canvas. */
export const syncPixel = (u: { value: number }) => (renderer: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera) => {
  u.value = (2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2))) / renderer.getSize(new THREE.Vector2()).y;
};
