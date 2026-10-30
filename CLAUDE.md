# Open Westeros: instructions for Claude

Canon first, never invent (PRODUCT.md). Anything that says where something is (a place, river, road, the Wall, a distance or a label) is checked against the lore before it is changed or trusted.

## Lore first

- **Sources, highest first:** the novels, World of Ice & Fire, Fire & Blood (`docs/sources/books/text`, built by `node tools/books/extract.mjs`), then the wiki (`docs/sources/wiki`), then the Atlas of Ice and Fire blog (`docs/sources/atlas-blog`), then the source maps (`assets/`). A book beats the wiki; say so when they disagree and log it in `docs/lore-conflicts.md`. Where all are silent, say "canon is silent" and keep the position.
- **A claim needs a quote** (book and chapter, or wiki page) and a measurement in miles. No quote, no move. Never move a place from a screenshot or from memory.
- **Gaps in the lore are filled, not left blank.** Where canon gives no usable number (a height, width, depth, slope, colour, texture), make the best assumption from nature's rules, maths and a real-world equivalent; when in doubt, artistic interpretation and realism decide. Mark such a value `assumption` with its analogue and reason, next to the lore claims it must not contradict (`tools/books/range-heights.json`). Positions and relations stay canon-first: silent means keep.
- **Places before roads.** Roads, labels and distances are derived from places.
- Use the `lore-check` skill for any map edit; use `editing-map-places` for the mechanics of a move; use the `lore-verifier` agent for an independent read.

## Commands

| Command | Does |
|---|---|
| `npm run lore -- find <term> [term ...]` | book sentences with every term, with book and chapter |
| `npm run lore -- search <term> [--kind k]` / `near <lat> <lon>`, `near "Name"` | find places by name or neighbourhood, with the `/?place=Name` link |
| `npm run shot -- "Name" ["Name" ...] [--flat] [--eval js] [--when moment] [--houses] [--house id]` | headless Chrome: opens the world, flies to each place, saves `tmp/shots/<Name>.png`, prints JSON (card, tab title, address, altitude, console errors). Starts the dev server itself, about 30 s per run, then ~3 s per extra place |
| `npm run lore -- place "Name"` | position, claims, wiki lead, book passages, distances to coast, rivers, roads |
| `npm run lore -- check` | all lore checks; exit 1 on any failure (also runs in the pre-commit hook and after edits, via `.claude/settings.json`) |
| `npm run lore -- roads` | regenerate places and roads, then check |
| `npm run lore -- report` | how much of the map has a lore claim |
| `npm run lore -- sources` | which sources are present and how fresh |

Claims live in `tools/books/`: `place-checks.json` (a place against a river, coast, lake or another place), `travel.json` (stated distances), `lore-roads.json` (the roads and their waypoints), `island-places.json` (places on islands the land lacks).

## Write it down

When you build something, find a problem or its fix, learn a technique, or measure a limit, add an entry to `docs/findings.md` (what, evidence, so-what) before the turn ends. A change to structure or a tool also updates `docs/ARCHITECTURE.md`; a choice between options gets a `docs/decisions/` note. A task without its entry is unfinished, including a diagnosis with no code change and a task done in a hurry; use the `recording-findings` skill before the final message. Map: `docs/ARCHITECTURE.md` (data flow, generated files, build order), `docs/findings.md` (log).

## Working here (Windows)

- Write or Edit files that hold regexes or backslashes; a shell heredoc strips the backslashes. Several files are CRLF: match `\r?\n` or use sed.
- Use the Grep tool, not `grep -E "a|b"`, for alternations: the output filter here mangles them.
- Generated, never hand-edited: `src/world-data.ts` (`npm run places`), `src/roads.json` (`node tools/blog/roads-trace.mjs`), `src/place-books.json`, `docs/sources/books/` (git-ignored, copyrighted).
- Finish a map change with `npm run lore -- check`, `npx tsc --noEmit` and `npm test`.
