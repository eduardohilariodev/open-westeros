import type { Object3D } from 'three';

// Name placement shared by the globe's names and a 3D site's: names are offered in priority order and one whose screen box
// overlaps an already placed box is hidden for the frame; showing and hiding fade (the `.off` class, style.css) instead of popping.


/** One frame's placed boxes. `claim` takes a spot for a box (or a chain of boxes, all or none) unless it overlaps one already placed (within the padding); `force` takes it anyway. */
export function createDeclutter(padX = 4, padY = 4) {
  const CELL = 64, grid = new Map<number, number[][]>(); // placed boxes by 64 px cell, so a claim only meets its neighbours
  const cell = (v: number) => Math.min(127, Math.max(-32, Math.floor(v / CELL))); // clamped: far off-screen boxes share the edge cells, which only adds candidates
  const cells = (b: number[], px: number, py: number, fn: (list: number[][] | undefined, key: number) => boolean | void) => {
    for (let cx = cell(b[0] - px), x1 = cell(b[2] + px); cx <= x1; cx++) for (let cy = cell(b[1] - py), y1 = cell(b[3] + py); cy <= y1; cy++) if (fn(grid.get((cx + 32) * 256 + cy + 32), (cx + 32) * 256 + cy + 32)) return true;
    return false;
  };
  const overlaps = (a: number[], b: number[]) => a[0] < b[2] + padX && b[0] < a[2] + padX && a[1] < b[3] + padY && b[1] < a[3] + padY;
  return {
    claim(box: number[] | number[][], force = false) {
      const boxes = typeof box[0] === 'number' ? [box as number[]] : (box as number[][]);
      if (!force && boxes.some((b) => cells(b, padX, padY, (list) => !!list?.some((t) => overlaps(t, b))))) return false;
      for (const b of boxes) cells(b, 0, 0, (list, key) => { (list ?? (grid.set(key, (list = [])), list)).push(b); });
      return true;
    },
  };
}

/** Offsets to try for a crowded name, in steps: its own spot, then three rings out, below and above first. */
export const RINGS = [[0, 0], ...[1, 2, 3].flatMap((r) => [[0, 1], [0, -1], [-1, 1], [1, 1], [-1, -1], [1, -1], [-1, 0], [1, 0]].map(([a, b]) => [a * r, b * r]))];

/** Draws a label `dx`, `dy` px off its spot (style.css --dx, --dy: screen only, the place keeps its coordinates), with a leader line back once it is moved (`.moved`). */
export function offset(el: HTMLElement, dx: number, dy: number) {
  el.style.setProperty('--dx', `${dx}px`); el.style.setProperty('--dy', `${dy}px`);
  el.style.setProperty('--len', `${Math.hypot(dx, dy)}px`); el.style.setProperty('--ang', `${Math.atan2(dy, dx)}rad`);
  el.classList.toggle('moved', Math.hypot(dx, dy) > 6);
}

/** Fades a name in or out: the class goes at once, the object leaves the page once the fade-out (0.25 s) is done. */
export function setShown(obj: Object3D & { element: HTMLElement }, on: boolean, now: number) {
  obj.element.classList.toggle('off', !on);
  if (on) { obj.visible = true; obj.userData.offAt = 0; }
  else if (obj.visible && now - (obj.userData.offAt ||= now) > 300) obj.visible = false;
}
