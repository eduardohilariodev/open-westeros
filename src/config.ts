// World scale and georeferencing — the single source of truth for sizes, shared by src/ and tools/.
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

// "The Known World" map (assets/world/known-world.jpg), georeferenced from points read off the source image.
export const KNOWN_WORLD = {
  source: { width: 9050, height: 6000 },
  crop: 60, // paper border trimmed by tools/world/prepare.mjs
  textureWidth: 8192, // safe max texture size on most GPUs
  castleBlack: { y: 960, lat: 66.6 }, // the Wall, just south of the Arctic Circle
  dorneCoast: { y: 3980 }, // Sunspear / Dorne's south coast
  wallToDorneMiles: 3000,
  meridian: { x: 1821, y: 3075, lon: 0 }, // King's Landing = 0°; longitude scale is true at its latitude
  surroundings: 400, // half-size (source px) of the map crop shown under each site
  ocean: 0x353b68, // open-sea colour sampled from the map, for the unmapped rest of the planet
  // Second globe style: the land/sea outline map (assets/world/known-world-outline.webp), aligned to the painted
  // map by tools/world/align.mjs: outlinePx = scale * paintedPx + offset. Recoloured to an atlas look.
  outline: {
    scale: 1.128, offsetX: -111, offsetY: -43,
    sea: 0x9fb6c8, land: 0xf1ead6, line: 0x55606b,
  },
};

// Places you can zoom into from the globe. `map` = position on the Known World source image;
// `erase` = the map's own icon (radius) and label box [x0, y0, x1, y1] painted out under the 3D model.
export const SITES = {
  kingsLanding: {
    name: "King's Landing",
    map: { x: 1821, y: 3075 },
    erase: { icon: 18, label: [1712, 3102, 1958, 3142] },
    // Book-based estimates (GRRM gives no survey): ~400,000 people, 500,000+ in A Storm of Swords; walls
    // "roughly square", several miles across. At medieval densities that is ~10-20 sq mi inside the walls,
    // i.e. ~3-4 mi a side. tools/sites/kingsLanding/plan.mjs scales the consensus city plan to this area.
    walledAreaSqMi: 12.25, // a 3.5 mi square's worth
  },
  winterfell: {
    name: 'Winterfell',
    map: { x: 1544, y: 1542 },
    erase: { icon: 18, label: [1474, 1555, 1620, 1592] },
  },
};
export type SiteId = keyof typeof SITES;

export const SITE_SWITCH = {
  enterDistance: 350_000, // globe camera closer than this to a site -> switch to the site scene
  exitDistance: 400_000, // site camera farther than this from the site -> back to the globe
};
