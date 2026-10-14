import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSiteScene, type Place, type SiteView } from '../SiteScene';
import { LORE } from './lore';
import { createProceduralWinterfellView } from './procedural';

// Winterfell from "The True Winterfell SE" (the Skyrim port of Shadiversity's model), converted by
// tools/sites/winterfell/import.mjs into public/sites/winterfell. Frame: metres, x = east, y = up, z = south,
// origin at the castle centre, ground there at y ≈ 0. Without the import, the procedural fallback is used.
const DIR = '/sites/winterfell';
type SceneData = {
  terrain: { file: string; cols: number; rows: number; step: number; x0: number; z0: number; scale: number };
  models: { file: string; source: string }[];
  instanceStride: number;
  instances: number[]; // [model, px, py, pz, qx, qy, qz, qw, scale] per placement
};

export async function createWinterfellView(renderer: THREE.WebGLRenderer, labelsEl: HTMLElement): Promise<SiteView> {
  const res = await fetch(`${DIR}/scene.json`);
  if (!res.ok || res.headers.get('content-type')?.includes('html')) return createProceduralWinterfellView(renderer, labelsEl);
  const data: SceneData = await res.json();

  // ---------- terrain ----------
  const T = data.terrain;
  const h = new Int16Array(await (await fetch(`${DIR}/${T.file}`)).arrayBuffer());
  const groundAt = (x: number, z: number) => { // bilinear on the grid; row 0 = north (z0)
    const fx = THREE.MathUtils.clamp((x - T.x0) / T.step, 0, T.cols - 1.001), fz = THREE.MathUtils.clamp((z - T.z0) / T.step, 0, T.rows - 1.001);
    const c = Math.floor(fx), r = Math.floor(fz), tx = fx - c, tz = fz - r, i = r * T.cols + c;
    return ((h[i] * (1 - tx) + h[i + 1] * tx) * (1 - tz) + (h[i + T.cols] * (1 - tx) + h[i + T.cols + 1] * tx) * tz) * T.scale;
  };

  const site = createSiteScene(renderer, labelsEl, {
    id: 'winterfell', sky: 0xc5ced6, shadowExtent: 450, ground: groundAt, labelMaxDistance: 12_000,
    home: { position: new THREE.Vector3(330, 260, 420), target: new THREE.Vector3(0, 10, 0) },
  });
  const { scene } = site;
  scene.add(new THREE.AmbientLight(0xffffff, 1.1)); // Skyrim textures are authored dark for its own lighting

  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1, T.cols - 1, T.rows - 1),
    new THREE.MeshStandardMaterial({ color: 0x6f7552, roughness: 1 }),
  );
  {
    const pos = terrain.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const c = i % T.cols, r = Math.floor(i / T.cols);
      pos.setXYZ(i, T.x0 + c * T.step, h[i] * T.scale, T.z0 + r * T.step);
    }
    terrain.geometry.computeVertexNormals();
    terrain.receiveShadow = true;
  }
  scene.add(terrain);

  // ---------- models: one InstancedMesh per primitive, one instance per placement ----------
  const byModel = new Map<number, THREE.Matrix4[]>();
  const S = data.instanceStride, m4 = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let k = 0; k < data.instances.length; k += S) {
    const d = data.instances, s = d[k + 8];
    const mtx = new THREE.Matrix4().compose(m4.set(d[k + 1], d[k + 2], d[k + 3]), q.set(d[k + 4], d[k + 5], d[k + 6], d[k + 7]), new THREE.Vector3(s, s, s));
    byModel.set(d[k], [...(byModel.get(d[k]) ?? []), mtx]);
  }
  const loader = new GLTFLoader();
  await Promise.all([...byModel].map(async ([mi, mats]) => {
    const model = data.models[mi];
    const gltf = await loader.loadAsync(`${DIR}/${model.file}`);
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const inst = new THREE.InstancedMesh(o.geometry, o.material, mats.length);
      mats.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.castShadow = inst.receiveShadow = true;
      inst.computeBoundingSphere();
      scene.add(inst);
    });
  }));

  // ---------- places (positions of the corresponding mod meshes) ----------
  const P = (name: string, kind: string, x: number, z: number, labelY: number, radius = 40): Place => ({ name, kind, pos: [x, z, labelY], radius });
  const places: Place[] = [
    P('Great Keep', 'keep', -6, 17, 70, 60), P('First Keep', 'keep', 3, -156, 55), P("Maester's Turret", 'tower', 4, -46, 60),
    P('Broken Tower', 'tower', -41, -150, 60), P('Guest House', 'hall', 47, 52, 35), P('East Gate', 'gate', 172, 18, 40, 50),
    P('Heart Tree', 'wood', -63, 130, 35, 30), P('Godswood', 'wood', -90, 110, 45, 90),
  ];
  site.addPlaces(places);

  return Object.assign(site, {
    lore: { ...LORE, 'Guest House': 'Lodging for guests of House Stark within the castle walls.' },
    flyTo(p: Place) {
      site.flyToPoint(new THREE.Vector3(p.pos[0], groundAt(p.pos[0], p.pos[1]) + 10, p.pos[1]), Math.max(140, (p.radius || 40) * 3.5));
    },
  });
}
