// Hand-placed names, written by the globe's "Edit names" mode (npm run dev). Applied on top of world-data.ts, so they survive `npm run places`.
// p = [lat, lon], rot = degrees counter-clockwise (water names), s = size multiplier.
export type PlaceEdit = { p?: [number, number]; rot?: number; s?: number };
export const PLACE_EDITS: Record<string, PlaceEdit> = {
  "The Mander": {"p":[31.965,-8.375],"rot":20},
  "Bay of Pentos": {"p":[35.091,1.927],"rot":16.69999999999999,"s":0.3},
};
