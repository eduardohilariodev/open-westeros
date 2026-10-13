// Exports the consensus plan (plan.mjs, terrain.mjs) for QGIS/GDAL into assets/sites/kingsLanding/gis/:
// topdown.jpg + water.png with world files, dem.asc (heights in m), plan.geojson (wall, gates, places, streets, roads).
// CRS: EPSG:3857 with the city at 0,0, where it is metre-true; easting = x, northing = -y (plan y points south).
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { GATES, M, PLAN, TOPDOWN, WATER, toMetres } from './plan.mjs';
import { CELL, cols, heights, rows } from './terrain.mjs';

const OUT = 'assets/sites/kingsLanding/gis';
mkdirSync(OUT, { recursive: true });
const en = ([x, y]) => [+x.toFixed(1), +(-y).toFixed(1)];
const [x0, y0] = toMetres([0, 0]);

const worldFile = [M, 0, 0, -M, x0 + M / 2, -(y0 + M / 2)].join('\n'); // centre of the top-left pixel
copyFileSync(TOPDOWN, `${OUT}/topdown.jpg`); writeFileSync(`${OUT}/topdown.jgw`, worldFile);
copyFileSync(WATER, `${OUT}/water.png`); writeFileSync(`${OUT}/water.pgw`, worldFile);

const lines = [];
for (let r = 0; r < rows; r++) lines.push(Array.from(heights.subarray(r * cols, (r + 1) * cols), (h) => h.toFixed(2)).join(' '));
writeFileSync(`${OUT}/dem.asc`, [`ncols ${cols}`, `nrows ${rows}`, `xllcenter ${x0}`, `yllcenter ${-(y0 + (rows - 1) * CELL)}`,
  `cellsize ${CELL}`, 'NODATA_value -9999', ...lines].join('\n'));

const feature = (geometry, properties) => ({ type: 'Feature', geometry, properties });
const line = (kind) => ([name, pts]) => feature({ type: 'LineString', coordinates: pts.map(en) }, { name, kind });
writeFileSync(`${OUT}/plan.geojson`, JSON.stringify({
  type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3857' } },
  features: [
    feature({ type: 'Polygon', coordinates: [[...PLAN.wall, PLAN.wall[0]].map(en)] }, { name: 'City walls', kind: 'wall' }),
    ...Object.entries(PLAN.places).map(([name, p]) => feature({ type: 'Point', coordinates: en(p) }, { name, kind: GATES.includes(name) ? 'gate' : 'place' })),
    ...Object.entries(PLAN.streets).map(line('street')),
    ...Object.entries(PLAN.roads).map(line('road')),
  ],
}));
console.log(`${OUT}: dem ${cols}x${rows} @ ${CELL} m, ${heights.reduce((a, b) => Math.min(a, b)).toFixed(0)}..${heights.reduce((a, b) => Math.max(a, b)).toFixed(0)} m`);
