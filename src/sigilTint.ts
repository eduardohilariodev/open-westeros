/** The coat of arms' main colour: the commonest saturated, mid-light hue among its opaque pixels, as [r, g, b] (a mid grey for a black, white and grey one, null for an empty picture). */
export const tintOf = (img: HTMLImageElement): [number, number, number] | null => {
  const w = 32, h = 32, ctx = Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const bins = new Map<number, [number, number, number, number]>(), d = ctx.getImageData(0, 0, w, h).data;
  let lum = 0, seen = 0;
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (d[i + 3] >= 200) { lum += (r + g + b) / 3; seen++; }
    if (d[i + 3] < 200 || mx < 50 || mn > 215 || mx - mn < 40) continue; // clear, near black, near white, grey
    const k = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6), a = bins.get(k) ?? [0, 0, 0, 0];
    a[0] += r; a[1] += g; a[2] += b; a[3]++; bins.set(k, a);
  }
  const top = [...bins.values()].sort((a, b) => b[3] - a[3])[0];
  if (top && top[3] > seen * 0.08) return [0, 1, 2].map((i) => Math.round(top[i] / top[3])) as [number, number, number];
  if (!seen) return null;
  const g = Math.round(Math.min(175, Math.max(85, lum / seen))); // no hue to take: a grey, not too dark or pale to read on the map
  return [g, g, g];
};
