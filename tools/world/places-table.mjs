// Reads tools/world/places.raw.txt: name | kind | painted px,py | atlas tile dx,dy   ('-' = not on that map).
// Atlas coordinates were read off tiles of the political atlas map (2500 px squares viewed at 1933 px, 2500x800 strips at
// 2000 px; tile name = x_y of its top-left corner), and are converted here to full-resolution pixels of the atlas image.
import { readFileSync } from 'node:fs';

const TILE = 2500, SHOWN = 1933;
const atlasPx = (tile, dx, dy) => {
  const [tx, ty] = tile.split('_').map(Number), k = ty === 7500 ? 1.25 : TILE / SHOWN;
  return [tx + dx * k, ty + dy * k];
};

/** [{ name, kind, p?: [x, y] painted-map px, a?: [x, y] atlas-map px, ll?: [lat, lon] }] */
export function readPlaces(file = 'tools/world/places.raw.txt') {
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
    const [name, kind, p, a] = l.split('|');
    const e = { name, kind };
    if (p.startsWith('ll:')) e.ll = p.slice(3).split(',').map(Number); // a spot given as lat,lon on the globe, for lettering on a line
    else if (p !== '-') e.p = p.split(',').map(Number);
    if (a?.startsWith('@')) e.a = a.slice(1).split(',').map(Number); // full-resolution atlas pixels
    else if (a !== '-') { const [tile, xy] = a.split(' '); e.a = atlasPx(tile, ...xy.split(',').map(Number)); }
    return e;
  });
}
