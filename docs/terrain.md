# Terrain pipeline

The globe's relief is synthesised from the vector map; there is no source DEM. `npm run terrain` runs it with progress bars
(`tools/world/terrain-cli.mjs`; stages in `tools/world/terrain/pipeline.mjs`, the filter in `erosion-filter.mjs`, grid hydrology in
`hydrology.mjs`, progress UI `ui.mjs`, stage cache `cache.mjs`). `npm run relief` is a thin wrapper that runs the whole world through the same stages.

## Run it

| Command | Does |
|---|---|
| `npm run terrain -- --window trident --preview` | the Riverlands window (rivers, plains) in seconds, previews in `assets/terrain-lab/proto/trident/`; writes nothing to `public/world` |
| `npm run terrain -- --window vale --preview` | the Vale and the Mountains of the Moon window |
| `npm run terrain` | the whole world as a dry run |
| `npm run terrain -- --full --preview --detach` | the whole world in its own console window (stays open), writing `public/world/relief-*.webp` and `src/globe/relief-bounds.json` (about 4 min) |
| `--from <stage>`, `--only <stage>`, `--no-cache`, `--list` | rerun from a stage, stop after one, ignore the cache, list the stages |

Progress is also in `assets/terrain-lab/status.json`; stage results are cached in `assets/terrain-lab/cache/` (git-ignored), keyed by the stage's
parameters, the pipeline file and the source data (`src/vector-world.json`, `src/terrain.json`, `tools/world/geology.json`, `tools/books/range-heights.json`).
Any edit to `pipeline.mjs` invalidates every cache.

## Stages

1. `inputs`: masks, geology, distances, which drawn polygons belong to which named range.
2. `base-height`: the geology-driven guess (ranges from the drawn polygons, hills, dunes, thrust ridges ...).
3. `carve-corridors`: the 363 canon rivers (`src/vector-world.json`) become pixel paths, oriented source to mouth by `tools/world/river-orient.mjs` (the SVG stores them mouth first; the end that touches the sea, a longer river or a lake is the mouth), loops cut out. Each gets a bed that never rises downstream (`bedProfile`) and a valley around it: wide and shallow on big rivers, narrow and steep at headwaters. **Nothing is drawn as a river here: the canon lines only tell the terrain where the big valleys are.** Not cached: it fills the corridor state later stages read.
4. `erosion-filter`: the Rune Skovbo Johansen filter (MPL-2.0, `erosion-filter.mjs`) on km units, 4 octaves from a 30 km wavelength; strength by slope and rock hardness. Plains get low swells first (10-60 m at ~20 km) and a small strength with a direction from a blurred slope, so lowland is never a ruled surface. Also writes the ridge map and the height change.
5. `range-heights`: calibrates each named range to `tools/books/range-heights.json`, lowers valley floors, caps summits, raises the Lance (below).
6. `flow-accumulation`: carves the valleys again, priority-floods the depressions and lets every cell drain to its own lowest neighbour (D8); no path is pinned, so tributaries branch where the ground makes them branch, join in a Y and cannot cross. Rain is accumulated (less in deserts); each canon river has a spring at its source (and where it leaves a lake) as big as it is drawn, so a small river of the books is not lost to the threshold. It follows the books because the valleys lead the water along them.
7. `river-fields`: river cells (flow >= 90 rain cells, ~1,300 km², nothing else) -> `relief-e`. The distance is to each river's smoothed line (Chaikin, one round through the cell's upstream and downstream steps), not to the D8 staircase. Reports how closely the water follows the books (km from each canon path pixel to the nearest river cell).
8. `shader-bakes`, `encode`: slope, shadow, occlusion, ground colour; the webp files.

Then checks; exit code 1 on a failed one.

## relief-e.webp (the rivers for the shader)

Same size as `relief-a`, lossless. R,G: **signed** distance to the nearest river in km, 16 bit, `(R*256+G)/65535*2-1` times `riverDistMax` (40), positive on the left of the flow; B: size of the nearest river, log scale 0..1; A: the filter's ridge map (0.5 neutral). The numbers the shader needs (`riverDistMax`, `riverWidthKm`, `riverDepthKm`, `riverSigned`) are in `src/globe/relief-bounds.json`.
The globe draws no river geometry: it rebuilds a channel from (distance, size) at run time and shows water where the carved terrain is below the water level (see `src/globe/lift.ts`, `relief.ts`). A distance on the 4.2 km grid cannot place a 0.1-1.6 km channel unless it is signed.

## Heights: lore first, then nature

`tools/books/range-heights.json` holds, per named range, a crest (99th percentile of its cells) and a summit (highest point) in km, each with a `basis`:

- `lore`: a book states or implies it; `cite` quotes the sentence. Hard claims: the Giant's Lance is 3.5 mi (5.63 km) above the Vale floor (AGOT, Catelyn VI) and the Bones are the tallest range of the known world (WOIAF).
- `assumption`: canon is silent, so the value is the best guess from nature's rules, maths and a real-world analogue (Himalaya, Alps, Rockies, Atlas ...), with the reason. When in doubt, artistic interpretation and realism decide (rule in `CLAUDE.md`).

`range-heights` scales each range toward its crest (4 closed-loop passes on the filtered heights), lowers valley floors, caps each range at its summit
(ground in no named range at the default cap, so only the named tall ranges stand higher) and raises the hard peaks. The checks fail the run when a lore claim breaks and only warn when an assumption drifts.

## Traps

- Droplet erosion lowered crests and flattened a sharp peak (a 5.8 km cone came out at 2 km); it is gone, but calibrate after any step that moves heights.
- A window bake must keep filters off the grid edge; the old droplets read out of range there and filled the heights with NaN.
- Heights above `HEIGHT_MAX` (9 km, in `relief-bounds.json`, read by the shader and mesh) are clamped by the encoder.
- Scaling a range's foothills down can sink low land under the 0.003 km land floor; the stage clamps it.
- A valley side slope of 6% cut every mountain within 90 km of a river; it is 0.25 now.
- Pinning the canon lines as the drainage (the first version) made flow loops wherever a line was oriented backwards, straight runs, parallel threads and tributaries that were just a second line laid across the first. Rivers now come from the flow; the check is `rivers: canon rivers are followed` (path pixels within 16 km of a river cell).
- A signed distance flips sign between two unrelated rivers (their medial axis); bilinear filtering then crosses zero and draws a thin water line far from any river. The shader must take the unsigned value there (the flip is only real if a texel is within ~0.75 texel of a river).
