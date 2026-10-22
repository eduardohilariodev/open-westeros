import * as THREE from 'three';
import { PLANET } from '../config';
import { DISPLACE, LIFT_GLSL, PEAKS } from './lift';

// The relief as real height, detailed as you zoom (the Google Earth recipe): a quadtree over the bake's grid splits each
// node until its vertices are about TARGET_PX apart on screen, culled to the view and the horizon. Every node is the
// same N×N grid template, drawn in one instanced call; the vertex shader places it from the node's cells and raises it by
// the baked height (relief-h.webp, 16-bit, sampled bicubic so it stays smooth between the bake's ~4 km pixels) plus
// procedural detail (lift.ts detailH: rugged in the mountains, gentle in the lowlands) for the octaves the node is fine
// enough to show. A skirt round each node hides the cracks where neighbours differ in level. The shader drops what lies
// under half land cover, which traces the coast to a fraction of a pixel; the vector coast line is drawn over it.
const N = 32, ROOT = 1024, MAX_DEPTH = 8, TARGET_PX = 6, MAX_NODES = 4096; // nodes of ROOT >> MAX_DEPTH = 4 cells: ~0.5 km vertices

export const MESH_VERT = `#include <common>
#include <logdepthbuf_pars_vertex>
${LIFT_GLSL}
attribute vec3 aNode; // first cell x, y and size in cells
uniform float uCellKm; // km per cell, north-south
varying vec3 vDir;
varying float vCover;
void main() {
  vec2 g = clamp(position.xy, 0.0, ${N}.0), uv = (aNode.xy + g / ${N}.0 * aNode.z + 0.5) / vec2(textureSize(tH, 0));
  float lon = radians(mix(uBounds.x, uBounds.y, uv.x)), lat = radians(mix(uBounds.w, uBounds.z, uv.y));
  vDir = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  float spacing = aNode.z / ${N}.0 * uCellKm, base = baseHeight(uv);
  float km = base + detailH(vDir, base, spacing) - (g != position.xy ? 0.1 + spacing * 0.5 : 0.0); // skirt
  vCover = textureLod(tH, uv, 0.0).g;
  gl_Position = projectionMatrix * viewMatrix * vec4(raise(vDir * ${(PLANET.radius - 7).toFixed(1)}, km), 1.0);
  #include <logdepthbuf_vertex>
}`;

