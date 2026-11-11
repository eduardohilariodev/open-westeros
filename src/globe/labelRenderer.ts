import type { Camera, Object3D, Scene } from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

/**
 * CSS2DRenderer that does nothing when nothing it draws has changed. It writes only display, transform and z-index, which depend on
 * the camera, the window and each label object's visibility and position, so those are compared with the last render. While
 * the camera moves the z-order sort (every label's z-index by distance, only ever decides overlaps) runs every 8th render and
 * once more when it settles.
 */
export function createLabelRenderer(element: HTMLElement) {
  const r = new CSS2DRenderer({ element }), base = r.render.bind(r);
  let prev: number[] = [], cur: number[] = [], frame = 0, sortPending = true;
  const collect = (o: Object3D) => {
    if (o.visible === false) { cur.push(0); return; }
    if ((o as unknown as { isCSS2DObject?: boolean }).isCSS2DObject) { const e = o.matrixWorld.elements; cur.push(1, e[12], e[13], e[14]); }
    for (const c of o.children) collect(c);
  };
  r.render = (scene: Scene, camera: Camera) => {
    if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld();
    if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld();
    const { width, height } = r.getSize();
    cur.length = 0;
    cur.push(width, height, ...camera.matrixWorld.elements, ...camera.projectionMatrix.elements);
    collect(scene);
    const same = cur.length === prev.length && cur.every((v, i) => v === prev[i]);
    [prev, cur] = [cur, prev];
    if (same && !sortPending) return;
    r.sortObjects = same || ++frame % 8 === 0;
    sortPending = !r.sortObjects;
    base(scene, camera);
  };
  return r;
}
