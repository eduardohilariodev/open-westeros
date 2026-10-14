// Georeference of the two source maps (painted Known World map, political atlas) and their consensus. The vector map is the
// product; these raster georeferences only place the named places (consensus.mjs) and the terrain classes (terrain-classify.mjs).
// Each map has its own: the painted map from the Wall->Dorne distance, the atlas from the latitude ticks printed on its margin.
// The consensus averages them so neither map is favoured, then moves into the canonical frame of the SVG vector maps.
import { METRES_PER_DEGREE, MILE } from '../../src/config.ts';
import { readPlaces } from './places-table.mjs';

const rad = (d) => (d * Math.PI) / 180;
const PAINTED = { castleBlack: { y: 960, lat: 66.6 }, dorneCoast: { y: 3980 }, wallToDorneMiles: 3000 }; // the Wall; Dorne's south coast
export const ATLAS = { source: { width: 10000, height: 8300 }, crop: 14 }; // crop: scale-bar margin trimmed
// atlasPx -> paintedPx per axis, from the two maps' coasts (align-atlas.mjs, since removed)
const T = { scaleX: 0.8868, offsetX: 96.6, scaleY: 0.8832, offsetY: -1012.3 };
// Old stretched-longitude frame -> the canonical frame, 96.8% land overlap (align-canon.mjs).
const CANON = { lonScale: 0.7839, lonOffset: -7.86, latScale: 0.9823, latOffset: -1.08 };

export const toPainted = ([x, y]) => [T.scaleX * x + T.offsetX, T.scaleY * y + T.offsetY];
export const rows = readPlaces();
const KING = rows.find((e) => e.name === "King's Landing"); // the 0° meridian city, on both maps

// Native georeferences as lat = a*y + b, lon = c*x + d over painted px.
const painted = (() => {
  const K = PAINTED, perDeg = (K.dorneCoast.y - K.castleBlack.y) / ((K.wallToDorneMiles * MILE) / METRES_PER_DEGREE);
  const perLon = perDeg * Math.cos(rad(K.castleBlack.lat - (KING.p[1] - K.castleBlack.y) / perDeg));
  return { a: -1 / perDeg, b: K.castleBlack.lat + K.castleBlack.y / perDeg, c: 1 / perLon, d: -KING.p[0] / perLon };
})();
const atlas = (() => {
  const EQUATOR = 7663, PER_DEG = 87.23; // measured from the margin ticks (10° = 872.3 px)
  const perLon = PER_DEG * Math.cos(rad((EQUATOR - KING.a[1]) / PER_DEG));
  const [ka] = KING.a;
  return { a: -1 / (PER_DEG * T.scaleY), b: (EQUATOR + T.offsetY / T.scaleY) / PER_DEG, c: 1 / (perLon * T.scaleX), d: -(T.offsetX / T.scaleX + ka) / perLon };
})();
const mean = (k) => (painted[k] + atlas[k]) / 2;
const G = {
  latPerPx: mean('a') * CANON.latScale, lat0: CANON.latScale * mean('b') + CANON.latOffset,
  lonPerPx: mean('c') * CANON.lonScale, lon0: CANON.lonScale * mean('d') + CANON.lonOffset,
};

/** Painted-map pixel -> degrees. */
export const at = ([x, y]) => ({ lat: G.latPerPx * y + G.lat0, lon: G.lonPerPx * x + G.lon0 });
/** Atlas-map pixel -> degrees (the atlas image's own pixel frame). */
export const atlasAt = ([x, y]) => at(toPainted([x, y]));
/** The atlas grid as lat = latPerPx * y + lat0, lon = lonPerPx * x + lon0 over atlas px. */
export const ATLAS_FIT = {
  latPerPx: G.latPerPx * T.scaleY, lat0: G.latPerPx * T.offsetY + G.lat0,
  lonPerPx: G.lonPerPx * T.scaleX, lon0: G.lonPerPx * T.offsetX + G.lon0,
};
