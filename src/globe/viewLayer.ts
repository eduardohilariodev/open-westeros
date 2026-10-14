// Polygon types shared by the map layers (terrain.ts, regions.ts, gpuVector.ts).
export interface Bounds { lon0: number; lon1: number; lat0: number; lat1: number }

/** A ring of [lon, lat] with its bounding box, so hit-testing can skip what is off the point. */
export type Ring = [number, number][];
export interface Shape { ring: Ring; box: Bounds }
export const shape = (ring: Ring): Shape => {
  let lon0 = Infinity, lon1 = -Infinity, lat0 = Infinity, lat1 = -Infinity;
  for (const [lon, lat] of ring) { if (lon < lon0) lon0 = lon; if (lon > lon1) lon1 = lon; if (lat < lat0) lat0 = lat; if (lat > lat1) lat1 = lat; }
  return { ring, box: { lon0, lon1, lat0, lat1 } };
};
