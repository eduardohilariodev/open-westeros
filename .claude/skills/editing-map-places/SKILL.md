---
name: editing-map-places
description: Use when moving, adding or renaming a place, river, lake or road on the Open Westeros map after the lore-check skill has established where it belongs, or when regenerating places and roads after a position changed.
---

# Editing map places

The mechanics of a move. First decide where it belongs with the `lore-check` skill (passage, measurement, claim recorded); do not move a place on a hunch. Then rebuild what derives from it. Canon first, never invent (PRODUCT.md).

## Steps

1. **Geometry** from `src/vector-world.json` (already globe lon/lat, so do not unflatten): `rivers` are unnamed polylines, `lakes` have ids, `land` is a flat list of rings. A confluence is a river endpoint on another river's line; a shore is the nearest ring edge. `npm run lore -- place "Name"` measures these; compute the new point, do not eyeball it, and check it is on land (`node tools/books/sea-sweep.mjs`).
2. **Names ride on lines.** A river's name letters along the polyline nearest its place spot (`LINES` in `src/globe/GlobeView.ts`), a road's along the named line with exactly its name. After a move, check the nearest line is its own river (the Tumblestone's name once sat on the Red Fork's line).
3. **Edit the source**, never `src/world-data.ts`: put `ll:lat,lon` in the position field of `tools/world/places.raw.txt`, or `px,py>ll:lat,lon` where the row has painted pixels (King's Landing must keep its pixels: they anchor the georeference). The Wall's castles, Mole's Town and the Wall are generated from `src/globe/wallLine.ts`. Then `npm run places`; the `world-data.ts` diff must show only the intended rows (earlier uncommitted rows by the user may show too: keep them). `npm run snap` is only for lakes, seas and islands.
4. **Record the claim** in `tools/books/place-checks.json` with its quote (see `lore-check`).
5. **Rebuild roads:** `npm run lore -- roads` (places, `roads-trace.mjs`, `roads-check.mjs`, the lore checks). Spurs and minor tracks derive from `PLACES`, so skipping this leaves roads dangling at the old spot.
6. **Look.** Render the roads and the old and new point (`node tools/blog/roads-overlay.mjs out.png lon0 lon1 lat0 lat1 pxPerDeg`) and read it. Roads pass near places and never knot or spaghetti.
7. **Verify:** `npm run lore -- check`, `npx tsc --noEmit`, `npm test`.
8. **Report** old to new, the quote, the miles moved, what the roads did. Commit only if asked.

## Red flags

- Moving a place from a screenshot or "it looks off".
- Citing canon without a quote from `docs/sources/books` or `docs/sources/wiki`.
- Regenerating places but not roads.
- Trusting a river's lettering spot as its location.
- Editing a generated file (`world-data.ts`, `roads.json`) or a Wall castle's row.

All of these mean: stop, go back to the step you skipped.
