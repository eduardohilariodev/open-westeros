// Bakes the globe's terrain relief. The bake lives in tools/world/terrain/ (stages, cache, progress bars): this runs it for the whole
// world and writes public/world/relief-*.webp and src/globe/relief-bounds.json, as before. See docs/terrain.md; `npm run terrain` has all the options.
// Usage: node tools/world/relief-bake.mjs [degrees per pixel = 0.035 (~4.2 km)]    (BOUNDS="lon0,lon1,lat0,lat1" bakes a window and writes nothing)
import { spawnSync } from 'node:child_process';

const [res] = process.argv.slice(2), args = ['tools/world/terrain-cli.mjs'];
if (process.env.BOUNDS) args.push('--bounds', process.env.BOUNDS); else args.push('--full');
if (res) args.push('--res', res);
process.exit(spawnSync(process.execPath, args, { stdio: 'inherit' }).status ?? 1);
