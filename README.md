# Open Westeros

**A community-built, Google Earth–style 3D atlas of the Known World.** Spin the planet, dive into King's Landing, walk the walls of Winterfell — and help build the rest.

**Live preview:** [open-westeros.vercel.app](https://open-westeros.vercel.app) — private for now (Vercel login required) while we sort out how to show the copyrighted source art publicly.

## Manifesto

Westeros has been drawn a thousand times, but never mapped as a place you can *fly through*. Open Westeros is an attempt to do that together, in the open.

1. **Open by default.** The code is MIT-licensed. Every decision, tool and pipeline lives in this repo. Pull requests aren't just accepted — they are the plan.
2. **Community built.** No single person can model a continent. Each castle, city, road and river is a contribution. If you love a corner of the Seven Kingdoms (or Essos, or beyond the Wall), it is waiting for you.
3. **Canon first, sources always.** Sizes, distances and layouts follow the books and official maps first, then well-argued fan reconstructions. Every number in [`src/config.ts`](src/config.ts) says where it came from. When canon is silent, we say so.
4. **Honest scale.** One planet (radius 6,915 km), one coordinate system, real metres. A castle is as big as the text implies — not as big as looks cool.
5. **Reproducible, not redistributed.** Copyrighted art (GRRM's maps, game assets, mods) is *never* committed. Instead we ship the tools that turn your own copies into the atlas, so anyone can rebuild it and nobody's work is taken.
6. **Small, readable pieces.** Prefer the simplest thing that works. A new site should be a config entry, one view module and one data pipeline — nothing more.
7. **Credit the makers.** Artists, modders, cartographers and wiki editors made this possible. Their names stay attached to what they made.

## What exists today

- **The globe** — the Known World draped on a planet ~8% larger than Earth, in three styles: atlas outline (default), the political atlas and the painted map. The maps are georeferenced as a consensus: the political atlas is registered to the outline's coasts and each map's own latitude reference (the Wall→Dorne distance, the atlas's printed latitude ticks) is averaged, so King's Landing is the 0° meridian and the Wall sits near 65°N.
- **King's Landing** — a 3D city generated from the painted city map: ~20,000 houses, walls and gates, the Red Keep, the Great Sept, the Dragonpit, terrain, lore for every landmark.
- **Winterfell** — Shadiversity's book-accurate design (via the Skyrim port *The True Winterfell SE*), converted mesh by mesh and placed exactly.
- **Place names** — ~620 named places read off the maps (cities, castles, regions, seas, rivers, islands…), each with a symbol for its kind, coloured by kind and shown at sensible camera heights. The sidebar legend has a checkbox per kind, and every name is searchable and flies you there.
- **Google Earth–style controls** — search across all places, compass, tilt, zoom, scale bar, coordinates, guided tours, deep links (`#winterfell/Great%20Keep`).

## Run it

```bash
npm install
npm run dev
```

The app needs generated data in `public/` (ignored by git). Build it from your own copies of the sources:

| Source (not included) | Put it at | Then run |
| --- | --- | --- |
| *The Known World* map (9050×6000) | `assets/world/known-world.jpg` | `npm run prepare:world` |
| Known World outline map | `assets/world/known-world-outline.webp` | (same) |
| *The Known World* political atlas (Adam Whitehead, [atlasoficeandfireblog](https://atlasoficeandfireblog.wordpress.com), 10000×8300, optional) | `assets/world/known-world-atlas.jpg` | (same) |
| *King's Landing* painted map + heightmap | `assets/sites/kingsLanding/` | `npm run analyze` |
| *The True Winterfell SE* (Nexus Mods #94816), extracted | `assets/sites/winterfell/mod/` | `npm run winterfell:collect` (needs Skyrim SE) then `npm run winterfell` |

Without the Winterfell data the app falls back to a procedural Winterfell; the globe and King's Landing need their sources.

### Places and alignment

[tools/world/places.raw.txt](tools/world/places.raw.txt) lists every named place with its position on the painted map and/or the political atlas. `npm run places` fits the consensus georeference and regenerates [src/world-data.ts](src/world-data.ts); `node tools/world/align-atlas.mjs` re-registers the political atlas to the outline map. Add a place by adding a line.

### Deploy

The preview is deployed from a machine that has the generated data — Git pushes do **not** deploy, because the data isn't in the repo:

```bash
npx vercel deploy --prod
```

[`.vercelignore`](.vercelignore) uploads the code and the generated `public/` data, never the raw sources in `assets/`. The Vercel project keeps Deployment Protection on, so every URL requires a Vercel login.

## How it's built

```text
src/
  config.ts            planet size, georeferencing, sites — the single source of truth for scale
  geo.ts               lat/lon ↔ planet ↔ local site frames
  globe/               the planet view
  sites/               one folder per zoomable place (+ shared SiteScene, primitives)
  ui/                  panel, search, compass & navigation
tools/
  world/               globe textures, map alignment
  sites/<site>/        per-site data pipelines (image analysis, Skyrim ESM/NIF/BSA/DDS readers…)
```

Three.js + Vite + TypeScript, no framework. Each site is its own local scene in metres; zooming close to a globe marker hands the camera over seamlessly.

## Add a place

1. Add it to `SITES` in [`src/config.ts`](src/config.ts) with its pixel position on the Known World map.
2. Write a view in `src/sites/<id>/` using `createSiteScene` (see Winterfell for the shortest example).
3. Register it in [`src/sites/index.ts`](src/sites/index.ts).
4. If it needs data, add a pipeline under `tools/sites/<id>/` — never commit the copyrighted inputs.

Ideas waiting for an owner: the Wall and Castle Black, Harrenhal, Casterly Rock, Oldtown and the Hightower, the Eyrie, Dragonstone, Braavos, the kingsroad between them all.

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## License & credits

Code: [MIT](LICENSE) © Open Westeros contributors.

*A Song of Ice and Fire* and its maps © George R. R. Martin. Winterfell design © Shadiversity; Skyrim port by the authors of *The True Winterfell SE*; *The Elder Scrolls V: Skyrim* assets © Bethesda Softworks. Lore summarised from [A Wiki of Ice and Fire](https://awoiaf.westeros.org). Open Westeros is an unofficial fan project, not affiliated with or endorsed by any of them.
