// Small map symbols for the place names on the globe, one per kind (12x12 viewBox, drawn in the label's colour).
// Capital, city, town, castle and ruin follow the legend of the atlas map.
const stroke = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"';
const waves = `<path ${stroke} d="M1 4Q3.5 1 6 4T11 4M1 8.5Q3.5 5.5 6 8.5T11 8.5"/>`;

/** Kinds in legend order, with their legend names. */
export const PLACE_KINDS: [string, string][] = [
  ['ocean', 'Oceans'], ['sea', 'Seas & bays'], ['region', 'Regions'], ['city', 'Cities'], ['capital', 'Regional capitals'],
  ['town', 'Towns'], ['castle', 'Castles'], ['minor', 'Keeps & villages'], ['ruin', 'Ruins'], ['island', 'Islands'],
  ['mountain', 'Mountains & hills'], ['forest', 'Forests'], ['wild', 'Deserts & wastes'], ['lake', 'Lakes'], ['river', 'Rivers'],
  ['landmark', 'Landmarks'],
];

export const PLACE_ICONS: Record<string, string> = {
  capital: '<path d="M6 .5l1.6 3.9 4.2.2-3.3 2.6 1.1 4.1L6 9 2.4 11.3l1.1-4.1L.2 4.6l4.2-.2z"/>',
  city: `<circle ${stroke} cx="6" cy="6" r="4.4"/><circle cx="6" cy="6" r="1.8"/>`,
  town: '<circle cx="6" cy="6" r="3.2"/>',
  castle: '<path d="M6 1l5 9H1z"/>',
  minor: '<circle cx="6" cy="6" r="2"/>',
  ruin: '<circle cx="6" cy="3" r="1.8"/><circle cx="3" cy="8.5" r="1.8"/><circle cx="9" cy="8.5" r="1.8"/>',
  island: '<path d="M.5 10Q2.5 4 6 6q2.5-3.5 5.5 4z"/>',
  mountain: '<path d="M.5 10.5L4 3l2.5 4.5L8 5.5l3.5 5z"/>',
  forest: '<path d="M6 .8L10.2 7H7.4v4H4.6V7H1.8z"/>',
  wild: `<path ${stroke} d="M1 3h10M1 6h10M1 9h10"/>`,
  river: waves,
  sea: waves,
  ocean: waves,
  lake: '<path d="M6 1S10 6 10 8a4 4 0 0 1-8 0C2 6 6 1 6 1z"/>',
  region: `<path ${stroke} d="M6 1l5 5-5 5-5-5z"/>`,
  landmark: '<path d="M6 .5l5.5 5.5L6 11.5.5 6z"/>',
};
