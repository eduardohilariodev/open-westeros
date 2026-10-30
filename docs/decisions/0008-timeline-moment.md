# 0008 The map through time: a moment per chapter or episode, facts as dated changes

Date: 2026-10-29. Status: accepted (the project owner's choices). Plan: `docs/roadmap-timeline.md`.

## Context

The owner wants spoiler control: places, seat holders and region borders shown as they are at a chosen chapter of the books or episode of the show. Today "when" is a book (`src/state/time.ts`), house lieges have 4 periods, seats never change, and the place card shows wiki text written after ADWD.

## Decision

- **The moment** is a track and an index: a chapter in publication order on the books track (the 345 chapters of `characters.json`, AFFC wholly before ADWD), an episode on the show track. Each also maps to a year AC; before the first chapter, history is browsed by year.
- **Default:** a new visitor starts at the first chapter of AGOT. Nothing later is drawn, named or told.
- **Facts are dated changes** (`tools/books/timeline.json`, each with a quote), applied over the AGOT base. A fact counts from the chapter or episode where the reader or viewer learns it.
- **The show is its own track**, cited by episode (S#E#). Show facts never appear on the books track and never move a place; positions stay canon-first (CLAUDE.md).
- **Wiki text** on cards sits behind a "may contain spoilers" reveal until the moment reaches the end of the published series on that track. Below it, book passages up to the chosen chapter are shown.
- **Borders:** realms follow the liege graph at the moment, and a seat taken by another house hands its territory to the holder. The kingdoms before the Conquest (and Dorne outside the realm until 187 AC) are part of this work, on the history-by-year side, drawn from region polygons with dated changes like everything else.

## Consequences

Every house tie, seat change and battle needs a chapter and a quote, so the change list grows by hand and is checked by `npm run lore -- check`. The 4 wiki periods stay as seed changes until refined. Pre-Conquest borders have no traced source yet; tracing them is an `assumption` until a source is chosen (step 4b of the roadmap).
