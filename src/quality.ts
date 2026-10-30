import * as THREE from 'three';

// One switch for phones and other weak devices: the full scene wants ~1 GB of GPU memory (8192 px sky and cloud maps, 4743 px relief
// maps, a 4096 px shadow map) and a fast GPU, which a phone tab does not have. `?quality=low` or `?quality=high` overrides the guess.
const forced = new URLSearchParams(location.search).get('quality');
const weak = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 1100 || ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;

export const LOW = forced ? forced === 'low' : weak;
export const Q = LOW
  ? { ratio: 1.5, aa: false, aniso: 2, skyPx: 2048, mapPx: 2400, shadow: 2048, targetPx: 10, detail: false, clouds: false }
  : { ratio: 2, aa: true, aniso: 8, skyPx: 0, mapPx: 0, shadow: 4096, targetPx: 6, detail: true, clouds: true };

/** A texture decoded at most `maxPx` wide (0 = as is): a big picture is shrunk while decoding, so the full size never reaches the GPU. */
export function loadTexture(url: string, maxPx: number, onLoad?: (t: THREE.Texture) => void) {
  const t = new THREE.Texture();
  fetch(url).then((r) => r.blob()).then((b) => createImageBitmap(b, maxPx ? { resizeWidth: maxPx, resizeQuality: 'medium', imageOrientation: 'flipY' } : { imageOrientation: 'flipY' })).then((bmp) => {
    t.image = bmp; t.needsUpdate = true; onLoad?.(t);
  });
  return t;
}
