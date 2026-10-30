# Roads vs lore: audit (2026-10-22)

Measured on `src/roads.json` (362 stretches, 114 minor tracks, 8 named lines) against `docs/sources/wiki` (AWOIAF) and the two source maps in `assets/world/roads/`. Distances are great-circle miles from the place's spot to the nearest road line. "named" is the single line a road carries its name on; "main" is any stretch of the network; "track" is a minor spur. Nothing has been changed yet.

## Findings

### 1. The hubs are not where canon puts them
Canon: the Kingsroad, Goldroad and Roseroad all meet at King's Landing; the Ocean Road meets the Roseroad at Highgarden; the Kingsroad, River road and High road meet at the crossroads inn. The Goldroad "ends at Lannisport and Casterly Rock".

| Hub | Nearest road node | Problem |
|---|---|---|
| King's Landing | 18 mi, a road passing by (degree 2); real junctions 37 and 53 mi away | the three roads do not meet at the capital |
| Lannisport / Casterly Rock | road passes 14-20 mi off, no node within 30 mi | Goldroad, Ocean Road and River Road do not start at the city or the Rock (the user's example) |
| Highgarden | 7-8 mi, degree 2 and 3 | ok (the Roseroad / Ocean Road meet here) |
| Crossroads inn | 6 mi, degree 3 | ok |
| Riverrun | 17 mi, degree 2; junction 36 mi | River Road passes, does not end there |
| Oldtown | 27 mi, dead end | Roseroad stops short of its canon terminus |
| Storm's End | 56 mi off, track only | Kingsroad does not begin at Storm's End |
| Duskendale | 93 mi from any road, no track | Rosby road has no end |

### 2. Named roads stop short, or detour
| Named line | Ours | Canon | Gap |
|---|---|---|---|
| Kingsroad | Storm's End to Castle Black 2899 mi | 2600 mi (World of Ice and Fire); starts at Storm's End, ends at Castle Black | +11 %, and it misses the Twins (70 mi from the line), Bronzegate (57) and Queenscrown (63) |
| Gold Road | KL to Lannisport 961 mi | ~800 mi, ends at Lannisport and Casterly Rock | +20 % |
| Ocean Road | 975 mi | Lannisport, Crakehall, Old Oak, then Highgarden | misses Crakehall by 42 mi (the road "passes through the forest around Crakehall") |
| River Road | Casterly Rock to Riverrun, 536 mi | continues east along the Red Fork to the crossroads inn | last 238 mi missing; the stretch exists in the network but is not named |
| Roseroad | KL to Highgarden, 800 mi | continues to Oldtown | last 292 mi missing |
| Demon Road | Volantis to Bhorash 1019 mi | on to Meereen | last 355 mi missing (network has it, 2 mi from Meereen) |
| Valyrian Road | Pentos to Qohor 1021 mi | continues east to Essaria; Pentos is 49 mi from the road's end | dead end short of Pentos |

Cause: `roads-trace.mjs` takes the shortest path between places snapped to the painted line (up to 105 mi away). The detours come from those snaps, and the roads end where the painted line ends, not at the place.

### 3. Lore roads that have no line at all
| Road | Canon | Ours |
|---|---|---|
| High road | crossroads inn, Bloody Gate, Eyrie ("along the high road") | network reaches the Eyrie (18 mi) but nothing is named; place "The Bloody Gate" is in the data |
| Rosby road | King's Landing, Rosby, Duskendale ("shortest road between the capital and Duskendale") | Rosby 9 mi; Duskendale 93 mi from anything |
| Boneway / Stone Way | Summerhall, Wyl, Yronwood, through the Red Mountains | network passes Summerhall (9 mi), Wyl 32, Yronwood 34 off |
| Prince's Pass | Dorne to the Reach, Skyreach and Kingsgrave | Skyreach 3 mi, Kingsgrave 30; Blackmont 130, Starfall 211 off |
| Sunspear | the Dornish capital | 574 mi from any road, so the Dornish east has no road |
| Lake road | "eastern lake road" east of the Gods Eye (Gods_Eye.md) | not separate from the Kingsroad |

No wiki page exists for High road, Rosby road, Prince's Pass or Valyrian roads: they need `node tools/wiki/scrape.mjs "Title"` (never curl) before anything is drawn from them.

### 4. Places canon puts on a road but the road misses
Bronzegate 55 mi (castle "on the kingsroad"), Haystack Hall 63 (east of it), Briarwhite 69 (west of it), Hornvale 70 (on the Goldroad), Crakehall 39 (Ocean Road), Queenscrown 63 (near the Kingsroad), Casterly Rock 17 ("on the ocean road"), Stoney Sept 117 (the Goldroad runs "southeast of Stoney Sept", then south of the Blackwater). The Stoney Sept gap looks plausible against the maps, because both source maps draw the road well south of it. Everything else is a fit offset or a missing spur.

### 5. What looks right
The Kingsroad trunk passes Harrenhal (26 mi) on the east side of the Gods Eye, the crossroads inn is a real three-way junction, Moat Cailin is 3 mi from the road, Castle Black is 19 mi from the end. River Road touches Sarsfield (1 mi) and the Golden Tooth (10). Demon Road passes Volantis, Mantarys (5) and Bhorash (10). Blog lengths: KL-Storm's End 415 vs 400, Mantarys-Bhorash 447 vs 450, Volantis-Mantarys 573 vs 600.

### 6. King's Landing sits inland of the Blackwater mouth
Canon (King's_Landing.md): "situated along the kingsroad at the mouth of the Blackwater Rush and overlooks Blackwater Bay"; "the city covers the north shore of the Blackwater Rush"; the harbor and fish market are on the northern shore (Blackwater_Rush.md); the Red Keep on Aegon's High Hill "overlooks the bay directly".
Geometry (`vector-world.json`, river 134 is the Blackwater): the river mouth is at lon -7.714, lat 34.898; King's Landing is at -7.81, 35.08 (`1821,3075` pixels in places.raw.txt). That is 15 mi from the mouth and the river line and 12 mi from the nearest coast point, so the capital is inland of both the river and the bay. The road hubs in finding 1 are measured to this point, so places move before roads.

### 7. What the books add (node tools/books/travel-check.mjs)
Book distances use 1 league = 3 miles (the Wall is "three hundred miles" and "a hundred leagues"). Stated distances against our places: Winterfell to Deepwood Motte 270 vs 300, Astapor to Yunkai 313 vs 300, Volantis to Meereen 1383 vs 1500, King's Landing to Tumbleton 187 vs 180: the scale is right. Outliers, which are place errors to audit before any road work:
- **Mole's Town** is "half a league south along the kingsroad" from Castle Black (1.5 mi, AGOT, Tyrion; ADWD, Jon). Ours: 28 mi.
- **Oldtown to Horn Hill** "a hundred leagues northeast" (AFFC, Samwell): 231 vs 300. **Meereen to Astapor** "two hundred leagues": 471 vs 600. **Eastwatch to Shadow Tower**, the length of the Wall: 251 vs 300. **Sunspear to the Water Gardens** "three leagues of coast road": 16 vs 9.
- **The eastern roads are mislabeled.** The World of Ice & Fire: the Steel Road runs from Vaes Dothrak "almost due east" to Kayakayanaya, the Stone Road from Vaes Dothrak to Vaes Jini and on to Samyriana, the Sand Road from Qarth through the southern Bones to Tiqui, guarded at its east end by Bayasabhad. `lore-roads.json` has the "Steel Road" from Tiqui to Kayakayanaya, which is none of these.
- **Roads that exist in the book but have no line:** High Road, Rosby Road, Boneway and Prince's Pass (all four have book quotes now), plus the Stone and Sand roads above.
- **Winding legs** in our network (road miles over straight miles): King's Landing to Rosby 2.1x, Qarth to Bayasabhad 1.8x, Vaes Jini to Samyriana 1.8x.
All of these are recorded with citations in `tools/books/lore-roads.json` (waypoints per road) and `tools/books/travel.json` (distances); `tools/books/lore-roads.json` is the lore file step 3 below calls for.

## Results (plan executed 2026-10-22)

**Places** (`tools/books/place-checks.mjs`, 24 canon checks from books and wiki, all OK; `tools/books/place-checks.json` holds each quote):
- Moved to where canon puts them: King's Landing (15 mi inland to the north bank, 3 mi from the Blackwater mouth), White Harbor (22 mi off, now on the east shore of the firth, ADWD Davos), Lannisport (19.5 mi from Casterly Rock, now 0.7 mi south), Casterly Rock, Storm's End, Duskendale (27 mi inland, now on the bay), Mole's Town (28 mi off Castle Black, now 1.5 mi south), Pentos and Astapor (10-11 mi inland), Crakehall (in the sea; now on land near the Ocean Road).
- Coastal places that sat in our sea by a fit error, snapped to the shore: Sunspear, The Crag, Hardhome, Asshai, Sealskin Point, Grimston, Ten Towers, Sharp Point, Stonedance, Dyre Den, Sweetport, Kingshouse, Ghozai, Elyria, Gorosh, Griffin's Roost, Oldcastle, Morosh.
- Not moved: eight island places that the vector land has no island for (Mormont's Keep, Widow's Watch, Baelish Keep, Lordsport, Sisterton, Celtigar Keep, Greenshield, Leng Yi). That is a land-polygon gap, not a place error.
- Only the places named above were audited against canon text (about 25 checks); the remaining ~260 castles and towns were only swept for being in the sea.
- King's Landing's pixel stays in `places.raw.txt` (it anchors the georeference); the `px>ll:lat,lon` form carries the canon position.

**Roads** (`tools/books/lore-roads.json` replaces `roads-named.json`; `roads-trace.mjs` routes each road through its places):
- Every lore waypoint is now a junction on its road (0-3 mi, was 15-70). Places off the painted road get a spur drawn with the network, so Lannisport, Casterly Rock, King's Landing, Storm's End, Bronzegate, Oldtown and the rest begin or end their roads. The old minor tracks are mostly replaced (114 to 83).
- Roads end at their terminals and pass the places between. The River Road now reaches the crossroads inn, the Roseroad Oldtown, the Demon Road Meereen.
- New named roads: High Road, Rosby Road (drawn direct, King's Landing to Rosby, as the painted map has no such road), Boneway, Prince's Pass, Stone Road, Sand Road, Ghiscari Coast Road. The Steel Road now runs Vaes Dothrak to Kayakayanaya.
- Still open: the Kingsroad is 2980 mi against the stated 2600 (the blog's figures are close to straight-line distance, so the painted road cannot meet them); the Boneway (Yronwood to Wyl) and Sand Road (Qarth to Bayasabhad) wind 1.8-1.9x because the painted road goes round a gulf and the Bones; Sunspear to the Water Gardens is 14 mi against 9. No road reaches Stoney Sept, Sunspear or Starfall (canon is silent on them), and Asabhad is still 346 mi from the network.

## The Wall (audited 2026-10-22)

| Check | Source | Ours |
|---|---|---|
| Length | 100 leagues = 300 miles (AGOT, Jon; ACOK, Jon; World of Ice & Fire; wiki) | line 296 mi, Westwatch to Eastwatch 281 mi straight (the Wall winds in the west) |
| Latitude | blog "A Song of Lines and Latitude": 61.97°N; the Wall to the pole is 2,086 mi (Size and Extent of Westeros, about 62°N) | mean 62.03°N, range 61.56 to 62.13 (the west end dips, as on the canon map of the Gift) |
| Wall to Dorne's south coast | ~3,000 mi (blog) | Castle Black to Dorne's south coast 3,002 mi |
| Castle count | nineteen, Westwatch-by-the-Bridge to Eastwatch-by-the-Sea (wiki Wall; Greenguard in ADWD and the World of Ice & Fire) | 19 in the data, but the globe's Wall list had 18: **Greenguard was missing** from `wall.ts` |
| Castle Black | near the centre of the Wall (wiki Castle Black); 40 leagues, 120 mi, to Greyguard (ADWD, Jon) | 119 mi to Greyguard; 119 mi to Eastwatch; 56% along from the west |
| Mole's Town | half a league (1.5 mi) south of Castle Black along the kingsroad (AGOT, Tyrion) | 2 mi (data is rounded to 0.01°, about 0.75 mi) |
| Shape | straight from Castle Black to Eastwatch, a snake from Castle Black to the Shadow Tower (wiki) | as drawn on the Gift map |

Defects found and fixed:
- The data placed the castles from the two source maps (Westwatch to Eastwatch only 255 mi) while the globe drew them on the 300-mi Wall line (`WALL_CASTLES`), so search, roads and the drawn symbols disagreed by up to 23 mi, and Mole's Town sat 21 mi from the drawn Castle Black. The line and castle maths now live in `src/globe/wallLine.ts`, `tools/world/consensus.mjs` reads it, and the data and the globe agree.
- Greenguard added to the Wall's castle list (19 castles, 9 intervals from Castle Black to Eastwatch).
- `src/config.ts` said the Wall is at ~66.6°N, which is the Arctic Circle; the data was already right at ~62°N, so the comment is corrected.
- The Wall's castles no longer get minor tracks to the Kingsroad (they had fanned out along the Wall); the wiki says a narrow track along the Wall joins them.
- Four new checks in `tools/books/place-checks.json` (Castle Black to Greyguard, Westwatch to Eastwatch, Castle Black to Eastwatch, Mole's Town).

Open: the blog's two latitude statements differ (the Arctic Circle "exactly 300 miles north of the Wall" implies 62.5°N, the Wall-to-pole distance implies 62.0°N); the data keeps 62.0°N, the figure two of the three agree on.

## The Vale of Arryn (audited 2026-10-22)

Independent read by the `lore-verifier` agent confirmed the main finding. 15 new claims in `place-checks.json`, all passing.
- **Eyrie, Gates of the Moon, Giant's Lance** were 59 to 117 mi apart; every source puts them within a few miles (the Gates at the foot of the Lance, the Eyrie a day's climb above). The Lance is now 1.5 mi from the Eyrie and the Gates 4 mi south of it.
- **Five coastal castles were 12 to 28 mi inland** and are now on their shores: Runestone (north shore of the Gulltown peninsula), Old Anchor, Heart's Home, Snakewood, Coldwater.
- **High Road** now runs Crossroads Inn, Bloody Gate, Gates of the Moon (the Eyrie is the stair above, joined by a track), as AGOT's ride from the Bloody Gate to the Gates describes.
- Unchanged and passing: Gulltown, Maidenpool, Wickenden, Ironoaks (lake shore), Bloody Gate (southwest of the Eyrie).
- Not checked, wiki silent: Longbow Hall, Strongsong, Redfort. Islands (Three Sisters, Baelish Keep, Sisterton, Breakwater) are on the missing-island list or lack island polygons.
- Open: a dangling stub of painted road about 40 mi east of the Eyrie, left from the road's old end, belongs to no named road.

## Plan to correct (after cross-checking with the map data)

0. **Fix places before roads.**
   - **King's Landing first:** onto the north bank, a few miles up from the river mouth. Compute the point from the river line and the shore ring (candidate near lat 34.92, lon -7.74), do not eyeball it. Put it in `tools/world/places.raw.txt` as `ll:lat,lon`, then `npm run places`. It is a 3D site, so check the site handoff and the Rosby, Duskendale and Dragonstone offsets afterwards.
   - **Then every capital and important place** (kinds `capital`, `city`, and castles that seat a great house or hold a road hub; about 100 in Westeros and the Free Cities, to be listed in the audit). For each one follow the editing-map-places skill: quote the sentence in `docs/sources/wiki` that fixes its position (confluence, shore, mouth, hill, road), measure it against rivers, lakes, coast and roads in `vector-world.json`, and write the offset in miles. Report a table (old, canon quote, distance off, proposed) and move only places where canon and geometry agree they are wrong. Where the wiki is silent, say so and keep the position. Known to check first: Riverrun (Tumblestone/Red Fork confluence), Harrenhal, Casterly Rock / Lannisport, Oldtown (Honeywine mouth), Highgarden (Mander), Storm's End, Winterfell, White Harbor, the Eyrie, Sunspear, and the Twins.
   - After the moves: `node tools/blog/roads-trace.mjs`, `roads-check.mjs`, `npx tsc --noEmit`, `npm test`, and a before/after render.
1. **Cross-check** each finding above on `vector-world.json` (rivers, lakes, coast): where each road crosses a river or lake (Blackwater ferry at KL, Green Fork and Trident near the crossroads, Gods Eye river for the Goldroad), that the road leaves a place on land, and that spurs do not cross water.
2. **Scrape** the four missing pages and read the route sentences.
3. **Rule for lore roads**: `tools/books/lore-roads.json` (ordered waypoints and citations per road, books first, then the wiki) replaces the `via` lists in `lore-roads.json`. Terminals are hard: the named line begins and ends at its terminal place, joined by a short spur when the painted line stops short.
4. **Hubs**: make King's Landing, Lannisport / Casterly Rock, Riverrun, Oldtown, Storm's End and Duskendale real junction nodes (a spur from the trunk of at most about 20 mi), so that roads that canon says meet, meet.
5. **New lines** only where canon names the road and the maps show a painted road or a clear gap (Rosby road, High road, Boneway). No road is invented where canon is silent: Sunspear and Starfall stay unconnected unless a source map draws a road.
6. Rebuild (`node tools/blog/roads-trace.mjs`), rerun `roads-check.mjs` and compare lengths with the numbers above, then look at renders before and after.
