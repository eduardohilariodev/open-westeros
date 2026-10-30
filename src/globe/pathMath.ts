import { METRES_PER_DEGREE } from '../config.ts';

// Maths for a character's route (characterPath.ts), kept free of three.js so it can be tested: a route is a list of legs,
// each a list of [lon, lat] points. Distances are metres along the legs; a gap between two legs counts for nothing.
export type Pt = [number, number];
export interface Route {
  legs: Pt[][];
  /** per leg, the distance (m) from its start to each point */
  cum: number[][];
  /** the distance (m) at which each leg starts, and the route's whole length */
  start: number[];
  total: number;
}

const COS = Math.PI / 180;
/** Metres between two points (flat approximation, east-west shrunk by cos(lat)). */
export const dist = (a: Pt, b: Pt) => Math.hypot((b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * COS), b[1] - a[1]) * METRES_PER_DEGREE;

/** The line with a vertex at least every `step` degrees. */
export const densify = (pts: Pt[], step: number): Pt[] => pts.flatMap((a, i) => {
  if (!i) return [a];
  const b = pts[i - 1], n = Math.max(1, Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1]) / step));
  return Array.from({ length: n }, (_, k): Pt => [b[0] + ((a[0] - b[0]) * (k + 1)) / n, b[1] + ((a[1] - b[1]) * (k + 1)) / n]);
});

export function makeRoute(legs: Pt[][]): Route {
  const cum: number[][] = [], start: number[] = [];
  let total = 0;
  for (const leg of legs) {
    start.push(total);
    const c = [0];
    for (let i = 1; i < leg.length; i++) c.push(c[i - 1] + dist(leg[i - 1], leg[i]));
    cum.push(c);
    total += c[c.length - 1];
  }
  return { legs, cum, start, total };
}

/** Index of the last element <= x in an ascending array (0 if none). */
const floorIndex = (a: number[], x: number) => {
  let lo = 0, hi = a.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= x) lo = m; else hi = m - 1; }
  return lo;
};

/** The point at distance `s` along the route, and the unit direction of travel there as [east, north] metres. */
export function pointAt(r: Route, s: number): { p: Pt; dir: Pt } {
  s = Math.max(0, Math.min(r.total, s));
  const leg = floorIndex(r.start, s);
  const cum = r.cum[leg], legs = r.legs[leg], local = s - r.start[leg];
  const i = Math.min(legs.length - 2, floorIndex(cum, local));
  const a = legs[i], b = legs[i + 1], seg = cum[i + 1] - cum[i], t = seg > 0 ? (local - cum[i]) / seg : 0;
  const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const dx = (b[0] - a[0]) * Math.cos(a[1] * COS), dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1;
  return { p, dir: [dx / n, dy / n] };
}

/** How many line segments (counted leg by leg, as lineGeometry emits them) lie wholly before distance `s`. */
export function segmentsUpTo(r: Route, s: number): number {
  let n = 0;
  for (let l = 0; l < r.legs.length; l++) {
    const segs = r.legs[l].length - 1;
    if (s >= r.start[l] + r.cum[l][segs]) { n += segs; continue; }
    if (s > r.start[l]) n += floorIndex(r.cum[l], s - r.start[l]);
    break;
  }
  return n;
}

/**
 * Arrowheads along the route, one every `spacing` metres, each a 3-point open ring (wing, tip, wing) whose tip is on the
 * line and whose wings sweep back `size` metres at 28°. `at` is the route distance of each tip, ascending. Tips sit on
 * whole multiples of `spacing`, so doubling it keeps every other arrow where it was.
 */
export function chevrons(r: Route, spacing: number, size: number): { rings: Pt[][]; at: number[] } {
  const rings: Pt[][] = [], at: number[] = [], A = (28 * Math.PI) / 180;
  for (let s = spacing; s < r.total; s += spacing) {
    const { p, dir } = pointAt(r, s);
    const k = Math.cos(p[1] * COS) || 1;
    const wing = (side: number): Pt => {
      // rotate the backward direction by ±A, then back to degrees
      const bx = -dir[0], by = -dir[1], c = Math.cos(A * side), sn = Math.sin(A * side);
      const wx = bx * c - by * sn, wy = bx * sn + by * c;
      return [p[0] + (wx * size) / (METRES_PER_DEGREE * k), p[1] + (wy * size) / METRES_PER_DEGREE];
    };
    rings.push([wing(1), p, wing(-1)]);
    at.push(s);
  }
  return { rings, at };
}
