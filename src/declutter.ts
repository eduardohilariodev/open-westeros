import type { Object3D } from 'three';

// Name placement shared by the globe's names and a 3D site's: names are offered in priority order and one whose screen box
// overlaps an already placed box is hidden for the frame; showing and hiding fade (the `.off` class, style.css) instead of popping.


/** One frame's placed boxes. `claim` takes a spot for a box unless it overlaps one already placed (within the padding). */
export function createDeclutter(padX = 4, padY = 4) {
  const taken: number[][] = [];
  const overlaps = (a: number[], b: number[]) => a[0] < b[2] + padX && b[0] < a[2] + padX && a[1] < b[3] + padY && b[1] < a[3] + padY;
  return {
    claim(box: number[]) {
      if (taken.some((t) => overlaps(t, box))) return false;
      taken.push(box);
      return true;
    },
  };
}

/** Fades a name in or out: the class goes at once, the object leaves the page once the fade-out (0.25 s) is done. */
export function setShown(obj: Object3D & { element: HTMLElement }, on: boolean, now: number) {
  obj.element.classList.toggle('off', !on);
  if (on) { obj.visible = true; obj.userData.offAt = 0; }
  else if (obj.visible && now - (obj.userData.offAt ||= now) > 300) obj.visible = false;
}
