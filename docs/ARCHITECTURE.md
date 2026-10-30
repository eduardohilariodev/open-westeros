# Architecture

Open Westeros is a Vite + three.js globe of the Known World. Positions come from the books first (see `CLAUDE.md`); everything else is derived.

## Data flow

```
assets/ (git-ignored source maps)
  -> tools/world    places, coast, relief, ground, terrain   -> src/world-data.ts, public/world/
  -> tools/blog     road tracing from the Atlas blog         -> src/roads.json
  -> tools/books    book index, claims, distances            -> src/place-books.json, docs/sources/books/
  -> tools/world/battles.mjs  battles.json -> battle rows of places.raw.txt
  -> tools/wiki     wiki mirror, place info, sigils          -> docs/sources/wiki/, place info
  -> tools/sites    per-site plans (kingsLanding, winterfell) -> public/sites/
  -> tools/satellite local GeoSynth prototype (not wired in)
  -> tools/lore     verb dispatcher over the checks (npm run lore -- <verb>)
src/ (app) reads the generated files; never edit them by hand.
```

## Views

- The globe (`src/globe/`, drawn by `main.ts`): a bird's-eye map, camera at least 600 km above the drawn ground (`cameraRig.ts MIN_ALT`, decision 0003).
- The 3D model view (`src/ui/modelViewer.ts`): a full-screen overlay with its own renderer and orbit controls that shows a site
  (`src/sites/`, registered in `sites/index.ts`, configured in `config.ts SITES`). Opened from the place card's "3D model" button
  (`placePanel.ts onModel`) or `?place=Name&view=3d`; the globe loop sleeps while it is open. The Wall is part of the globe, not a site.
- The houses overlay (`src/globe/houses.ts`, panel `src/ui/housePanel.ts`, graph `src/houseGraph.ts`, plan `docs/roadmap-houses.md`): territories, borders and coats of arms over either terrain look, toggled by `#housesBtn`. Click a house: it and everyone sworn to it (nested) are lit and the `#house` card opens instead of the place card. The liege graph is per book period, from the shared time store `src/state/time.ts`: a moment is a chapter, a show episode or a history year (decision 0008, plan `docs/roadmap-timeline.md`), `?when=acok`, `asos-sansa-iv` or `s3e9`, read in `main.ts` before `initWhen` writes the address; switcher `#when`. Other layers that depend on "when" subscribe to the same store (`onPeriod` fires on every moment change). What is true at the moment (a house's liege, a place's holder, state, name) comes from `src/state/changes.ts` (`stateAt`): the AGOT state plus the dated, quoted changes of `tools/books/timeline.json` (checked by `tools/books/timeline-check.mjs` in `npm run lore -- check`) and the wiki's per-book lieges counted from the end of each book. Address: `?house=id`.
- The map through time (plan `docs/roadmap-timeline.md`, decision 0008): `src/state/time.ts` holds the moment (a chapter, an episode or a year of the history; `?when=acok`, `asos-sansa-v`, `s3e9`, `y-100`), `src/state/changes.ts` resolves a place or house at it from `tools/books/timeline.json` (quoted, dated changes; `npm run lore -- check` validates them). The timeline wheel (`initWhen` in `src/ui/housePanel.ts`) has one stop per wiki year before the books, a folded stop for every other year from 3 BC (they unfold as you scroll in) and one per chapter of the books; each rest sets the moment. The year and chapter at the bottom of the screen (`#yearBtn`, `src/main.ts`) opens and closes it.

## Generated, never hand-edited

| File | Made by |
|---|---|
| `src/world-data.ts` | `npm run places` (from `tools/world/places.raw.txt`) |
| `src/roads.json` | `node tools/blog/roads-trace.mjs` (or `npm run lore -- roads`) |
| `src/place-books.json` | `tools/books/place-index.mjs` |
| `src/chapters.json` | `npm run chapters` (`tools/books/chapters.mjs`): the 345 chapters in publication order from `docs/sources/quartermaester/qm-paths.json`, each with its book and year AC (rules and quotes in the script), and the 73 show episodes from the wiki season pages (no year: canon gives none). The time axis of `src/state/time.ts`; character steps count by its indexes |
| `src/house-wiki.json` | `node tools/wiki/house-info.mjs`: each house's wiki lead and a few infobox rows for the house card (behind the spoiler button until the end of the story) |
| `src/houses.json` | `node tools/wiki/houses.mjs` (wiki house infoboxes: seat, region, head, overlords per book period) |
| `src/house-territories.json` | `node tools/world/house-territories.mjs` (the local reference house map `assets/world/houses/poster.png` warped onto our seats by `tools/world/house-poster.json`, then a colour-edge flood from the seats; the Gift held by no house; decision 0006). The coast fit in that file: `node tools/world/house-poster-fit.mjs` |
| `docs/sources/*/` (all but `atlas-blog/`), `public/world/`, `public/sites/` | extract/scrape/bake scripts, git-ignored. The sources are shelved by what they are and in trust order; the catalogue is `docs/sources/README.md` |
| `public/sigils/` | `node tools/wiki/scrape.mjs --sigils` (place houses from `_sigils.json` plus `src/houses.json`, 120 px webp) |

