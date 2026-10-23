// Name text rules shared by the globe's names and a 3D site's (SiteScene.ts).

/** Words per line: a name is broken after `per` words, not counting the `skip` ones ("the"): "Tower of / the Hand". */
export const wrap = (name: string, per = 2, skip = ['the']) => {
  let out = '', n = 0;
  for (const w of name.split(' ')) {
    if (n === per) { out += '\n'; n = 0; } else if (out) out += ' ';
    out += w;
    if (!skip.includes(w.toLowerCase())) n++;
  }
  return out;
};

/** Kinds lettered over an area or along a line (no symbol on a spot). */
export const AREA_KINDS = new Set(['continent', 'ocean', 'sea', 'lake', 'river', 'road', 'region', 'mountain', 'forest', 'wild', 'population']);

/** Type size range in px per kind, small end to large end: oceans and continents the biggest lettering, water and regions next, rivers and small places least. */
export const FONT_PX: Record<string, [number, number]> = {
  continent: [18, 32], ocean: [18, 32], sea: [14, 24], region: [14, 24], population: [12, 19], lake: [12, 18], capital: [13, 19], city: [12, 18],
  river: [11, 16], road: [11, 16], ruin: [10, 13], minor: [10, 13],
};
export const FONT_DEFAULT: [number, number] = [11, 15];

const FONT_B = 1.3; // exponential-ease base (vector styles use 1.2-1.5)
/**
 * Type size in px at height `h`: an exponential ease from `min` at the top of a kind's height band (`hi`) to `max` at its
 * bottom (`lo`), so names grow gently as you come down, like zoom-interpolated text-size in a vector style.
 */
export const easeFont = ([min, max]: [number, number], hi: number, lo: number, h: number) => {
  const span = Math.log2(hi / lo), u = Math.min(Math.max(Math.log2(hi / h), 0), span);
  return min + (max - min) * ((FONT_B ** u - 1) / (FONT_B ** span - 1));
};
