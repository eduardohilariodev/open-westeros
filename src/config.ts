// World scale — the single source of truth for sizes, shared by src/ and tools/.
// Planet size and latitudes follow the fan reconstruction (atlasoficeandfireblog, "The size and extent of
// Westeros", 2016): a planet ~8% larger than Earth, the Wall at ~62°N (the blog's latitude post gives 61.97°N; 66.6°N is the Arctic Circle, which lies north of it), ~3,000 mi from the Wall to the
// south coast of Dorne, and King's Landing used as the 0° meridian (there is no canonical one).
// Keep this file free of imports and non-erasable TS syntax: Node runs it directly for the tools.

export const MILE = 1609.344; // metres

export const PLANET = {
  radius: 6_915_000, // m (~4,297 mi)
};

/** Metres per degree of latitude (~120.7 km, ~75 mi). */
export const METRES_PER_DEGREE = (2 * Math.PI * PLANET.radius) / 360;

// The source maps are flat art drawn at one scale everywhere, and the tools read them as plate carrée degrees. On the
// sphere that shrinks east-west distances by cos(lat) (the North came out half as wide as drawn). Reading the art as a
// sinusoidal projection instead keeps every parallel at its drawn length. Centred on King's Landing's meridian.
// STRETCH tunes it: 1 = full sinusoidal (true widths, but far from the meridian shapes shear into a fan), 0 = plate carrée.
const MERIDIAN = -7.81, STRETCH = 0.75;
const k = (lat: number) => Math.cos((lat * Math.PI) / 180) ** STRETCH;
/** Plate-carrée lon (as read off the flat map) -> lon on the globe. Latitude is unchanged. */
export const unflatten = (lon: number, lat: number) => MERIDIAN + (lon - MERIDIAN) / k(lat);
/** Inverse of unflatten. */
export const flatten = (lon: number, lat: number) => MERIDIAN + (lon - MERIDIAN) * k(lat);

// Places with a 3D scene of their own. They are ordinary places on the map (matched by name in src/world-data.ts, with the
// kind given here) whose card opens their scene in the full-screen model view (ui/modelViewer.ts).
export const SITES = {
  kingsLanding: {
    name: "King's Landing",
    kind: 'city',
    // Book-based estimates (GRRM gives no survey): ~400,000 people, 500,000+ in A Storm of Swords; walls
    // "roughly square", several miles across. At medieval densities that is ~10-20 sq mi inside the walls,
    // i.e. ~3-4 mi a side. tools/sites/kingsLanding/plan.mjs scales the consensus city plan to this area.
    walledAreaSqMi: 12.25, // a 3.5 mi square's worth
    drawDistance: 60_000, // about 7x its width: the model view's overview distance is scaled from it
  },
  winterfell: {
    name: 'Winterfell',
    kind: 'capital',
    drawDistance: 8_000, // about 5x its width
  },
};
export type SiteId = keyof typeof SITES;
