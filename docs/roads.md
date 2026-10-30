# Roads pipeline

How `src/roads.json` is made. The lore audit (which roads, which quotes, what disagrees) is in `roads-lore-audit.md`; the rules for editing are in `.claude/rules/lore.md`; why the roads are routed and not traced is [decisions/0007](decisions/0007-roads-routed-over-the-terrain.md).

## What decides what

- **The lore decides which places a road runs through**: `tools/books/lore-roads.json`, one entry per road, `via` in order, with book and wiki cites.
- **The official maps decide its course where they are clearer than the text**: *The Lands of Ice and Fire* (2012) outranks every fan map. Its roads go into `lore-roads.json` as:
  - `@lat,lon` waypoints in `via` where the road bends at no place of ours (the demon road's town and ruin, the goldroad well south of Stoney Sept);
  - `along: ["<river>"]` where it follows a river (the river road on the Red Fork): that river's banks cost half for the road;
  - places dropped from `via` that the road only passes (the kingsroad runs east of the Twins).
- `straight: true` marks a Valyrian road: a ruled line from place to place ("straight as a Dothraki arrow", AGOT; ruled on the maps), routed only where the line would cross water. `joins: "<road>"` makes a branch from its last place to that road (Tolos: the nearest ruled line).
- **Reading a sheet**: the PDF is in `docs/sources/books/` (git-ignored). Render a page with `conda run -n gis gdal_translate --config GDAL_PDF_DPI 3000 -of PNG "PDF:<page>:<file>" sheet.png` (p13 Westeros, 4433x6708 at 3000 dpi; p10 The Free Cities, p4 Central Essos). `node tools/books/liaf-grid.mjs sheet.png out.png x0 y0 w h` crops it with a pixel grid. Read 7-12 places of ours and the road's bends in sheet pixels, then `node tools/books/liaf-fit.mjs anchors.json x,y ...` prints the residuals and the `@lat,lon` waypoints. Fit one region at a time: a whole sheet is 20-40 mi off our canon-corrected places, a region 5-30. The roads are faint dotted lines; rivers are solid.
- **The ground decides the rest**: each leg is the cheapest path over the baked relief (`public/world/relief-h.webp`, the relief bake's own ~0.035 degree cells).
- **The painted road map is a gentle pull**, the lowest source: `known-world-roads.png` (3400x2267) in `assets/world/roads/`, registered by `roads-fit.mjs` (fit in `roads-fit.known.json`). Copyrighted art is never committed.

## Cost of a step (`step` in `roads-trace.mjs`)

- miles x slope x cell cost. Slope: `1 + (grade / 5%)^2`, capped at 40 (15% for a straight road). Cell cost: `1 + 0.12 x height km`, times cover (forest 1.25, swamp 3, desert 1.4, snow 2), times 0.9 on a river bank (0.5 on the banks of a river the road is `along`), times 0.75 on the painted road (not for a straight road).
- Sea, lakes and the Wall cannot be crossed; a cell must be mostly land (cover > 200 of 255), except the cells round a place on the shore. The Wall has gates at Castle Black, Eastwatch and the Shadow Tower (wiki Wall).
- Entering a river costs 15 + 40 x its size in miles; x0.2 within two cells of a settlement (a bridge, a ferry), free within three cells of a place a road is named through (Bitterbridge, the Twins, Riverrun). Rivers are the relief's (`relief-rivers.json`) and the flat map's canon lines both.
- A step along an edge already laid costs 0.35x, so later roads join it: junctions fall where roads part, and nothing runs side by side.
- 16 moves (king's and knight's), so a road runs at 16 headings, not only 45 degree steps.

## Steps

1. Named roads in the file's order (the Kingsroad first), leg by leg (A*).
2. Tracks: every capital, city, town and castle (not the Wall's, nor islands) to the nearest road or track, biggest first, so tracks branch like a tree. Reach 900 / 700 / 350 / 350 miles of path, ruins and villages 60. A place with no road in reach seeds a local network the places round it join (Yi Ti, east Dorne). A track stretch used by 3+ places, or a capital's, is drawn as a road (a city's is not: the maps draw no Pentos-Myr road).
3. The network is cut at junctions into stretches; each is smoothed once (Douglas-Peucker to half a cell, a cell and a half for a straight road, then Chaikin), with a tighter fit where that would touch water. Places are pinned: a road ends at the place, not the cell.
4. `named`: a road's stretches end to end. A place the road runs out to and back from the same way is on a spur; the named line passes it by.
5. `npm run lore -- roads` runs consensus, the router (~30 s), `roads-check.mjs` and the lore checks; `npm test` checks every lore place is on the network and no stretch crosses itself.
6. Debug: `DBG=1 node tools/blog/roads-trace.mjs` lists places left without a track and why; `node tools/blog/roads-overlay.mjs out.png [lon0 lon1 lat0 lat1 pxPerDeg]` draws roads (red), tracks (green) and named lines (blue).

## Distances

- Blog text, as straight-line figures: King's Landing to Winterfell about 1500 mi, to Storm's End about 400, to Lannisport about 800; Kingsroad total 2600; Mantarys to Volantis about 600, to Bhorash 450; Qohor to the ruin 400 E; Essaria 520 from the Valyrian road ruin; Asabhad to Qarth about 500.
- A road is longer than straight-line, so it cannot match a blog figure; do not "fix" a road to hit one. Last measured (2026-10-29): Kingsroad 2730 vs 2600, King's Landing to Winterfell 1679 vs 1500, to Storm's End 390 vs 400, to Lannisport 870 vs 800, Volantis to Mantarys 598 vs 600, Mantarys to Bhorash 454 vs 450.

## Traps

- Moving a place, the coast, a river or the relief needs a re-route (`npm run lore -- roads`); `roads-fit.mjs` only when the coast or the painted image changes.
- The grid is the relief's: a place in a cell that is mostly sea is "in the sea" for routing (8 islands the land lacks, `island-places.json`).
- A road from a lore place out to another and back on the same cells is a spur, not a detour: the named line skips it (Harrenhal off the Kingsroad, Crakehall off the Ocean Road).
- The conda `gis` env has no PIL; use sharp in node for pixel work.
- Open: Yi Ti's stone roads (WOIAF) and Yin to Asabhad (wiki: "a trade route") have no waypoints yet, so Yi Ti has local tracks only; Asabhad is 281 mi from the network.
