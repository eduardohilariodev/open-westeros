---
paths:
  - "src/globe/**"
  - "src/ui/style.css"
  - "tools/world/places.raw.txt"
---

# Globe place names: what shows at which height

Place names are CSS2D labels driven by `update()` in `src/globe/GlobeView.ts`. Keep these rules when you change them.

## Height bands

- Each kind has `LOD[kind] = [shown below, fly-to height, hidden below?]`, in metres of camera altitude.
- Big area lettering hides once the camera is well inside the area, so the places inside it take over (like Google Maps):
  continents give way to regions, and regions and oceans give way to point places.
- Point places (cities, castles…) have no lower limit. Once shown they stay shown down to the camera floor.
- Keep bands nested from coarse to fine, all above the 600 km camera floor (`MIN_ALT`, `cameraRig.ts`, measured above the drawn
  ground). Roughly: continents above 6,000 km, regions 1,000–6,000 km, oceans hidden below 1,200 km, cities and capitals below
  3,500–4,000 km, castles and towns below 1,600 km, keeps and villages below 1,000 km. Fly-to heights are at or over 600 km.
  3D sites open in their own view (`ui/modelViewer.ts`), not on the globe.
- The scale is this planet's, not Earth's (radius 6,915 km, see `src/config.ts`): at 22,000 km the whole Known World fits
  the screen, and at 3,000 km about one and a half Westeroses. Don't copy Earth or Mercator zoom tables. Calibrate by
  looking at the screen.

## Overlap check (priority, then collision)

- Every frame, names are placed in `RANK` order: continent, ocean, region, capital, city, sea, island, castle, town,
  landform, lake, river, landmark, ruin, minor. The pinned or searched place always goes first.
- A name whose screen box (from `screenBox`, plus `PAD`) overlaps an already placed box is hidden for that frame.
- A point name tries right of its symbol, then left, below, above (`SPOTS`); where none is free, symbol and name are drawn off
  the place in rings of `SHIFT` px with a leader line back (`shift`, `--dx/--dy`, `.moved`). Screen only: never move coordinates.
- The castles of the Wall (`WALL_CASTLES`) stand in a tight row: symbol and name slant up 60° (`.on-wall`, `WALL_SLANT`),
  `spreadWall` slides them apart along the Wall's screen line, and each claims a chain of small boxes along its slant.
  The castles the Watch has abandoned in the current book period are grey (`MANNED`, `REMANNED`, `.abandoned`).
- In houses mode the coats of arms (`houses.ts`) keep clear of the focused seat's name (`seatBox`) and move off their land in
  the same rings (`RINGS`, `offset` in `declutter.ts`) rather than over a neighbour.
- At the camera floor (below 1.1 × `MIN_ALT`) every point place is named: point places go first, and one with no free spot is forced in,
  and area and line lettering (seas, lakes, rivers, roads) makes way for them.
- A new kind must be added to `LOD`, `RANK`, `PLACE_KINDS` and `PLACE_ICONS` (`placeIcons.ts`), and to `AREA_KINDS`
  if it is lettering over an area rather than a symbol on a spot. It also needs a `.k-<kind>` colour in `style.css`
  (at least 4.5:1 against the dark `#101c1b` stroke), picked from its family: white only for capitals and castles, gold to
  taupe for settlements by size, blues for water, greens and earths for land, reds and purples for history.
- Box sizes come from `measure()`, run once at start-up and again when the web font loads. Never read layout
  (`offsetWidth`, `getBoundingClientRect`) per label per frame, because it forces a reflow.

## Rivers and roads: names along a line

- Kinds `river` and `road` are lettered along their line (`LINES` in `GlobeView.ts`), not at a point. A river rides on the
  map polyline nearest its spot; a road on the named road in `src/roads.json` (`named`) with the same name as the place.
- A new line kind needs an entry in `LINES` and `LINE_WIDTH_M`, a `.line-text.k-<kind>` colour, and the usual kind lists above.
- Roads are routed over the baked relief through the places `tools/books/lore-roads.json` names (`roads-trace.mjs`, see
  `docs/roads.md`); Danny Selvag's Known World map (`assets/world/roads/`, not committed) is only a pull toward its line.
  `roads-check.mjs` compares against the blog's quoted mileages, `roads-overlay.mjs` draws the result. Their name places are
  `road` rows in `places.raw.txt`; a spot given as `ll:lat,lon` is a globe position.
- `src/roads.json` has `roads` (the network: stretches between junctions, ends shared exactly), `minor` (tracks joining
  castles and towns to it, branching like a tree) and `named`. Roads begin and end at their lore places, never cross
  themselves or hook back (no circles or knots), and stay on land.
- Main roads draw below 8,000 km (`ROADS_BELOW`), tracks below 1,600 km, the castles' height (`TRACKS_BELOW`); names show below 2,000 km.

## Fades, not pops

- Showing and hiding goes through the `.off` class: a 0.25 s opacity transition, and `@starting-style` for the fade-in.
  `obj.visible` only goes false about 300 ms after `.off` is set, once the fade-out is done.
- Don't hard-toggle `obj.visible` for band or collision changes.

## Data

- `src/world-data.ts` is generated: edit `tools/world/places.raw.txt` and run `npm run places`.
- Rows are `name|kind|painted px,py|atlas tile dx,dy`, with `-` for a map the place isn't on. The painted map is linear
  in lat/lon, so a lettering spot that is on neither map can be placed from its painted-map pixel.

## Verify

Check label changes in the real app at several heights (home 22,000 km, about 3,500 km, about 1,200 km, the 600 km floor) and count overlaps
between visible label boxes. There should be none above the floor; at the floor, every point place on screen has its name.
