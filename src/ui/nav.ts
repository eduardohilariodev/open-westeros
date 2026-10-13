import * as THREE from 'three';

/** Camera navigation every view (globe, sites) exposes to the on-screen controls. Angles in radians. */
export interface Nav {
  /** Compass bearing the camera faces, clockwise from north. */
  heading(): number;
  resetNorth(): void;
  /** Multiply the viewing distance (<1 zooms in). */
  zoom(factor: number): void;
  canTilt: boolean;
  /** 0 = looking straight down. */
  tilt(): number;
  toggleTilt(): void;
  home(): void;
  altitude(): number;
  /** Lat/lon of a screen point (normalised device coords), or null if it misses the ground/planet. */
  pick(ndc: THREE.Vector2): { lat: number; lon: number } | null;
  metresPerPixel(): number;
}

const $ = (id: string) => document.getElementById(id)!;
const MILE = 1609.344;

const dms = (v: number, pos: string, neg: string) => {
  const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60);
  return `${d}°${String(m).padStart(2, '0')}'${String(s % 60).padStart(2, '0')}"${v >= 0 ? pos : neg}`;
};
const distance = (m: number) => (m >= 10_000 ? `${Math.round(m / 1000).toLocaleString()} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
/** Largest 1/2/5 × 10^k not above x. */
const nice = (x: number) => {
  const p = 10 ** Math.floor(Math.log10(x)), f = x / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
};

/** Wires the compass, zoom/tilt/home buttons and the status bar to whichever view is active. */
export function initNav(canvas: HTMLElement, current: () => Nav) {
  $('compass').onclick = () => current().resetNorth();
  $('zoomIn').onclick = () => current().zoom(0.5);
  $('zoomOut').onclick = () => current().zoom(2);
  $('tiltBtn').onclick = () => current().toggleTilt();
  $('homeBtn').onclick = () => current().home();

  const mouse = new THREE.Vector2();
  let hover = false;
  canvas.addEventListener('pointermove', (e) => {
    mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    hover = true;
  });
  canvas.addEventListener('pointerleave', () => (hover = false));

  const needle = $('compassNeedle'), tilt = $('tiltBtn'), coords = $('coords'), alt = $('altitude');
  const barKm = $('scaleKm'), barMi = $('scaleMi');
  const last: Record<string, string> = {};
  const set = (key: string, value: string, apply: (v: string) => void) => {
    if (last[key] !== value) { last[key] = value; apply(value); }
  };
  const bar = (el: HTMLElement) => (v: string) => { const [w, t] = v.split('|'); el.style.width = `${w}px`; el.textContent = t; };
  const centre = new THREE.Vector2();
  return {
    /** Call once per frame. DOM is only touched when a value changes. */
    update() {
      const nav = current();
      set('heading', (-THREE.MathUtils.radToDeg(nav.heading())).toFixed(1), (v) => (needle.style.transform = `rotate(${v}deg)`));
      set('tilt', nav.canTilt ? (nav.tilt() > 0.3 ? '2D' : '3D') : '', (v) => { tilt.textContent = v; tilt.hidden = !v; });
      const p = nav.pick(hover ? mouse : centre);
      set('coords', p ? `${dms(p.lat, 'N', 'S')}  ${dms(p.lon, 'E', 'W')}` : '', (v) => (coords.textContent = v));
      set('alt', `Camera: ${distance(nav.altitude())}`, (v) => (alt.textContent = v));
      const mpp = nav.metresPerPixel(), km = nice(mpp * 90), mi = nice((mpp * 90) / MILE);
      set('km', `${(km / mpp).toFixed(0)}|${distance(km)}`, bar(barKm));
      set('mi', `${((mi * MILE) / mpp).toFixed(0)}|${mi >= 1 ? `${mi.toLocaleString()} mi` : `${Math.round(mi * 5280)} ft`}`, bar(barMi));
    },
  };
}
