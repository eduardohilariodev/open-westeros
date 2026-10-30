# Roadmap: a bird's-eye world

Why: `docs/decisions/0003-birds-eye-camera.md`. The camera floor is 600 km (first written as 20 km, then 400 km on 2026-10-28, 600 km on 2026-10-29).
From there a pixel covers 150-450 m, so anything under ~300 m is invisible and astronaut photographs are the reference. Ticked as each step lands.

## Phase 0: write the direction down
- [x] Decision 0003, this roadmap, PRODUCT.md vision lines
- [x] Rerouted to a 400 km floor, then 600 km (decision, product, label rules)

## Phase 1: 600 km camera floor
- [x] `MIN_ALT = 600_000`, no site override
- [x] Label bands fitted to the floor: everything comes in above 600 km, regions and oceans give way at 1,000-1,200 km
- [x] Floor measured above the drawn ground, with a few metres of hysteresis (a cm wobble kept the frame "moving")
- [x] `flyToDir` / `flyToFit` clamped to the floor
- [x] Site flights use city framing

## Phase 2: sites off the globe (the Wall stays)
- [x] Site handoff out of `main.ts`
- [x] Site flattening out of `lift.ts`, `reliefMesh.ts`, `gpuVector.ts`
- [x] `siteWithin` / `siteCamera` / `flyToSite` out of `GlobeView`

## Phase 3: full-screen 3D model viewer
- [x] "3D model" button beside "Wiki"
- [x] `src/ui/modelViewer.ts`: own canvas, orbit controls, globe asleep while open
- [x] Places inside a site open the viewer on that building (`?place=…&view=3d`); searchable once their site has been opened
- [x] `SiteScene` owns its camera

## Phase 4: retune what was sized for the ground
- [x] Ground photo layer gone (Poly Haven textures, `ground.ts`, `groundMap.ts`, `npm run ground`)
- [x] `detail.ts` windows 1200 / 400 / 160 km (were 160 / 40 / 10)
- [x] Exaggeration eases 600-3000 km, 4.5x at the floor (was 150-1500 km, 3x)
- [x] Sky stays space at the floor, as from the ISS

## Phase 4b: water seen from the floor (before the bake: resolution alone does not fix it)
- [x] Rivers drawn as lines from the bake's own smoothed network (relief-rivers.json), not the 4.2 km distance field: no forks or hooks at confluences from 600 km
- [x] Rivers drawn like the bake's flow preview (1-2.5 px by flow, no wobble); lakes with no detail under the vector outline
- [x] Fewer branches, closer to the lore: canon rivers on their own paths, others need ~5,000 km² of catchment, no twins (within 8 km, or within 25 km with half the canon flow), no stubs under 30 km
- [ ] relief-e kept for the valley and floodplain only (no more channel traced from the 4.2 km grid: staircases and dashed tributaries)
- [x] No margins: valley blended with a smooth minimum, narrower floors, floodplain tint removed; river water olive-grey to slate green
- [ ] Lakes flat at the bake's level per lake (export `lakeBasins` levels), shore from the vector outline
- [ ] No procedural detail under lakes (bake a lake mask for the mesh), so the floor never pokes through
- [ ] Shots: God's Eye, the Trident forks, Long Lake, the Rhoyne, straight down and tilted at 600 km

## Phase 4c: prototype rivers from erosion alone (`docs/prototype-erosion-rivers.md`)
- [x] Resolution trial: Trident baked at 4.2 / 2.1 / 1 km, compared in the globe with `?bake=`
- [x] Canon paths as forced receivers; canon valley floors drain into their river (no twins, no floating branches)
- [ ] Canon guide troughs and pinned outlets
- [ ] Stream-power erosion with uplift, hillslope diffusion, deposition (Trident at 1 km)
- [ ] Lakes as filled depressions; water-depth map replaces relief-e's distance field
- [ ] Shader draws water from depth (no lines); comparison page vs today
- [ ] 250 m refinement round Riverrun; decide what the world bake (phase 5) runs

## Phase 5: relief bake v2 (1 km, GPU, tiled)
- [ ] 5a GPU harness in headless Chrome (playwright-core, WebGL2 float targets), timed on one 2048² tile; go/no-go if the world > ~2 h
- [ ] 5b Macro stream-power sim (4.2 km, CPU), canon rivers as forced receivers, lakes level, then range calibration
- [ ] 5c Fine GPU sim per 1 km land tile (halo 128 px): fluvial + hillslope erosion, then the stateful erosion filter (prototype pass A)
- [ ] 5d Masks per tile: slope, AO, flow, moisture, sediment, biome, canopy
- [ ] 5e Tile pyramid + manifest (z0 = today's global set, land tiles only)
- [ ] 5f Checks: range heights, canon rivers within 2 km of a river cell (≥ 98%), no cycles, lakes level; no place moves

## Phase 6: runtime tiled relief
- [ ] Tile atlas cache (texture array, LRU) for the quadtree, z0 fallback
- [ ] `heightAt` reads tiles
- [ ] Rivers read tiled `relief-e`; drawn as 1-2 px threads, the floodplain as the visible green ribbon

## Phase 7: procedural "from orbit" look
- [x] First pass, sized for 400-600 km: farm districts (~4 km), forest clumps (~1.5 km), drainage streaks (~1 x 6 km), light bump
- [ ] Tune against astronaut photos once the 1 km bake lands: valley greening, snow by aspect, alluvial fans, dry lake beds
- [ ] Prototype touches: water glint, hard sun and soft sky light

## Phase 8: verify and record
- [ ] Shots at 600 km (straight down and tilted), phone, low quality; before/after per region
- [ ] Frame time and first-load MB
- [ ] lore check, tsc, tests; findings, ARCHITECTURE, terrain.md
