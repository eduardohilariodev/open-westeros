# Prototype: rivers from erosion alone

Goal: from the 600 km floor, rivers look real because the terrain made them, not because a line is drawn on it. Water lies where the simulated
flow is, in valleys the flow cut, with floodplains it built. No distance field, no screen-width line, no SVG look. Bake time does not matter.
Canon still decides where the main rivers run (CLAUDE.md: positions are canon-first).

## Why the current look can't get there
- `erosion-filter` is per pixel ("no simulation, no neighbours"): it shades gullies, but no water moves, so rivers had to be added on top.
- Droplet erosion was the only real sim tried, and it flattened mountains (5.8 km cone to 2 km); stream-power with uplift does not.
- Canon lines were cut into a finished terrain, giving gorges up to 360 m where they crossed invented hills. Here the canon lines shape the
  terrain before it erodes.

## The prototype (Trident window, then Vale and Reach; compared on a page like the bake trials)

1. **Base**: today's `inputs`, `base-height` and `range-heights` stages, at 1 km for the window (250 m for a 300 km box round Riverrun as a
   second step).
2. **Canon guide, not a cut**: lower the base along each oriented canon river (a broad trough, tens of metres, widening downstream) so the
   sim's own drainage finds those courses, and route the flow along the canon path where the sim would leave it (forced receivers on the
   canon cells), so the main stems follow the books closely and the erosion deepens them there. Pin canon mouths and lake outlets as
   fixed-level outlets.
3. **Stream-power erosion with uplift** (Braun and Willett 2013, implicit, O(n) per step; reuses `priorityFlood` and `accumulate` from
   `hydrology.mjs`):
   - uplift from the range masks and `range-heights.json`, so mountains are held up while rivers cut them
   - erodibility from `geology.json`
   - a few hundred steps until valleys stop deepening
4. **Hillslope diffusion** (thermal / linear diffusion) between steps: rounded hills, scree, valley sides at a real angle of repose.
5. **Deposition**: where the slope drops (mountain fronts, valley floors, lake inlets), the sediment the river carries settles, which makes
   alluvial fans and flat floodplains.
6. **Lakes**: depressions filled by priority-flood become lakes at their spill level (canon lakes are held as basins), so lake shores are the
   eroded terrain's contour, not a polygon.
7. **Few branches**: only the canon rivers and the sim's big rivers carry visible water. Off the canon a channel needs about 5,000 km² of
   catchment (4x the bake's river threshold), and a simulated river within 8 km of a canon one, or within 25 km carrying half its flow, is its twin and is dropped, as are branches under 30 km; smaller
   streams show only as the valleys they cut. (The same rule is in today's bake: `river-fields`, `BRANCH_CELLS`, `CANON_NEAR_KM`, `TWIN_KM`, `MIN_CHAIN_KM`.)
8. **Water**: from the final discharge, hydraulic geometry gives each cell a channel width and depth (w ∝ Q^0.5, exaggerated about ×5 so main
   rivers span 2-3 px at 600 km: an artistic choice, like the relief's own ×6). The bake writes a **water-depth map** (river channels and
   lakes) instead of relief-e's distance field, plus a floodplain/sediment mask.
9. **Render**: the land shader reads the water-depth map like the prototype's water plane: a water surface over the eroded channel, coloured
   by depth (pale shallows, dark channel), with sun glint and the floodplain's greener soil around it. Narrow rivers fade by depth and
   coverage inside a texel, not by a screen-space width rule.
10. **Checks**: canon rivers within 2 km of the simulated main stem (≥ 98%), range heights still within tolerance, no flow cycles, lakes
   level; `npm run lore -- check`.

## What it shows us
Side by side at 600 km, straight down and tilted, on the same `?bake=` switch: today's look, stream-power at 1 km, stream-power plus
250 m refinement. If the 1 km sim is enough, the world bake is the same pipeline in tiles (roadmap phase 5); if not, the 250 m refinement
runs per land tile on the GPU.

## Risks
- Canon courses that run against our invented slopes: the guide trough may need to deepen where the sim refuses it. Logged per river.
- Rivers narrower than a texel at 1 km: the ×5 width rule keeps main rivers visible. Creeks show through the valleys they cut and the
  floodplain colour, not as water.
- Memory at 250 m for large areas: window only in the prototype.
