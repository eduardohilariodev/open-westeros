# 0002 Rivers come from the terrain, the canon lines only shape it

**Decision.** The world's hydrology is generated once, whole, by `npm run terrain`: the canon rivers (SVG lines) lower the ground along them into graded valleys, and the water then finds its own way (priority-flood, D8, rain). A river is a cell that drains enough; no line is drawn or pinned as a river.

**Why.** Pinning each canon line as the drainage, then adding tributaries, gave straight runs, flow loops, parallel threads and "branches" that were a second line laid over the first. Per-window particle erosion (Nick McD, momentum map) on top of a canon line could not meander either: the canon line is nearly straight and the seed valley held the channel on it (thalweg sinuosity 1.02-1.04 across parameter sweeps).

**Canon first, with a tolerance.** The books place the rivers; the terrain generator is allowed to move one by a few cells if the ground asks. Check `rivers: canon rivers are followed`: 90% of canon path pixels within 16 km of a river cell (first run: 93% within 8 km, 98% within 16 km, median 2.6 km). Direction comes from the data (`river-orient.mjs`), never from terrain height.

**Not done.** Meanders: the 4.2 km grid cannot show them. When they come, they belong to a detail pass on the lowland reaches of a network that already exists (shape of the channel, not topology).

**Amended 2026-10-29: canon valleys drain into their river.** With the 600 km camera (decision 0003) the drawn network is thinned to the books' rivers plus big branches, and the sim's water wandering beside a canon line (twins) had to be cut, which left branches ending in mid-field. Now each canon path cell drains to the next one, and each cell of a canon valley's carved floor drains toward the river (`flowAccumulation`, loops reverted to the fill's receivers). The canon courses are pinned; everything else still finds its own way, and a book line that stops short of the river it feeds continues down that drainage. The "followed" check is now trivially met (100%); the honest checks are no cycles, beds never rising, and no drawn river ending on dry land (`tmp/ends.mjs`: 7 of 1,587).
