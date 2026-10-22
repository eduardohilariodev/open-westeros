// The Wall's line and its nineteen castles: traced off the canon map of the Gift (pixels of a 632×333 crop, north up), read at one true
// scale that makes the Wall 300 miles, about Eastwatch where the maps put it by the sea. Pure maths, so the globe (wall.ts) and the
// place tools (tools/world/consensus.mjs) read the same castles. Checked against the books by tools/books/place-checks.json.
import { METRES_PER_DEGREE, MILE } from '../config.ts';

/** The foot of the Wall on the drawing, west to east */
export const LINE: [number, number][] = [ // the foot of the Wall on the drawing, west to east: the Gorge to the Bay of Seals
  [22, 228], [45, 215], [70, 198], [100, 184], [130, 173], [165, 164], [200, 159], [240, 156], [280, 153], [315, 151],
  [360, 151], [420, 151], [480, 150], [530, 153], [548, 156],
];
const EASTWATCH = { x: 530, y: 153, lat: 62.11, lon: -5.47 };
const M_PER_PX = (300 * MILE) / LINE.slice(1).reduce((s, [x, y], i) => s + Math.hypot(x - LINE[i][0], y - LINE[i][1]), 0);

/** A pixel of the drawing -> [lon, lat] on the globe, at true distance from Eastwatch. */
export const drawingAt = ([x, y]: [number, number]): [number, number] => {
  const lat = EASTWATCH.lat + ((EASTWATCH.y - y) * M_PER_PX) / METRES_PER_DEGREE;
  return [EASTWATCH.lon + ((x - EASTWATCH.x) * M_PER_PX) / (METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180)), lat];
};

/** The Wall's line on the globe, [lon, lat]. */
export const wallLine = (): [number, number][] => LINE.map(drawingAt);

// The nineteen castles, west to east. Westwatch, the Shadow Tower, Castle Black and Eastwatch sit at their points of the
// drawing (LINE[0], [1], [9], [13]); the rest are spaced evenly along the Wall between them.
export const CASTLES = ['Westwatch-by-the-Bridge', 'Shadow Tower', 'Sentinel Stand', 'Greyguard', 'Stonedoor', 'Hoarfrost Hill', 'Icemark', 'The Nightfort',
  'Deep Lake', 'Queensgate', 'Castle Black', 'Oakenshield', 'Woodswatch-by-the-Pool', 'Sable Hall', 'Rimegate', 'Long Barrow', 'The Torches', 'Greenguard', 'Eastwatch-by-the-Sea'];
const FIXED: Record<string, number> = { 'Westwatch-by-the-Bridge': 0, 'Shadow Tower': 1, 'Castle Black': 9, 'Eastwatch-by-the-Sea': 13 };
const ARC = LINE.reduce((a, [x, y], i) => (a.push(i ? a[i - 1] + Math.hypot(x - LINE[i - 1][0], y - LINE[i - 1][1]) : 0), a), [] as number[]);
const onLine = (s: number): [number, number] => {
  const i = Math.max(1, ARC.findIndex((a) => a >= s)), t = (s - ARC[i - 1]) / (ARC[i] - ARC[i - 1]);
  return [LINE[i - 1][0] + t * (LINE[i][0] - LINE[i - 1][0]), LINE[i - 1][1] + t * (LINE[i][1] - LINE[i - 1][1])];
};

/** [lat, lon] of each castle on the Wall, by name. */
export const WALL_CASTLES: Record<string, [number, number]> = {};
{
  const fixed = CASTLES.map((n, i) => [i, FIXED[n]] as const).filter(([, k]) => k !== undefined);
  for (let f = 0; f < fixed.length - 1; f++) {
    const [i0, k0] = fixed[f], [i1, k1] = fixed[f + 1];
    for (let i = i0; i <= i1; i++) {
      const [lon, lat] = drawingAt(onLine(ARC[k0] + ((ARC[k1] - ARC[k0]) * (i - i0)) / (i1 - i0)));
      WALL_CASTLES[CASTLES[i]] = [+lat.toFixed(3), +lon.toFixed(3)];
    }
  }
}


/** Mole's Town is "half a league south along the kingsroad" from Castle Black (AGOT, Tyrion): 1.5 miles. */
const [cbLat, cbLon] = WALL_CASTLES['Castle Black'];
export const MOLES_TOWN: [number, number] = [+(cbLat - (0.5 * 3 * MILE) / METRES_PER_DEGREE).toFixed(3), cbLon];
/** The Wall as a landmark: halfway along its line. */
export const WALL_MIDDLE: [number, number] = (() => { const [lon, lat] = drawingAt(onLine(ARC.at(-1)! / 2)); return [+lat.toFixed(3), +lon.toFixed(3)]; })();
