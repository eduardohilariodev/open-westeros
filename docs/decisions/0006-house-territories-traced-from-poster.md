# 0006 House territories traced from the reference house map

Date: 2026-10-29. Status: accepted (the project owner asked for it). Supersedes the Voronoi part of 0004.

## Context

The weighted Voronoi of 0004 drew borders the reference maps do not have: Umber ran past the New Gift up to the Wall, the Skagos houses spilled over, and sizes matched no map. The owner supplied the reference house map (the full poster and its regional crops) and asked for the borders to follow it. Its seats are often placed differently from ours (Winterfell about 1 degree east, Deepwood Motte about 1.5 degrees off), and our positions are canon-first.

## Decision

- Trace the borders from the poster (`assets/world/houses/poster.png`, local, git-ignored; the regional crops are copies of it and are kept for reference only).
- The poster is warped onto our seats, never our seats onto the poster: a cubic coast fit (`house-poster-fit.mjs`) plus a thin-plate spline that pins each house's seat onto its name label in the poster and leaves the coast where the fit put it. The 141 anchors were read off gridded tiles by eye (`tools/world/house-poster.json`); a house the poster does not label floods from its own seat.
- Borders come from a flood from all seats at once on our grid, a step costing up to 26 times more where the poster's colour changes, within the seat's region. A poster territory whose house we lack goes to the neighbour that reaches it cheapest.
- The Gift (150 miles south of the Wall in the North region, ASOS Bran: "to fifty leagues") belongs to no house. It is taken from canon, not from the poster's parchment colour, which pale territories such as Woolfield share.

## Consequences

Borders are the poster's, bent around our seats; where a seat sits far from its poster position the territory is stretched. Rebuilding needs the poster locally. A new house needs an anchor in `house-poster.json`, or it floods from its seat. The weights file of 0004 is gone.
