`# Findings log
`
`Append-only, newest first. One entry per thing the next session would otherwise rediscover: a problem and its fix, a technique, a limit, a measurement. Decisions go in `docs/decisions/`, terms in `GLOSSARY.md`, structure in `ARCHITECTURE.md`, lore conflicts in `lore-conflicts.md`.
`
`Entry format:
`
````
`## YYYY-MM-DD area: one-line finding
`- What: ...
`- Evidence: command, file, number
`- So: what to do or avoid next time
````
`
`## 2026-10-30 ui: spoiler gate removed; battle dates; 40 more card images
- What: the wiki text now shows without the spoiler button (`src/ui/spoiler.ts` deleted, panels read the wiki directly). Every battle card has a Date fact: the wiki's, else "Not dated in canon" (place-info.mjs). `article.parse` rewrites `/images/...` picture links to the thumb.php form, and the hero falls back to the best article picture when the lead has none. Redgrass Field and Battle at Mummer's Ford now map to their battle articles (ALIASES in scrape.mjs).
- Evidence: places without an image 177 -> 137; battles without a Date 11 -> 0 real gaps (9 say not dated).
- So: the remaining 137 have no picture in their article; they need another source.

## 2026-10-30 deploy: vercel uploaded ~1 GB because .vercelignore missed docs/, tmp/, .cache/
- What: the CLI deploy (`npx vercel deploy --prod`, Git deploys off) uploads every file not in `.vercelignore`. `docs/` (349 MB, wiki and book dumps), `tmp/` (386 MB, screenshots) and `.cache/` (102 MB, scraper browser profile) went up next to `public/` (212 MB). Added all three to `.vercelignore`.
- Evidence: `du -sh`; the last READY production deploy was 2026-10-23. The build reads `tools/books/timeline.json` (`src/state/changes.ts`), so `tools/` must stay uploaded.
- So: a new large local folder outside `public/`, `src/`, `tools/` goes in `.vercelignore` too.

