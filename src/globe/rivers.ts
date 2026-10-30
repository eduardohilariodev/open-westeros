import * as THREE from 'three';
import type { Ring } from './viewLayer';

// What is left of the river ribbons: the 3D relief's rivers are now the channel the mesh cuts and the shader draws water in,
// from the bake's relief-e map (lift.ts RIVER_GLSL, relief.ts, reliefMesh.ts). The canon polylines still letter the names
// (GlobeView) and are the flat map's lines (terrain.ts), so they are smoothed here.

/** Chaikin corner cutting: each round replaces every segment with its quarter points, so a polyline becomes a curve. */
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

/** Keeps uPixel in step with the camera and canvas (the Wall uses it). */
export const syncPixel = (u: { value: number }) => (renderer: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera) => {
  u.value = (2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2))) / renderer.getSize(new THREE.Vector2()).y;
};
