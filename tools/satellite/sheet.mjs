// Contact sheets for the satellite prototype (control | generated, side by side) and the whole-world cost estimate:
// Known World land area (src/vector-world.json) / ground per tile at each resolution x measured seconds per tile.
// Usage: node tools/satellite/sheet.mjs <seconds per tile from generate.py>
import sharp from 'sharp';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { METRES_PER_DEGREE } from '../../src/config.ts';

const DIR = 'assets/satellite/proto', SIDE = 900, spt = +(process.argv[2] ?? 7);

for (const f of readdirSync(DIR).filter((f) => f.endsWith('-sat.png'))) {
  const variant = f.replace('-sat.png', ''), crop = variant.split('-')[0], control = `${DIR}/${crop}-control.png`;
  if (!existsSync(control)) continue;
  const [a, b] = await Promise.all([control, `${DIR}/${f}`].map((p) => sharp(p).resize(SIDE, SIDE).png().toBuffer()));
  await sharp({ create: { width: SIDE * 2 + 10, height: SIDE, channels: 3, background: '#fff' } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: SIDE + 10, top: 0 }]).jpeg({ quality: 88 }).toFile(`${DIR}/${variant}-sheet.jpg`);
  console.log(`${DIR}/${variant}-sheet.jpg`);
}

// land area: shoelace on lon·cos(lat), lat in km (equal-area enough at this precision)
const km = METRES_PER_DEGREE / 1000;
const ringArea = (r) => Math.abs(r.reduce((s, [x1, y1], i) => {
  const [x2, y2] = r[(i + 1) % r.length], c = Math.cos(((y1 + y2) * Math.PI) / 360);
  return s + (x1 * c * km) * (y2 * km) - (x2 * c * km) * (y1 * km);
}, 0)) / 2;
const land = JSON.parse(readFileSync('src/vector-world.json', 'utf8')).land.reduce((s, ring) => s + ringArea(ring), 0); // islands and continents; lakes not subtracted
console.log(`\nKnown World land ≈ ${(land / 1e6).toFixed(1)} M km², at ${spt} s per 512 px tile (448 px new ground per tile):`);
for (const m of [0.6, 2.4, 10, 30, 60]) {
  const tileKm2 = ((448 * m) / 1000) ** 2, tiles = land / tileKm2, days = (tiles * spt) / 86400;
  console.log(`  ${String(m).padStart(4)} m/px: ${tiles.toExponential(2)} tiles, ${days < 1 ? (days * 24).toFixed(1) + ' GPU-hours' : days.toFixed(0) + ' GPU-days'}`);
}
