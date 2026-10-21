// Hand-placed names, written by the globe's "Edit names" mode (npm run dev). Applied on top of world-data.ts, so they survive `npm run places`.
// p = [lat, lon], rot = degrees counter-clockwise (water names), s = size multiplier.
export type PlaceEdit = { p?: [number, number]; rot?: number; s?: number };
export const PLACE_EDITS: Record<string, PlaceEdit> = {
  "The Mander": {"p":[31.965,-8.449],"rot":20},
  "Bay of Pentos": {"p":[35.091,3.508],"rot":16.69999999999999,"s":0.3},
  "Shadow Tower": {"p":[61.652,-13.011]},
  "Castle Black": {"p":[62.036,-8.855]},
  "The Nightfort": {"p":[62.044,-10.305]},
  "The Gorge": {"p":[61.527,-13.337]},
  "Mole's Town": {"p":[61.578,-7.564]},
  "Queenscrown": {"p":[61.062,-9.208]},
  "Whitetree": {"p":[62.368,-9.45]},
  "Craster's Keep": {"p":[63.077,-10.329]},
  "The Wall": {"p":[62.058,-10.985]},
};
