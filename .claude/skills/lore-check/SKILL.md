---
name: lore-check
description: Use when a place, river, road, the Wall, a label or a distance on the Open Westeros map is added, moved, trusted or relied on, when a place looks far from the river, shore, road or hill the lore ties it to, or before building roads, routes or labels on place coordinates.
---

# Checking the map against the lore

## Overview

Positions in `places.raw.txt` are a guess until a passage and a measurement agree with them. Roads, labels and distances inherit a wrong place and look broken themselves. Check the place first, then build. King's Landing sat 15 mi inland of "the mouth of the Blackwater Rush"; Mole's Town sat 28 mi from a Castle Black it should touch; Crakehall was in the sea. A screenshot or memory found none of them.

## Steps

1. **Start** with `npm run lore -- place "Name"`: position and where it came from, existing claims, wiki lead, book passages, measured distances. `npm run lore -- find "term" ...` for anything else.
2. **Passage.** Quote the sentence that fixes it, in source order: novels and World of Ice & Fire, Fire & Blood, wiki, blog, maps. Read neighbours' passages too: they state the relation from the other side. Silent everywhere: record "canon silent" and keep the position.
3. **Measure** the claim in miles (`tools/books/place-checks.mjs` relations: river-mouth, on-river, confluence, coast, lake-shore, distance). Books give relations, not coordinates: leagues (3 mi), days, "at the mouth of". Those can be measured.
4. **Compare.** Allow the fit error (about 15 mi on the road maps) and the 0.75 mi rounding. Wrong side of water, inland of a coast it sits on, off its confluence, or far from a stated distance: a defect. A source map that disagrees with a quote loses.
5. **Record the claim** in `tools/books/place-checks.json` (or `travel.json`, `lore-roads.json`) with the quote and cite, before or with the fix, so the check keeps it true.
6. **Fix** with `editing-map-places` (where positions live, regenerating). Then `npm run lore -- roads` and `npm run lore -- check`.
7. **Second reader** for more than a few places: dispatch the `lore-verifier` agent with the claim and the sources, not your conclusion.
8. **Report** old to new, the quote, miles moved, what the roads did, and any conflict logged in `docs/lore-conflicts.md`.

Order of work: capitals and hubs, then castles and towns, then roads. `npm run lore -- report` lists what has no claim.

## Red flags

| Thought | Reality |
|---|---|
| "It's been there since the first import" | Age is not evidence. Measure it. |
| "It looks right on the globe" | A screenshot cannot show 15 mi. |
| "The wiki says so" | The wiki summarises the books. Check the book where one exists, and log disagreements. |
| "The wiki is vague, so I'll nudge it to fit" | Vague means keep it and say canon is silent. Never invent. |
| "I'll fix the road, the place is close enough" | The hub follows the place. Fix the place first. |
| "I know where it is" | From memory or the show, not this repo's data. Quote `docs/sources/books` or `docs/sources/wiki`. |
| "The blog gives 1500 mi, make the road match" | Blog road figures are nearly straight-line. Do not bend roads to them. |
| "It's in the sea, move it" | Check `island-places.json`: it may be an island the land lacks. |
| "The book gives no coordinates" | It gives leagues, days and "at the mouth of". Measure those. |
| "Both sources agree, so it's verified" | Check they are independent: the wiki quoting a book is one witness. |

All of these mean: go back to step 1.
