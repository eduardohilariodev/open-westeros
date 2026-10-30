# Roadmap: the map through time (spoiler control)

The map shows the world as a reader or viewer knows it at a chosen point: up to a chapter of the books or an episode of the show. Places appear, fall to ruin or change name; seats change hands (Winterfell: Stark, Greyjoy, Bolton); realms and their borders follow who is sworn to whom. Nothing after the chosen point is drawn, named or told. The year is always shown at the bottom of the screen, and clicking it opens the timeline. Ticked as each step lands. Decisions at the end.

## What already exists

- `src/state/time.ts`: one store for "when", `?when=` in the address, but only book granularity (7 books folded onto 4 house periods).
- `src/houses.json`: a liege per house for 4 periods (agot, acok, asos, adwd) from the wiki infobox; the seat of a house never changes.
- `src/house-territories.json`: territories per house, traced (decision 0006). Realm outlines are already built at runtime from the liege graph, so they follow whatever graph we feed them.
- `src/characters.json`: 345 chapters in publication order (AGOT 0, ACOK 73, ASOS 143, AFFC 225, ADWD 271, TWOW sample 344), and character steps keyed by chapter index. This is the axis.
- `src/globe/regions.ts`: the ten region polygons, static.
- The year drum `#when` and its info window (`initWhen`, `src/ui/housePanel.ts`, events from `src/timeline.ts`), opened today only by the clock button `#timelineBtn` (`setTimeline`, `src/main.ts`).
- Spoiler leaks today: the place card shows the wiki lead (written after ADWD), `place-books.json` lists mentions by book, not chapter, and the house card shows the current head.

## The model

**A moment** is `{ track: 'books' | 'show', at: number }`: a chapter index on the books track (the 345 chapters above), an episode index on the show track (73 episodes, S1E1 = 0). Each chapter and episode also maps to a year AC, so year-dated facts (Summerhall burned 259 AC) apply on both tracks. Before the first chapter there is a history mode by year (Fire & Blood, Dunk and Egg), which is the current `BOOKS` list.

**A change** is one dated fact, never a snapshot:

```jsonc
// tools/books/timeline.json (claims, with quotes, like the other claim files)
{ "subject": "Winterfell", "set": { "holder": "greyjoy" },
  "books": "ACOK Bran VI", "show": "S2E6", "quote": "...", "source": "ACOK Bran VI" }
{ "subject": "house:frey", "set": { "liege": "lannister" }, "books": "ASOS Catelyn VII", "show": "S3E9", "quote": "..." }
{ "subject": "Summerhall", "set": { "state": "ruin" }, "year": 259, "source": "TWOIAF" }
```

- `subject` is a place name or `house:<id>`; `set` holds any of `holder` (house holding the seat), `liege`, `state` (`built` / `ruin` / `gone`), `name` (renames).
- `books` and `show` are each optional: a change the show lacks or the books lack is simply absent on that track. Show-only facts never reach the books track, and the reverse.
- The value at a moment is the base (AGOT chapter 0, from the generated data) plus every change at or before it. A pure function, unit-tested.
- Spoiler rule: a fact is shown from the chapter where the reader learns it. For in-series events that is the chapter it happens in; backstory told in AGOT counts from AGOT.

## Steps

- [x] **0. Decide** the open questions below: `docs/decisions/0008-timeline-moment.md`
- [x] **1. The axis**
  - [x] `src/state/time.ts`: the moment (`books` chapter, `show` episode, `history` year) replaces the book; `getBook`, `getPeriod`, `setPeriod`, `onPeriod` stay as derived values so the houses overlay works unchanged
  - [x] chapter list moved out of `characters.json` into `src/chapters.json` (`npm run chapters`: title, book, year AC from the wiki year pages and ASOS Sansa IV); episodes with season and title, no year (canon silent)
  - [x] `?when=` accepts `acok`, `asos-sansa-iv`, `s3e9`, `fab`; old addresses keep working; read before `initWhen` writes the address (it used to drop the link)
  - [x] unit test (`src/state/time.test.ts`): parse, round-trip, book to first chapter, chapter to year, show periods
  - Until step 6/7 the show track borrows a book period per season (S1 AGOT, S2 ACOK, S3-4 ASOS, S5+ ADWD; assumption) and the wheel shows that book
