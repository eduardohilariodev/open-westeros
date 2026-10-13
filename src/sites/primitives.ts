import * as THREE from 'three';

// Unit geometries (base at y=0) shared by every procedural model; scale them per use.
export const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
export const CYL = new THREE.CylinderGeometry(1, 1, 1, 16).translate(0, 0.5, 0);
export const OCT = new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0);
export const CONE = new THREE.ConeGeometry(1, 1, 16).translate(0, 0.5, 0);
export const DOME = new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
export const TREE = new THREE.IcosahedronGeometry(1, 0);
/** Gable roof prism, ridge along x. */
export const ROOF = (() => {
  const v = [
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
})();

export const UP = new THREE.Vector3(0, 1, 0);

export const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

export function part(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.y = ry;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

export type Instance = { pos: THREE.Vector3; rot: number; scale: THREE.Vector3; color?: number };

export function instanced(geo: THREE.BufferGeometry, m: THREE.Material, items: Instance[]) {
  const mesh = new THREE.InstancedMesh(geo, m, items.length);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, mtx.compose(it.pos, q.setFromAxisAngle(UP, it.rot), it.scale));
    if (it.color !== undefined) mesh.setColorAt(i, c.setHex(it.color));
  });
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}
