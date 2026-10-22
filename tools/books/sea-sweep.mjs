// Lists the point places (cities, towns, castles, ruins) that sit in our sea or in a lake: a place the canon puts on land is
// either misplaced (a fit error, snap it to the shore) or on an island the vector land lacks (listed in island-places.json, with
// why, so it is not reported again). Exit code 1 when an unlisted place is wet.
// Usage: node tools/books/sea-sweep.mjs
import { readFileSync } from 'node:fs';
import { PLACES } from '../../src/world-data.ts';
import { W, nearestOf } from './place-checks.mjs';

const KINDS = new Set(['capital', 'city', 'town', 'castle', 'ruin', 'site']);
const islands = JSON.parse(readFileSync('tools/books/island-places.json', 'utf8'));
const inRing = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const dry = (p) => W.land.reduce((n, r) => n + (inRing(p, r) ? 1 : 0), 0) % 2 === 1 && !W.lakes.some((l) => l.rings.some((r) => inRing(p, r)));

const wet = PLACES.filter((p) => KINDS.has(p[1]) && !dry([p[3], p[2]])).map((p) => [p[0], p[1], p[2], p[3], nearestOf([p[3], p[2]], W.land)[0]]);
const unlisted = wet.filter(([n]) => !(n in islands));
for (const [n, k, lat, lon, mi] of unlisted) console.log(`WET ${n} (${k}) ${lat},${lon}: ${mi.toFixed(1)} mi from our land`);
const stale = Object.keys(islands).filter((n) => !wet.some(([w]) => w === n));
for (const n of stale) console.log(`NOTE ${n} is listed in island-places.json but is on land now: remove it`);
console.log(`sea sweep: ${unlisted.length} wet, ${wet.length - unlisted.length} island places allowed`);
process.exitCode = unlisted.length ? 1 : 0;
