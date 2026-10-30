# 0003 A bird's-eye world: 400 km camera floor, 3D sites in their own viewer

Date: 2026-10-28. Status: accepted (the project owner's direction).

## Context

Martin writes the world from a map, a bird's-eye view. The books give ground detail only where the characters go. A Google Earth zoom to the ground asked for that
detail everywhere: ground photos tiled from 1 m, site models drawn into the globe, relief flattened under them. Even with the community it would never be done,
and the photos tiled at 1 m look like close-up ground stretched over whole regions once seen from height.

## Decision

- The camera never goes below 600 km above the ground (amended: first written as 20 km, then 400 km on 2026-10-28, 600 km on 2026-10-29).
  A screen pixel covers about 250-700 m there, so astronaut photographs of Earth from orbit are the reference for the look.
- 3D site models (King's Landing, Winterfell) are not drawn on the globe. A "3D model" button beside "Wiki" opens them in a full-screen viewer with its own orbit
  controls. The Wall stays on the globe as it is.
- The budget goes into the relief seen from 400 km and up: a 1 km grid baked on the GPU in tiles, with erosion simulated so mountains and valleys look natural,
  and rivers forced along their canon courses.
- Ground colour is painted procedurally from the bake (biome, flow, erosion, scree, sediment, forest, fields), with noise whose finest octave follows each pixel's
  footprint: the illusion of detail at any height, no photo tiling.

## Alternatives

- Keep the ground zoom and detail places one by one: rejected, unbounded work for places canon never describes.
- Aerial photo swatches per biome: rejected for now, sourcing and attribution cost, and their colour fights the bake's biomes.
- 2 km CPU bake: cheaper and enough for ~5-12 px per texel; the owner chose a GPU bake at good resolution, so 1 km (near 1:1 at 400 km),
  with a measured go/no-go on bake time before committing.

## Roadmap

`docs/roadmap-birds-eye.md`.
