// Control maps for the satellite-imagery prototype (tools/satellite/generate.py): our layouts drawn the way
// OpenStreetMap's standard style draws them, because GeoSynth-OSM was trained on OSM tiles paired with satellite
// photos at zoom 18 (~0.6 m/px). Each crop is an SVG in local metres (x east, y south) rasterised by sharp.
//   city:  King's Landing, from the site plan (public/sites/kingsLanding/city.json + the water mask)
//   village: Harrenhal and Harrenton, from the book-text layout in harrenhal-village.json
//   grass: farmland and meadow on the riverlands' edge, procedural parcels around the real road and river
// Output: assets/satellite/proto/<crop>-control.png (not in git, like the other generated assets).
// Usage: node tools/satellite/control.mjs [city|village|grass ...]   (default: all)   PREVIEW=1 draws the whole city small.
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { METRES_PER_DEGREE } from '../../src/config.ts';

const OUT = 'assets/satellite/proto', M = 0.6; // metres per pixel, OSM zoom 18
mkdirSync(OUT, { recursive: true });
const json = (f) => JSON.parse(readFileSync(f, 'utf8'));

// OSM Carto colours
const C = {
  land: '#f2efe9', residential: '#e0dfdf', farmland: '#eef0d5', meadow: '#cdebb0', scrub: '#c8d7ab', wood: '#add19e',
  water: '#aad3df', building: '#d9d0c9', buildingLine: '#c4b6ab', ruin: '#e4dcd4', road: '#ffffff', roadLine: '#c9c5c1',
  sand: '#f5e9c6', paved: '#dddde8', tree: '#b5d29d', treeRow: '#a2c48e',
};

const rand = ((s) => () => ((s = (s + 0x6d2b79f5) | 0), (s = Math.imul(s ^ (s >>> 15), s | 1)), (s ^= s + Math.imul(s ^ (s >>> 7), s | 61)), ((s ^ (s >>> 14)) >>> 0) / 4294967296));
const pts = (p) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const poly = (p, fill, stroke = 'none', sw = 0) => `<polygon points="${pts(p)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const line = (p, color, w) => `<polyline points="${pts(p)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
const road = (p, w) => line(p, C.roadLine, w + 1.2) + line(p, C.road, w); // white road with a grey casing
const rect = ([cx, cy, w, h, deg], fill, stroke = C.buildingLine) =>
  `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" transform="translate(${cx} ${cy}) rotate(${deg})" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>`;
const circle = ([x, y, r], fill, stroke = C.buildingLine) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>`;

/** Rasterise an SVG body drawn in metres over the square [x0, x0+size] x [y0, y0+size]; `under` is an optional sharp input composited first. */
async function render(name, { x0, y0, size }, body, background = C.land, under) {
  const px = Math.round(size / M);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${x0} ${y0} ${size} ${size}">${body}</svg>`;
  const layers = [...(under ? [{ input: under }] : []), { input: Buffer.from(svg) }];
  await sharp({ create: { width: px, height: px, channels: 3, background } }).composite(layers).png().toFile(`${OUT}/${name}-control.png`);
  console.log(`${OUT}/${name}-control.png  ${px} px, ${size} m`);
}

/** Houses on both sides of a street: `rows` deep, `spacing` apart, facing the street. */
function houses({ along, spacing, size: [w, d], rows, seed }) {
  const rnd = rand(seed), out = [];
  for (let i = 0; i < along.length - 1; i++) {
    const [ax, ay] = along[i], [bx, by] = along[i + 1], len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
    const deg = (Math.atan2(uy, ux) * 180) / Math.PI;
    for (let s = spacing / 2; s < len; s += spacing) for (const side of [-1, 1]) for (let r = 0; r < rows; r++) {
      if (rnd() < 0.15 + r * 0.25) continue; // gaps, thinning away from the street
      const off = side * (8 + d / 2 + r * (d + 6 + rnd() * 6)), t = s + (rnd() - 0.5) * 4;
      const hw = w * (0.8 + rnd() * 0.5), hd = d * (0.8 + rnd() * 0.4);
      out.push(rect([ax + ux * t - uy * off, ay + uy * t + ux * off, hw, hd, deg + (rnd() - 0.5) * 8], C.building));
    }
  }
  return out.join('');
}

