// World scale — the single source of truth for sizes, shared by src/ and tools/.
// Planet size and latitudes follow the fan reconstruction (atlasoficeandfireblog, "The size and extent of
// Westeros", 2016): a planet ~8% larger than Earth, the Wall at ~66.6°N, ~3,000 mi from the Wall to the
// south coast of Dorne, and King's Landing used as the 0° meridian (there is no canonical one).
// Keep this file free of imports and non-erasable TS syntax: Node runs it directly for the tools.

export const MILE = 1609.344; // metres

export const PLANET = {
  radius: 6_915_000, // m (~4,297 mi)
};

/** Metres per degree of latitude (~120.7 km, ~75 mi). */
export const METRES_PER_DEGREE = (2 * Math.PI * PLANET.radius) / 360;

// Places with a 3D scene of their own. They are ordinary places on the map (matched by name in src/world-data.ts, with the
// kind given here) that load their scene when the camera comes close.
export const SITES = {
  kingsLanding: {
    name: "King's Landing",
    kind: 'city',
    // Book-based estimates (GRRM gives no survey): ~400,000 people, 500,000+ in A Storm of Swords; walls
    // "roughly square", several miles across. At medieval densities that is ~10-20 sq mi inside the walls,
    // i.e. ~3-4 mi a side. tools/sites/kingsLanding/plan.mjs scales the consensus city plan to this area.
    walledAreaSqMi: 12.25, // a 3.5 mi square's worth
  },
  winterfell: {
    name: 'Winterfell',
    kind: 'capital',
  },
};
export type SiteId = keyof typeof SITES;

// A site's 3D scene is drawn into the globe's frame (same camera pose, same depth buffer), so zooming in is one continuous
// view. What changes with distance is only who steers the camera and when the scene is loaded and drawn. Metres.
export const SITE_SWITCH = {
  loadDistance: 3_000_000, // start loading the scene
  drawDistance: 1_500_000, // draw it over the globe
  enterDistance: 350_000, // the camera is steered by the site's map controls (tilt, WASD, orbit) closer than this
  exitDistance: 400_000, // and by the globe's controls farther than this
};
