// Seeded 2D simplex noise (Gustavson), -1..1, and fractal sums of it. relief-bake.mjs carries its own copy, tied to its
// random stream; keep this one separate so changing a seed here never moves the baked relief.
export function makeNoise(seed = 7) {
  let s = seed;
  const rand = () => ((s = (s + 0x6d2b79f5) | 0), (s = Math.imul(s ^ (s >>> 15), s | 1)), (s ^= s + Math.imul(s ^ (s >>> 7), s | 61)), ((s ^ (s >>> 14)) >>> 0) / 4294967296);
  const perm = new Uint8Array(512), p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]], F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  const noise = (x, y) => {
    const t0 = (x + y) * F2, i = Math.floor(x + t0), j = Math.floor(y + t0), t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t), i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    let n = 0;
    for (const [cx, cy, di, dj] of [[x0, y0, 0, 0], [x0 - i1 + G2, y0 - j1 + G2, i1, j1], [x0 - 1 + 2 * G2, y0 - 1 + 2 * G2, 1, 1]]) {
      let q = 0.5 - cx * cx - cy * cy;
      if (q > 0) { const g = G[perm[((i + di) & 255) + perm[(j + dj) & 255]] & 7]; q *= q; n += q * q * (g[0] * cx + g[1] * cy); }
    }
    return 70 * n;
  };
  /** Fractional Brownian motion, normalised to about -1..1: each octave halves in amplitude and doubles in frequency. */
  const fbm = (x, y, octaves = 3) => {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < octaves; i++, amp *= 0.5, f *= 2.03) { sum += amp * noise(x * f + i * 17.3, y * f - i * 9.1); norm += amp; }
    return sum / norm;
  };
  return { noise, fbm };
}