async function village() {
  const { crop, features } = json('tools/satellite/harrenhal-village.json');
  const draw = (f) => {
    const shape = (fill, stroke) => f.poly ? poly(f.poly, fill, stroke, stroke ? 0.6 : 0) : f.rect ? rect(f.rect, fill, stroke ?? 'none') : circle(f.circle, fill, stroke ?? 'none');
    switch (f.kind) {
      case 'water': return shape(C.water);
      case 'farmland': case 'meadow': case 'scrub': case 'wood': case 'sand': case 'paved': return shape(C[f.kind]);
      case 'castle': return shape(C.land);
      case 'road': return road(f.line, f.width);
      case 'houses': return line(f.along, C.residential, 2 * (8 + f.rows * 14)) + houses(f);
      case 'building': case 'tower': return shape(C.building, C.buildingLine);
      case 'ruin': return shape(C.ruin, C.buildingLine);
      case 'wall': return line(f.line, C.building, f.width) ;
      case 'bridge': return line(f.line, C.building, f.width);
      case 'stream': return line(f.line, C.water, f.width);
      default: throw new Error(`unknown kind ${f.kind}`);
    }
  };
  // landuse, then roads and houses, then the castle on top
  const order = ['water', 'farmland', 'meadow', 'scrub', 'sand', 'paved', 'road', 'houses', 'castle', 'wood', 'stream', 'building', 'ruin', 'wall', 'bridge', 'tower'];
  const body = order.map((k) => features.filter((f) => f.kind === k).map(draw).join('')).join('');
  await render('village', crop, body);
}

async function city() {
  const c = json('public/sites/kingsLanding/city.json');
  // the plan's pixel frame starts 900 m outside the walls (tools/sites/kingsLanding/plan.mjs)
  const fx = Math.min(...c.wall.map((p) => p[0])) - 900, fy = Math.min(...c.wall.map((p) => p[1])) - 900;
  const crop = process.env.PREVIEW ? { x0: fx, y0: fy, size: Math.max(...c.size) } : { x0: 1150, y0: 700, size: 1229 }; // dense streets with the Red Keep at the east edge
  const PM = c.metresPerPixel, px = Math.round(crop.size / PM);
  // water mask (white = water) cut to the crop and tinted, as an underlay
  const left = Math.round((crop.x0 - fx) / PM), top = Math.round((crop.y0 - fy) / PM);
  const width = Math.min(px, c.size[0] / PM - left), height = Math.min(px, c.size[1] / PM - top);
  const cut = await sharp('assets/sites/kingsLanding/water.png').greyscale().extract({ left, top, width, height })
    .extend({ right: px - width, bottom: px - height, background: '#000' }).png().toBuffer();
  const mask = await sharp(cut).resize(Math.round(crop.size / M), Math.round(crop.size / M)).extractChannel(0).raw().toBuffer();
  const n = mask.length, water = Buffer.alloc(n * 4), [wr, wg, wb] = [0xaa, 0xd3, 0xdf];
  for (let i = 0; i < n; i++) water.set([wr, wg, wb, mask[i] > 127 ? 255 : 0], i * 4);
  const side = Math.round(crop.size / M);
  const under = await sharp(water, { raw: { width: side, height: side, channels: 4 } }).png().toBuffer();

  const near = (x, y, r = 50) => x > crop.x0 - r && y > crop.y0 - r && x < crop.x0 + crop.size + r && y < crop.y0 + crop.size + r;
  const parts = [];
  const B = c.buildings.data, S = c.buildings.stride;
  for (let k = 0; k < B.length; k += S) {
    const [x, z, , w, d, , rot] = B.slice(k, k + S);
    if (near(x, z)) parts.push(rect([x, z, w, d, (-rot * 180) / Math.PI], C.building));
  }
  const T = c.trees.data;
  for (let k = 0; k < T.length; k += c.trees.stride) if (near(T[k], T[k + 1])) parts.push(circle([T[k], T[k + 1], 4 * T[k + 3]], C.tree, 'none'));
  for (const l of c.landmarks) {
    const [x, z] = l.pos;
    if (!l.radius || !near(x, z, l.radius)) continue;
    if (l.kind === 'castle') { // a curtain wall with towers round a paved yard, and halls inside
      const r = l.radius * 0.75, rnd = rand(11), ring = Array.from({ length: 9 }, (_, i) => [x + r * Math.cos(i * 0.785), z + r * Math.sin(i * 0.785)]);
      parts.push(poly(ring, C.paved), line(ring, C.building, 9), ...ring.slice(0, 8).map(([a, b]) => circle([a, b, 9], C.building)));
      for (let i = 0; i < 10; i++) { const t = rnd() * 6.28, d = rnd() * r * 0.7; parts.push(rect([x + d * Math.cos(t), z + d * Math.sin(t), 20 + rnd() * 40, 12 + rnd() * 14, Math.round(rnd() * 4) * 45], C.building)); }
    } else parts.push(circle([x, z, l.radius * 0.6], C.building));
  }
  parts.push(line([...c.wall, c.wall[0]].map(([x, z]) => [x, z]), C.building, 8));
  await render('city', crop, parts.join(''), C.residential, under);
}

