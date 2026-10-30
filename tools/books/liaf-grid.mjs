// A crop of a map sheet with a labelled pixel grid, to read places and road bends off it in sheet pixels (then liaf-fit.mjs).
// Render a page of The Lands of Ice and Fire first (docs/roads.md). Usage: node tools/books/liaf-grid.mjs sheet.png out.png x0 y0 w h [step]
import sharp from 'sharp';
const [inp, out, x0, y0, w, h, step = 100] = process.argv.slice(2).map((v, i) => (i < 2 ? v : +v));
const lines = [];
for (let x = Math.ceil(x0 / step) * step; x < x0 + w; x += step) lines.push(`<line x1="${x - x0}" y1="0" x2="${x - x0}" y2="${h}" stroke="#f0f" stroke-width="1" opacity=".6"/><text x="${x - x0 + 2}" y="14" font-size="14" fill="#f0f">${x}</text>`);
for (let y = Math.ceil(y0 / step) * step; y < y0 + h; y += step) lines.push(`<line x1="0" y1="${y - y0}" x2="${w}" y2="${y - y0}" stroke="#f0f" stroke-width="1" opacity=".6"/><text x="2" y="${y - y0 - 2}" font-size="14" fill="#f0f">${y}</text>`);
await sharp(inp).extract({ left: x0, top: y0, width: w, height: h }).composite([{ input: Buffer.from(`<svg width="${w}" height="${h}">${lines.join('')}</svg>`) }]).toFile(out);
