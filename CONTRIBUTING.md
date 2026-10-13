# Contributing to Open Westeros

Pull requests are welcome — that's the whole idea. Small fixes, new places, better lore, faster pipelines, all of it.

## How

1. Open an issue (or comment on one) saying what you'd like to build, so nobody duplicates work.
2. Fork, branch, build. Keep PRs focused: one place, one feature or one fix.
3. Before opening the PR: `npx tsc` and `npm run build` pass, and you've looked at your change in the browser.
4. In the PR, show it — a screenshot or short clip of the result goes a long way.

## Ground rules

- **Never commit copyrighted art or game data.** Maps, paintings, game meshes and textures, mod files: they stay out of git (`assets/` and generated `public/` data are ignored). Commit the *tool* that converts them instead, and document where to get the input.
- **Cite your numbers.** Any size, distance or position that isn't obvious gets a comment pointing to its source (book chapter, official map, wiki page, reconstruction). If you're guessing, say so in the comment.
- **One scale.** Use the planet and site frames from `src/config.ts` / `src/geo.ts`; site scenes are in metres, x = east, y = up, z = south.
- **Keep it simple.** Match the surrounding code. No new dependency for what a few lines can do; no abstraction until the third time it's needed.
- **Credit people.** If your contribution builds on someone's art, model or research, credit them in the code and the README.

## Adding a site

The checklist is in the README under *Add a place*. Winterfell (`src/sites/winterfell/`) is the shortest complete example; King's Landing shows a data pipeline that generates a whole city from a painted map.

## Be kind

This is a fan project made for fun. Assume good faith, review generously, and help newcomers land their first PR.