## 2026-10-29 ui: island, archipelago and forest labels shared near-identical greens
`- What: `.k-island` and `.k-archipelago` were both #a6e0b8 and `.k-forest` #9fd6b0, so the three read as one. Now island darker teal #3fb5aa, archipelago teal #6fd8d0, forest leaf green #84c96b (`src/ui/style.css`).
`- Evidence: colours only; all light on the dark #101c1b stroke, so above 4.5:1. Not checked on screen.
`- Also: island names now show below 1,600 km (was 3,000 km), the castles' height, so they come in closer (`LOD.island` in `GlobeView.ts`).
`- So: keep each kind distinct within its family (globe-labels rule); teal stays clear of the water blues (#a9d4ff).
`
`## 2026-10-29 ui: search ignored a place's other names and cut off at 8 results
`- What: search scored only `label`. A place shown as "Vaes Graddakh (Sarys)" (`place-alt.json`) could not be found by its other name, nor "Gift" for Brandon's Gift (wiki article title, `place-info.ts`). It also kept only 8 hits. `main.ts` now gives each map and 3D-site item `alt` (place-alt name + wiki title minus its parenthetical), scores the best of name and aliases (alias +0.5), shows the matching alias in the row, and keeps 40 hits.
`- Evidence: 212 of 635 places in `place-wiki.json` have a wiki title different from the map name; `npx tsc --noEmit` clean.
`- So: another name for a place goes in `place-alt.json` or its wiki title; search picks it up. Not covered: `?place=` links and `onNavigate` still match the map name only; characters and houses have no aliases.
`
`## 2026-10-29 sources: docs/sources/ shelved by kind and trust; Beyond the Wall was being searched as canon
`- What: `docs/books`, `wiki`, `atlas-blog`, `qm`, `scripts` moved under `docs/sources/` as `books/` (GRRM prose + `text/` + `places.json`), `maps/` (The Lands of Ice and Fire), `wiki/`, `atlas-blog/`, `quartermaester/`, `criticism/` (Beyond the Wall), `screen/` (`hbo-scripts/`, `genius-transcripts/`). Book files renamed to their slugs; `extract.mjs` now takes the slug from the filename instead of matching titles. Catalogue: `docs/sources/README.md`.
`- Evidence: `find.mjs` searches every `.txt` in `books/text`, and `beyond-the-wall.txt` (essays by other authors) was there, so `lore find` could cite it as a book. `extract.mjs` treated any PDF as World of Ice & Fire; the Lands of Ice and Fire PDF only lost to it by alphabetical order. Paths rewritten in 43 files; `git mv docs/atlas-blog` failed with "Permission denied" (a watcher held the folder), but moving its children one by one worked. After: `extract.mjs` gives the same 8 books, `lore check` clean, `tsc` clean, 58 tests pass.
`- So: new source = new shelf folder + a README row + a `.gitignore` line if copyrighted. Name book files by slug. `tmp/fit.mjs` and `tmp/match.mjs` (scratch) still point at the old paths.
`
`## 2026-10-29 sources: Genius transcripts are off-limits to Claude
`- What: we asked to scrape the GoT transcripts on genius.com/artists/Game-of-thrones; declined.
`- Evidence: genius.com/robots.txt has `Disallow: /` for anthropic-ai, ClaudeBot, ChatGPT-User, GPTBot and other AI agents.
`- So: don't scrape Genius with Claude. The user can read it directly; for local copies use a source that allows it (ScriptSlug, see below).
`- Later: the user supplied pages they had saved; all 73 GoT episodes were converted to `docs/sources/screen/genius-transcripts/*.txt` (git-ignored, ~492k words). The transcript is the `data-lyrics-container="true"` divs; each starts with a `data-exclude-from-selection` header (contributors, title, blurb + "Read More") with nested divs, which needs matched-div removal, not a regex. The Prince of Winterfell came only from the season-2 folder.
`
`## 2026-10-29 sources: ScriptSlug has only 6 GoT/HotD scripts, saved to docs/sources/screen (git-ignored)
`- What: ScriptSlug hosts 5 Game of Thrones episodes (101, 510, 609, 707, 806) and 1 House of the Dragon episode (101), not full seasons. The PDFs are in `docs/sources/screen/` (copyrighted, added to `.gitignore` like `docs/sources/books/`).
`- Evidence: the sitemap (`sitemap.xml` → `sitemap-scripts.xml`) lists only these six. The series pages load their episode lists with JS, so plain curl shows none. The PDF link is `assets.scriptslug.com/live/pdf/scripts/<slug>.pdf`, but the slug can differ from the page's (HotD's is `house-of-the-dragons-…`), so take the link from the script page. robots.txt allows `Claude-User` there and forbids AI training (ai.txt).
`- So: these are show scripts, which are not in the canon order in CLAUDE.md. Use them for show-only questions, never to place things on the map.
`
`## 2026-10-29 assets: fonts self-hosted, service worker caches every fetch, 5 sigils were never downloaded
`- What: Google Fonts replaced by `public/fonts/` (latin + latin-ext woff2, `fonts.css`, OFL). `public/sw.js` (registered from `main.ts` in builds only) serves our files cache-first from `static-<build>` (`__BUILD__`, vite.config `define`; a deploy drops the old cache) and the wiki's thumb.php pictures from a permanent `wiki` cache. `sigilUrl` stripped only `.svg`, so `Hawick.png` / `Tawney.png` asked for `*.png.webp` (404); now strips any extension. `scrape.mjs --sigils` only read `docs/sources/wiki/_sigils.json` (place houses), so houses-mode sigils were missing: Baelish_of_Harrenhal, Norrey, Slynt, Whent, Seaworth. It now adds `src/houses.json`.
`- Evidence: headless Chrome on `vite preview`: first load 10 network + 18 SW, reload 1 network (the page) + 27 SW. `--sigils` failed with Chrome exit 21 = profile in use: an orphan Chrome (a timed-out run) still held `.cache/awoiaf-profile`; once killed, the window closed again during the challenge. Plain curl to `Special:FilePath/<file>` gets 200 with no challenge, so `--sigils` now runs before the browser launch, with curl (cookie sent if `AWOIAF_COOKIE` is set). All 5 fetched; every sigil houses.json, characters.json and place-wiki.json names is on disk.
`- So: Chrome exit 21 from scrape.mjs = kill the Chrome processes whose command line has `awoiaf-profile`. A character's sigil reaches the list only through `character-info.mjs` (Seaworth was fetched by hand). Wiki gallery/lead pictures stay hot-linked (fan art under each artist's licence, not CC BY-SA like the sigils); the SW caches them per browser instead. `character-info.mjs` rewrites `src/character-wiki.json` with partial data that fails `tsc` (facts typed `string[][]`): don't run it alone.
`
`## 2026-10-29 ui: legend rows sorted alphabetically by label
`- What: the legend in `src/main.ts` now sorts kinds by their label (`localeCompare`) instead of the `PLACE_KINDS` order.
`- Evidence: `.filter(...).sort(...)` runs on the filtered copy, so `PLACE_KINDS` (the legend order other code may rely on) is not mutated; `npx tsc --noEmit` clean.
`- So: change the order in `main.ts`, not in `placeIcons.ts`.
`
`## 2026-10-29 globe: tracks dotted; relief never got its road widths; the dev server watched the scraper's profile
`- What: tracks (`minor`) are dotted (`LineMaterial` `dashed`, both halo and ink, the halo's dash 1 px longer each side), 3 px dots every 10 px, kept that size on screen by `setTrackDots(metresPerPixel)` each frame (dashes are in metres). Track widths: flat 4.4/2.6, relief 4.8/3 px. `restyle` only ran on a look switch, so the relief (the opening look) kept the constructor widths: `createTerrain` now calls `restyle(false)` once.
`- Evidence: `npm run shot` timed out at page load for every place; vite with no config watched `.cache/awoiaf-profile` (EBUSY on locked browser files), `docs/` and `tmp/`, 6-8 s a module. `vite.config.ts` now ignores `.cache`, `docs`, `tmp`, `assets` in the watcher; shots load again.
`- So: a hung `npm run shot` is likely a stale vite on 5199 (kill it) or the watcher; check `tmp/vite.log`-style output before blaming the page.
`
`## 2026-10-29 roads: The Lands of Ice and Fire as the road course; Valyrian roads ruled
`- What: Valyrian roads (`straight`) are now ruled lines place to place, routed only where a line would cross water (4 legs: ruin to Mantarys, Bhorash to Meereen, the Ghiscari coast, the Long Summer coast). From the official sheets: the demon road bends at a town and a ruin west of Mantarys and turns before Meereen (`@` waypoints); the Long Summer coast road (Oros, a west-coast ruin, back to the demon road) added; the river road follows the Red Fork (`along`); the goldroad runs well south of Stoney Sept (3 waypoints); the kingsroad passes east of the Twins (dropped from `via`).
`- Evidence: before, the river road ran 20-25 mi south of the Red Fork and the goldroad went up the Blackwater through Stoney Sept. A whole-sheet affine fit of p13 to our places is 4-37 mi off (Riverrun 37); a regional one 5-30. Kingsroad now 2669 mi vs 2600 stated, goldroad 839 vs 800. Ocean Road, Roseroad, Boneway, Prince's Pass and the high road already matched the sheet. The sheet draws no road to White Harbor and none inside Dorne.
`- So: read a road off the sheet with `tools/books/liaf-grid.mjs` and `liaf-fit.mjs` (one region at a time) before trusting the router alone; the sheet's roads are faint dotted lines, the rivers solid.
`
`## 2026-10-29 roads: routed over the relief instead of traced; the old patches were the artifacts
`- What: the bulbs at coasts, the staircases in the Vale, the triangle at Casterly Rock, the Essos spaghetti and Highgarden off its junction all came from patches on the traced ink (gap bridges, `hubs.json`, the coastal A* on a 2 km grid, loop and bulb cutters). `roads-trace.mjs` now routes `lore-roads.json` legs by least cost over `relief-h.webp` (slope, swamp, river crossings, sea, lakes and the Wall impassable), with the painted ink as a 0.75x pull and laid edges at 0.35x so roads merge. Each graph stretch is smoothed once. Every seat gets a track; a track shared by 3+ places is a road.
`- Evidence: every lore waypoint is 0-1 mi from its road (was 15-70); no stretch crosses itself (new test in `roads-graph.test.mjs`); Kingsroad 2730 mi vs 2600 stated (was 3033); Volantis-Mantarys 598 vs 600; ~30 s a run. Added the Valyrian network from wiki Valyrian roads (Pentos, Ghoyan Drohe, Norvos, Qohor; branches to Ar Noy, Sarnath, Saath, Oros, Tolos, and Volantis to Sar Mell; one witness, the wiki citing the *Lands of Ice and Fire* maps: see `lore-conflicts.md`), `straight: true` (grade tolerance 15%, no pull).
`- Traps found: the river barrier must use the flat map's canon river lines too, or a road runs on top of the drawn river (Qohor); castle reach under ~300 mi left Deepwood Motte (275 mi) and Karhold (327) unjoined; the Wall must be a barrier with gates at Castle Black, Eastwatch and the Shadow Tower or tracks cross it.
`- Map check (same day): *The Lands of Ice and Fire* (PDF in `docs/sources/books/`, pages are small raster scans: GDAL renders them, 1500 dpi gives ~2700x4000 px) draws every wiki-only Valyrian leg as a straight road; it puts the Tolos branch due north of Tolos, ~110 mi east of Mantarys (now `joins`), and no Pentos-Myr road (city tracks are no longer promoted to roads).
`- So: change a road by changing its lore places or a cost (`docs/roads.md` table), never by patching output. Open: Yi Ti has no lore roads (only local tracks), Asabhad is 281 mi off the network.
`
`## 2026-10-29 labels: colour by family, white only for capitals and castles
`- What: five kinds were near-white (region, city, town, continent, monument) and castles and capitals shared a salmon that sat beside battle and landmark. Now capitals and castles are `#fff`; settlements go gold to taupe by size (city `#ffe2a0`, town `#cfc8ba`, minor `#b3a794`); region `#e6d6b4`; river `#8fc6f2` (deeper than the sea names); wild `#e0a868`; monument `#d9b8ff`; hover `#ffd24a`.
`- Evidence: every new colour is 7.4:1 or more against the `#101c1b` stroke (minor is the lowest). `npm run shot -- "Riverrun" "King's Landing"` shows the castles in white and the keeps falling back in taupe. The old comment and rule said "parchment/white stroke"; the stroke is dark.
`- So: a new kind takes a colour from its family (see `globe-labels.md`), not a new white.
`
`## 2026-10-29 houses: territories traced from the reference house map, warped onto our seats
`- What: `house-territories.mjs` now warps the poster onto our grid (cubic coast fit plus a thin-plate spline pinning 141 seats onto their house labels, `tools/world/house-poster.json`), samples each cell's fill (7x7 median drops the line art) and floods from all seats with a colour-edge cost. Fixes Umber running to the Wall and Skagos spilling over. The Gift (North region, 150 mi from the Wall) is held by nobody.
`- Evidence: the coast fit converges to a stretched local minimum from a bounding-box start; a grid search of an axis-aligned affine on land/sea agreement (0.87) then ICP at degree 1, 2, 3 gives about 1.75 px (at 1/4 scale) mean coast error. Poster seats sit up to 110 px (~1.5 degrees) from ours, so a flood from our seats on the raw fit starts in the wrong territory; anchors fix that. The Gift's parchment median (166,146,127) matches Woolfield's (171,153,131), so it is cut by canon distance, not colour. A Float32Array of Dijkstra costs never finished (`fround` rounds up, so `nd < best[n]` stays true and the cell is pushed forever); with Float64 the whole build takes 16 s. Every cell against 900 spline points took minutes; a 0.2-degree lattice read bilinearly takes under a second.
`- So: a house without an anchor floods from its own seat (12 now: small Iron Islands houses, Osgrey, Smallwood, Royce of the Gates of the Moon). Add an anchor (poster pixels, the centre of its name label) when one looks wrong. Rebuilding needs `assets/world/houses/poster.png` locally. Use Float64 for Dijkstra costs.
`
`## 2026-10-29 labels: at the 600 km floor every place is named
`- What: at the floor, the height bands already let every kind through; the missing names (Casterly Rock under Lannisport, Fair Isle, Wendish Town, Sallydance, Riverbend, Harroway, Ruby Ford) lost the overlap test. Below 1.1 × `MIN_ALT`, point places now go first and claim their box with `force` (`declutter.ts`); area and line lettering makes way. The God's Eye and Straits of Fair Isle lettering then gives way to the Isle of Faces and Fair Isle.
`- Evidence: `npm run shot -- "Riverrun" "Lannisport" --eval "$(cat tmp/labeleval.js)"` (projects `PLACES` with the camera, lists the point places on screen with no shown label): 5 and 2 missing before, 0 after.
`- So: forced names can touch at the floor (the Crossroads Inn cluster); if that reads badly, nudge the text side rather than hide the name.
`
`## 2026-10-29 ui: search results hid under the phone sheets; house rows show their arms
`- What: `#results` sits inside `.searchbox`, whose `backdrop-filter` makes it a stacking context at z auto, so the place and house bottom sheets (z 25, same `#side`) painted over the results whatever `#results`' own z-index. `.searchbox` now has `position: relative; z-index: 30`. House rows in the results show `sigilUrl(h)` instead of the shield icon.
`- Evidence: `npm run shot -- "Winterfell" --size 420x600 --eval` with `elementFromPoint` on the overlap: `place` before, `results` after. `shot.mjs` screenshots before `--eval` runs, so a UI state set by `--eval` isn't in the PNG.
`- So: anything with `backdrop-filter`, `filter`, `opacity < 1` or a `transform` traps its children's z-index; raise the wrapper, not the child.
`
`## 2026-10-29 wiki: past Cloudflare with curl and a cf_clearance cookie, or from the Wayback Machine
`- What: `tools/wiki/scrape.mjs` takes `AWOIAF_COOKIE=<cf_clearance>` (optional `AWOIAF_UA`) and calls the API through curl, headless, with no hand-solved challenge. An article the live site refuses falls back to its latest Wayback copy (`--wayback` forces it), marked `copy:` in the frontmatter. `--categories` walks a category tree, 500 members a call.
`- Evidence: curl with the cookie: `parse` and `categorymembers` 200. Node `fetch` with the same cookie and user agent: 403 "Just a moment" (Cloudflare reads its handshake, not only the cookie). curl without the cookie: `siteinfo` 200, real queries challenged. Wayback `web/<ts>id_/` copies hold `.mw-parser-output`, `wgRevisionId` and `#catlinks`; same markdown as live, older revision (Battle at the Mummer's Ford: 306447 against 354132). archive.org answers 429 after a few quick calls, so 3 to 5 s between them.
`- So: `Category:Places` does not exist; the root of places is `Category:Geography` (Places in Westeros/Essos/..., Structures, Islands...). `parse` cannot batch, so a full mirror is one call per article, about 2 s each; an expired cookie stops the run, rerun with a fresh one to resume. The hidden Chrome died once after ~2,700 articles and every later article failed in a second ("Target page, context or browser has been closed"); the script now starts a new Chrome when that happens (tested by killing it mid-run: one article fails, the run goes on).
`
`## 2026-10-28 characters: journeys from quartermaester.info, adapted to our map (tools/characters, src/characters.json)
`
`- **What:** quartermaester.info (qm) is static: `ASoIaF-overlays.js` holds `paths["name"] = [{line|arrow|icon, chapters, episodes, path|coord|key}]` for 27 characters and a `locations` table of 245 places; `ASoIaF-events.js` has the chapter table ("AGOT-12: Eddard II"). qm's lat/lng are Google-Mercator on its own tile art, not our degrees. `qm-extract.mjs` reads both into git-ignored `docs/sources/quartermaester/`; `qm-map.mjs` matches 214 of 245 places to `PLACES` by name (duplicates such as the two Oakensheilds resolve to the nearest candidate), fits a quadratic (lng, Mercator y) -> (lon, lat) and adds an inverse-distance residual so every matched place lands exactly on our position; `build.mjs` writes `src/characters.json` (27 characters, 521 steps, 95 KB). A place key always takes our canon position; only bends and unmatched spots (18 inns and villages) use the transform, blended along a leg between its stops so a line still meets them.
`- **Evidence:** fit median about 27 miles on 189 anchors; 24 qm places differ from ours by 84 to 1,037 miles (Essos, and the west Riverlands/Westerlands: Raventree, Pennytree, Tarbeck, Oxcross, Fawnton, Wendish Town). `qm-lore.mjs` maps all 344 qm chapters to the book text (a chapter title can be a bare capitals line, not a `## ` heading, e.g. THE KRAKEN'S DAUGHTER) and finds 433 of 536 named stops said in their chapters. `legs-check.mjs` lists legs in the sea: 47 at 20% or more, mostly real voyages (Davos, Sansa to the Eyrie, Arya to Braavos); the Quiet Isle is ferried to (AFFC, Brienne). Open: Astapor to Yunkai and Yunkai to near Yunkai are land marches that clip our Essos coast; the 103 stops the books do not name are unreviewed.
`- **So what:** qm is a source map, the lowest rung: it gives stop order and chapter ranges, never a position. Review a leg with `legs-check.mjs <id>` and `npm run lore -- find`, then fix the point in qm-map or an override, not in `src/characters.json`. Map layer: `src/globe/characterPath.ts` (line, arrows, sigil head, player), `pathMath.ts` (tested), `cameraRig.follow()`; the card is the place card in character mode (`ui/characterPanel.ts`). Wiki text and portraits need `npm run characters:wiki` run by hand: awoiaf is behind a Cloudflare challenge, so the scraper needs a person at its Chrome window. Another author's data: credited in the card, raw files not committed.
`
`## 2026-10-29 terrain: Trident window baked at 4.2 / 2.1 / 1 km; test bakes load in the globe with ?bake=
`
`- **What:** `terrain-cli.mjs --out <name>` writes a bake (a window too) to `public/world-test/<name>/` with its bounds JSON. The globe loads it with `?bake=<name>` (`src/globe/bake.ts` picks `BAKE_DIR` and `B`). `RIVER_CELLS` now scales with `(0.035 / RES)²`, so the threshold stays at about 1,300 km² of catchment at any grid; before, it was a cell count. Rivers in the land shader are drawn like the bake's flow preview: a 1-2.5 px line by flow, the preview's blue ramp, no meander noise (`lift.ts`), no mud or foam. Lakes have no detail under them, and the ground sinks 50 m under the vector outline (`tL` mask built in `lift.ts`, no bake needed). Lake water has no surf band.
`- **Evidence:** window bake times 19 s, 46 s and 149 s. River cells 7,020, 15,074 and 30,601. Canon paths within 8 km of a river cell 80%, 84% and 84%; median distance 3.4, 2.1 and 2.1 km. Shots: `npm run shot -- "Riverrun" --zoom 0.0001 --query bake=trident-1km`. The comparison page is a published artifact; the previews are in `tmp/river-sims/res-*`.
`- **So:** at 1 km the rivers turn into smooth bends and the relief carries its own gullies. The canon corridors read as wide, too-even green plains, which real erosion (phase 5b) should cut into valleys. A whole-world CPU bake is about 15 min at 2.1 km; at 1 km it is about 50 min, but too much memory for the current pipeline (phase 5 GPU tiles).
`
`## 2026-10-29 water: at 400 km rivers are sub-pixel staircases and lakes fill with land; a drawing problem, not a resolution one
`
`- **What:** at the 400 km floor (about 460 m/px) the relief draws rivers at true width (0.12-1.6 km, a 1.5 px floor). Their course is the channel rebuilt from `relief-e`, traced from 4.2 km D8 cells, which gives the staircase. Tributaries below the 90-cell threshold break into dashes. The vector river lines are hidden in 3D (`relief.ts`, `riverLines.visible`). God's Eye shows as green land with a few water holes.
`- **Evidence:** `npm run shot -- "Harrenhal" "Riverrun" --zoom 0.0001 --out tmp/shots/water`. `relief-h` across God's Eye at lat 38.5 (`tmp/lakeprobe.mjs`): the floor is 0.5-1 m and the shores 50-200 m, so the bake's levelled bowl is there. The water is the vector polygon lifted by `lift()` at its corners (edges up to 0.6°). The mesh under it adds `detailHV`/`detailH` bumps of tens of metres, times 4.5-6, which rise through the sheet.
`- **So:** a 1 km bake only makes the staircase 4x finer. Draw rivers as ribbons from the canon lines, 1.5-3 px by size, the way the Wall keeps 2.5 px. Draw each lake flat at its bake level, with no procedural detail under it (needs the bake's levels and a lake mask). Roadmap phase 4b.
`
`## 2026-10-28 camera: floor rerouted to 400 km; ground photos removed; procedural detail resized; four traps
`
`- **What:** the owner's "20 km" was 400 km (about the ISS). From there, with the 45° fov, a pixel covers 150-450 m. Retuned: `MIN_ALT = 400_000`, `detail.ts` windows 1200 / 400 / 160 km, exaggeration eased over 400-3000 km (4.5x at the floor), sky never blue. The Poly Haven ground photos are gone; `relief.ts` paints farm districts (~4 km), forest clumps (~1.5 km), drainage streaks down the slope (~1 x 6 km) and a light bump, each fading with the pixel footprint `fw`.
`- **Evidence:** `npm run shot -- "Riverrun" "Giant's Lance" "Sunspear" "Winterfell" --zoom 0.0001 --tilt 0.7 --out tmp/shots/f400` lands at 400-420 km. The Vale reads well. Lowlands are soft (the 4.2 km bake is ~10-25 px a texel here), Winterfell has a smeared snow-class streak, and Dorne is flat: those are for the 1 km bake.
`- **Traps:**
`  - `dot(p, east)` with `east` built from `vDir` is always 0. Local plane coordinates need lon/lat km (`atan(x, z) cos(lat) R`, `lat R`).
`  - Turning a grid by a varying angle about the far-away origin smears it into swirls. Use one or two fixed angles.
`  - A backtick inside a comment in a GLSL template literal ends the template. `tsc` passed, but Vite answered 500 and the page hung on the loading screen. Find it with `curl localhost:<port>/src/globe/relief.ts`.
`  - The debug readout's "lean" is the adaptive flag, not the program being drawn.
`  - `shot.mjs --zoom` cancelled the flight. It now zooms and tilts after the flight settles.
`- **So:** size procedural features to the floor (more than about 2 px there) and check each one with a debug paint before tuning its strength.
`
`## 2026-10-28 camera: 20 km floor above the drawn ground (since raised to 400 km, above); 3D sites moved to their own full-screen view
`
`- **What:** decision 0003 (bird's-eye world). `cameraRig.ts` `MIN_ALT = 20_000` now counts from the drawn ground under the camera (`groundAt`), not the sphere: near-ground exaggeration (3x, `lift.ts exaggeration`) lifts a 7.9 km summit to about 23 km, so a sphere-based floor put the camera inside the Vale. `flyToDir` (unclamped before) and `flyToFit` clamp to the floor. Site handoff (`sites/handoff.ts`), relief flattening at sites (`siteFade`, `uSites`) and the near-site vector subdivision are gone. `src/ui/modelViewer.ts` shows a site in a full-screen overlay (z 20, under `#side` so the card stays beside it) with its own `WebGLRenderer` and `OrbitControls`, opened from a "3D model" button beside Wiki; the globe loop sleeps while it is open.
`- **Evidence:** `npm run shot -- "Giant's Lance" --zoom 0.0001 --tilt 1.1` stops at 42.9 km. `?place=Winterfell&view=3d` loads in about 3 s headless; clicking Great Keep shows its card, keeps the 3D button and sets `?place=Great+Keep&view=3d`.
`- **So what:** the globe loop must draw its first frame even under the viewer, or the loading screen never lifts (`ready && modelOpen()` in `main.ts`). Places inside a site join search only after that site has been opened once (their names live in the site data, not `world-data.ts`).
`
`## 2026-10-27 mobile: a low-quality profile (src/quality.ts) so phones stop running out of GPU memory
`
`- **What:** the full scene held about 1 GB of GPU textures: 8192x4096 sky and cloud jpgs (~170 MB each with mips), relief maps 4743x2343 (a, b, e: ~56 MB each, h ~59 MB), a 4096 px shadow map, a 32-layer ground array, plus MSAA and a 2x pixel ratio. `src/quality.ts` guesses a weak device (coarse pointer and a screen of 1100 px or less, or `deviceMemory` of 4 or less; `?quality=low|high` forces it) and `Q` then gives: no MSAA, pixel ratio 1.5, sky and cloud maps shrunk to 2048 px while decoding (`loadTexture`), relief a and b to 2400 px, ground layers 256 px, anisotropy 2, shadow map 2048, mesh vertices 10 px apart instead of 6, no cloud layer, no erosion detail buffers (the costliest fragment shader). The canvas also handles `webglcontextlost`, so the browser can restore it.
`- **Evidence:** `npm run shot -- "King's Landing" --size 390x844 --query quality=low` renders with no errors beyond a cross-origin image block; `tsc` and tests pass. Not measured on a real phone.
`- **So what:** relief-h (CPU height lookups, cell units) and relief-e (texel-sized river field) stay full size, so a GPU with a 4096 px max texture still fails; shrinking them means re-baking. Add new big textures through `loadTexture` and `Q`. `shot.mjs` gained `--query`.
`
`## 2026-10-27 terrain: 2D fractal river network for the Riverlands (rivers2d-gen.js, rivers2d.html)
`
`- **What:** `rivers2d-gen.js` (pure JS, reusable by the bake) turns the 55 canon rivers in the Riverlands box (1091 x 1217 km) into a tree (mouth = end touching another river, discharge Q = km drained, width 0.035 Q^0.6 km), meanders each with a sine-generated curve (wavelength 11 widths, drift removed so the canon course holds), pins tributaries to the generated parent, then grows Horton-like tributaries recursively (depth 4: 5 to 12k paths, 150 to 240k vertices). `rivers2d.html` draws it blue on white with pan and zoom (px/km and scale bar shown); `?h=1` uses baked heights, `e` exports JSON.
`- **Evidence:** headless build takes about 0.35 s. First version (even spacing, steady angle) looked like a fern; exponential spacing, lognormal lengths, angles 35 to 75 degrees and weaker wobble gave a dendritic pattern. Remaining: a few wide canon tributary stubs still cross the main stem, mild main-stem meanders, no terrain awareness unless `?h=1`.
`- **So what:** the network is a vector layer separate from the terrain, so the particle sim only has to refine it, not invent it.
`
`## 2026-10-27 terrain: first particle-erosion river sim (rivers-sim.js), not yet better than the line sim
`
`- **What:** `rivers-sim.js` carves the canon lines as a valley (monotone bed, flat floodplain, 10% walls, 3 m seed trench), then rolls particles with inertia and a momentum map (Nick McD's mechanism) that erode fast, deposit slow, and cut the bank in front of flow that leaves its gradient. Headless harness `scratchpad/sim2.mjs` writes a hillshade and change map PNG. Not wired into `main.js` yet.
`- **Evidence:** first run (strong erosion, no valley limit) turned the whole 28 km window into one basin. After clamping each cell to -12/+6 m, killing particles that leave the 3 km valley and lowering rates, the water stays on the canon course and forms a channel network. But the channel is jagged and blobby, pools form where a line meets the window edge, and no meanders emerge. Cost: about 30 s for 80 epochs x 3000 particles on 384 cells (line sim: about 1.5 s).
`- **Round 2 (same day):** replaced vertical erosion with an explicit meander drive (curvature of the particle's path: cut the bank just outside the channel on the outer side, build the bank at the channel edge on the inner side), Chaikin-smoothed the canon line first (raw canon kinks became a sawtooth channel), added a no-progress cutoff (particles orbited in pits). 120 epochs x 3000 on 384 cells: 19 s headless. Wavy, meander-like reaches now appear on the flatter east part, but they are noisy and multi-threaded, and a few pit orbits remain. Inner-bank deposit inside the channel dammed it, which made the pits.
`- **So what:** the particle route needs real tuning (momentum coupling, deposit on the inside bank, boundary handling) and a faster inner loop before it can beat the line sim; it is a bake-time tool at this cost, not a lab-time one.
`
`## 2026-10-27 terrain: hairpin loops, tributary stub as wide as the main river, no mouth direction
`
`- **What:** user circled a hairpin on `riverrun`. Canon data is fine (river 125 is a gentle line; river 127 is a 10 km stub from the junction). Causes: (1) bends could close into C/P loops; (2) river direction came only from terrain height, so a stub could point away from its main river; (3) the stub took the main river's width.
`- **Fix (`rivers-lab.js`):** an end within 1.5 km of another river is the mouth (that decides the flow direction); a river that starts in the window gets discharge `0.12 + 0.55 (km from source/30)^0.7`; migration stops within 3.5 to 4 km of a junction; migration fades out when a reach turns more than 50 to 75 degrees from its canon heading (no closed loops); sinuosity ceiling 1.25 to 1.55. `riverrun` sinuosity 1.42/1.25, no loops (`river-fix-7.png`).
`- **Open:** hatched wall faces beside the river (bank height jumps between reaches); a tributary's mouth meets the main river's canon line, not its simulated line, so it can miss by up to the 2.5 km belt.
`
`## 2026-10-27 terrain: bends were hooks because the minimum radius was 2.5 widths (reference photo: 4 to 6)
`
`- **What:** user compared the lab to a photo of a real lowland river (broad, smooth, near-constant width). `rivers-lab.js`: curvature cap 1/(5w), curvature low-pass over 3.5 widths, cut-off at 3.2w, final line smoothing 14 passes, width variation reduced to about ±18%. `main.js`: valley-wall cut limited to 40 m below the original ground. Sinuosity `riverrun` 1.34/1.58, testbed 1.28/1.09/1.07.
`- **Tried and dropped:** bank-top height from the terrain under the river (not the canon line) made the walls deeper (ground -0.25 km) and added a step where two reaches of one loop meet. Kept the canon-line height, capped at ground + 30 m.
`- **Evidence:** `assets/terrain-lab/proto/river-fix-3.png` (smooth bends), `river-fix-5.png` (final). Hatched wall faces and a seam still show where adjacent reaches take different bank heights; the real fix is a bank height that varies smoothly across the floodplain, not per nearest segment.
`
`## 2026-10-27 terrain: river width varies, confined valleys stay straight, scroll bars on inner banks
`
`- **What:** `rivers-lab.js`: width varies along the river (wider through bends, narrower on straights, slow noise); valley confinement (terrain 2.5 km either side of the line more than 0.12 to 0.45 km above the bank) scales migration down to 8%, so rivers stay straight between hills. `main.js` variant 3: scroll bars, 1.2 m ridges and swales following the channel on the inner bank. Headless testbed sinuosity 1.31/1.13/1.09; `riverrun` 1.26/1.64.
`- **Evidence:** `assets/terrain-lab/proto/river-fix-2.png`. Width variation is visible; scroll bars are too faint to judge at this zoom, and a seam in the left reach and an isolated river patch at the top right remain.
`- **So what:** point bars and abandoned-channel scars are not stamped (the texture holds one nearest feature per texel); the shader fakes scrolls from the distance field. Real scars need a second texture layer.
`
`## 2026-10-27 terrain: wide canon rivers spiralled (sinuosity 5), fixed with a belt cap and a sinuosity limit
`- **What:** on the `riverrun` preset (real canon river, q high, width up to 1.6 km) the sim wound into overlapping spirals, sinuosity 5.03, with vertical cliffs where the flattened floodplain cut hillsides (user screenshot).
`- **Cause:** the belt around the canon line was `min(6, 4.5w)` km, so a wide river had room for loops of its own width, and nothing capped how much longer than the canon line it could grow. The floodplain blend flattened to the bank height even where the terrain was far above it.
`- **Fix:** `rivers-lab.js`: belt `min(2.5, max(0.8, 3w))`; migration is multiplied by `sstep(1.7, 1.35, length/canonLength)` so winding stops near sinuosity 1.5 to 1.7 (as real rivers do). `main.js` variant 3: floodplain blend fades out where `h - zf` > 0.03 to 0.25 km, plus a valley wall `zf + 0.3*(|x| - 1.5hw)`. Result: sinuosity 1.52/1.64, headless testbed 1.31/1.13/1.09, no spirals; a small seam and two tight hook bends remain.
`- **So what:** any river-shape rule needs a hard ceiling (belt, sinuosity); the lab's testbed has narrow rivers and hid this. Check each preset with a river before porting.
`
`## 2026-10-27 terrain: lab opens on one synthetic testbed tile; meander sim hang and its cure
`- What: `index.html` with no params now shows `preset=testbed` (synthetic height in `synthH`: alpine belt in the west, foothills, rolling plains, a coast in the east, an irregular lake, a main river with two tributaries; `lake=0.12` floods the coast). Everything reloads in about 2.4 s. The other presets and `?sheet=4` stay opt-in. `rivers-lab.js` now has floodplain heterogeneity (soft and hard patches), regridding, canon-anchored belt, cut-offs every 6 iterations and bank-top heights taken from the canon line (so a loop that doubles back meets the same height instead of a cliff).
`- Evidence: the first testbed load hung the tab for 98 s: the wide river (1.3 km) exploded to 17,800 km of line (sinuosity 192, 56 oxbows) because the migration clamp (0.03 w a step) and a 6 km belt let loops balloon at node scale; the 98 s was the sim, the nodes then made 1.6 km of "descent" in the bed. Reproduced and fixed headless with `node scratchpad/sim-test.mjs [iters] [gain]` (no browser): curvature cap 1/(2.5 w), clamp 0.012 w, belt 4.5 w, cut-off at 2.2 w. Now 2000 iterations at gain 1.0 give sinuosity 1.5-1.65 and 11 oxbows in 2.2 s. Also made `fractalNoise` octave loops non-constant (`octaves + uZ`) to keep ANGLE from unrolling them.
`- So: test a simulation change in Node first, in the browser last (a hung tab cannot be reloaded, only replaced). Open: mountains in the testbed are too spiky and dark (vex 3 on a 4 km relief), the river still winds inside the mountains, sea foam is heavy, small rivers barely meander (0.3 km node spacing is coarse for a 0.3 km channel).
`
`## 2026-10-27 terrain: meandering rivers in the lab, simulated on the canon centrelines (rivers-lab.js)
`- What: `src/globe/prototype-terrain/rivers-lab.js` replaces the sine-noise meander and the 4.2 km distance field. For each canon river in the window: Chaikin-smooth, resample at 0.3 km, orient downhill, then iterate a Nick McD style meander model (outer bank erodes toward the outside of the curvature; curvature is low-passed downstream with a lag of 6 widths, his time-averaged momentum map; width from the baked river size, his discharge; amplitude gated by slope so steep reaches stay straight; neck cut-offs leave oxbows; a belt of 3-4 widths keeps the canon course). Bank-top height is the smoothed baked terrain with a bed that never rises downstream; the field (signed distance to the outer bank, half width, bank top, oxbow flag) is rasterised at 39 m/texel and pass A carves a channel, a flat floodplain and water depth from it. Reach: sinuosity 1.6, smooth bends, floodplain (`river-sim-5.png`). Takes 0.25 s per window.
`- Evidence: `?preset=reach&gain=0.15&iters=450` (now the default; `gain`, `iters` are URL params), `sheet-3.png`. First tries: gain 0.07 x 520 iterations gave sinuosity 2.9 with sawtooth edges (curvature noise at 4 widths); curvature smoothing over 2.5 widths and a final 4-pass line smoothing fixed the facets but gave 1.04 until the gain rose to 0.15.
`- So: his particle simulation itself (erosion on a 960² grid, thousands of steps, momentum "hand-waving" by his own words) cannot keep canon rivers where canon puts them, so the lab keeps his mechanism but runs it on the canon line. Open: oxbows rarely form at these settings, no point bars or scroll marks, tributary junctions are not simulated, rivers are only simulated per window (for the world this must move into the bake as a fine polyline set), lakes are still the invented height quantile: `vector-world.json` has canon `lakes` polygons to use instead.
`
`## 2026-10-27 terrain: the criss-cross pattern was a float32 hash, not the baked data
`- What: the lab (variant D) now has 20 presets (`?preset=name`, dropdown) and a contact sheet (`?sheet=4`) covering every height and terrain class: Giant's Lance, Vale and Moon, Bones, Frostfangs, Northern, Red and Mother mountains, Riverrun, God's Eye, Reach, Neck, Winterfell plain, Barrowlands, Dorne coast, Storm's End, Pyke, Dothraki Sea, Painted Mountains, Wall, Dagger Lake. Canon rivers (relief-e corridor) draw as water in the Shadertoy render. The square patches of parallel stripes (90 degree flips) came from `hash()` (`x.x*x.y*(x.x+x.y)`) fed filter coordinates offset by (1731, 911): the product reaches 1e10, float32 cannot hold its fractional part, so the Phacelle cell directions degenerated. A small offset (9.37, 5.11) removes it; the slope baseline `e=6 km` (was 1.8) and 7 fractal octaves in `roll` also help.
`- Evidence: `assets/terrain-lab/proto/reach-4.png` (criss-cross) vs `reach-6.png` (organic drainage), `sheet-2.png`; URL `?preset=reach&vex=3&str=0.012&onset=20&roll=0.25&e=6`.
`- So: keep every noise input to a hash small (under ~100) in shaders, also in the globe port (`detail.ts` uses UNIT 40 km and the same hash: check it). Open: lake shores foam too wide on flat water, the river meander sine is too sharp, no snow on the highest ranges, lakes are still height-quantile invented, plains amplitude (`roll` x3.5, vex 3.5) is by eye.
`
`## 2026-10-27 terrain: prototype of the Shadertoy look on our heights (throwaway, src/globe/prototype-terrain/)
`- What: a two-pass WebGL2 page (pass A: the full stateful erosion filter on our baked `relief-h`, 1024² float buffer, ~60 ms; pass B: raymarch like the Shadertoy) with `?variant=A|B|C`. A: filter + drainage lines. B: rivers from filter creases x baked flow. C: canon corridor field (`relief-e`) with meander noise, water by height. Verdict: the look transfers. Mountains (Vale window, `km=45 vex=2.5 str=0.04 onset=8`) get the branching ridges and creases the globe lacks. Our plains do not: the baked base is a slab (under 50 m over 24 km), so the filter only aligns stripes to a quantised slope (a rectilinear grid); adding `roll=0.12` km of rolling hills at 2-11 km wavelengths gives hills and gullies. B fails (rivers are blue specks); C looks like a river once the terrain under it has relief.
`- Evidence: screenshots `assets/terrain-lab/proto/lab-*.png`; run `npm run dev`, open `/src/globe/prototype-terrain/index.html?variant=C&roll=0.12&vex=5&str=0.03&onset=14&km=28&el=0.42&dist=1.2` (Riverrun), `?variant=A&lat=42.0&lon=-6.6&km=45&vex=2.5&str=0.04&onset=8&dist=1.3&el=0.5` (Vale mountains).
`- Variant D (`shadertoy-look.js`) runs the Shadertoy's own image pass (water plane, strata block, trees, GGX shading, scattering) on our buffer: `?variant=D&lat=42.0&lon=-6.6&km=45&vex=2.5&str=0.04&onset=8&el=0.5` gives the look of the user's reference screenshot on our Vale heights (`lab-D-vale.png`). Heights are remapped into the Shadertoy's 0.37..0.66 range; the lake level is a height quantile (`lake=0.15`), which invents lakes: canon lakes and rivers must replace it in the real port.
`- The rectilinear "cross / ladder" pattern on plains is the Phacelle cell grid showing through: the gully direction comes from a near-uniform, quantised slope (4.2 km baked texels), so the stripes of neighbouring cells are parallel or flip by 90 degrees. Giving the base the Shadertoy's own fractal gradient noise (analytic derivatives, 3-4 octaves, `roll` in `main.js`) removes it: gullies curve and branch along the slope (`lab-fractal-A.png`). In the real pipeline add that fractal term to the base and never derive the gully direction from the baked texels.
`- So: the globe's gap is detail at 1-25 km, not the rivers' drawing: port pass A as a camera-centred GPU detail buffer (stateful filter at view resolution) and give the lowlands base relief at 5-40 km in the bake; keep canon rivers as constraints. Foam on C is too strong and the sign-guard still leaves vertical banding at the box edge. Not committed; prototype kept untracked.
`
`## 2026-10-27 terrain: rivers from the terrain, erosion filter, signed distance for the shader
`- What: the whole terrain pipeline runs in one command (`npm run terrain -- --full --preview --detach`, 4 min): corridor carve of the 363 canon rivers, Rune Skovbo Johansen's erosion filter plus plains swells, range calibration, priority-flood flow accumulation with the canon rivers pinned, `relief-e.webp` (signed distance to the nearest river, size, ridge map). The globe draws no river geometry any more: water appears where carved terrain is below the water level. Whole world: 158,760 river cells, 28,581 canon path pixels all above the river threshold, 0 rising bed steps, 72 cells left in a flow cycle (warn).
`- Evidence: `npm run terrain` checks; Trident window screenshots; app at `?place=Riverrun` with no console errors. Dead ends: pinning every canon path made flow loops where the path was oriented backwards (orientation now follows the natural drainage), had flat beds (beds now fall 2 cm a pixel), closed on itself (loops cut), or stopped a pixel short of the coast (mouths run on); a plain (unsigned) distance on the 4.2 km grid hides diagonal channel stretches, a signed one draws thin lines at the medial axis between rivers (the shader takes the unsigned value there); a 6% valley side slope cut mountains for 90 km around every river (0.25 now).
`- So: see `docs/terrain.md` (stages, relief-e format, traps). Any `pipeline.mjs` edit invalidates the stage cache (4 min rerun).
`
`## 2026-10-27 terrain: heights broke two lore claims; ranges now calibrate against a table after erosion
`- What: the old bake put the Giant's Lance 2 mi above the Vale (AGOT, Catelyn VI: 3.5 mi) and the Moon (8.15 km), the North (7.9 km) and the Frostfangs (7.2 km) above the Bones (WOIAF: the Bones are the tallest range; they peaked at 5.2 km). `tools/books/range-heights.json` now holds crest and summit per range, each `lore` or `assumption` (real-world analogue + reason); stage `range-heights` scales each range to its crest, lowers the Vale floor, caps summits, raises the Lance. Whole-world run: all ranges within 0.1 km of target, Bones 8.29 km highest, Lance 5.63 km above a 0.13 km floor.
`- Evidence: `npm run terrain -- --full --preview --detach` (312 s, all checks OK); calibration before erosion failed because droplets flatten a sharp peak (a 5.8 km cone became 2.0 km), so it runs after; windows fed NaN heights from droplets starting on the grid edge (fixed: 30 s to 1.1 s); the 8 km encoder limit clipped the 8.15 km peak (now 9).
`- So: new height claims go in `range-heights.json` with a quote or an analogue; when the erosion filter replaces droplets, keep `range-heights` after it or before it, the loop measures whatever it gets. See `docs/terrain.md` and `docs/decisions/0001-fill-lore-gaps-with-realism.md`.
`
`## 2026-10-27 process: a rule in CLAUDE.md alone was skipped under time pressure
`- What: with only the CLAUDE.md "Write it down" rule, 2 of 2 simulated hurried sessions skipped `docs/findings.md` ("no map data changed", "only a lookup key", "you're in a hurry"; one only offered a note). With the `recording-findings` skill, 2 of 2 wrote the entry and named the files.
`- Evidence: subagent pressure runs on 2026-10-27, scenarios: a terrain bake lost without `--detach`, and a duplicate "Storm's End" row (castle plus kind `road`) breaking `place()`.
`- So: keep the rationalization table in `.claude/skills/recording-findings/SKILL.md` current; add new excuses when seen.
`
`## 2026-10-27 tooling: terrain `--detach`, roads fit, new gates
`- What: `terrain-window.mjs` is now `npm run terrain -- --detach ...` (replaces `terrain:run`). `lore roads` deliberately does not run `roads-fit` (the committed `roads-fit.known.json` is the fit; re-run only when the coast or road source changes). `coast-run.mjs` stays: it is a six-step runner, not a launcher. `npm run verify` is the gate; `tools/blog/roads-graph.test.mjs` checks every place named in the claim files exists.
`- Evidence: `npm run verify`.
`- So: `src/globe/relief-bounds.json` showed `heightMax` 8 to 9 uncommitted from terrain work, not from this change.
`
`## 2026-10-27 tooling: dead scripts and missing gates
`- What: tools survey found `tools/world/{fetch-awoiaf-maps,merge-names,towns-assets}.mjs`, `tools/sites/kingsLanding/depth.mjs`, `tools/satellite/sheet.mjs` and the root `_s.mjs`, `tools_shot.mjs` referenced by nothing. `align-canon.mjs` is cited by README and `georef.mjs`, so it stays.
`- Evidence: `git grep` of each name hits only the file's own usage header.
`- So: delete them in one commit; `npm run verify` is now the single gate (lore check, tsc, tests).
`
`## 2026-10-27 feature: focused place in the URL and tab title; CLI search/near
`- What: `showCard` (src/ui/placePanel.ts) is the one point every focus passes through, so it sets `?place=Name` (history.replaceState, other params kept) and the tab title `Name · Open Westeros...`; closing restores both. `main.ts` opens `?place=` after the relief is ready, matching names accent- and case-insensitively. New `npm run lore -- search <term> [--kind k]` and `near <lat lon | "Name"> [--kind k]` print name, kind, position, miles and the link; `place` prints the link too. No browser needed to find a place or build a link.
`- Evidence: `lore search winter`, `lore near Winterfell --kind castle` (Castle Cerwyn 58 mi); `tsc --noEmit` clean. Not exercised in a browser here.
`- So: places inside 3D sites (Winterfell's keeps) get a `?place` link but it does not reopen them (they load on demand); a name shared by two rows opens the first.
`
`## 2026-10-27 tooling: `npm run shot` opens the world headless
`- What: `tools/world/shot.mjs` (playwright-core, installed Chrome, SwiftShader GL) starts vite on 5199 if nothing answers, loads `/?place=<first>`, waits out the loading coin, then flies to each place through `window.__globe` (dev only), waits until the camera is still, saves a png and prints one JSON line per place (card, tab title, address, altitude, centre, deduped console errors). `--flat`, `--size`, `--out`, `--eval` (run JS in the page after each fly-to).
`- Evidence: `npm run shot -- Winterfell "The Wall"` took 31 s in all, both places right (card, title and `?place=` address correct, Winterfell's 3D site drawn at 3.2 km). The only console errors were wiki pictures blocked `NotSameOrigin`, which are ignored for the exit code.
`- So: the 3-4 s coin finale and startup dominate; many places in one call is the cheap way. Use `--eval` for state (`__globe.nav.altitude()`) before a screenshot. `tmp/` is now git-ignored.
`
`## 2026-10-27 prototype terrain: biome colours in the Shadertoy look (variant D)
`- What: the lab's variant D drew every land with the Shadertoy's fixed grass, dirt and tree colours. `shadertoy-look.js` now samples the globe's own bakes, `relief-v` (biome albedo) and `relief-c` (canopy, moisture, snow), through a ~1 km noise wobble. Biome albedo replaces the grass pair (x0.78, x1.12 by height) and tints the dirt; tree colour follows the biome and tree amount follows canopy (none in deserts, full in rainforest); snow cover from `relief-c` blue. `?biome=0` restores the fixed greens for comparison; the synthetic testbed has no biome.
`- Evidence: `?sheet=5` contact sheet of 21 presets, no shader errors. Dorne tan, Dothraki Sea straw, Frostfangs white, Painted Mountains dark rock, north grey-green, Reach/Stormlands/Riverlands close greens.
`- So: the lowland greens differ little because the fan map classes them close (grassland, light forest); contrast can be raised in the two multipliers if wanted. Not wired into the globe; that already colours by `relief-v`.
`- Follow-up, same day: biomes pulled further apart. Biome albedo is saturated around its own grey (`?sat=`, default 2.2; 1 = the bake's colour) and tinted warm and yellow where the moisture channel (`relief-c` G) is dry, cool and green where wet. Contact sheet: Dorne gold, Dothraki Sea yellow-olive, Reach and Stormlands bright green, Neck and the Wall's ground darker blue-green, Iron Isles olive.
`
`## 2026-10-27 river meanders: a flat-map preview (not wired in)
`- What: `tools/world/meander.mjs` lays a Kinoshita bend across each canon river (offset sideways from the Chaikin-smoothed canon line, tapered to 0 at both ends, capped at `maxOffset`, peak heading lowered until no bend is tighter than `rMin` channel widths); a mouth within 8 km of a longer river is moved onto that river's meandered line over its last two wavelengths. `node tools/world/meander-preview.mjs [W E S N] [out.png]` draws canon and meandered rivers side by side (default window: the Riverlands). Test: `tools/world/meander.test.mjs` (not yet in `npm test`).
`- Evidence: Riverlands window, 363 rivers. Junctions stay joined and the canon courses stay where they were. With width = 0.05 sqrt(length km) the bends were 1-3 px at this zoom and read as ripple; width 0.12 sqrt(length km), rMin 2.5, offset cap 9 km gives readable meanders.
`- So: these numbers are `assumption`s (canon gives no channel width; analogue: lowland alluvial rivers, rMin 2-3 widths from Leopold-Wolman; the research note's 5 widths gives bends too gentle to see). Places on rivers are not re-checked: `npm run lore -- check` still reads the unmeandered `src/vector-world.json`, and meanders can move a line up to 9 km (~6 mi) from the canon centreline, near the 6-10 mi on-river tolerance. Run the check before wiring this into `terrain.ts` or the bake.
`
`## 2026-10-27 terrain: Nick McD momentum-map particle sim rewritten (rivers-particles.js); no meanders yet, language is not the bottleneck
`
`- **What:** `src/globe/prototype-terrain/rivers-particles.js` is the SimpleHydrology / 2023 meander model in pure typed arrays (momentum and discharge maps, `c_eq = (1 + ENT erf(0.4 Q/QS)) dh`, lerp update per epoch, two-way thermal cascade, optional bed floor). `rivers-sim.js` (`?rivers=sim`) now only builds the canon valley and a straight seed trench, then calls it; the sine seed and the hand-made bank carving are gone. Harness: `node tools/world/rivers-particles-preview.mjs` (flags `--src --td --wall --depth --qscale --entrainment --epochs`).
`- **Evidence:** 60 epochs x 2000 particles on 384 cells is 2.3 s in Node (the old loop took 19 s for similar work: closures, `Math.hypot`, allocation). That is roughly 50M particle steps/s, so Rust or C++ would gain 2-3x at most; no compiler is installed here anyway. Quality is the problem: with unlimited incision the channel becomes a 10 m ravine that widens; with a bed floor and a single source the water holds one narrow coherent thread, but it stays in the straight seed trench (a 3 m trench on a 0.08% slope is a strong attractor) and no bends grow. Water spawned along the whole line makes gully fans and parallel threads.
`- **So what:** Nick's meanders grow on a free alluvial plain with sediment in equilibrium, not in a pre-cut trench. Next: seed trench barely deeper than the noise, upstream sediment inflow so the bed does not only erode, uniform rain on the corridor so discharge builds by drainage, and measure sinuosity in the harness before looking at pictures. The fallback that already looks right is the line model (`rivers-lab.js`, sinuosity 1.6).
`
`## 2026-10-27 terrain: the particle sim ported to Rust (WebAssembly): same speed as the JS, still no meanders
`
`- **What:** `tools/world/rivers-rs` (Rust, `cdylib`, C ABI, no wasm-bindgen, 26 KB) holds the loop; `npm run rivers:wasm` builds it to `src/globe/prototype-terrain/rivers.wasm`; `rivers-particles.js` is now only the loader and `rivers-sim.js` takes it as `opts.engine`. The JS loop is deleted. Toolchain: `scoop install rustup-gnu`, `rustup default stable-x86_64-pc-windows-gnu`, `rustup target add wasm32-unknown-unknown` (the wasm target needs no MSVC). New seeds: water enters at the upstream end of each canon run plus rain on the corridor, a sediment inflow, a 0.8-1.5 m trench.
`- **Evidence:** 60 epochs x 2000 particles: 2.0 s in wasm against 2.3 s in the JS loop, so Rust bought nothing measurable (the loop is bound by random memory access and branches, and V8 already compiled it well). 200 epochs x 4200: 12 s. A particle of volume 20 made the run explode (erosion is `vol * D * (1 + ENT) * dh`, a factor above 1 overshoots): inflow must be many unit particles. With unit particles the seeded trench breaks into disconnected scours and no bends form (`tmp/r2.png`, `tmp/r3.png`); the thread is still not continuous at 200 epochs.
`- **So what:** speed was never the limit, so more Rust will not fix this; the model needs a change. Untried: a continuous channel from the first epoch (carve the thalweg to the bed so the water never leaves it), many more unit particles at the source, an equilibrium sediment inflow measured from a short run, and a sinuosity number in the harness (not done). Whether this model gives readable meanders on a 0.08% slope at 73 m cells is unproven; `rivers-lab.js` (sinuosity 1.6) is still what the lab shows.
`
`## 2026-10-27 terrain: back to JS, main river had no water source, bank slumping was switched off; first single thread with gentle bends
`
`- **What:** Rust and wasm removed (`tools/world/rivers-rs`, `rivers.wasm`, the loader, the npm script); the loop is JS again in `rivers-particles.js` (sync, unit-volume particles, defaults now the tuned set below). Harness `tools/world/rivers-particles-preview.mjs` also prints a thalweg trace (not reliable yet: it stops at the first gap).
`- **Evidence:** (1) `rivers-sim.js` took each run's first node as the source, but the main canon river starts 17.6 km north of the window centre, outside the 14 km half-window, so it had no inflow in every run before this one; sources are now the first node inside the window. (2) The cascade never fired: `repose` 0.4 with `VS` 20 allows 8 u between cells, a 4 m channel on 62 m cells has about 1.3 u; `repose` 0.03 makes banks slump. Before that, repose 0.4 and 1.0 gave identical images. (3) With deposition 0.1 sediment filled the seeded trench; 0.03 keeps the thread continuous. Result `tmp/final.png` (`?rivers=sim`, 250 epochs x 3100 particles, 29 s in Node for 384 cells): one continuous thread from the source to the confluence with gentle S-bends (sinuosity about 1.1-1.2), a branching stub, no gully fans. Less wandering than a real lowland river.
`- **So what:** tuned defaults: `perSrc` 3000, `perRain` 100, `deposition` 0.03, `repose` 0.03, `qscale` 100, trench 0.5 m, floor 3 m, valley wall slope 1%. With a freer trench (0.5 m) and less bank slumping the channel splits and rejoins (braids) instead of meandering; the knob between braided and single-thread is not found. Next: a sinuosity number that works, a run of the real grid in the browser (`?preset=riverrun&rivers=sim`, not looked at yet), and cutting the 29 s (cascade runs on every step; do it every 4th, or only where discharge is high).
`
`## 2026-10-27 terrain: the wide-channel look restored, and cleaned of side gullies with a base erosion of 0.1
`
`- **What:** the early run the user liked (`sim1`/`sim3`: a wide river with irregular banks and islands) is the default again: unlimited incision, deposition 0.1, repose 0.4, qscale 50, 3 m trench, 10% valley walls, water entering every 0.3 km of the canon line (`srcEvery` 3 nodes), 60 epochs, no rain, no sediment inflow. `rivers-particles.js` gained `base` (default 0.1): `c_eq = (base + ENT erf(0.4 Q/QS)) dh`, so the 1 in the original formula no longer erodes sheet flow.
`- **Evidence:** with `base` 1 the side of the channel grows a fan of gullies (each node's particles run down the wall); `base` 0.1 leaves one clean channel with slight bends and a clean tributary (`tmp/clean.png`; `base` 0 plus `srcEvery` 10 is thinner and a little braided). Run length is a width knob: 60 epochs wide river, 120 a lake-wide belt, so the width is not yet tied to a discharge.
`- **So what:** not yet looked at on the real grid in the browser (the shot tool only drives the main app; the chrome-devtools profile was busy): open `/src/globe/prototype-terrain/index.html?preset=riverrun&rivers=sim`. Bends are slight (sinuosity about 1.1); making them larger needs a different mechanism than more epochs.
`- **Wired:** `?preset=riverrun` now runs the particle sim by default (`main.js`); `?rivers=line` gives the line model back, `?rivers=0` no rivers. Not yet looked at in the browser.
`
`## 2026-10-27 terrain: the river sim exports only its own change, no sunken border
`
`- **What:** the thick sunken band around the river was the sim's scaffolding exported as ground: `rivers-sim.js` carved a 3 km wide valley (flat floodplain at the smoothed bed + 1.5 m, 10% walls) into the terrain and blended it in over `1 - smoothstep(0.7 WV, WV, dist)`, and the grid it ran on is 265 m coarse against the shader's own detail. Now the output (`r` = signed height change in km, `g` = water depth) is `(h_final - valley - noise)` gated by the discharge within 4 cells (`smoothstep(0.06, 0.35) QS`) and softened with a 3x3 blur; the pass-A shader does `h += r.r` instead of `mix(h, r.r, r.b)`. The terrain outside the channel is the shader's own, untouched.
`- **Evidence:** headless harness (`tmp/edge2.png`): the whole main river from its source, the stub tributary and a few faint scratches, nothing else changed. With a gate of 0.3-1.2 QS the head of the river and the tributary were lost (low discharge); 0.06-0.35 keeps them. The channel still has cell-sized teeth on its banks (the blur softens them).
`- **So what:** the channel is cut relative to the local terrain, so its bed follows the rolling hills, not a graded profile; water is `ground + depth`, so over a hill it may stand above the downstream reach. Check in the browser.
`
`## 2026-10-27 terrain: the river has a graded bed and cuts the terrain (gravity), no longer rides it
`
`- **What:** the delta export made the bed follow the hills (water stood above the reach below). Now (`rivers-sim.js`): each canon line gets a graded bed = the terrain's trend (40 smoothing passes) minus 4 m (`clear`), never rising downstream (running minimum, 1 cm per 100 m fall). The valley the sim runs in is built on that bed. Export: the channel's ground (`h` where the sim cut more than ~1 m below the valley and the water is) plus a V valley (`wallSlope` 0.3, chamfer sweeps on the 384 grid) cut into any hill the bed passes under; the shader does `h = min(h, r.r)`. Water surface = bed + 1.1 m, so it is level across the channel and falls with the bed.
`- **Evidence:** first real-grid run in a browser (`tmp/proto-shot.mjs`, Playwright, `tmp/proto-sim-top.png`): the riverrun terrain is hilly, not the slab of my synthetic harness. With a running-minimum bed straight under the terrain the river was a vertical-walled trench with jagged teeth; with the V valley it is a continuous channel with a level, falling water surface and sloped walls, but through the hills it is a 50-100 m gorge, the water looks like a long lake ribbon (the wide-channel look of the 60-epoch run), and the 384 grid costs 8 s in the browser (page blocked).
`- **So what:** the canon river does not sit in a valley of the baked terrain, so a graded river has to carve one: that is correct physically but heavy where the terrain is high. Knobs: `wallSlope` (lower = wider, gentler valley), `clear`, `surface`, `epochs` (width), `reach`. Open: a narrower channel (the width is the 60-epoch erosion, not tied to discharge), the gorge depth, the 8 s, and the `el`/`dist` URL params did not move the camera in the shot.
`
`## 2026-10-27 terrain: the baked terrain along the riverrun canon rivers swings 240 m; a graded river is a gorge, a wide valley erases the hills
`
`- **What:** `?debug=1` on the prototype logs each canon run with its terrain and graded bed. The shader now pulls the terrain down to the channel with an S-curve over the distance a wall of slope `wallSlope` (0.15) needs, so the walls keep the terrain's relief (`r.r` channel ground, `r.b` distance, `r.a` slope); `epochs` default 30 (narrower channel); URL params `epochs wallSlope clear surface reach qscale debug`.
`- **Evidence:** the main run's terrain along the canon line, every 1 km: 0, -90, -117, -76, ..., +240 (a ridge in the middle), +156, +65, +150, 0, -56, +30, +188, +123, -144 m. The river as drawn crosses hills; a bed that only falls (running minimum, 1 cm per 100 m) is 167 m below the terrain on average and 358 m at most, the tributary 37 m mean. The best monotone fit (pool adjacent violators) still cuts 178 m and leaves the bed 179 m above the terrain in places. Screenshots `tmp/proto-b30.png` (slope 0.15: a gorge through the hills, a lake-like ribbon upstream), `tmp/proto-c05.png` / `proto-c025.png` (slope 0.05 / 0.025: a valley kilometres wide that flattens the hills, the border the user rejected). Timing: the sim is 1.5 s in Node at 30 epochs; in headless Chrome with a software GL the page build is 4.5 s; the cascade is inert at `repose` 0.4 (identical output with it off).
`- **So what:** gravity and the canon course cannot both hold on this terrain: the terrain has to be baked with the river in it (a graded valley profile along every canon river, then the hills around it), not the river cut afterwards. Until that is done the choices are a gorge (slope 0.15-0.3), a wide valley (0.05), or the river riding the terrain (the first version). The 8 s was mostly software GL; the sim itself is 1.5-2.5 s.
`
`## 2026-10-27 terrain: the gap in the middle of the river (flat bed filled by deposition)
`
`- **What:** user circled a stretch with no river between a thin upstream reach and the wide reach below. The graded bed (running minimum) is flat under a ridge, falling only 1e-5 per 0.1 km node (slope 1e-4); `?debug=1` (`RUN-GATE` lines) showed Q 150-300 there but cut 0.0 mm and gate 0: the sim's deposition refilled the 3 m trench (final ground 6-8 m above the trench floor), so no channel passed the gate and no water was drawn.
`- **Fix:** the bed now falls at least `minSlope` = 4e-4 (40 cm per km) per node. With it the channel survives the stretch and the river is continuous through the gorge (`tmp/proto-d1.png`).
`- **So what:** any reach flatter than about 4e-4 fills in this sim at the current deposition (0.1); a lower deposition would allow flatter beds but gave a braided thread earlier. The river still crosses the 240 m ridge as a gorge (see the entry above).
`
`## 2026-10-27 canon river direction: the lines are stored mouth to source
`
`- **What:** the river lines come from SVG paths with no direction attribute, but their order is consistent. `node tools/world/river-direction.mjs`: of 363 lines (3+ points), the sea or another river lies within 6 km of the first point in 297, of the last point in 2, of both in 15 (tributary networks), of neither in 49 (lake outlets, endorheic stubs, ends near a lake). So the stored order is mouth to source and the flow is the reverse. `rivers-sim.js` now orients every line that way (keeping a line only if its last point and not its first touches a sink) instead of comparing the heights of the two halves; a synthetic world says `oriented`.
`- **Evidence:** Riverrun: the main river flows SW to NE and the stub joins it at the junction, which the old terrain-based flip had also chosen, so the picture does not change there. On the real grid the terrain along the main river is still 171 m above the bed on average (the ridge) and the stub 39 m. In the harness, with the tilt flipped to match, the Y confluence forms correctly.
`- **So what:** the 49 lines with no sink at either end and the 15 with both need another rule (lake outlets: the lake side is the source or the sink by the lake's height; tributary networks: the end on the longer river is the mouth); not done. `carve-corridors` in the world bake still orients by the terrain's own drainage and should use this direction first, which is also what makes the graded valley possible without fighting the terrain.
`
`## Wiki places missing from the map (2026-10-27)
`
`- **What:** `tools/wiki/place-gap.mjs` compares the mirrored wiki (categories, links) with the map names and writes `docs/sources/wiki/_place-gap.json`; the readable result and a split of `landmark` into more kinds is in `docs/place-gap.md`.
`- **Evidence:** only 1 mirrored place article is off the map (Harrenton); 4,073 unscraped articles are linked from map places, about 315 with a place-like title. A live category crawl failed: Cloudflare shows a challenge only a person can solve, and plain curl is blocked too.
`- **So what:** the mirror was built from the map's names, so an offline diff cannot find the real gap. Rerun the crawl by hand (open Chrome once, solve the challenge) for the full "Places" tree. The map's "Kneeling Man" is "Inn of the Kneeling Man" in the wiki. A crashed run can leave `.cache/awoiaf-profile` locked; delete `Singleton*` there.
`
`## 2026-10-27 rivers fade out with height instead of staying a 1.5 px line
`
`- **What:** the relief shader (`relief.ts`, rivers block) widened every river to at least 1.5 pixels (`halfC = max(rHalf, 0.75*fwr)`) "so it stays a line from far out", so the whole network showed from space.
`- **Fix:** `vis = smoothstep(0.3, 1.5, 2*rHalf/fwr)` (real width in pixels) multiplies the land mask, so water, banks and floodplain only appear once a river's true width nears a pixel. The floor stays, to stop shimmer. Widest rivers (1.6 km) come in around 1,000 km up, the narrowest (0.12 km) only near 100 km.
`- **So what:** the 0.3-1.5 px band is a taste knob; the flat map's lines (`terrain.ts` `setRiverWidth`) are unchanged. Checked only that the shader compiles (`npm run shot -- Harrenhal`); look from 22,000, 3,500 and 900 km.
`
`## 2026-10-27 terrain: the canyon was the prototype's own rolling hills; width from drainage; orientation for all 363 lines
`
`- **What:** (1) `tools/world/river-orient.mjs` (pure; `river-direction.mjs` prints the counts): sinks are the sea (rank 3), a longer river (2), a lake (1), a shorter river (0.5); the end touching a sink is the mouth, both ends -> the higher rank, a tie or neither -> the stored order (mouth first). Result for 363 lines: 320 first end only, 38 both (decided by rank), 2 last end only, 2 ties, 1 none; the 3 undecided follow the prior. `rivers-sim.js` uses it. (2) The prototype's `roll` (rolling hills "by eye", 0.42 km after vex) knew nothing about rivers. The terrain along the Riverrun canon line swung 240 m only because of it: depth of the graded bed below the terrain was max 360 m / mean 171 m with the default roll, 89 / 40 at roll 0.12, 33 / 11 at 0.04, 28 / 12 at 0. `roll` now fades out toward a canon river (`riverD`, bilinear of the unsigned baked distance, 0 at 0.5 km, full at 3 km; `?rollnear=` `?rollfar=`): max cut 28 m, mean 12 m, no gorge, hills kept elsewhere. A first version took the minimum of four texels and made straight dark criss-cross lines (the 4.2 km texel grid shows as cliffs); the bilinear one has none. (3) The sim finds the thalweg (the ridge of discharge across each canon node, median-filtered and smoothed) and the section is geometry: width `widthK` 0.06 x sqrt(km drained) (tributaries add their length at the junction), depth width x 0.04, parabolic bed on the graded bed, water 0.8 of the depth. Riverrun main river 0.12 km at the source to 0.44 km at the end, the stub 0.12 to 0.21. (4) `npm test` (20 pass), `tsc`, `lore check` (46 ok) pass.
`- **Evidence:** thalweg sinuosity 1.025 (6 sweeps of epochs, momentum, trench depth, noise, deposition and entrainment: 1.023-1.040). The canon line itself is nearly straight (38.1 km chord, 38.3 km drawn) and the valley scaffold (trench + walls) holds the sim's channel on it, so the sim cannot meander inside it; a free floodplain braided instead (earlier entries). Screenshot `tmp/proto-d1.png`: a thin, straight river that widens downstream, in a gentle valley.
`- **So what:** the canyon, the orientation and the width are fixed; bends are not. Next experiment: no trench and a floodplain several widths wide, many more epochs with a sediment supply in balance, and measure sinuosity of the thalweg per run before looking at pictures. `widthK` 0.06, depth ratio 0.04 and the roll fade distances are assumptions (analogue: lowland alluvial rivers), not canon.
`
`## 2026-10-27 atmosphere: no depth when tilted, thin limb from space
`
`- **What:** (1) the haze over ground had a weight `w` that fell to ~0.4 at 480 km, so a tilted view from there kept distant ground fully saturated; the far-ground cap (`GlobeView.ts`, `cap = mix(cap, 0.8, smoothstep(6e5, 3e6, t1))`) now applies at any height. (2) Air is `DK = 1.5` times denser than the Earth-like coefficients. (3) Rayleigh and ozone are sampled at 615/535/445 nm, the cone-dominant wavelengths of Schueler's article (thetenthplanet.de/archives/4519), instead of 680/550/440.
`- **Evidence:** `npm run shot -- Winterfell --zoom 5000` (16,000 km) and `--zoom 150 --tilt 1.3` (480 km, tilt 74.5°). DK 2.5 with a 3e5-1.5e6 ramp washed the whole globe grey, so it was backed off.
`- **So what:** not adopted: the article's Chapman-function optical depth (the march already has 24 samples); it matters for a cheaper or LUT-free path. `DK` and the ramp are taste knobs. `nav.setTilt` and `shot --tilt` added for looking at tilted views.
`
`## 2026-10-27 satellite-grade vegetation tried and reverted
`
`- **What:** a shader-only pass (moss/olive/khaki drift, field patchwork, distance desaturation and veil in `relief.ts`) was tried and reverted at the user's request. The effect was subtle and fields never showed clearly.
`- **Evidence:** before/after shots at Harrenhal, Kingswood, Highgarden.
`- **So what:** the pale diagonal gully scars on the Reach plains are not the `bare` term (fading it on lowland changed nothing); they come from the baked slope shading of the filtered terrain, so look at the erosion filter's plains strength, not the colour.
`
`## 2026-10-27 plains stripes: the erosion filter's plains strength was 100 m, not 5 m
`
`- **What:** the pale diagonal/horizontal streaks over the Reach plains (the open question in "satellite-grade vegetation tried and reverted") came from `detail.ts`: `ErosionFilter` does `strength *= scale` (20 km), so the plains' `strength` 0.005 gave gullies of ~100 m, which the shader lit hard and coloured as `bare` rock and crease dirt. Now `strength = mix(0.0004, 0.04, m * m) * inland` (plains ~8 m; mountains unchanged).
`- **Evidence:** `npm run shot -- Highgarden --zoom 0.5` (116 km): before, a web of pale streaks; after, an even grassland with soft rolling texture.
`- **So what:** the 0.0004 plains value is an assumption (low rolling lowland), a taste knob; hills (`m` ~0.3-0.5) now get less filter than before because of `m * m`, so look at the Marches and the Vale before keeping it.
`
`## 2026-10-27 atmosphere thicker when tilted: ground-ray haze gain
`
`- **What:** in the atmosphere shader (`GlobeView.ts`) rays that hit the ground now use `1 - Tm^HAZE` (HAZE 3.0) instead of `1 - Tm`, and the far-ground fade to the horizon haze starts at 200 km (was 600 km) and reaches cap 0.9 (was 0.8). Sky rays and the limb glow are untouched.
`- **Evidence:** by reading the shader: the shell's extinction is divided by KS (~6), so a grazing ray from low down has a small optical depth and the veil stayed thin. Not yet looked at on screen.
`- **So what:** HAZE and the 2e5/2e6 fade range are taste knobs, to be tuned by eye with `npm run shot`; if the mountains sink into a fog wall, lower HAZE or the 0.9 cap.
`
`## 2026-10-27 haze gain only near the ground
`
`- **What:** the ground-ray haze gain (`HAZE`) and the earlier far-fade start/cap are now blended by `w` (1 inside the air, 0 above it), so from space the veil is the original again and only low, tilted views get the thicker one.
`- **Evidence:** the previous change applied at every height and washed the globe white from space (user report). Not yet checked on screen.
`- **So what:** `w` fades out between 0.15 and 1.2 shell heights (~90-750 km); if the thick look should hold higher, widen that range.
`
`## 2026-10-27 3D trees removed
`
`- **What:** `src/globe/trees.ts`, `tools/world/trees-bake.mjs`, `public/world/trees*`, the `trees` npm script, `docs/decisions/0002-tree-packs.md` and their hooks in `GlobeView.ts` deleted at the user's request; the instanced-trees findings entry went with them.
`- **Evidence:** `npx tsc --noEmit` clean. The `wood` fade of gully rock and crease dirt by canopy in `relief.ts` (a shader paint change, not a mesh) was kept; `shot --zoom` was kept.
`- **So what:** the pack choice and traps (adm-zip duplicate entry, leaf-card holes seen from above) are in git history only if it was ever committed; it was not.
`
`## 2026-10-27 distance haze on the land itself
`
`- **What:** the atmosphere's ground pass marches rays that hit the *smooth* planet, so relief standing above its horizon (ridges when tilted to ~85 degrees) got no haze, with a hard line at the smooth horizon. The land fragment shader (`relief.ts`) now mixes towards a horizon blue by its own camera distance (`vDist`, `1 - exp(-d/120 km)`, max 0.85), faded out above ~90-750 km altitude so space views are unchanged.
`- **Evidence:** user screenshot at 66 km, tilt 85: clean foreground and a step at the smooth horizon. Not yet re-shot.
`- **So what:** the 120 km length, 0.85 cap and the fog colour are taste knobs; it stacks with the atmosphere pass on ground below the horizon, so lower the length if that double-counts.
`
`## 2026-10-27 haze too strong at 500 km, land fog first tried on the wrong scale
`
`- **What:** the land fog used `vFragDepth - 1` (view depth, m); at 183 km looking straight down it tinted the whole land blue, so only the dense lowest ~30 km of path counts now (`min(1, 30 km / alt)`), length 250 km, cap 0.8, faded out 60-400 km. The atmosphere pass's earlier far-fade change is reverted and its `HAZE` gain acts only as `w^3`: at 519 km, tilt 85 it washed the whole ground white. A land fragment shader cannot take a new varying: `MESH_VERT` is a second vertex shader (the first try failed with "varying vDist does not match").
`- **Evidence:** `npm run shot` errors list, user screenshots at 66 km and 519 km.
`- **So what:** the land fog is the low-altitude haze now; tune its 250 km and 0.8 first.
`
`## 2026-10-27 world hydrology regenerated from the terrain; the line-based river code removed
`
`- **What:** `carve-corridors` orients the canon lines with `tools/world/river-orient.mjs` (source to mouth; the sea, a longer river or a lake at an end is the mouth) and only carves valleys; `flow-accumulation` no longer pins any path (no recv overrides, no loop breaking, no "never smaller downstream" patch) and `river-fields` keeps only cells above the river threshold; the distance field is to each river's smoothed line (Chaikin round through the cell's upstream and downstream steps), not to D8 staircase segments. New check `rivers: canon rivers are followed` replaces "canon rivers carry water" and "paths pinned". Deleted: the prototype river code (`rivers-sim.js`, `rivers-particles.js`, `rivers-network.js`, `rivers-lab.js`, `rivers2d*`, the harness), the flat-map meander preview (`meander*.mjs`), and from the lab (`main.js`) the river variants, pass S and the roll fade. Decision note `docs/decisions/0002-rivers-from-the-terrain.md`; `river-orient.test.mjs` is in `npm test`.
`- **Evidence:** whole-world dry run (5 min 54 s) and full run: 150,498 river cells; canon path pixels 93.2% within 8 km and 98.0% within 16 km of a river cell, median 2.6 km, 90th percentile 5.7 km (28,508 pixels); no rising bed, no flow cycle; all range lore checks and `npm run lore -- check` pass. Trident window preview (`assets/terrain-lab/proto/trident/river-fields.png`): a dendritic network in the valleys, tributaries joining in Y junctions, no loops or crossings. Lab at Riverrun with the new `relief-e`: the Red Fork and its tributaries follow the valleys; corners of the 4.2 km grid remain visible at 28 km window size, which the smoothed line reduces.
`- **So what:** the globe itself could not be looked at: its terrain shader fails to link (`FRAGMENT varying vDist does not match any VERTEX varying`), from the uncommitted edits in `src/globe/lift.ts`, `relief.ts`, `reliefMesh.ts` that were already in the working tree; the data is read in the lab (`/src/globe/prototype-terrain/index.html?preset=riverrun`). Meanders are not part of the world bake (4.2 km cells); see the decision note.
`
`## 2026-10-27 atmosphere hazed by the real depth of the land (replaces the land-colour fog)
`
`- **What:** the land fog in `relief.ts` is gone. `relief.depth()` draws the relief mesh's depth alone into a half-size render target before each frame (camera below 1,500 km); the atmosphere ground pass (`GlobeView.ts`) reads it (`tDepth`), inverts the log-depth (`w = 2^(d * log2(far+1)) - 1`, divided by the ray's cosine to the view axis) and ends each pixel's ray there instead of at the smooth sphere, so ridges above the smooth horizon and the near ground in a tilted view get haze by their true distance. The ground haze gain `HAZE` (8, only through `w^3`, i.e. well inside the air) now scales the scattered light with the extinction (`gain`): raising only the alpha had darkened the ground to grey-green.
`- **Evidence:** `npm run shot -- Whitegrove --zoom 0.36 --tilt 1.48` (66 km, 85 deg): the green ground now lightens towards the horizon; the 513 km view is not washed out; no shader errors.
`- **So what:** costs a second vertex pass of the mesh below 1,500 km (the shot shows 42-49 fps in headless). Only the land is in the depth, so trees, lines and the sea fall back to the sphere's hit. Tune `HAZE`.
`
`## 2026-10-27 per-channel transmittance on the ground (L = L_ground * T + L_in)
`
`- **What:** the atmosphere's ground pass is now two draws of the same shell (`GlobeView.ts`): `multMat` (`MULT_PASS`, `MultiplyBlending`, render order 299; skips the sun marches, so it is cheap) multiplies the ground by the air's per-channel transmittance `T^hz` (capped, times the night veil), then `atmoMat` adds the scattered light. Before, one alpha blend used the grey mean of T, so distance only washed the ground out and never shifted its colour.
`- **Evidence:** `npm run shot -- Whitegrove --zoom 0.36 --tilt 1.48` (66 km): the ground leaves green-grey and cools towards the horizon; 513 km and the 11,000 km globe unchanged in strength. A first version added linear scatter straight to the sRGB screen and washed everything milky; the scatter is now encoded at its own strength (`/aG`, then `* aG`) as the alpha blend effectively did. `MultiplyBlending` needs `premultipliedAlpha: true` in three, or it logs an error.
`- **So what:** the ground pass costs one extra, cheap draw (optical depth only). A true linear blend would need a linear framebuffer or dual-source blending; the `aG` encode is the stand-in.
`
`## 2026-10-27 dev-only atmosphere tuner
`
`- **What:** `src/globe/atmoTuner.ts` adds 12 sliders (air density, ground haze gain, sun intensity, exposure, multiple scattering, three veil caps, far-haze start/full, in-air height range) over the atmosphere shader's uniforms, with reset and a copy button that puts the values on the clipboard as JSON. Dev only (loaded from `main.ts` under `import.meta.env.DEV`); `globe.atmo` exposes the uniforms. The shader's old constants (`DK`, `HAZE`, `SUN`, `EXPOSURE`, the caps, the ranges) are now those uniforms, same defaults.
`- **Evidence:** shot at 66 km shows the panel, 12 range inputs, no errors; look unchanged at the defaults.
`- **So what:** paste the copied JSON back and the defaults in `ATMO_KNOBS` take those values. The shell thickness `ATMO` is geometry, so it is not a slider.
`
`## 2026-10-27 atmosphere: tuner removed, fewer and cheaper passes
`
`- **What:** the dev tuner is gone (its constants are back in the shader with the tuned defaults). The atmosphere is back to one ground draw (the multiply pass for per-channel transmittance is dropped: its effect was a slightly cooler horizon, for a whole extra shell draw), plus the sky draw. The ground march is 12 steps (sky 24) and the sun's optical depth 3 steps (was 5); the half-size land depth pre-pass runs only below 800 km (was 1,500).
`- **Evidence:** shots at 66 km (tilt 85) and 11,000 km look the same as before; draw calls 13 -> 12 low, 12 -> 11 from space.
`- **So what:** what is left per frame: the depth pre-pass (second vertex pass of the land, below 800 km), the sky draw and the ground draw. If still heavy, next candidates are rendering the haze at half size or skipping the pre-pass when the tilt is small (a look straight down needs no real depth).
`
`## 2026-10-27 river zigzags on flat plains: canon corners, D8 staircase and spikes
`
`- **What:** the Cockleswhent (Reach, a flat plain) came out as V zigzags with long horizontal runs, a straight diagonal and wedge-shaped spikes. Three causes, each fixed in the algorithm, none per river: (1) the SVG draws a river as straight segments with sharp corners and the valley was carved along them: `smoothLine` resamples each canon line every km and low-passes it (Gaussian, `SMOOTH_KM` 10) before the valley is carved, ends held by reflection; (2) D8 drainage on a plain steps along rows and diagonals, and the distance field followed that staircase: `river-fields` now traces every river from source to junction or sea, resamples it every km and low-passes it (`RIVER_SMOOTH_KM` 6, ends held), and the field is the distance to those lines; (3) first-order branches of 4 cells or fewer hanging off a river are spikes: dropped (`MIN_SPUR`), a canon river's own source kept (79 in the Reach window).
`- **Evidence:** Reach window (new `--window reach`): canon followed 93.9% within 8 km, 97.5% within 16 km, median 3.5 km. Whole world, 7 min 10 s: all checks and `lore check` pass. App at Ashford (`npm run shot -- "Ashford"`): the Cockleswhent is one smooth curve, no V, no stair, no spikes. The first screenshot after the run timed out on `#loading` (software GL under load) and showed the previous image; a rerun was clean.
`- **So what:** the straight diagonal at the Ashford crossing is the canon line (the books' course) with its corners relaxed, not a generated bend: lowland sinuosity below a pixel (4 km) is not in the bake and belongs to the render-time channel wander in `lift.ts`.
`
`## 2026-10-27 lakes: flat level and smooth bowl in the bake; the globe's water sheet is still tilted
`
`- **What:** `lakeBasins` (pipeline, start of `flow-accumulation`): each connected piece of the lake mask gets one level, the 10th percentile of the ground on its shore (at least 3 m), and a smooth floor below it, 5 m at the edge plus 1.2 m per km from the shore, 40 m at most (assumption: lowland lakes, canon gives no depths). Before, the filter left bumps inside the mask (and a flat 20 m), and the globe lays the lake water a few metres above the terrain, so a bump showed as land inside the lake with a moat at the shore.
`- **Evidence:** God's Eye (Harrenhal) and the Poison Sea in the app, before and after (`tmp/shots/Harrenhal.png`, `tmp/shots/The_Poison_Sea.png`): the water now fills both lakes. Trident window: 6 lakes levelled, levels 3 m to 154 m. Still visible: oval land patches inside the Poison Sea (its mask has one ring, so they are not drawn islands) and thin dark slivers across the God's Eye water. Cause, from reading `lift.ts` and `relief.ts` (not changed): the lake polygon is triangulated with boundary vertices only and each is lifted to the terrain at the shore plus a hair, so the sheet is a tilted plane between shore heights; where it dips below the flat lake floor the terrain shows through, and the slivers are the triangulation of that sheet.
`- **So what:** the bake side is done; the proper fix is on the globe side: draw each lake as a flat sheet at the bake's level. The bake knows the level per lake (the `levels` array in `lakeBasins`); exporting it (by lake id, matched through the polygon) and lifting the lake mesh to it is a change in `lift.ts` / `relief.ts`, which have uncommitted edits of yours: not touched.
`
`## 2026-10-28 houses overlay: data, territories and the liege graph (steps 1 to 3 and the overlay of docs/roadmap-houses.md)
`
`- **What:** `tools/wiki/houses.mjs` reads the wiki's house infoboxes into `src/houses.json` (172 houses whose seat is a place on the map; per book period the overlord from the `Overlords` row). `tools/world/house-territories.mjs` draws each house's land as a weighted Voronoi of the seats, clipped to the coast and to the region the seat is in, and the shared borders as lines drawn once (`src/house-territories.json`: 153 territories, about 580 border lines). `src/houseGraph.ts` answers "who is sworn to whom" and the nested subtree for the click; `src/state/time.ts` is the one book-period store. Tests: `houses.test.mjs`, `house-territories.test.mjs`, `houseGraph.test.ts`, `time.test.ts`.
`- **Evidence:** the territories rendered as an SVG over the land read like the reference crops in the Riverlands and Westerlands. Wiki shapes that broke the first parse: an overlord link inside a note ("None, sovereign (disputed by House Baratheon of Dragonstone...)" made the crown its own vassal, a cycle); "(historical)" overlords that are no period's (Blackwood and Bracken as each other's liege); "(?-299 AC)" means up to 299, not from. The wiki names a liege per book and skips books (Frey: AGOT Tully, ADWD Baelish; Stark: AGOT Baratheon, ADWD Bolton), the same shape with opposite truth (Stark was a king in between), so a gap stays empty and is not guessed. Small holdings: Royce at the Gates of the Moon and Stout at Goldgrass are about 4 miles from their lords' seats, so a pure Voronoi leaves them under a cell; houses with under 40 cells (or a seat off the raster land: islets such as Serry, Sparr, Pryor) get a round holding of up to 0.15 degrees (about 22 miles across, assumption), never over another house's seat cell and its neighbours.
`- **So what:** about 164 wiki houses have no seat on the map (cadet branches, extinct or landless houses, seats the map lacks) and the reference maps draw about 300, so coverage is about 55%; the `house-reference.json` checklist (roadmap step 0) will say which are missing and why. Four houses share `The Northern Mountains` as seat (Burley, Liddle, Norrey, Wull): the first drawn takes it, the rest need seat positions from the lore. ACOK and ASOS have fewer lieges than AGOT and ADWD because the wiki leaves those books blank; canon overrides with a quote each would fill them (Frey and Mallister under Tully until the Red Wedding). Territory sizes are an assumption (`house-weights.json`, empty: size follows the number of vassals).
`
`## 2026-10-28 houses overlay: it works end to end; two traps for the next session
`
`- **What:** the overlay is on screen: `#housesBtn`, territories with every border and coats of arms at the seats, a click on a house lights it and everyone sworn to it (nested), the `#house` card, and the `#when` period pill. Checked in a real browser with real mouse clicks: click on Mallister's land opens House Mallister (sworn to Tully); the ACOK button changes the address to `when=acok` and Tully's lord to Stark; Esc clears; relief and flat map, and a 400 px phone sheet.
`- **Evidence:** `tmp/shots-h/` (not committed). Traps: (1) `npm run shot --eval` runs after the screenshot is taken, so state set there never appears in the picture; set the state before the shot (`?house=id` in the address, or a scratch script that evaluates first). (2) The draw-order trap is not real: the relief mesh sits at renderOrder 0.5, so any vector layer above that is on top; my first "nothing drawn" was the screenshot order. Also, while another session's uncommitted `relief.ts` had backticks inside a GLSL template string (a syntax error), the app could not start; a scratch copy of `src` under `tmp/` with `public` junctioned and `server.fs.strict=false` served the app without touching that file.
`- **So what:** left for the next pass, in `docs/roadmap-houses.md`: the reference checklist (step 0) and with it the coverage report, adjacency test and the landless/extinct houses; tuned territory weights; the other six regions compared against their crops; a three-height phone sheet; a `lore-verifier` pass on the liege chains.
`
`## 2026-10-29 sigils on seats, clickable house chips, house card with words and arms colour
`
`- **What:** a place that is a house's seat wears the house's sigil as its globe icon (`GlobeView.ts`, `.has-sigil`); the house chips on the place card are buttons that open the house sidebar (`onHouse` in `placePanel.ts`, resolved in `main.ts` by name, then sigil file); the house card shows the house's words (new `words` field, parsed from the line under the infobox picture in `tools/wiki/houses.mjs`) instead of "The the Reach · N sworn houses", with region and sworn count moved into its facts; its header tint is the arms' dominant saturated colour, read from the sigil on a 32px canvas (`tintOf` in `housePanel.ts`).
`- **Evidence:** Tyrell opens with "Growing Strong" and tint 21,137,19 (green). Only 48 of 172 houses have words on their wiki infobox, so the line is hidden for the rest. "The the Reach" came from `region` being "the Reach" (lower case) against a case-sensitive `^The ` strip.
`- **So what:** a grey-and-white sigil gets no tint and keeps the default burgundy. `src/houses.json` is untracked in git; regenerate with `node tools/wiki/houses.mjs`.
`
`## 2026-10-29 books removed from the sidebars
`
`- **What:** the place card no longer lists "In the books" (`place-info.ts` stopped merging `src/place-books.json`) and the house card no longer has a "Book" row; its no-liege note says "at this time". The book-period switcher (`#when`) stays, it drives the liege graph.
`- **So what:** `src/place-books.json` and `tools/books/place-books.mjs` are still generated but unused by the UI; delete them or show them again if wanted.
`
`## 2026-10-29 houses mode: soft glowing land instead of drawn borders, bigger sigil hit area
`
`- **What:** `globe/houses.ts` no longer draws one fill mesh per territory plus thin and realm border lines. It paints every territory onto a canvas (24 px/degree) in its great house's arms colour (`graph.realm`, colour read from the sigil by `src/sigilTint.ts`), blurs it twice (14 px halo, 4 px core), and drapes it as a texture on a half-degree patch of the globe (through `lifted`, like the old fills). Great houses' own land is stronger (alpha .5), sworn houses' fainter (.24); a lit realm uses the focused house's colour at .7/.52/.4 by depth. Only the gold focus outline stays a line. The sigil button has 10 px padding and its hover scales the picture, not the button (scaling the button moved it under the cursor).
`- **Evidence:** screenshots at 3,600 km and 3,000 km (Riverlands, North): colours melt across borders, no hard edges. Grey or white sigils (Stark) have no tint and fall back to the palette colour.
`- **So what:** `ctx.filter` blur is missing in older Safari, where borders would stay sharp. The soft glow also bleeds a little over the coast. A territory click still goes through `houseAt`, so the whole land is clickable already; the sigil is just a bigger target.
`
`## 2026-10-29 houses mode: faint borders back, lighter colour, house card order and link styles
`
`- **What:** the thin and realm border lines are back in `globe/houses.ts` at opacity .3 and .4 (`THIN_OPACITY`, `REALM_OPACITY`); land colour is lighter (great house .28, sworn .12, lit .45/.32/.24, unlit .03). The house card reads sigil, name, words, then "Sworn to" as a plain link to the lord, then the facts and the sworn-to-this-house chips. Place and house links in the card use the map card's style (`#place a.to-map`: rose, dotted underline, solid on hover); wiki and credit links use the accent colour with underline on hover.
`- **Evidence:** screenshot of House Stark at 3,000 km: borders visible but quiet over the soft colour; "House Baratheon of King's Landing" and "Winterfell" in the card share the place card's pink dotted links.
`- **So what:** the focus outline stays gold and hard; tune `LIT_ALPHA` and the border opacities together, since the lines read stronger as the colour gets lighter.
`
`## 2026-10-29 house card: the lord sits in the header
`
`- **What:** "Sworn to" moved from its own section into the header under the words: centred, the lord's sigil beside its name in plain text (`.h-lord` in `index.html`, `housePanel.ts`); it still flies to the lord on click, with only a faint hover background.
`- **Evidence:** screenshot of House Stark: sigil, name, words, "Sworn to" and the Baratheon sigil and name, all centred.
`- **So what:** `index.html` has two `<div class="kind"></div></header>` blocks (place card and house card); a string edit hit the wrong one first, so anchor edits on the crest line.
`
`## 2026-10-29 `?house=` link left the loading screen up forever
`
`- **What:** the startup code that opens `?house=id` called `setHouses`, which calls `wake()`, a `const` declared ~150 lines later in `main.ts` (temporal dead zone). The module threw before `setAnimationLoop`, so no first frame and the loading screen never lifted. `wake`/`awakeUntil` now sit before `setHouses`.
`- **Evidence:** headless Chrome, `?house=tully`: `ReferenceError: Cannot access 'wake' before initialization` at `setHouses`; `#loading` never detached. After the move it detaches. `?place`, `?when`, `?character`, `?quality`, `?view=3d` were fine.
`- **So what:** anything the top-level link handling calls must not use `const`s declared below it; `npm run shot -- X --query "house=tully"` is the check. `npx tsc` shows 2 unrelated errors in `housePanel.ts` (`PERIODS` import) that predate this.
`
`## 2026-10-29 pin: the house's sigil goes left of the name
`
`- **What:** a pinned seat's pin shows the house's sigil to the left of the name above the hand (`.pin-head` in `GlobeView.ts`), and the houses layer leaves out its own sigil at that seat (`hideAt` in `globe/houses.ts`), so the pin's tip no longer carries it.
`- **Evidence:** type-checked only; `src/ui/housePanel.ts` was mid-edit by something else (escaped backticks around line 55, a timeline in progress) and the app would not load, so there is no screenshot.
`- **So what:** look at it in the app once `housePanel.ts` compiles again; the seat match is a 22 km radius (`1e-5` on unit vectors).
`
`## 2026-10-29 timeline: books as year ranges, year slider, wheel zoom
`
`- **What:** `#when` is now a line of years AC (broken axis: 1–136, 209–211, 298–300) with every book as a band behind the year dividers, a year slider and wheel zoom (1x–12x, scrolls sideways). The store (`state/time.ts`) holds a book (`fab`, `aksk`, `agot`, `acok`, `asos`, `affc`, `adwd`); `getPeriod()` maps it to the four periods `houses.json` has ties for (`fab`/`aksk` show AGOT, `affc` shows ADWD). `?when=` takes any book id.
`- **Evidence:** years 1–136 (Fire & Blood), 209 and 211 (World of Ice & Fire) are in the extracted books; the 298–300 spans of the five novels are from the wiki, the books give no year (assumption, `BOOKS` in `time.ts`). The wiki dates the Whitewalls tourney 212; the book says 211, the book is used. `npm test` and `tsc` pass; screenshot checked at 1x only.
`- **So what:** at 299–300 five books overlap, so a year does not pick a book: the slider keeps the current book while it covers the year, bands pick one. World of Ice & Fire (a history to 298 AC) is left out of the axis. Short bands clip their label until zoomed. Wheel zoom and mobile layout are not checked in a browser.
`
`## 2026-10-29 timeline: one line, a drum of years you spin
`
`- **What:** `#when` is now one drum of years AC (`initWhen` in `housePanel.ts`): drag, mouse wheel or arrow keys spin it with inertia and it snaps to a year; the years between book spans are skipped. The books covering the middle year are chips under it (the stacked bands are gone, since five books share 299–300 AC and one line cannot show that); the year picks the book when the current one does not cover it.
`- **Evidence:** layout checked in headless Chrome at rest; `tsc` and `npm test` pass. Drag, inertia and touch are not exercised in a browser.
`- **So what:** the `time.ts` store is unchanged (still a book), so layers that follow it need nothing.
`
`## 2026-10-29 timeline: events from deep time to 300 AC
`
`- **What:** `src/timeline.ts` holds about 65 events (12,000 BC to 300 AC) from the wiki's "Timeline of major events". The drum now turns through every year a book covers or an event starts in (BC years are negative, no year 0); years with events carry a dot, and the events covering the middle year show in a card under the drum. A year no book covers keeps the selected book (house ties unchanged). AGOT now starts 297 AC (the wiki puts its Prologue there).
`- **Evidence:** the page's own dates, texts condensed; `ca` marks approximate ones. Checked in headless Chrome at 297 AC only; deep BC years, the scroll of a long card and mobile are not.
`- **So what:** the page's claims are wiki-level (cites the novels and World of Ice & Fire) and not checked against `docs/sources/books/text`; run `npm run lore -- find` on any date before relying on it. Credit line in the card follows the page's CC BY-SA licence.
`
`## 2026-10-29 timeline: bottom bar, button, eras as background, separate window
`
`- **What:** the timeline is a full-width bar at the bottom opened by its own button (`#timelineBtn`, or a `?when=` link), no longer tied to the houses overlay. The wiki's eras (`ERAS` in `src/timeline.ts`: two lanes, Westeros and the Freehold, which overlaps it) are bands behind the drum and move with it; the era name stays in the visible part of its band. Events and the book chips moved to a separate card (`#whenInfo`) above the bar. The drum's radius follows the bar's width.
`- **Evidence:** headless Chrome at 297 AC, 1280 px wide; the bar, button, era bands and window render. Not checked: phone width, very wide screens, the deep BC years.
`- **So what:** era limits are the page's section headings, so deep-time eras are as loose as the sources (the Long Night and the Age of Heroes share one band).
`
`## 2026-10-29 timeline: books as areas, no book chips
`
`- **What:** the book chips are gone. Each book is a coloured area in the timeline's background (rows under the eras; books that overlap, as the five novels do in 299–300 AC, take their own row). Years inside a book spanning under five years are spread out (`WIDE` 120 px, not 34) so its area has room. A book is picked by turning the drum into its years or by tapping its area; the information window names the picked book.
`- **Evidence:** headless Chrome at 297 AC: AGOT, ACOK, ASOS, AFFC and ADWD show as separate areas over 297–300 AC. Tap-to-pick and the 209–211 AC Dunk & Egg area were not exercised in a browser.
`- **So what:** a tap on an area that is under the middle year picks that book; for 299–300 AC the drum alone cannot choose among the four overlapping books, only a tap can.
`
`## 2026-10-29 timeline: only the years the wiki has events for, each linked
`
`- **What:** the drum turns only through `YEAR_STOPS` (`src/timeline.ts`): the wiki's "Years before / after Aegon's Conquest" lists (25 BC years, 101 AC years), so the 1–136 AC run is no longer every year. The window links each year to its wiki page (`WIKI_YEAR`, `<n>_AC` / `<n>_BC`). An event dated in a year with no page shows at the next listed year with its own date in the heading (96 AC at 99, 157 AC at 160, deep BC dates at the next stop).
`- **Evidence:** the AC list is read off the wiki's navbox screenshot, the BC list from the page text; neither was checked against the live wiki, and the `<n>_AC` page names are assumed from the wiki's usual pattern. Headless Chrome at 297 AC.
`- **So what:** the 212 AC stop is the wiki's date for The Mystery Knight; the World of Ice & Fire gives 211, and the Dunk & Egg area ends at 211. Not yet logged in `docs/lore-conflicts.md`.
`
`## 2026-10-29 timeline: one row of books, wheel zoom, era names that fit
`
`- **What:** the books are one row, in reading order; books that share years split the stretch they share evenly (AGOT, ACOK, ASOS, AFFC, ADWD side by side over 297–300 AC) instead of stacking. This is a drawing choice, not a claim about when events happened; the year ranges in `BOOKS` are unchanged. The mouse wheel zooms the years in and out (0.3x to 2.5x, `zoom` in `initWhen`); dragging turns the drum. An era or book name is drawn only where it fits whole in the visible part of its band (text measured with a canvas), so nothing is cut off; below 0.7x only the decade and gap labels remain.
`- **Evidence:** headless Chrome at 297 AC: one row, no clipped names. Wheel zoom and the zoomed-out look were not exercised in a browser.
`- **So what:** a name that does not fit is hidden, not shortened; zoom in to read narrow eras such as "Fall of the Dragons" (281–283 AC).
`
`## 2026-10-29 timeline: stacked overlaps again, full book names, sideways scroll
`
`- **What:** books that overlap in time stack in rows again (the others share one row), and each area carries the book's full name, shown only where it fits (zoom in for the narrow ones). Sideways scroll (trackpad, shift+wheel, `deltaX`) still turns the years; up and down zooms. The bar's height follows the number of rows (`--wheel-h`).
`- **Evidence:** headless Chrome at 297 AC: five stacked rows with full names, none cut. The wheel code was type-checked only.
`- **So what:** this undoes the one-row split of the previous entry for overlapping books; its zoom and fit-the-name rules stay.
`
`## 2026-10-29 house borders: soft edges, and the focus outline in the house's colour
`
`- **What:** the thin, realm and focus borders in `globe/houses.ts` are `softLine`s: a core line plus a 2.6x wider copy at 35% opacity, so each edge has a soft shoulder that stays the same width on screen at every zoom. The focus outline takes the focused house's arms colour, 35% lighter, instead of gold.
`- **Evidence:** House Tully at 1,500 km: a periwinkle outline with a soft edge around the Riverlands, no gold; the faint dark realm lines are softened the same way.
`- **So what:** blurring the borders inside the land canvas was rejected: at 24 px/degree a texel is about 5 km, so lines went 35 px wide when zoomed in. Tune `HALO` and `HALO_ALPHA` for more or less blur.
`
`## 2026-10-29 houses mode: hover, a vivid focused realm, softer borders
`
`- **What:** over a house's land the cursor is a pointer and that land takes a little more colour (`HOVER_ALPHA` .16; `setHover` in `globe/houses.ts`, one pick per frame at most, none while dragging or measuring). The focused realm is drawn in a more saturated, mid-light version of the house colour (`vivid`) at higher alpha (.55/.40/.30). Border halos are wider (`HALO` 4.5, alpha .3).
`- **Evidence:** `window.__renderer.domElement.style.cursor` is `pointer` over the Riverlands and empty over the sea; House Tully's realm is a clear blue with a soft edge.
`- **So what:** every hover change repaints the land canvas (two blurs), so moving across many houses fast costs a repaint per house; if it stutters, lower `PPD` or cache each house's layer.
`
`## 2026-10-29 houses mode: crisp borders again, saturated focus outline
`
`- **What:** the border lines lost their halo copy (`borderLine` in `globe/houses.ts` is one line per layer again, widths 1.5, 2.5 and 4 px); the focus outline uses `vivid` of the focused house's colour instead of the lightened one.
`- **So what:** the soft look now comes from the land colour only; the halo idea (wider fainter copy) is in the previous entry if it is wanted back.
`
`## 2026-10-29 houses mode: sigil and name at the middle of the land; normal mode has its icons back
`
`- **What:** in houses mode each house's sigil and name ("House Tully") sit at the centroid of its biggest territory ring (`centreOf` in `globe/houses.ts`, seat as fallback when the centroid falls outside the land), the name under the sigil (`.house-sigil span`); the declutter box covers both. The place labels went back to their kind symbols in every mode: the `has-sigil` icons and the `houses-on` body class are gone, and so is `hideAt` (the sigil no longer sits at the seat the pin marks).
`- **Evidence:** screenshots at 2,400 km: "House Tully", "House Arryn" and "House Baratheon of King's Landing" are centred in their lands, the seat labels keep their castle and city symbols; at 22,000 km, a pinned seat shows the pin with its house's sigil left of the name.
`- **So what:** the pin still shows the seat's first house sigil left of its name (asked for earlier); drop `pinSigil` in `GlobeView.ts` if the normal map should show none.
`
`## 2026-10-29 houses mode: only the houses are labelled; a click flies there
`
`- **What:** with the houses layer on, the place-name pass shows no names (`!houses.visible` in `GlobeView.ts`'s label loop, and `houses.visible` in the pass's change signature so toggling re-runs it); the houses' own sigils and names remain. A click on a house's land or sigil now lights it and flies to frame its realm (`onPick` in `HouseLayerOptions`, wired to `flyToHouse`); a click off the land still clears.
`- **Evidence:** headless run at 1,200 km: 0 place labels shown in houses mode; a click on the land flew to 401 km and opened "House Staunton of Rook's Rest". The click framed that house alone because a leaf house has no sworn houses to include.
`- **So what:** a pinned place's pin (and its name) still shows in houses mode; pins come from search and clicks on places, which the houses mode does not use.
`
`## 2026-10-29 houses mode: fainter vassal names, no hover scaling, vassal land lighter, hover through the sigil
`
`- **What:** names of houses below the top tier are drawn fainter (`.house-sigil:not([data-tier="0"]) span`); the sigil no longer scales on hover; when a liege is focused its vassals' land is lighter (`LIT_ALPHA` .55 / .22 / .15 by depth); hovering a sigil or its name hovers that house's land (`onpointerenter` in `globe/houses.ts`), because the sigil box sits over the land and swallows the canvas pointer events.
`- **So what:** the land's hover tint is now the only hover feedback on a sigil.
`
`## 2026-10-29 houses mode: flat, visible colour instead of the glow
`
`- **What:** the land is flat colour again, easy to read: every territory in its great house's arms colour made vivid (`vivid`), at .42 for a great house's own land and .30 for its sworn houses; one light 2 px blur only hides the canvas's pixel steps (`BLUR = [2]`); borders are stronger (thin .45, realm .75). A focused realm is .62 / .42 / .34 by depth, the rest .03.
`- **Evidence:** screenshots at 1,000 km (Riverlands, Vale, Crownlands each a distinct, clear tint with crisp edges) and with House Tully focused.
`- **So what:** the earlier look (14 px halo blur, alphas .12 to .28) is in the git history of this session's entries above; `BLUR`, `HEAD_ALPHA`, `SWORN_ALPHA` and `LIT_ALPHA` are the four knobs if it needs to swing back toward soft.
`
`## 2026-10-29 houses mode: hover without flicker
`
`- **What:** hover is its own small layer (`hoverMesh`, `drawHover` in `globe/houses.ts`) that redraws only the hovered territory, instead of repainting all of them with blurs on every change; `setHover` takes the last answer once a frame, so the leave-then-enter when the pointer goes from one house's land onto the next one's sigil no longer flashes the land unhovered in between.
`- **Evidence:** headless run across a border and over a sigil: no page errors, 7.6 ms CPU per frame afterwards. The tint itself was not visible in the screenshot because the hovered land (Smallwood) was already a strong yellow.
`- **So what:** hover alpha is `HOVER_ALPHA` (.22); on a land that is already strong, raise it or switch the hover to a lighter colour if it needs to show.
`
`## 2026-10-29 Regions | Houses switcher, top right
`
`- **What:** the shield button that toggled the houses layer is replaced by a two-button switcher, "Regions | Houses", fixed at the top right (`#modeSwitch` in `index.html`, `setHouses` in `main.ts`, rules in `style.css`). Regions is the normal map, Houses turns the layer on; the pressed one is burgundy, like the other pressed controls.
`- **Evidence:** headless click on Houses: `regions:false, houses:true`, no page errors; screenshot of the pill top right.
`- **So what:** the pill sits clear of the left search bar and the side card, but not of the debug HUD strip if it is wide; check it on a phone width (top right, safe-area aware).
`
`## 2026-10-29 houses mode: coloured borders, shores outlined, fainter land
`
`- **What:** border lines are no longer black. `drawBorders` in `globe/houses.ts` draws every house's whole outline (the shore included, which the shared-border list `T.borders` never had) in its realm's vivid colour, and the lines between two realms in the mean of the two colours; one pooled line per colour, rebuilt only when the grouping changes (a period switch or a sigil colour arriving). Land opacity is lower again (great house .28, sworn .18).
`- **Evidence:** screenshot at 1,500 km: the Riverlands' blue lines, the Crownlands' yellow-green, Dragonstone's coast outlined in its own colour; no black left.
`- **So what:** a border between two realms is drawn by both sides in their own colour on top of the blend, so it is a little thicker than one inside a realm; the page logged no errors, but 94 draw calls at this view are mostly the pooled lines, so merge colours (fewer, coarser buckets) if frames drop.
`
`## 2026-10-29 houses mode: each border once, and the focused house's seat is named
`
`- **What:** the double borders came from drawing every house's full outline (a shared border was drawn by both neighbours) on top of the shared-border lines. `drawBorders` in `globe/houses.ts` now draws each shared border once (realm colour, or the blend between realms) plus only the shore: the stretches of a house's outline with no shared border within one cell (`T.cell`, 0.05 degrees) of their midpoint (`coastOf`, computed once, about 18,000 of 51,000 outline segments). Also: with a house focused in houses mode, its seat's place name and symbol show at any height (`houses.seat`, the label loop in `GlobeView.ts`).
`- **Evidence:** screenshot at 1,500 km: single lines between houses, coloured shores; focusing Tully shows exactly one place label, "Riverrun". Exact vertex matching between outlines and `T.borders` failed (only 55% of border points sit on outline points), hence the distance test.
`- **So what:** the seat is looked up by the house's `seat` name; a house whose seat has no matching place label shows nothing extra.
`
`## 2026-10-29 houses mode: solid land, a bigger white focused house
`
`- **What:** the land canvas is no longer blurred (`BLUR = [0]`) and is sharper (`PPD` 32); the focused house's own sigil and name get a `.focus` class (`globe/houses.ts` update loop): white 18 px name with a heavier outline, a 64 px sigil, and a 1.6x declutter box.
`- **Evidence:** House Tully at 1,500 km: flat blue realm with crisp edges, "House Tully" white and larger.
`- **So what:** the seat label ("Riverrun") sits where the sigil's centre is for a house whose centroid is near its seat, so it overlaps the sigil's lower edge; if that bothers, offset the seat label or the sigil.
`
`## 2026-10-29 houses mode: a smaller focused sigil that grows smoothly
`
`- **What:** the focused house's sigil is 50 px (was 64) and its name 16 px (was 18), and both ease to those sizes over .35 s when the house is focused, and back when it is not (`transition` on `.house-sigil img` and `span` in `style.css`); the declutter box is 1.3x (was 1.6x).
`- **So what:** not looked at in motion; the sizes are the two numbers to tweak (`.house-sigil.focus[data-tier]`).
`
`## 2026-10-29 houses mode: lighter land colour
`
`- **What:** land opacity lowered: great house .17 (was .28), sworn .11 (was .18), focused realm .40 / .26 / .20 (was .62 / .42 / .34), in `globe/houses.ts` (`HEAD_ALPHA`, `SWORN_ALPHA`, `LIT_ALPHA`). Not looked at on screen.
`
`## 2026-10-29 house card: sworn houses one a line, sorted as printed
`
`- **What:** the "Sworn to this house" list is one chip per line (`#house .h-sworn .h-list` is a column) and sorted by the name as printed without "House " (`shown` in `ui/housePanel.ts`), not by the full name. Not looked at on screen.
`
`## 2026-10-29 houses mode: shore lines match the realm borders
`
`- **What:** shore stretches are drawn in the realm-border style (2.5 px, .9 opacity, pooled with the lines between realms) instead of the thin one (1.5 px, .6), still in the house's realm colour (`drawBorders`, `globe/houses.ts`). They no longer fade out at high altitude with the thin lines. Not looked at on screen.
`
`## 2026-10-29 houses mode: grey realms for houses without a sigil colour; the focus outline includes the shore
`
`- **What:** `tintOf` (`src/sigilTint.ts`) now returns a mid grey (luminance clamped to 85..175) when no saturated colour covers at least 8% of the sigil's opaque pixels, instead of null (which fell back to a palette colour); Stark's red wolf tongue was enough to tint the whole North pink before. The focus outline now also includes the shore stretches of the lit houses (`ring.set` in `paint`), so the focused realm is outlined in one colour all round; before, its shore was drawn in the realm colour beside an orange border.
`- **Evidence:** House Hornwood focused: border and shore both orange. House Stark focused: grey fill, grey outline and a grey header; white and black sigils (Cerwyn, Karstark) read as grey and dark-grey realms.
`- **So what:** the header tint of the house card uses the same grey; `vivid` leaves greys alone by design (hue-less colours have nothing to saturate).
`
`## 2026-10-29 houses mode: darker borders on grey realms
`
`- **What:** a border or shore whose colour has no hue (a grey realm) is drawn at 40% of its brightness (`edge` in `globe/houses.ts`, applied to the pooled border colours and the focus outline); coloured realms are unchanged. Not looked at on screen.
`
`## 2026-10-29 place card house buttons: hover colour only
`
`- **What:** the house chips on the place card (`#place .house`) lost their transition, lift, press and sigil scaling; hover only changes the background and border colour. Not looked at on screen.
`
`## 2026-10-29 600 km floor; rivers: fewer branches, on the books' courses, no margins, natural colour
`
`- **What:** camera floor raised to 600 km (`MIN_ALT`), label bands refitted (regions and oceans give way at 1,000-1,200 km, point places all show at the floor). `river-fields` now draws the canon rivers on their own paths and, off them, only sim rivers with ~5,000 km² of catchment (`BRANCH_CELLS` = 4x the river threshold). Dropped: sim cells within 8 km of a canon river (`CANON_NEAR_KM`), sim cells within 25 km carrying half the flow the sim gathered along the canon path there (`TWIN_KM`, `TWIN_SHARE`: the canon river's own water drifted off course), and branches under 30 km that nothing joins (`MIN_CHAIN_KM`: the comb teeth along the Red Fork). Size is normalised against the whole sim network (`QrefSim`), or dropping twins swells what is left. `reincise` now blends the valley with a smooth minimum (40 m), floor half-width 2-12 km (was 3-25) and keeps 60% of the ground's small relief; the shader's floodplain tint is gone. River colour: silty olive-grey to dark slate green, not blue.
`- **Evidence:** Trident 1 km drawn river cells 30,672 -> 5,629; world 150,278 -> 53,871. Canon fit at 1 km: 84% within 8 km, median 2.1 km -> 90%, 1.3 km (narrower valleys pull the sim's drainage onto the canon line). World: 95% within 8 km, 90th percentile 4.6 km; lore check green. Shots: `tmp/shots-600/` (world, trident-1km-canon, labels).
`- **So what:** the twin test must compare against the flow the sim gathered, not the drawn size (with the books-length boost it was ~5x too high at 1 km and left parallel rivers). The "margin" along rivers was the hard `min` in `reincise` after the erosion filter: a flat floor with a terrace edge, amplified 4.5x by exaggeration.
`
`## 2026-10-29 river artifacts at 600 km: the distance field is too coarse; rivers drawn as lines
`
`- **What:** from the 600 km floor the rivers broke into forks, hooks and blobs where they meet (Riverrun, the Tumblestone into the Red Fork). Cause: the water was drawn from relief-e, a signed distance field at 4.2 km per texel. From 2,000 km a texel is ~2 px and looks clean; from 600 km it is ~6 px, wider than the 1-2.5 px river, and where two rivers meet inside one texel the four-tap blend invents zero crossings. Fix: the bake writes its smoothed river chains to `relief-rivers.json` (lon, lat, size every 2 km; world 3.5 MB, Trident window 0.17 MB) and `relief.ts` `bakedRivers` draws them as lifted LineMaterial lines in five size classes, with the shader's widths, colours and fade by km per pixel. `uRiverLines` turns the shader's water off; relief-e still carves.
`- **Evidence:** `tmp/shots-600/lines/crop.png` (1 km bake) and `tmp/shots-600/lines-world/crop.png` against `tmp/shots-600/zoom/crop.png` (before). At 450 m above the baked ground the lines were still cut into dashes from 2,100 km (the exaggeration grows with height); pulling each vertex 0.2% toward the camera in view space (same screen spot) fixed it. Polygon offset does nothing here: the log depth buffer writes gl_FragDepth.
`- **So what:** a line thinner than a texel cannot come from a texture field; draw it as geometry. The same 0.2% view-space pull would fix the dashed roads from 2,000 km (not done). Tall ranges in a tilted view still hide the lines, as they should.
`
`## 2026-10-29 river lines fuller, teal instead of grey
`
`- **What:** `bakedRivers` (relief.ts) widths 1.5-3.5 px (were 1-2.5), opacity 0.8-1 (was 0.6-0.95), colour muted green-teal (creek) to deep blue-teal (great river), no 0.7 dimming. The olive-grey to slate ramp read as grey lines from 600 km (the Green Fork at the Crossroads).
`- **Evidence:** `tmp/shots-600/colour/crop.png`. Trap on the way: a trailing `//` comment pasted before `mat.userData.q = q` left q undefined, so every class faded to nothing and tsc still passed; a shot is the only check that catches it.
`- **So what:** the lines now sit near the lakes' water colour, so rivers and lakes read as one water system.
`
`## 2026-10-29 the Wall's castles slant at 60°; crowded names are drawn off their spot, never over a neighbour
`
`- **What:** the nineteen castles of the Wall stand ~16 miles apart in a row, so their names overlapped and the overlap check hid most of them. Symbol and name now both rise at -60° (`.on-wall`, style.css; `WALL_SLANT`, GlobeView.ts), and each frame `spreadWall` slides them along the Wall's on-screen line just enough to keep slanted neighbours a name's height apart (isotonic regression, pool adjacent violators). A slanted name claims a chain of text-high squares up the slant (`createDeclutter().claim` takes a chain, all or none); one upright box would always hit the neighbours. Every other point name tries right, left, below, above; where none is free, symbol and name are drawn 18, 36 or 54 px off the place (`SPOTS`, `shift`, CSS `--dx/--dy`) with a leader line back (`.moved::after`). Screen only: coordinates never change.
`- **Evidence:** `tmp/overlap.js` (rotated-rectangle overlap test of the shown names, run with `node tools/world/shot.mjs <places> --eval "$(tr '
`' ' ' < tmp/overlap.js)"`; no `//` comments, the newlines are dropped) at the 600 km floor: Castle Black, Shadow Tower, Winterfell, King's Landing, 155-299 names shown, 0 overlaps (Castle Black had 15 before: Mole's Town's symbol is 4 px from Castle Black's). `npm run shot -- ` mangles a multi-line `--eval`; call node directly.
`- **So what:** at the floor every point place is still named but no longer over another. The leader line is not in the overlap test, so it may cross a name.
`- **Houses (same day):** the coats of arms ran their own overlap check, blind to the focused seat's name, and a crowded one was only hidden. Now the label pass hands the seat's box to `houses.update` (`reserved`, one frame late), and a coat of arms tries `RINGS` (declutter.ts, shared with the place names) in steps of half its height, drawn off its land on a leader line (`offset`, `.moved`). Its box was guessed at 6.5 px a letter, too small for "House Baratheon of King's Landing"; 7.5 / 8.7 px (12 / 14 px type) matches. `tmp/houseshot.mjs <house ids>` opens `?house=` and counts seat-name and sigil overlaps: tully, stark, lannister, tyrell, arryn went from 1-8 overlaps each to 0. Leader lines sit under the symbols (`z-index: -1` on `::after`; the CSS2D transform makes each label its own stacking context).
`- **Abandoned castles of the Wall** are grey (`.abandoned`, #9a968c, 5.7:1 on the stroke), by period: only Eastwatch, Castle Black and the Shadow Tower manned up to ASOS ("Only Eastwatch, Castle Black, and the Shadow Tower were manned when I left the Wall", ASOS, Jon); in ADWD also Icemark, Long Barrow, Sable Hall, Greyguard and Deep Lake ("The Watch now had garrisons at ...", ADWD, Jon).
`
`## 2026-10-29 rivers: one colour, no floating branches
`
`- **What:** river lines are one water colour; the small ones leave by thinning, not fading (a translucent line reads as another colour). Floating branches had two causes. (1) The per-cell twin rule (within 25 km, half the canon flow) measured against a canon river's own sim flow, which is tiny near its source, so it cut ordinary rivers mid-course. Fixed in the drainage, not the drawing: canon path cells drain to the next cell, a canon valley's floor drains toward its river, cycles reverted (`flowAccumulation`); the twin rules and the 8 km exclusion are gone. (2) 91 canon rivers whose book line stops a few km short of the river it feeds: they now continue down the sim's drainage to it (`joinAt`).
`- **Evidence:** `tmp/ends.mjs public/world/relief-rivers.json` classifies every drawn river's last point: before 993 joined, 504 at water, 91 floating (all canon); after 1,076 / 504 / 7. The bake prints how traced rivers end (`river ends: joined 1036, noReceiver 411`; noReceiver is a fill outlet, i.e. the sea or a lake). Trap: a point-in-polygon land test must be even-odd over all rings, as the bake rasterises (holes are water). Shot: `tmp/shots-600/natural/The_Crossroads_Inn.png`.
`- **So what:** don't hide a drainage problem with drawing rules; route the water. 7 canon rivers still end on land (55.18,-3.8; 52.17,-11.22; 48.91,-14.61; 48.95,-13.67; 46.11,-13.04; 42.86,-12.93; -1.28,30.01): their walk hit the 200-cell cap or an outlet the checker misses.
`
`## Place kinds: inn, archipelago; alt names; Twins on the Green Fork (2026-10-29)
`
`- **What:** new kinds `inn` (Kneeling Man renamed to the wiki title *Inn of the Kneeling Man*, The Crossroads Inn moved out of `landmark`) and `archipelago` (Iron Islands, Three Sisters, Shield Islands, Targaryen Islands, Stepstones, Basilisk Isles, Summer Isles, Thousand Islands, Manticore Isles: lettered over the group like a region, not a symbol on one island). Forest names are now uppercase. `src/place-alt.json` (hand-kept) gives a name in parentheses under a label: Dothraki *Rhaesh Andahli* for Westeros, and the original names of the Dothraki-renamed ruins, all from the wiki's Dothraki language table. The Twins snapped to the nearest point of the vector Green Fork (43.97, -13.23; it was 4.0 mi off). Eleven battles added at the place their wiki title names (Oxcross, Ashford, Bronzegate, Mummer's Ford, Acorn Hall, Duskendale, Fairmarket, Rook's Rest, Pyke, Moat Cailin, and the Trident at Ruby Ford).
`- **Evidence:** wiki titles `Battle of Oxcross`, `Battle at Duskendale` etc. (category Battles); `Inn of the Kneeling Man` ("main building sits along the southern shore where the Red Fork of the Trident bends"). `The Trident` is a river in the books (Red, Green and Blue Forks); the land it drains is "the riverlands", so `river` is right. Checked with `npm run lore -- check` (46 ok), `tsc`, `npm test`, shots.
`- **So what:** inns found in the wiki mirror (Bawdy Badger, Black Bargeman, Bloody Caltrops, Broken Anvil...) stand inside cities, so they belong to the 3D sites, not the globe. The added battles have no wiki summary on the card yet (`place-info.mjs` maps by map name). Region-like names still typed `castle`: Hornwood, Snakewood, Brindlewood, Felwood, Willow Wood, Mistwood are castles named after woods, kept as points.
`
`## All mirrored battles on the map (2026-10-29)
`
`- **What:** `tools/books/battles.json` lists 58 battles from the wiki's Battles category, each placed where its infobox "Place" row says (a place's spot, the nearest point of a named river's drawn line, a point just inside the Gods Eye shore, or the Green Fork between the Twins and the Crossroads Inn). `node tools/world/battles.mjs` writes them as `battle` rows at the end of `places.raw.txt` (below a marker line; it replaces the 11 I had added by hand, and drops "Fall of Moat Cailin", which is a capture). Battles that share a spot are fanned about 5 mi apart on a ring, the first on the spot (Ruby Ford has three, Riverrun two, Castle Black two).
`- **Left out, canon gives no usable place:** Whispering Wood (books say only that Jaime was smashed "in the Whispering Wood"), Black Bog, Bitter River, Borderland, Summerfield, Three Armies, Six Kings, Crookwater, Horns of Hazzat, Battle for the Dawn, the burning septry, the Kingsroad north of King's Landing. Also left out as not battles: sacks, burnings, captures, falls, marches.
`- **Limit:** the mirror holds 96 pages in "Battles"; the wiki has more. Re-run the category crawl (`docs/place-gap.md`), add rows to `battles.json`, run `node tools/world/battles.mjs && npm run places`.
`- **Evidence:** `lore check` 46 ok, 0 wet; `tsc`, `npm test` pass; shots of Ruby Ford and the Gods Eye. The cards of the new battles have no wiki text yet (`place-info.mjs` does not map them).
`
`## Timeline and spoiler control: what exists, what leaks (2026-10-29)
`
`- **What:** plan in `docs/roadmap-timeline.md`. The axis already exists: `src/characters.json` has 345 chapters in publication order (AGOT 0, ACOK 73, ASOS 143, AFFC 225, ADWD 271, TWOW sample 344) and keys character steps by chapter index. `src/state/time.ts` only knows books (folded onto the 4 liege periods of `houses.json`); house seats never change there.
`- **Leaks found:** the place card shows the wiki lead (written after ADWD); `place-books.json` lists mentions per book, not chapter; the house card shows today's head; battles show regardless of date.
`- **So what:** the moment should be a chapter or episode index, and facts dated changes on top of the AGOT base, not per-period snapshots. Realm outlines are already built at runtime from the liege graph, so they follow a per-chapter graph for free.
`
`## Battles visible earlier, archipelago icon (2026-10-29)
`
`- **What:** battle names came in only below 1,600 km (the castle band), so the opening view and a Westeros-wide view showed none. `LOD.battle` in `GlobeView.ts` now starts at 2,800 km (the mountains' band); a shot at 2,700 km shows them all. The home view (22,000 km) still shows only continents and oceans, by design. `archipelago` got an icon (three islands over water) so its legend row is no longer empty; the label itself stays lettering, since area kinds draw no symbol.
`- **So what:** if 58 battle names clutter the 2,800 km view, narrow the band, not the data.
`
`## Timeline step 1: chapters and episodes as the axis (2026-10-29)
`
`- **What:** `src/state/time.ts` holds a moment (a chapter in publication order, a show episode, or a history year), `?when=acok | asos-sansa-iv | s3e9 | fab`. `src/chapters.json` (`npm run chapters`, `tools/books/chapters.mjs`) holds 345 chapters with book and year, and the 73 episodes from the wiki season pages; `src/characters.json` no longer carries the chapter list. TWOW (sample) is a book in `BOOKS`; ADWD now spans 300 AC only.
`- **Evidence:** chapter years from the wiki year pages' intros (AGOT prologue 297; AGOT 298 until the Battle on the Green Fork, AGOT 62, 299; ACOK 299; AFFC The Prophet 299, the rest 300; ADWD 300) and ASOS 59 Sansa IV, "The three hundredth year since Aegon's Conquest." AGOT 61 (Daenerys VII) and the TWOW sample are dated by no source: assumptions in the script. The year pages' chapter citations are for events, including backstory (ACOK 8 is cited on the 298 page), so they can't date chapters on their own. The season pages give no year for any episode. `npm test` 45 pass, `tsc`, `lore check`; shots of `when=asos-sansa-iv` (wheel at 300 AC, ASOS), `s3e9`, `twow`.
`- **Bug fixed:** a `?when=` link was lost on load: `initWhen()` wrote the address for the default moment before `main.ts` read it. The read now comes first.
`- **So what:** Node's test runner needs `with { type: 'json' }` on a JSON import in a `.ts` file it loads; Vite and tsc accept it. The show track has no house ties yet; it borrows a book period per season until roadmap step 7.
`
`## Timeline step 2: dated changes, the resolver, quotes checked to the chapter (2026-10-29)
`
`- **What:** `tools/books/timeline.json` (11 quoted changes: Robb crowned, the river lords, Winterfell taken, burned and held by the Boltons, Moat Cailin, Harrenhal, the Red Wedding), `tools/books/timeline-check.mjs` (in `npm run lore -- check`), `src/state/changes.ts` (`stateAt`, `liegeAt`). The houses overlay now builds its liege graph per moment (`buildGraph(houses, liegeFn)`); `src/houseGraph.test.ts` was not in `npm test` and now is. Checked in the app: the Frey card says "Sworn to Tully" at ASOS Catelyn VI and "Baratheon of King's Landing" at Catelyn VII.
`- **Technique:** a quote's chapter is the Nth `## POV` heading before it in the extracted book; this matches all 344 chapter slugs of the five novels, once the leading "The" qm drops ("Princess in the Tower") is allowed. `node tools/books/timeline-check.mjs --where "quote"` prints the slug to cite.
`- **Problems found and fixed:** `extract.mjs` missed "THE KRAKEN'S DAUGHTER" as a heading (its capitals regex lacked the curly apostrophe); re-extracted, the only other new headings are two appendix lines. ACOK's text is hard-wrapped, so quotes are searched with whitespace collapsed (headings turned into markers first).
`- **Decision:** the wiki's per-book lieges count from the *last* chapter of their book, not the first: the wiki gives no chapter, and the first would spoil (ADWD's Glover to Stannis at the ADWD prologue). A blank period means the wiki is silent, so the last liege stays; Stark's ACOK blank (independent) is supplied by the quoted AGOT Catelyn XI change.
`- **Limits:** the wiki mirror has 14 of the 73 Game of Thrones episode pages, so only S1E10 is dated on the show track. Some periods in the wiki read oddly (House Stark's ADWD liege is Bolton); they are the wiki's, applied at the end of ADWD.
`
`## Timeline step 3: places through time (2026-10-29)
`
`- **What:** `src/state/changes.ts` gains `first: true` changes (a place is `gone` until its change). `timeline.json` now has 60 changes: 22 in-series battles dated to the chapter that first reports them (quote checked to the chapter), 27 pre-series battles dated by year from their wiki infobox Date row. `GlobeView.ts` hides `gone` places (labels, search), draws ruins with the ruin symbol, shows the name of the moment; the place card has a "Held by" row; the selection pin's arms follow the holder (none for Winterfell after the sack).
`- **Left out on purpose:** "Battle in the ice" (only claimed in the Pink Letter, never fought on the page): stays always visible. Nine battles have no date row on the wiki and no book citation yet, so they also stay always visible: Bronzegate, Mummer's Ford (dated by book only), Fairmarket, Old Wyk, Howling Hills, Seven Stars, Slayne, Bloody Pool, Weeping Water.
`- **Judgement calls to review (subagent notes):** Whispering Sound dated at Samwell V (Cersei VIII only reports longships sent); Hornwood at Bran IV (explicit fighting is Bran V); Camps at Tyrion IX in AGOT (the plan is in Catelyn X); Fist's quote is the Watch arming, not naming the Fist.
`- **Gotcha:** `$TMP` in Git Bash is the system temp, not the session scratchpad; wiki Date rows use a non-breaking space ("299 AC").
`- **Still open in step 3:** castle seat changes beyond Winterfell, Moat Cailin, Harrenhal.
`
`## Wiki details for the places that had none (2026-10-29)
`
`- **What:** 76 of 709 places had no entry in `src/place-wiki.json`; 58 were battles, whose articles were already mirrored but missing from the stale `_places.json` (git-ignored, built before the battles were added). Rebuilding the name -> article map (same matching as `scrape.mjs --places`, run offline) and `node tools/wiki/place-info.mjs` gave them all a summary: 694 of 709 places now have wiki text. Two ALIASES added in `scrape.mjs` (Mormont's Keep -> Hall of the Mormonts, whose article note says its title is conjectural; Kingshouse (Skagos) -> Kingshouse). One new sigil (House Mormont) fetched with `--sigils`.
`- **Still without wiki text (16):** names the wiki has no article for (Baelish Keep, The Western Hills, Dornish Desert, Red Dunes, Targaryen Islands, Silver Lakes, Northern/Western/Eastern Provinces, Ice River, Lesser Mander, Lake Town, Basilisk Bay, Black Fort, Ghiscari Coast Road). Canon-first: not given a guessed article.
`- **So what:** after adding places to `places.raw.txt`, run `npm run wiki` (or `scrape.mjs --places` then `place-info.mjs`) or the new places show an empty card.
`
`## Timeline step 3: more seats changing hands (2026-10-30)
`
`- **What:** `timeline.json` now has 66 changes. Added the seats Deepwood Motte (Glover, Greyjoy at ACOK Bran VII, Glover again at ADWD Reek III), Torrhen's Square (Greyjoy from ASOS Jon XI, first told), Riverrun (Frey at AFFC Jaime VII), Storm's End (Stannis from ACOK Catelyn VI: "Storm's End had opened its gate to Stannis Baratheon") and Brightwater Keep (Tyrell from ASOS Tyrion III). Tests in `src/state/changes.test.ts`.
`- **Left out:** Darry (the Lannister garrison is told only in passing, ACOK Arya, so the chapter is unclear), Seagard (Mallister stays lord, "a prisoner in his own castle"), Dragonstone (Stannis holds it throughout), Raventree Hall, Griffin's Roost, Rain House, the Twins' grants (no clean quote found yet). The nine undated battles still wait for dates.
`- **So what:** step 3 is done for the main seats; each remaining one needs a quote that places it in a chapter, via `node tools/books/timeline-check.mjs --where "quote"`.
`
`## Timeline step 3: the rest of the left-out list (2026-10-30)
`
`- **What:** `timeline.json` has 69 changes. Added Darry to Lancel Lannister (AFFC Jaime III, "Lord Lancel is nearby at Darry with his garrison"), Harrenhal to Littlefinger (ASOS Sansa V, "Joffrey gave you Harrenhal, made you Lord Paramount of the Trident") and the attack on Old Wyk (ASOS Jaime VIII, Barristan's Book of Brothers entry). Tests added.
`- **No change recorded, on purpose:** Raventree Hall (besieged by Bracken, never taken), Seagard (Mallister a prisoner in his own castle), Dragonstone (Stannis throughout), Griffin's Roost (Jon Connington retakes it in ADWD The Griffin Reborn, but House Connington already holds it), Rain House (the Peake attack has no stated outcome), the Twins' grants (nothing but Riverrun, Harrenhal's Freys left no quote). The Bronzegate, Fairmarket, Howling Hills, Seven Stars, Slayne, Bloody Pool and Weeping Water battles are Andal-era or legendary with no year in the wiki or TWOIAF, so they stay always visible (told as history from the start).
`- **So what:** step 3 has nothing left that canon can date. Revisit the Andal-era battles only if a source gives them a year.
`
`## Timeline step 4: land follows allegiance, not occupation (2026-10-30)
`
`- **What:** the overlay colours land, borders and hover by the liege graph at the moment (`liegeAt`) and nothing else. A first version repainted a house's land in the colour of whoever held its seat; the owner pointed out that an occupied castle does not change who its vassals are sworn to (Glover stays Stark's while the ironmen sit in Deepwood Motte, Stark's bannermen stay Stark's while Winterfell burns), so it was reverted. `landHolder` is gone.
`- **So what:** occupation shows on the place card ("Held by") and in the sigil of the seat, allegiance on the map. A realm changes colour only through a `liege` change in `timeline.json` (Robb crowned, the Freys and Boltons at the Red Wedding). Not checked on screen: `npm run shot` cannot set `?when=`.
`
## Timeline step 4: wartime allegiances (2026-10-30)

- **What:** the map now follows the War of the Five Kings through `liege` changes in `timeline.json` (74 changes): Stannis breaks from the crown (ACOK Prologue), Renly crowns himself (ACOK Catelyn II), Highgarden and its bannermen follow Renly (ACOK Jon I), the Stormlords pass to Stannis at Renly's death (ACOK Catelyn VI), Highgarden joins Joffrey (ACOK Arya X). Test in `src/state/changes.test.ts`, including that the wiki's end-of-ACOK period seed does not undo them.
- **Not yet:** the Iron Islands show as independent for the whole series (the wiki infobox has no liege; the Greyjoys held of the crown until Balon crowned himself in ACOK), Alester Florent's turn to Stannis at Storm's End, the Vale, Dorne and the Lannisters' own bannermen. Each needs a chapter quote.
- **Gotcha:** the quote that "Renly claimed the crown" found by `--where` sits in an AGOT chapter (`agot-tyrion-ix`), a sample of ACOK printed inside AGOT; do not date from it.

## Favicon is the Valar Morghulis coin (2026-10-30)

- What: the tab icon is now `public/coin/valar.webp` (the VM face of the loading-screen coin); `public/favicon.svg` is deleted.
- Evidence: `index.html` line 11; nothing else referenced `favicon.svg`.
- So what: one image serves the loader and the tab. WebP favicons work in current Chrome, Firefox, Edge and Safari 14+; add a PNG fallback only if an old browser matters.

## Character route arrows no longer slide when zooming (2026-10-30)

- What: `fitArrows` (`src/globe/characterPath.ts`) re-spaced the arrowheads in x1.6 steps of camera height, with tips at spacing/2 + k*spacing, so every step moved every arrow. Now spacing steps by powers of two and tips sit on whole multiples of it (`chevrons`, `pathMath.ts`), so zooming only adds or drops every other arrow; size follows height in 5% steps.
- Evidence: `pathMath.test.ts` checks that doubling the spacing keeps every other tip in place.
- So what: the route reads as fixed to the ground. The line itself was never the problem: it is lifted onto the relief like the roads.

## Timeline step 4: Greyjoys, Florents and the shot tool (2026-10-30)

- **What:** `timeline.json` has 77 changes. The Iron Islands hold of the crown from AGOT Eddard I ("Robert had accepted the rebel lord’s surrender and Ned had taken his son Theon as hostage and ward") and break away at ACOK Tyrion XI (Balon "styled himself King of the Isles and the North"); the Florents leave Highgarden for Stannis at ACOK Davos III. Test in `src/state/changes.test.ts`.
- **Tool:** `npm run shot` takes `--when <moment>` (the `?when=` of the address), `--houses` (houses overlay on before the shot) and `--house <id>` (fly to a house). `--eval` runs after the screenshot, so it cannot set up the view; that is why the earlier try at a houses shot showed Regions. Checked on screen: Pyke at AGOT Eddard I and ACOK Tyrion XI differ, with the North split into realms after Robb is crowned.
- **Left out (no quote found):** the Vale, Dorne and the Lannisters' bannermen stay as the wiki has them; the Arryns stood neutral in the war but hold of the crown, so no change.

## Timeline step 4b: kingdoms before the Conquest (2026-10-30)

- **What:** `timeline.json` has 97 changes. Source: the wiki's title pages in `docs/sources/wiki` (King_of_the_Reach, King_of_the_Rock, Storm_King, King_of_Mountain_and_Vale, King_in_the_North, King_of_the_Isles_and_the_Rivers) plus the death pages of the last kings. Before the end of each kingdom the region's label reads "Kingdom of the Reach / the Rock / the Storm / Mountain and Vale / the North / the Isles and the Rivers"; Stark, Arryn and Lannister are unsworn until 1 AC and House Martell until 187 AC (wedding of Maron Martell and Daenerys Targaryen). Old names are set at year -12000 and reset at the end year, so books moments (from 297 AC) never see them. The place card title follows the name at the moment.
- **Years:** the Reach and the Rock end -2 (Field of Fire, wiki "2 BC"), the Storm and the Hoare realm -1 (wiki "2-1 BC", the later year), the North, the Vale and the great houses' oaths at 1 AC (assumption: the coronation; the wiki gives no year for the surrenders). The Hoare realm starts at -45, the latest year the wiki gives for Harwyn (assumption); before it the Riverlands are plain Riverlands.
- **Address:** `?when=y-100` opens a year of the history (100 BC); `momentParam` writes it back. `npm run shot -- "The Reach" --when y-100 --houses` shows the lettering.
- **Limits:** the region polygons do not move (the Storm kingdom once held the riverlands and crownlands; the Hoares held the Iron Islands too), so only the names and the liege graph change. In history the houses overlay still draws today's great houses (Tyrell, Baratheon, Tully, Greyjoy did not yet rule); only Stark, Arryn, Lannister and Martell are made independent. Crownlands carry no kingdom name.

## River and road names at the 600 km floor (2026-10-30)

- What: at the floor, river names went missing (the Trident, the Red Fork and the Blue Fork near Darry). Three causes in `update()` / `lineStretches` (`src/globe/GlobeView.ts`): a name only hung on fixed anchors along its whole line, which at 600 km are often off screen; it claimed one rectangle round the bent name, so a slanted name blocked a whole corner; and at the floor point places are forced in first, so lettering along lines found no room. Now a line name claims a chain of small boxes along its curve, and at the floor `lineStretches` also returns every other stretch in view (best first) as spares; a line on screen tries its anchors, then the spares, and only then is forced on its best stretch.
- Evidence: `npm run shot -- Darry Fairmarket "Stoney Sept" Seagard Bitterbridge --zoom 0.01`: before, Darry showed only the Green Fork; after, all four Trident rivers and the roads, with no overlaps at Fairmarket.
- So what: the floor rule (every point place named) now holds for rivers and roads too. Area lettering (lakes such as the Gods Eye, mountains) still gives way to point names at the floor.

## Timeline step 6a-6d: the wheel sets the moment (2026-10-30)

- **Bug:** dragging the wheel only called `setPeriod(book)`, so it set a moment only when the year left the current book, and then to that book's first year. Years before 1 AC (the kingdom names, Dorne's 187 AC change) and between books did nothing to the map, and a year inside Fire & Blood always snapped to 1 AC.
- **What:** `initWhen` in `src/ui/housePanel.ts` now has stops: each wiki year before the books, a folded stop for every other year from 3 BC to 296 AC (it opens when the scroll zoom passes 1.0 and is fully open at 1.6; a folded stop takes no room and cannot be rested on), and one per chapter, 15 px apart, in publication order. A rest on a stop calls `setMoment` (history year or chapter); a moment set from outside (address, book band, chips) spins the wheel there and, for a folded year, opens the years first. Book bands span their chapters; the year is lettered where it changes and at least 12 chapters apart (AFFC and ADWD overlap in time and the labels collided). Arrow keys add up from where the wheel is heading. There is no year 0.
- **The year at the bottom:** `#yearBtn` (year or S#E#, under it the book and chapter) replaces the clock button; a click or Esc opens and closes the timeline; while it is open the button moves to the top of the screen, clear of the wheel and the cards.
- **Tools:** `npm run shot` takes `--eval-file path`, since npm splits `--eval` text at spaces on Windows.
- **Not yet:** the show track is not on the wheel (it keeps its book's chapter), the picker and step buttons (6e), a phone-sized check beyond one screenshot.

## Timeline step 5 and 6e: spoiler-safe text and the picker (2026-10-30)

- **What:** `atEnd(moment)` and `chapterLimit(moment)` in `src/state/time.ts`. Before the end of the story (ADWD's last chapter, the last episode) the place and character cards replace the wiki lead and facts with a button "Show the wiki description (may contain spoilers)" (`src/ui/spoiler.ts`, the choice kept per card); the credit and read-more link wait with it. The house card shows the wiki's current head only at the end. The timeline window shows no wiki year summary for the series years (297-300 AC) before the end: the 298 AC entry names Robert's death. Characters: `known()` drops steps that begin after the chapter, so the journey neither draws nor lists them. A place's shared-seat house chip (Bolton of Winterfell on Winterfell) appears only once it holds the seat; before, the card gave away the Boltons at the start of AGOT.
- **Picker (6e):** the timeline window has Books/Show, a book or season, a chapter or episode, and step buttons; they read and write the moment only. The show track is still off the wheel (it rests on its book's first chapter).
- **Left:** `place-books.json` (mentions by book) is not shown on any card, so it needs no per-chapter version yet. Pictures from the wiki stay visible; a gallery can show a late scene. The mentions in the card's linked words still lead to articles whose text is unfiltered; the wiki link itself is the reader's choice.

## Timeline step 4 finished: the houses follow the years (2026-10-30)

- **Why the houses did not change:** the overlay's houses are the series-era ones (172 from the wiki). Before 1 AC only the liege of Stark, Arryn, Lannister and Martell changed, so every other house and the realm colours were today's, with the Baratheon crown and sigils in 29 BC. Also `realm()` treated any house without a liege as the crown, so a King in the North's bannermen each became their own realm (the North split into colours at ACOK).
- **What:** (1) `realm()` takes the crown house as a parameter (`houseGraph.ts`): the chain of a king under no crown ends at the king (the North is one colour). (2) Houses that did not exist yet are absent: `house:` changes with `first` (Baratheon of Storm's End 1 AC, of Dragonstone 284 AC, of King's Landing 283 AC), and the three royal houses the Conquest ended (Gardener, Durrandon, Hoare; kept by `tools/wiki/houses.mjs` as `extinct`, gone from -2, -1, -1) stand in their place: Tyrell sworn to Gardener, Tully to Durrandon then (from -45) Hoare, Greyjoy to Hoare from -45, Storm's End bannermen to Durrandon (`STAND_IN` in `changes.ts`). (3) In `globe/houses.ts` a house not yet founded has no sigil, hover or border; its land is painted as the house that held the seat before (Durrandon for Baratheon), else left bare, and the borders beside it become shore. The Crownlands are gone before 1 AC. 111 changes, each with a wiki quote; tests for existence, stand-ins and realm heads.
- **Checked:** shots at 29 BC and ACOK Catelyn VI: no Baratheon sigils in 29 BC, the Storm and Reach lands in one realm colour each, Baratheon and Dragonstone back by ACOK.
- **Limits:** the three old houses share their seats and so draw no sigil of their own (Highgarden shows Tyrell's in 29 BC); the regions of the Westerlands, North and Vale already had kings. Years 1-282 show the great houses unsworn (no Targaryen house in the data). Mormont came in with the regeneration of `houses.json` (a sigil and a seat now exist for it); the other 172 houses are unchanged.
- **Books on one row:** the wheel's book bands are on a single row now (the series books are on the chapter axis and never overlap).

## Timeline step 4: the seat's holder paints the seat's own land (2026-10-30)

- **What:** `realmOf` in `src/globe/houses.ts` colours a house's own territory (land, borders, hover) in the realm of whoever sits in its seat at the moment (`stateAt(seat).holder`) when that is another house in the graph: Stark land under the Greyjoys from ACOK Bran VI, Glover land at Deepwood Motte from Bran VII. The vassals' lands stay in the realm the liege graph gives them (they do not swear to the occupier), so only the occupied house's own polygon changes. This brings back the first version of step 4, which the owner then qualified with "the vassals are not sworn to that house" (see "land follows allegiance, not occupation" above, now narrowed to the vassals).
- **Checked:** `npm run shot -- "Winterfell" --when acok-bran-vi --houses --zoom 3` shows the Stark polygon outlined and filled in the Greyjoy realm's colour while the Northern vassals keep theirs. A burnt, empty seat (Winterfell at ACOK Bran VII, holder none) leaves the owner's colour.
- **Limits:** only seats with a dated holder change repaint (see the step 3 entries); the colour is the occupier's realm, not a hatching, so an occupation looks like an annexation at a glance; the Held-by row on the card says which.

## House card wiki text and the seat's coat of arms (2026-10-30)

- **What:** `tools/wiki/house-info.mjs` writes `src/house-wiki.json` (176 houses: the article's lead and up to six infobox rows: coat of arms, regions, titles, heirs, cadet branches, ancestral weapon, founder). The house card (`#house .h-wikitext`) shows them behind the same spoiler button as place and character cards until the moment reaches the end of the story. In the houses overlay, the coat of arms and name at an occupied seat are the occupier's (`seatLord` in `src/globe/houses.ts`, shared with the land colour): "House Greyjoy" stands at Winterfell in ACOK Bran VI, clicking it opens the Greyjoys. The occupied house's own sigil is not drawn while its seat is held.
- **Limits:** the place card's sigil chips still list the seat's own houses (Stark at Winterfell); a house whose seat is held has no sigil on the map until it recovers it, so the King in the North has none from ACOK Bran VI to ADWD Reek III when Winterfell is empty (a burnt seat has no holder, so the owner's sigil stays then).

## Allegiances audit, the Targaryens, and sigil classes (2026-10-30)

- **Audit:** `liegeAt` over AGOT, ACOK, ASOS, AFFC and ADWD lists the houses sworn to no one. The wiki tags overlords per book, so a house tagged only for ACOK (Meadows, Morrigen) was unsworn at AGOT, Smallwood's overlord is an ambiguous "House Vance" (never matched), and Darry's and Riverrun's Lannister and Frey branches exist only from AFFC. Fixed with 10 changes: Meadows to Tyrell, Morrigen to Baratheon, Smallwood to Tully (the appendix lists it under House Tully), Slynt to the crown, and Lannister of Darry and Frey of Riverrun appear at the chapter that gives them their seats, sworn to the crown (the wiki's Baelish holds from ADWD). What is left unsworn is right: the crown, the Greyjoys (kings after ACOK Tyrion XI), Stark (King in the North), Stannis. A cross-region scan found nothing else wrong; the Shield Islands houses sworn to the Greyjoys at ADWD are the wiki's (Euron's conquest). A test fails if a house is sworn to no one outside that list at AGOT, ACOK or ASOS.
- **Targaryen:** `House Targaryen` is kept by `tools/wiki/houses.mjs` (HISTORICAL) and exists from 1 to 282 AC; `standIn` in `state/changes.ts` makes houses sworn to the Baratheon crown sworn to it while the crown is gone, and the overlay paints the crown's land and draws its sigil with it (and Durrandon's at Storm's End before 1 AC, Targaryen's at Dragonstone before 284 AC). Before 1 AC no crown. House Connington's ADWD liege is now Targaryen (Aegon), which does not exist then, so it stands unsworn.
- **Sigil classes:** `tierOf` counts distinct seats (Harlaw's four branches on one seat counted four) and is stricter: 10 or more for a great house (sigil from 16,000 km), 6 or more for the next class, else small. Harlaw (2 seats), Hightower (5) and Dragonstone (3) are small now, so their coats of arms come in with the small houses (2,200 km) instead of at 4,500 km; inner borders follow the same classes.

## The Targaryen sigil from above (2026-10-30)

- **Why it was small:** the crown seat's sigil took its size class from the Baratheon crown house, which is not in the graph before 283 AC (no vassals, small class), though the house it now shows (Targaryen) leads the realm. `refreshGraph` in `src/globe/houses.ts` now takes the class of the house shown, and a stand-in shows once (at the crown's own seat first, not again at Dragonstone). Checked at 15,000 km in 100 AC: one big Targaryen sigil, class 0.
- **Seats:** `stateAt` returns the stand-in as the holder of a place whose base holder is not there yet, so King's Landing reads "Held by House Targaryen of King's Landing" and carries its sigil in 100 AC, Storm's End Durrandon before 1 AC. Tests added.
