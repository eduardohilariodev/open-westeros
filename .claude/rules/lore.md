---
paths:
  - "tools/world/places.raw.txt"
  - "tools/world/*.mjs"
  - "tools/books/**"
  - "tools/blog/**"
  - "tools/lore/**"
  - "src/world-data.ts"
  - "src/roads.json"
  - "src/globe/wall*.ts"
---

# Changing where things are: what we learned

Read `CLAUDE.md` first (sources, claims, commands). These are the traps.

## Where a position lives

- Edit `tools/world/places.raw.txt`, then `npm run places`. The position field is `px,py` (painted map), `-`, `ll:lat,lon`, or `px,py>ll:lat,lon` (canon overrides the consensus but keeps the pixels). King's Landing keeps its pixels because `georef.mjs` anchors the whole georeference on them: an `ll:`-only King's Landing breaks `npm run places`.
- The Wall's castles, Mole's Town and the Wall landmark are generated from `src/globe/wallLine.ts` (the 300-mile line off the Gift map). Edit that file, not their rows. `consensus.mjs` and the globe both read it.
- `src/world-data.ts` is rounded to 0.01 degrees (about 0.75 mi): tolerances below 2 mi are meaningless.

## Units and tolerances

- 1 league = 3 miles (the Wall is "three hundred miles" and "a hundred leagues"). Our latitude degree is about 75 mi.
- The blog's road distances are close to straight-line distances; a painted road is about 1.2x longer, so do not "fix" a road to hit a blog figure.
- A place is on a coast or a river when it is within a few miles: shore 4, river mouth 6, confluence 6, on-river 6 to 10 ("overlooking" is looser).
- Sweep for places in the sea: `node tools/books/sea-sweep.mjs`. A wet place is a fit error (snap it to the shore, 1.5 mi inland) or an island the vector land lacks (list it in `island-places.json` with the reason). Never move an island castle onto the mainland.

## Roads

- Roads are routed over the relief, not traced (`docs/roads.md`, decision 0007). `tools/books/lore-roads.json` gives each road's places in order (`via`) and its book or wiki cites; `straight: true` for a Valyrian road (ruled lines), `joins` for a branch whose junction no text names, `along` for a river the road follows, `@lat,lon` for a bend the official map shows at no place of ours. *The Lands of Ice and Fire* outranks the painted map: read its course with `tools/books/liaf-grid.mjs` and `liaf-fit.mjs` (`docs/roads.md`). The ground picks the way between; the painted map is only a pull.
- To change a road's course, change its places or add one the lore names on it; never hand-draw or patch the output. To change how all roads behave, change a cost in `roads-trace.mjs` and update the table in `docs/roads.md`.
- Every seat gets a track to the nearest road by the same costs; a track several places share is drawn as a road. A place the road runs out to and back is a spur: the named line passes it by.
- A named road is lettered only if a place row of kind `road` has exactly its name. Landmark passes (Boneway, Prince's Pass) stay landmarks.
- After any move run `npm run lore -- roads`; a leg that winds over 1.6x, or does not connect, is a defect in the network or a misplaced place. `npm test` fails if a lore place is off the network or a stretch crosses itself.

## After the change

`npm run lore -- check`, `npx tsc --noEmit`, `npm test`. Report old to new, the quote, the miles moved, and what the roads did.
