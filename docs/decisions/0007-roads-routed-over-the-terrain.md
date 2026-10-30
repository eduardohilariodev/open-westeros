# 0007: Roads are routed over the terrain, not traced off the painted map

Date: 2026-10-29

## Context
`roads-trace.mjs` traced the yellow ink of the painted road map, then patched it: straight bridges between loose ends, a hand-made hub at Casterly Rock (`hubs.json`), spurs to places, a coastal A* on a 2 km grid, and filters that cut loops and bulbs afterwards. The patches were the artifacts: a bulb where a road met a coast (the A* walked round the bay and the filters only cut part of it), staircases in the Vale, a triangle at Casterly Rock, parallel strands across Essos, and roads that passed Highgarden instead of meeting there.

## Options
1. Keep tracing and add more patches. Every patch had made a new artifact.
2. Draw roads by hand. Thousands of miles; no tie to the lore or the ground.
3. Route: the lore gives each road's places in order, the cheapest path over the baked relief joins them (slope, rivers, sea, swamp), and the painted map is only a pull toward its line.

## Decision
Option 3. One router, one smoothing pass per stretch of a shared graph, so junctions are exact and nothing runs side by side. Tracks join every seat to the network by the same costs and branch like a tree; a shared track is drawn as a road. Valyrian roads (`straight`) shrug off slope and the painted line.

## Consequences
- Roads begin and end at their lore places (0 mi, was up to 15-70); Highgarden, the crossroads inn and Casterly Rock are real junctions.
- The painted map's unnamed roads are gone unless a seat needs them; Essos has the Valyrian network the wiki gives (from *The Lands of Ice and Fire*) instead of the painted strands.
- Moving a place, a river or the relief re-routes everything (~30 s). The route depends on cost weights in `roads-trace.mjs`, documented in `docs/roads.md`.