- [x] **2. Changes and the resolver**
  - [x] `tools/books/timeline.json`, 11 quoted changes; `tools/books/timeline-check.mjs` (in `npm run lore -- check`) checks subject, houses, chapter, episode, and that the quote is in the cited chapter (the Nth `## POV` heading); `--where "quote"` gives the chapter to cite
  - [x] the 4 wiki periods of `houses.json` are seed changes dated at the **last** chapter of their book (the first would spoil the book: ADWD's Glover-to-Stannis would show from its prologue); a blank period keeps the last liege. Quoted changes refine them (Robb crowned, the river lords, the Red Wedding)
  - [x] `src/state/changes.ts`: `stateAt(subject, moment)`, `liegeAt(id)`; the houses overlay builds its graph from `liegeAt` (`buildGraph` takes a liege function); tests in `src/state/changes.test.ts` (Winterfell, Moat Cailin, Harrenhal, the Freys, seeds, show, history)
  - Show: only S1E10 is dated so far; 59 of 73 episode pages are missing from the wiki mirror, so other show dates wait for step 7
- [ ] **3. Places through time** (done: hiding, ruins, renames, battles, held-by row, pin arms; open: more seats changing hands)
  - [ ] places hidden before they exist or are known (`state`), drawn as ruin, or renamed, at the moment; label and search follow
  - [ ] the 58 battles of `tools/books/battles.json` appear from the chapter or year they are fought (or first told)
  - [ ] the card's "held by" row reads `holder` at the moment
  - [ ] first pass: the seats that change hands in the series (Winterfell, Moat Cailin, Deepwood Motte, Torrhen's Square, Harrenhal, Riverrun, Seagard, Dragonstone, Storm's End, the Twins' grants, Darry, Raventree Hall, Griffin's Roost, Rain House...), each with a quote
- [ ] **4. Territories and realms**
  - [ ] a seat taken by another house paints its territory in the holder's colour and realm (the polygon stays; its owner changes)
  - [ ] realm outlines from the liege graph at the moment (already runtime; feed it the resolved graph)
  - [ ] the ten regions stay static during the series
- [ ] **4b. Kingdoms before the Conquest** (history by year)
  - [ ] pick the source for the old borders (wiki kingdom articles, TWOIAF maps) and record it; until then an `assumption`
  - [ ] region polygons get dated changes: the riverlands under the Storm Kings, then Hoare's Kingdom of the Isles and the Rivers (-100 AC), the Seven Kingdoms at the Conquest, Dorne joining in 187 AC
  - [ ] kingdom names lettered over their land at the year
- [ ] **5. Spoiler-safe text**
  - [ ] book passages per chapter (rebuild `place-books.json` from `docs/sources/books/text` with chapter indexes); the card shows only passages at or before the moment
  - [ ] wiki lead hidden behind a "may contain spoilers" reveal when the moment is before the end of ADWD (or the show's end on that track)
  - [ ] house card: head and lord at the moment, not today's
  - [ ] characters: steps after the moment are not drawn (already chapter-keyed)
- [ ] **6. The control**
  - [ ] the year always shown at the bottom of the screen ("299 AC"), with the chapter or episode under it ("ACOK · Bran VI", "S2E6"); a click (or Enter) opens the timeline with the same `setTimeline(true)` the clock button calls (`src/main.ts`), clicking again or Esc closes it. It replaces `#timelineBtn` in `#nav` (one way in, not two), follows `onPeriod` as the drum turns, and sits clear of the phone bottom sheet and the safe-area inset
  - [ ] the `#when` drum gains a picker: track (Books / Show), then book and chapter, or season and episode; history years stay
  - [ ] step back and forward one chapter or episode
  - [ ] phone sheet
- [ ] **7. Show track**
  - [ ] episode list and show changes (only after decision on the source)
  - [ ] show-only differences recorded once per subject, e.g. Winterfell to Stark in S6E9, Hardhome destroyed in S5E8
- [ ] **8. Verify and record**: tests, `npm run lore -- check`, screenshots at AGOT start, ACOK end, ADWD end, S8E6; `lore-verifier` pass on the change list; findings, ARCHITECTURE, decision note

## Decided (2026-10-29, owner)

Answers: 1 start of AGOT; 2 the show as its own track; 3 publication order (not asked, kept); 4 wiki text behind a reveal; 5 pre-Conquest kingdoms included now (step 4b).

## Questions as asked (proposal in bold)

1. **Default moment** for a new visitor: the start of AGOT (safe), or the end of everything (spoilers for all)? **Start of AGOT, safe by default; the picker is one tap away.**
2. **The show as a source.** CLAUDE.md ranks books, wiki, blog, maps; the show is in none. Proposal: **the show is its own track with its own source (the episode itself, cited as S#E#, with the AWOIAF "TV series" sections as the reference), never used on the books track and never used to move a place.**
3. **AFFC and ADWD.** They run in parallel in-world. Publication order (AFFC fully before ADWD) is what a reader went through and what `characters.json` already uses. **Publication order.**
4. **Wiki text before the end of ADWD:** hide it behind a reveal, or hide it outright? **Behind a reveal.**
5. **Region borders over time** beyond the series (the seven kingdoms before the Conquest, Dorne outside the realm until 187 AC): now or later? **Later, as its own layer.**
