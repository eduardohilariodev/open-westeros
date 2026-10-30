// Advanced terrain erosion filter and Phacelle noise, ported from the GLSL of Rune Skovbo Johansen
// (https://blog.runevision.com/2026/03/fast-and-gorgeous-erosion-filter.html, https://www.shadertoy.com/view/wXcfWn).
// Phacelle Noise function copyright (c) 2025 Rune Skovbo Johansen
// Advanced Terrain Erosion Filter copyright (c) 2025 Rune Skovbo Johansen
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Each point is evaluated on its own from its height and slope: no simulation, no neighbours. The caller works in km: p in km,
// heights in km, slopes in km/km. `scale` is both the horizontal wavelength of the largest gullies and the vertical scale.

const TAU = 6.28318530717959;
const KX = 0.3183099, KY = 0.3678794;
const fract = (v) => v - Math.floor(v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;

const pc = new Float64Array(4); // phacelle result: cos, sin, dirX, dirY
/** Stripes aligned with (ndx, ndy), a unit vector: pc = [cos wave, sin wave (its slope), side direction x, y]. */
export function phacelle(px, py, ndx, ndy, freq, offset, normalization) {
  const sdx = -ndy * freq * TAU, sdy = ndx * freq * TAU; // orthogonal to the stripes, magnitude = their frequency
  offset *= TAU;
  const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
  let sx = 0, sy = 0, wsum = 0;
  for (let i = -1; i <= 2; i++) for (let j = -1; j <= 2; j++) {
    // hash of the cell point: gradient-noise hash, a random offset of up to 0.5 on each axis
    const ax = (ix + i) * KX + KY, ay = (iy + j) * KY + KX;
    const t = fract(ax * ay * (ax + ay));
    const rx = (-1 + 2 * fract(16 * KX * t)) * 0.5, ry = (-1 + 2 * fract(16 * KY * t)) * 0.5;
    const vx = fx - i - rx, vy = fy - j - ry;
    let w = Math.exp(-(vx * vx + vy * vy) * 2); // bell shaped, ~0 at 1.5
    w = Math.max(0, w - 0.01111);
    wsum += w;
    const a = vx * sdx + vy * sdy + offset;
    sx += Math.cos(a) * w; sy += Math.sin(a) * w;
  }
  sx /= wsum; sy /= wsum;
  const mag = Math.max(1 - normalization, Math.sqrt(sx * sx + sy * sy));
  pc[0] = sx / mag; pc[1] = sy / mag; pc[2] = sdx; pc[3] = sdy;
  return pc;
}

const powInv = (t, p) => 1 - Math.pow(1 - clamp01(t), p);
const easeOut = (t) => { const v = 1 - clamp01(t); return 1 - v * v; };
const smoothStart = (t, s) => (t >= s ? t - 0.5 * s : (0.5 * t * t) / s);

/** Result of erosionFilter, reused between calls: height delta, slope delta (x, y), summed octave strength, ridge map, final fade target. */
export const eroded = { dh: 0, dgx: 0, dgy: 0, magnitude: 0, ridge: 0, fade: 0 };

/**
 * p (px, py), the height and slope (h, gx, gy) of the terrain, fadeTarget (-1 at valleys .. 1 at peaks), then the stylistic parameters
 * (strength, gullyWeight, detail, rounding[4], onset[4], assumedSlope[2]; they may vary per point) and the scale ones.
 * `dirX, dirY` is the slope used for the gully direction (pass the smoothed slope on plains, where the real one is ~0).
 */
export function erosionFilter(px, py, h, gx, gy, dirX, dirY, fadeTarget, strength, gullyWeight, detail, rounding, onset, assumedSlope,
  scale, octaves, lacunarity, gain, cellScale, normalization) {
  strength *= scale;
  fadeTarget = Math.max(-1, Math.min(1, fadeTarget));
  let hh = 0, ghx = 0, ghy = 0; // accumulated deltas
  let freq = 1 / (scale * cellScale);
  const slopeLength = Math.max(Math.hypot(gx, gy), 1e-10);
  const dirLength = Math.max(Math.hypot(dirX, dirY), 1e-10);
  let magnitude = 0, roundingMult = 1;
  const roundingForInput = mix(rounding[1], rounding[0], clamp01(fadeTarget + 0.5)) * rounding[2];
  let combiMask = easeOut(smoothStart(slopeLength * onset[0], roundingForInput * onset[0]));
  let ridgeCombi = easeOut(slopeLength * onset[2]), ridgeFade = fadeTarget;
  // the gully direction comes from the slope, with an assumed magnitude that overrides the real one by assumedSlope[1]
  let gsx = dirX + (dirX / dirLength * assumedSlope[0] - dirX) * assumedSlope[1];
  let gsy = dirY + (dirY / dirLength * assumedSlope[0] - dirY) * assumedSlope[1];
  for (let o = 0; o < octaves; o++) {
    const gl = Math.hypot(gsx, gsy), nx = gl > 1e-10 ? gsx / gl : gsx, ny = gl > 1e-10 ? gsy / gl : gsy;
    phacelle(px * freq, py * freq, nx, ny, cellScale, 0.25, normalization);
    const cx = pc[0], sn = pc[1], dzx = -freq * pc[2], dzy = -freq * pc[3]; // slope directions that point down
    const sloping = Math.abs(sn);
    const sgn = Math.sign(sn);
    gsx += sgn * dzx * strength * gullyWeight; gsy += sgn * dzy * strength * gullyWeight; // normalised slope for the next octave
    // faded gullies: height cx, slope sn * (dzx, dzy), faded toward fadeTarget by the accumulating mask
    const fh = fadeTarget + (cx * gullyWeight - fadeTarget) * combiMask;
    hh += fh * strength;
    ghx += sn * dzx * gullyWeight * combiMask * strength; ghy += sn * dzy * gullyWeight * combiMask * strength;
    magnitude += strength;
    fadeTarget = fh;
    const roundingForOctave = mix(rounding[1], rounding[0], clamp01(cx + 0.5)) * roundingMult;
    const newMask = easeOut(smoothStart(sloping * onset[1], roundingForOctave * onset[1]));
    combiMask = powInv(combiMask, detail) * newMask;
    ridgeFade = mix(ridgeFade, cx, ridgeCombi);
    ridgeCombi *= easeOut(sloping * onset[3]);
    strength *= gain; freq *= lacunarity; roundingMult *= rounding[3];
  }
  eroded.dh = hh; eroded.dgx = ghx; eroded.dgy = ghy; eroded.magnitude = magnitude;
  eroded.ridge = ridgeFade * (1 - ridgeCombi); eroded.fade = fadeTarget;
  return eroded;
}