async function grass() {
  const LON = -10.2, LAT = 36.0, size = 1536; // the one grassland cell with a road and a river close by
  const kx = Math.cos((LAT * Math.PI) / 180) * METRES_PER_DEGREE, local = ([lon, lat]) => [(lon - LON) * kx, (LAT - lat) * METRES_PER_DEGREE];
  const roads = json('src/roads.json'), near = (L) => L.some(([x, y]) => Math.hypot(x, y) < 40000); // segments run long
  const roadLines = [...roads.roads, ...roads.minor].map((r) => r.pts.map(local)).filter(near);
  const riverLines = json('src/vector-world.json').rivers.map((L) => L.map(local)).filter(near);
  // centre the crop halfway to the nearest river vertex, so it holds both the road and the river
  const closest = ([ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1))); return [ax + t * dx, ay + t * dy]; };
  const [rx, ry] = riverLines.flatMap((L) => L.slice(1).map((p, i) => closest(L[i], p))).reduce((b, p) => (Math.hypot(...p) < Math.hypot(...b) ? p : b), [1e9, 1e9]);
  const cx = Math.abs(rx) < 1e8 ? rx / 2 : 0, cy = Math.abs(ry) < 1e8 ? ry / 2 : 0, x0 = cx - size / 2, y0 = cy - size / 2;
  // fields: a grid turned to the road's heading, split into strips of mixed use
  const rnd = rand(5), [a, b] = roadLines[0] ?? [[0, 0], [1, 0]], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const ca = Math.cos(ang), sa = Math.sin(ang), turn = ([u, v]) => [u * ca - v * sa, u * sa + v * ca];
  const USES = [['meadow', 0.45], ['farmland', 0.38], ['scrub', 0.09], ['wood', 0.08]];
  const pick = () => { let r = rnd(); for (const [k, p] of USES) if ((r -= p) < 0) return k; return 'meadow'; };
  const parts = [];
  for (let u = -2 * size; u < 2 * size; ) { // furlongs (columns) cut into long strips, as in open-field farming
    const du = 150 + rnd() * 200;
    for (let v = -2 * size; v < 2 * size; ) {
      const dv = 25 + rnd() * 70, j = () => (rnd() - 0.5) * 4;
      const q = [[u + j(), v + j()], [u + du + j(), v + j()], [u + du + j(), v + dv + j()], [u + j(), v + dv + j()]].map(turn);
      parts.push(poly(q, C[pick()]));
      if (rnd() < 0.35) parts.push(line([q[0], q[1]], C.treeRow, 4)); // hedgerow
      v += dv;
    }
    u += du;
  }
  for (const L of riverLines) parts.push(line(L, C.water, 35));
  for (const L of roadLines) parts.push(road(L, 6));
  // a few farmsteads by the road
  const along = roadLines.flatMap((L) => L).filter(([x, y]) => Math.abs(x - cx) < size / 2 && Math.abs(y - cy) < size / 2);
  for (let i = 0; i < 5 && along.length; i++) {
    const [x, y] = along[Math.floor(rnd() * along.length)], off = (rnd() < 0.5 ? -1 : 1) * (25 + rnd() * 30);
    for (let h = 0; h < 3; h++) parts.push(rect([x - sa * off + (rnd() - 0.5) * 25, y + ca * off + (rnd() - 0.5) * 25, 10 + rnd() * 10, 7 + rnd() * 4, (ang * 180) / Math.PI + (rnd() < 0.5 ? 0 : 90)], C.building));
  }
  console.log(`grass: ${roadLines.length} roads, ${riverLines.length} rivers near the crop`);
  await render('grass', { x0, y0, size }, parts.join(''));
}

const CROPS = { city, village, grass };
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CROPS)) await CROPS[name]();
