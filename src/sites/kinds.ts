// Kept apart from SiteScene.ts so the globe's bundle can name a site's places without loading the 3D scenes (they are a lazy chunk, ui/modelViewer.ts).

/** The globe kind a site kind is named and shown as (symbol, colour, type size, and the kind the place panel gives it). */
export const GLOBE_KIND: Record<string, string> = {
  castle: 'castle', keep: 'castle', tower: 'ruin', sept: 'sept', pit: 'hall', gate: 'landmark', hall: 'hall', square: 'town',
  place: 'village', wood: 'forest', hill: 'mountain', district: 'region', water: 'lake', street: 'road', road: 'road',
};
