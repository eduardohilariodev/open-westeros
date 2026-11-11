import * as THREE from 'three';

// One switch for phones and other weak devices: the full scene wants ~1 GB of GPU memory (8192 px sky and cloud maps, 4743 px relief
// maps, a 4096 px shadow map) and a fast GPU, which a phone tab does not have. `?quality=low` or `?quality=high` overrides the guess.
const forced = new URLSearchParams(location.search).get('quality');
const weak = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 1100 || ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;

export const LOW = forced ? forced === 'low' : weak;
export const Q = LOW
  ? { ratio: 1.5, aa: false, aniso: 2, shadow: 2048, targetPx: 10, detail: false, clouds: false }
  : { ratio: 2, aa: true, aniso: 8, shadow: 4096, targetPx: 6, detail: true, clouds: true };

/** A texture filled once `url` is decoded (phones get their own smaller files: relief-*-half, milky_way-2k). Stays empty if it fails. */
export function loadTexture(url: string, onLoad?: (t: THREE.Texture) => void) {
  const t = new THREE.Texture();
  fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.blob(); }).then((b) => createImageBitmap(b, { imageOrientation: 'flipY' })).then((bmp) => {
    t.image = bmp; t.needsUpdate = true; onLoad?.(t);
  }).catch((e) => console.warn(`texture ${url}:`, e));
  return t;
}
