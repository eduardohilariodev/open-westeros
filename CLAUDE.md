# Open Westeros: instructions for Claude

Canon first, never invent (PRODUCT.md). Anything that says where something is (a place, river, road, the Wall, a distance or a label) is checked against the lore before it is changed or trusted.

## Lore first

- **Sources, highest first:** the novels, World of Ice & Fire, Fire & Blood (`docs/books/text`, built by `node tools/books/extract.mjs`), then the wiki (`docs/wiki`), then the Atlas of Ice and Fire blog (`docs/atlas-blog`), then the source maps (`assets/`). A book beats the wiki; say so when they disagree and log it in `docs/lore-conflicts.md`. Where all are silent, say "canon is silent" and keep the position.
- **A claim needs a quote** (book and chapter, or wiki page) and a measurement in miles. No quote, no move. Never move a place from a screenshot or from memory.
- **Places before roads.** Roads, labels and distances are derived from places.
- Use the `lore-check` skill for any map edit; use `editing-map-places` for the mechanics of a move; use the `lore-verifier` agent for an independent read.

## Commands

| Command | Does |
|---|---|
| `npm run lore -- find <term> [term ...]` | book sentences with every term, with book and chapter |
| `npm run lore -- place "Name"` | position, claims, wiki lead, book passages, distances to coast, rivers, roads |
| `npm run lore -- check` | all lore checks; exit 1 on any failure (also runs in the pre-commit hook and after edits, via `.claude/settings.json`) |
| `npm run lore -- roads` | regenerate places and roads, then check |
| `npm run lore -- report` | how much of the map has a lore claim |
| `npm run lore -- sources` | which sources are present and how fresh |

Claims live in `tools/books/`: `place-checks.json` (a place against a river, coast, lake or another place), `travel.json` (stated distances), `lore-roads.json` (the roads and their waypoints), `island-places.json` (places on islands the land lacks).

## Working here (Windows)

- Write or Edit files that hold regexes or backslashes; a shell heredoc strips the backslashes. Several files are CRLF: match `\r?\n` or use sed.
- Use the Grep tool, not `grep -E "a|b"`, for alternations: the output filter here mangles them.
- Generated, never hand-edited: `src/world-data.ts` (`npm run places`), `src/roads.json` (`node tools/blog/roads-trace.mjs`), `src/place-books.json`, `docs/books/` (git-ignored, copyrighted).
- Finish a map change with `npm run lore -- check`, `npx tsc --noEmit` and `npm test`.
