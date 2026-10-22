# Geology of the Known World

Source: *A Geologic Map for Game of Thrones*, "based on character observations, official maps, and Earth principles
of the geologic science". It covers Westeros and western Essos, with a scale bar of 500 mi.
The map was traced by eye into [tools/world/geology.json](../tools/world/geology.json). The relief bake
([tools/world/relief-bake.mjs](../tools/world/relief-bake.mjs)) uses that tracing to shape and colour the globe's terrain.
To keep the original image with this note, save it as `docs/geology-map.png`.

## Units (youngest to oldest)

| Unit | Age | Where | Rock, and what it does to the terrain |
|---|---|---|---|
| Q, Quaternary | 0–2.6 Mya | coasts, river mouths, the Neck's edges, Salt Shore, the Rhoyne delta at Volantis | loose alluvium and sands: low, flat, wears away fastest |
| Pliocene–Miocene, Oligocene–Eocene | 2.6–56 Mya | the broad yellow belts: the North around Winterfell, the Riverlands, the Reach, the Crownlands, Essos plains | soft young sediments: rolling lowlands |
| Pg, Paleocene | 56–66 Mya | the far north, around Winterfell, the Riverlands and Reach (Pg near King's Landing), much of western Essos | sandstone and shale: plains and low hills |
| K, Cretaceous | 66–145 Mya | the Northern Mountains, the Wolfswood, the Mountains of the Moon, the Westerlands, the Hills of Norvos and Braavos | folded sediments that form the main ranges |
| P, Permian | 252–299 Mya | east of Winterfell to the coast (area 7), and west of Winterfell | **limestone**: karst plateaus, pale rock |
| D, Devonian | 360–420 Mya | the Flint Cliffs and Flint's Finger, and the bedrock off the north-west coast | **limestone**: sea cliffs, escarpments |
| S, Silurian | 420–443 Mya | a thrust belt from the Westerlands (area 6) through the Twins to the Mountains of the Moon (area 4) | slate and sandstone: folded ridges |
| O, Ordovician | 443–485 Mya | Dorne (area 8) and southern Essos | **red sandstone**: the red Dornish ground |
| € Cambrian | 485–540 Mya | the core of the Red Mountains (area 9) and pockets in Essos | — |
| pC, Precambrian | >540 Mya | north of the Wall, patches near Castle Black, the Iron Islands | ancient gneiss and schist basement, very hard |

**Intrusive granites:**
- **Cretaceous granite (red)** forms the peaks of the Northern Mountains (areas 1, 5), the Wolfswood, the Mountains of the Moon, and Casterly Rock and Silverhill. It suggests the gold and silver of the Westerlands.
- **Cambrian granite (salmon)** forms the Red Mountains of Dorne and a few stocks in Essos.

**Rock types:**
- limestone: the Permian and Devonian units
- sandstone: the Ordovician of Dorne
- salt: the Salt Shore flats (area 3)
- chert: legend only

## Structure

- **Western Westeros thrust:** runs from beyond the Wall down the west coast to Bear Island. It pushes the Devonian and Cretaceous rocks up into the Northern Mountains.
- **Riverlands–Vale–Braavos thrust arc:** runs from the Westerlands past the Twins and through the Mountains of the Moon, then across the Narrow Sea to the Hills of Norvos. It's the front of the collision that raised the Vale (areas 4, 6).
- **Dornish thrust:** follows the Red Mountains along Dorne's northern rim.
- **Narrow Sea spreading ridge (double red line):** a rift that is opening the Narrow Sea between Westeros and Essos (area 2). It continues north-east as an inferred dashed line.
- **Inferred strike-slip fault (dashed with "?"):** curves from the far north-west across the Shivering Sea towards Braavos.

## Areas of interest

The source map marks nine numbered areas ("click to learn more"), but the author's explanations weren't available.
These one-liners are my reading of the rock units and faults under each number, not the author's text.
1. North of the Wall: granite-cored ranges and Precambrian basement.
2. The Narrow Sea: the spreading rift between the continents.
3. Salt Shore: salt flats and coastal sands.
4. Mountains of the Moon: a thrust-stacked range with granite cores.
5. Northern Mountains near the Wall: granite intrusions in folded Cretaceous rock.
6. Westerlands: a thrust belt with granite (Casterly Rock), where the ores are.
7. East of Winterfell: Permian limestone plateau.
8. Dorne: Ordovician red sandstone plains.
9. Red Mountains: Cambrian granite and sediments.

## How the terrain uses it

[relief-bake.mjs](../tools/world/relief-bake.mjs) fits the map to the globe through 14 labelled towns, then applies each unit:

- **Erodibility.** Granite and basement resist the erosion simulation, so they stand as sharp peaks. Young sediments wear down into smooth lowlands.
- **Uplift.** A thrust lifts a ridge along its line. Granite bodies add peaks.
- **Bare-rock colour:**
  - pale limestone in the North
  - red sandstone and granite in Dorne
  - grey granite in the northern ranges
  - white salt crust at Salt Shore

These are educated guesses layered on the canon terrain classes (src/terrain.json). Where the two disagree, the terrain
classes decide where ranges are, and the geology decides what they look like.
