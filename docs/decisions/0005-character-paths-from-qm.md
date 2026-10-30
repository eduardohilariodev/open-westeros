# 0005: character paths come from quartermaester.info, adapted and checked

**Status:** accepted 2026-10-28

## Context
We want a character's journey on the map. Canon gives no coordinates for most of it; quartermaester.info already encodes a reading of the novels as stops per chapter.

## Decision
Use its stop order, chapter ranges and bends as a source map (the lowest rung in CLAUDE.md), never as a position: a place key takes our canon position, bends go through a fitted transform pinned to our places, and the result is checked against the book text (`tools/characters/qm-lore.mjs`) and the sea (`legs-check.mjs`). The generated `src/characters.json` is ours; the raw qm files stay git-ignored in `docs/sources/quartermaester/`.

## Consequences
- The qm author's work is credited in the character card. Ask the site's owner before shipping if that is not enough.
- Where qm and a book disagree the book wins and the conflict goes to `docs/lore-conflicts.md`.
- Wiki text for the cards is fetched by hand (`npm run characters:wiki`) because of the Cloudflare challenge.
