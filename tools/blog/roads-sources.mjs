// The maps the roads are read off. `known` (Danny Selvag's Known World map, assets/world/roads/) is the one used: its roads
// are the more reasonable ones (they cross the lakes and passes where the books do), and it carries the road names.
// `blog` is the Atlas of Ice and Fire blog's master map (docs/sources/atlas-blog), kept for comparison.
// Per source: the image; `skip` (x, y) true off the map (title bars, scale box); `sea` (r, g, b) the sea
// fill, for fitting to our land; `road` (r, g, b) the road ink; `seed` a rough placement to start the fit from (King's
// Landing at pixel x, y; at flat lon -7.8, lat 35.1) and the range of pixels a degree; `fit` where the fit is saved.
export const SOURCES = {
  known: {
    image: 'assets/world/roads/known-world-roads.png',
    skip: (x, y) => y < 80 || y > 2255,
    sea: (r, g, b) => b - r > 50 && b > 215,
    // orange main roads and the yellow lesser roads of Essos; lettering, markers and the purple name plates are none of these
    road: (r, g, b) => (r > 225 && g > 125 && g < 175 && b < 60) || (r > 225 && g > 190 && g < 230 && b < 110 && r - b > 130),
    seed: { x: 629, y: 1088, sx: [28, 40], sy: [28, 40] },
    fit: 'tools/blog/roads-fit.known.json',
  },
  blog: {
    image: 'docs/sources/atlas-blog/img/2016-03-28-details-of-the-maps-roads-mountains-forests/world-map-roads-forests-mountains.png',
    skip: (x, y) => x > 3000 && y > 2800, // the scale box at the bottom right
    sea: (r, g, b) => b - r >= 30,
    road: (r, g, b) => r > 225 && b < 175 && r - b > 70 && g > 150,
    seed: { x: 627, y: 1540, sx: [24, 40], sy: [26, 36] },
    fit: 'tools/blog/roads-fit.json',
  },
};
export const source = SOURCES[process.env.ROADS_SOURCE ?? 'known'];
