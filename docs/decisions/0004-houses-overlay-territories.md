# 0004 Houses overlay: territories from seats, one time store

Date: 2026-10-28. Status: accepted (the project owner's choice).
The Voronoi territories are superseded by 0006 (traced from the reference house map).

## Context

The map has polygons for ten regions only; canon gives the seats of the houses and who holds of whom, not the borders between them. The reference maps the owner supplied draw about 300 house territories. The liege graph changes with the books, and other features (characters, land changes) will also depend on "when".

## Decision

- Territories are a weighted Voronoi of the seats, clipped to the land and to the region the seat is in, with a small domain warp so borders are not straight bisectors. They are an `assumption` (the real-world analogue is demesne mapping around manor centres); no coordinate or border is traced from the reference images, which are used as a checklist, a visual spec and to check proportions (CLAUDE.md: positions stay canon-first). Tracing the flat colours of the crops is the upgrade path if the Voronoi looks wrong against them, and a separate decision.
- The book period (AGOT, ACOK, ASOS, ADWD) lives in one store, `src/state/time.ts`, with `?when=` in the address. The overlay subscribes; so will anything else that depends on "when".
- The overlay is independent of the terrain look: one layer over the globe, whichever of relief or flat is on.
- A house opens its own card (`#house`: a big coat of arms, lords and sworn houses), not the place card.

## Consequences

Borders between houses are approximate; seats and allegiances are the wiki's, per period, and a period the wiki leaves blank shows no liege. A house on a shared seat is lit on the seat's primary house.
