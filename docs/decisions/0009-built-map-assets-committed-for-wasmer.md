# 0009 The built map assets are committed, so Wasmer's GitHub build has them

Date: 2026-11-11. Status: accepted (the project owner's choice).

## Context

Production is Wasmer autobuild from GitHub: a push to `main` runs `npm run build` on Wasmer and serves `dist/`. `public/world/` (relief maps, 39 MB) and `public/sites/` (Winterfell and King's Landing 3D, 69 MB) were git-ignored as "built from the sources, rebuild locally", so the live site answered 404 for them: no relief, no 3D sites.

## Options

1. Manual deploy from a machine that has the assets (`npm run deploy:wasmer`), with the GitHub autobuild disconnected.
2. Keep the autobuild and deploy the assets by hand once; the next push drops them again.
3. Commit the built assets so the autobuild has them.

## Decision

Option 3. `public/world/` and `public/sites/` are tracked; `public/world-test/` (local bake comparisons) stays ignored. The sources in `assets/` stay uncommitted.

## Consequences

- A push is a full deploy again; nothing depends on one machine.
- These are built derivatives of copyrighted maps and models, now in a public repo. This narrows the "reproducible, not redistributed" principle to the sources; the site already served the same files publicly.
- Re-baking relief or re-importing a site rewrites tens of MB in git history each time; keep re-bakes deliberate. No file is over 40 MB (GitHub's limit is 100 MB).
