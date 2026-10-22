// Distances for the measuring wool: one length in metres, shown in many units, plus how long the trip takes at a few paces.
// Keep this file free of imports and non-erasable TS syntax: node --test runs it directly.

const MILE = 1609.344, NMI = 1852;
/** A land league is 3 miles, a sea league 3 nautical miles (World of Ice & Fire gives leagues without a length). */
export const LAND_LEAGUE = 3 * MILE, SEA_LEAGUE = 3 * NMI;

/**
 * Rule-of-thumb paces, km/h, and the hours of a travel day. Real-world medians for each mode, not lore: the books give few
 * speeds, and the dragon's is a genre estimate (faster than a raven, ~65-80 km/h cruise, bursts far above).
 */
export const PACES = [
  { name: 'On foot', kmh: 5, note: 'a day of marching on a road' },
  { name: 'Horseback', kmh: 10, note: 'normal travel, one rider' },
  { name: 'Courier horse', kmh: 15, note: 'hard pace, fresh mounts' },
  { name: 'Dragonback', kmh: 75, note: 'steady cruise with a rider (assumed)' },
  { name: 'Sailing ship', kmh: 9, note: '~5 knots' },
  { name: 'Fast ship', kmh: 18.5, note: '~10 knots, fair wind' },
  { name: 'Galley', kmh: 5, note: '~2.7 knots under oar' },
] as const;
export const TRAVEL_DAY_H = 8;

const group = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
/** 3 significant figures at most, no more decimals than that needs. */
const sig = (n: number) => group(n, n >= 100 ? 0 : n >= 10 ? 1 : 2);

export const metric = (m: number) => (m < 1000 ? `${group(m)} m` : `${sig(m / 1000)} km`);
export const imperial = (m: number) => (m < MILE / 4 ? `${group(m / 0.9144)} yd` : `${sig(m / MILE)} mi`);
export const nautical = (m: number) => `${sig(m / NMI)} nmi`;
export const landLeagues = (m: number) => `${sig(m / LAND_LEAGUE)} leagues`;
export const seaLeagues = (m: number) => `${sig(m / SEA_LEAGUE)} sea leagues`;

/** Hours to minutes, hours, or travel days (TRAVEL_DAY_H hours each). */
export function duration(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < TRAVEL_DAY_H) return `${Math.floor(hours)} h ${String(Math.round((hours % 1) * 60) % 60).padStart(2, '0')} min`;
  const d = hours / TRAVEL_DAY_H;
  return `${sig(d)} ${d < 1.05 ? 'day' : 'days'}`;
}
export const travelTime = (m: number, kmh: number) => duration(m / 1000 / kmh);

/** Great-circle distance (m) between two unit directions on a sphere of radius r. Cross-product form, exact for tiny and near-antipodal angles alike. */
export function arc(a: [number, number, number], b: [number, number, number], r: number) {
  const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0];
  return r * Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

/** Largest 1/2/5 x 10^k not above x. */
export const nice = (x: number) => {
  const p = 10 ** Math.floor(Math.log10(x)), f = x / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
};