/** The raw pixels of a lossless WebP: no premultiplied alpha, no colour management. */
async function pixels(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return { W: bmp.width, H: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
}

type Bounds = { lon0: number; lon1: number; lat0: number; lat1: number; heightMax: number };

/** The quadtree mesh at radius r, drawn with `material` (MESH_VERT); `update` picks the nodes for a camera before each
 * frame. Also the height texture (R height / heightMax, G land cover) and the baked height (km) at a lon/lat. */
export async function createReliefMesh(url: string, r: number, b: Bounds, material: THREE.ShaderMaterial) {
  const { W, H, data } = await pixels(url);
  const heightAt = (lonDeg: number, latDeg: number) => {
    const x = Math.round(((lonDeg - b.lon0) / (b.lon1 - b.lon0)) * W - 0.5), y = Math.round(((b.lat1 - latDeg) / (b.lat1 - b.lat0)) * H - 0.5);
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    const p = (y * W + x) * 4;
    return ((data[p] * 256 + data[p + 1]) / 65535) * b.heightMax;
  };

  // height and land cover as half floats: filterable everywhere, ~2 m steps at the top of the range
  const half = new Uint16Array(W * H * 2);
  for (let i = 0; i < W * H; i++) {
    half[i * 2] = THREE.DataUtils.toHalfFloat((data[i * 4] * 256 + data[i * 4 + 1]) / 65535);
    half[i * 2 + 1] = THREE.DataUtils.toHalfFloat(data[i * 4 + 2] / 255);
  }
  const texture = new THREE.DataTexture(half, W, H, THREE.RGFormat, THREE.HalfFloatType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  // which nodes hold land (with a cell of margin): a pyramid from 4-cell blocks up to the roots
  const land: Uint8Array[] = []; // by depth
  const landAt = (d: number, x: number, y: number) => {
    const nx = Math.ceil(W / (ROOT >> d)), ny = Math.ceil(H / (ROOT >> d));
    return x < nx && y < ny ? land[d][y * nx + x] : 0;
  };
  for (let d = MAX_DEPTH; d >= 0; d--) {
    const S = ROOT >> d, nx = Math.ceil(W / S), ny = Math.ceil(H / S), m = new Uint8Array(nx * ny);
    if (d === MAX_DEPTH) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!data[(y * W + x) * 4 + 2]) continue;
        for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const bx = Math.floor((x + dx) / S), by = Math.floor((y + dy) / S);
          if (bx >= 0 && by >= 0 && bx < nx && by < ny) m[by * nx + bx] = 1;
        }
      }
    } else {
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++)
        m[y * nx + x] = landAt(d + 1, 2 * x, 2 * y) | landAt(d + 1, 2 * x + 1, 2 * y) | landAt(d + 1, 2 * x, 2 * y + 1) | landAt(d + 1, 2 * x + 1, 2 * y + 1);
    }
    land[d] = m;
  }

  // the grid template: (N+3)² vertices at cell steps -1..N+1, the outer ring being the skirt
  const m = N + 3, pos = new Float32Array(m * m * 3), idx: number[] = [];
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) pos.set([i - 1, j - 1, 0], (j * m + i) * 3);
  for (let j = 0; j < m - 1; j++) for (let i = 0; i < m - 1; i++) {
    const a = j * m + i, c = a + m; // c is south of a, a + 1 east: counter-clockwise from outside
    idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  const nodes = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NODES * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.InstancedBufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)).setAttribute('aNode', nodes).setIndex(idx);
  geometry.instanceCount = 0;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // culled per node below
  mesh.renderOrder = 0.5; // over the ocean, under every vector layer (they are lifted onto it)

  const cellKm = (((b.lat1 - b.lat0) / H) * Math.PI * r) / 180 / 1000;
  material.uniforms.uCellKm = { value: cellKm };
  const rad = THREE.MathUtils.degToRad;
  const centre = (x: number, y: number, out: THREE.Vector3) => {
    const lon = rad(b.lon0 + ((x + 0.5) / W) * (b.lon1 - b.lon0)), lat = rad(b.lat1 - ((y + 0.5) / H) * (b.lat1 - b.lat0));
    return out.set(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)).multiplyScalar(r);
  };
  const frustum = new THREE.Frustum(), sphere = new THREE.Sphere(), m4 = new THREE.Matrix4(), cam = new THREE.Vector3(), camDir = new THREE.Vector3(), size = new THREE.Vector2();
  const raised = b.heightMax * 1000 * DISPLACE * (1 + PEAKS);
  const peakHorizon = Math.acos(r / (r + raised)); // a peak shows this much farther round the curve than the ground

  function update(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
    frustum.setFromProjectionMatrix(m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    camera.getWorldPosition(cam);
    camDir.copy(cam).normalize();
    const horizon = Math.acos(Math.min(1, r / cam.length())), pxAngle = (2 * Math.tan(rad(camera.fov / 2))) / renderer.getSize(size).y;
    let n = 0;
    const visit = (d: number, nx: number, ny: number) => {
      if (n >= MAX_NODES || !landAt(d, nx, ny)) return;
      const S = ROOT >> d, x0 = nx * S, y0 = ny * S;
      centre(Math.min(x0 + S / 2, W - 1), Math.min(y0 + S / 2, H - 1), sphere.center);
      sphere.radius = S * cellKm * 1000 * 0.75 + raised;
      if (!frustum.intersectsSphere(sphere)) return;
      if (Math.acos(THREE.MathUtils.clamp(sphere.center.dot(camDir) / r, -1, 1)) > horizon + sphere.radius / r + peakHorizon) return; // behind the planet
      const dist = Math.max(1, cam.distanceTo(sphere.center) - sphere.radius);
      if (d < MAX_DEPTH && (S / N) * cellKm * 1000 > TARGET_PX * dist * pxAngle) {
        for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) visit(d + 1, nx * 2 + cx, ny * 2 + cy);
        return;
      }
      nodes.setXYZ(n++, x0, y0, S);
    };
    for (let ny = 0; ny * ROOT < H; ny++) for (let nx = 0; nx * ROOT < W; nx++) visit(0, nx, ny);
    geometry.instanceCount = n;
    nodes.clearUpdateRanges();
    nodes.addUpdateRange(0, n * 3);
    nodes.needsUpdate = true;
  }
  return { mesh, texture, heightAt, update };
}
