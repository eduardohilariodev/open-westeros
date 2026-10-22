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
- Point places (cities, castles…) have no lower limit. Once shown they stay shown down to the 3D sites.
- Keep bands nested from coarse to fine. Roughly: continents above 6,000 km, regions 500–6,000 km, cities and capitals
  below 3,500–4,000 km, castles and towns below 1,200 km, keeps and villages below 700 km. `MIN_ALT` is 150 km, and
  `SITE_SWITCH` takes over below that.
- The scale is this planet's, not Earth's (radius 6,915 km, see `src/config.ts`): at 22,000 km the whole Known World fits
  the screen, and at 3,000 km about one and a half Westeroses. Don't copy Earth or Mercator zoom tables. Calibrate by
  looking at the screen.

## Overlap check (priority, then collision)

- Every frame, names are placed in `RANK` order: continent, ocean, region, capital, city, sea, island, castle, town,
  landform, lake, river, landmark, ruin, minor. The pinned or searched place always goes first.
- A name whose screen box (from `screenBox`, plus `PAD`) overlaps an already placed box is hidden for that frame.
- A new kind must be added to `LOD`, `RANK`, `PLACE_KINDS` and `PLACE_ICONS` (`placeIcons.ts`), and to `AREA_KINDS`
  if it is lettering over an area rather than a symbol on a spot. It also needs a `.k-<kind>` colour in `style.css`
  (at least 4.5:1 against the white stroke).
- Box sizes come from `measure()`, run once at start-up and again when the web font loads. Never read layout
  (`offsetWidth`, `getBoundingClientRect`) per label per frame, because it forces a reflow.

## Fades, not pops

- Showing and hiding goes through the `.off` class: a 0.25 s opacity transition, and `@starting-style` for the fade-in.
  `obj.visible` only goes false about 300 ms after `.off` is set, once the fade-out is done.
- Don't hard-toggle `obj.visible` for band or collision changes.

## Data

- `src/world-data.ts` is generated: edit `tools/world/places.raw.txt` and run `npm run places`.
- Rows are `name|kind|painted px,py|atlas tile dx,dy`, with `-` for a map the place isn't on. The painted map is linear
  in lat/lon, so a lettering spot that is on neither map can be placed from its painted-map pixel.

## Verify

Check label changes in the real app at several heights (home 22,000 km, about 3,500 km, about 900 km) and count overlaps
between visible label boxes. There should be none.