Runtime caching: `public/sw.js` (registered by `main.ts` in builds) keeps every same-origin fetch cache-first in `static-<build id>`, replaced each deploy, and the wiki's hot-linked pictures in a lasting `wiki` cache. Fonts are self-hosted in `public/fonts/`.

## Character paths

`npm run characters`: `tools/characters/qm-extract.mjs` (quartermaester.info to git-ignored `docs/sources/quartermaester/`) -> `qm-map.mjs` (our places and a fitted transform; review list) -> `build.mjs` (with `characters.json`, the names, wiki titles, houses) -> `src/characters.json`, generated (steps keyed by chapter index; the chapter list itself is `src/chapters.json`); `legs-check.mjs` lists legs in the sea, `qm-lore.mjs` checks stops against the book text. `npm run characters:wiki` (by hand, Cloudflare) writes `src/character-wiki.json` with `tools/wiki/character-info.mjs`. Runtime: `globe/characterPath.ts` draws the route and walks its steps, `globe/cameraRig.ts` `follow()` keeps the camera on the head, `ui/characterPanel.ts` fills the place card; search and `?character=id` open one. See decision 0005.

## Fresh clone

1. `npm install` (sets `.githooks`).
2. Source images go in `assets/`; copyrighted text is rebuilt with `node tools/books/extract.mjs`; wiki with `npm run wiki` (`AWOIAF_COOKIE=<cf_clearance>` skips the Chrome window; refused articles come from the Wayback Machine, see `tools/wiki/scrape.mjs`).
3. `npm run places`, then `npm run lore -- roads`.
4. `npm run verify` (lore check, tsc, tests), `npm run dev`.

## Gates

Pre-commit runs `lore check`; pre-push runs `npm run build`. `npm run verify` is the full local gate.

## Roads order

`tools/blog/roads-fit.mjs` registers the painted road map to our vector coast and writes `roads-fit.json` (the committed `roads-fit.known.json` is the fit for the current source, see `roads-sources.mjs`); `roads-trace.mjs` routes every road of `tools/books/lore-roads.json` over the baked relief (`public/world/relief-h.webp`, so it runs after `npm run terrain`), with the painted roads only as a pull, and joins every seat by a track ([roads.md](roads.md), [decisions/0007](decisions/0007-roads-routed-over-the-terrain.md)). `npm run lore -- roads` runs consensus, trace, check and the lore checks but not the fit: run `node tools/blog/roads-fit.mjs` by hand only when the coast or the road source image changes.

## Terrain order

`npm run terrain` (`tools/world/terrain-cli.mjs`, stages in `tools/world/terrain/`) bakes the relief with progress bars and a stage cache; heights are calibrated against `tools/books/range-heights.json` (lore claims plus labelled assumptions). Details, commands and traps: [terrain.md](terrain.md). The rule for gaps in the lore: [decisions/0001](decisions/0001-fill-lore-gaps-with-realism.md). Rivers are generated from the terrain, whole world at once, with the canon lines only shaping the valleys (`tools/world/river-orient.mjs` gives their direction): [decisions/0002](decisions/0002-rivers-from-the-terrain.md). The bake also writes `public/world/relief-rivers.json` (the drawn rivers as smoothed lon/lat lines with a size per point); `relief.ts` (`bakedRivers`) draws them as lifted screen-width lines, and the land shader draws no river water once they load (relief-e still carves the channels).

Keep this file true: when a tool, generated file or step changes, update it in the same commit, and log the why in `findings.md`.

- **Atmosphere depth:** `relief.depth()` (relief.ts) renders the land's depth at half size before the frame; the atmosphere ground pass in GlobeView.ts samples it (`tDepth`) to march rays to the real ground (below 1,500 km altitude).
