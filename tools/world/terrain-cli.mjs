// The terrain pipeline with progress: one bar overall, one for the running stage, a line per finished stage, then checks.
//   npm run terrain -- [--bounds lon0,lon1,lat0,lat1 | --window trident|vale] [--full] [--preview] [--from <stage>]
//                      [--only <stage>] [--res 0.035] [--out <name>] [--no-cache] [--list]
// --out writes the maps to public/world-test/<name>/ (a window too), for the globe to load with ?bake=<name>.
// Without --bounds/--window/--full it bakes the whole world but writes nothing to public/world (a dry run); --full writes it.
// A window bakes a part of the world, for quick tuning, and never writes public/world.
// Stage results are cached in assets/terrain-lab/cache/; a rerun redoes only what changed. Progress is also in
// assets/terrain-lab/status.json, previews (--preview) in assets/terrain-lab/proto/.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { buildPipeline } from './terrain/pipeline.mjs';
import * as cache from './terrain/cache.mjs';
import { Reporter } from './terrain/ui.mjs';

const WINDOWS = { // lon0, lon1, lat0, lat1; rivers and plains / mountains and a valley
  trident: [-17, 1, 30, 44], // Riverrun (40.24, -13.57), Harrenhal, the God's Eye, the Blackwater
  reach: [-21, -5, 24, 36], // Highgarden, the Mander and Cockleswhent, a flat farmland where D8 drainage zigzags
  vale: [-12, 2, 38, 49], // the Eyrie (42.32, -6.15) and the Mountains of the Moon
};
const args = process.argv.slice(2), flag = (n) => args.includes(`--${n}`), val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
if (flag('help') || flag('h')) { console.log(readHelp()); process.exit(0); }
if (flag('detach')) { // the same run in its own console window, kept open at the end; closing this shell does not stop it
  const run = `node tools/world/terrain-cli.mjs ${args.filter((a) => a !== '--detach').join(' ')}`;
  mkdirSync('assets/terrain-lab', { recursive: true });
  if (process.platform === 'win32') {
    // start opens a new window; cmd /k keeps it open after the run so the checks stay readable
    spawn('cmd.exe', ['/c', 'start', '"Open Westeros terrain"', 'cmd.exe', '/k', run], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, cwd: process.cwd() }).unref();
  } else {
    spawn(process.env.TERMINAL ?? 'x-terminal-emulator', ['-e', 'sh', '-c', `${run}; read -p "press enter" _`], { detached: true, stdio: 'ignore' }).unref();
  }
  console.log(`terrain window opened: ${run}\nprogress file: assets/terrain-lab/status.json`);
  process.exit(0);
}

const bounds = val('bounds')?.split(',').map(Number) ?? (val('window') ? WINDOWS[val('window')] : undefined);
if (val('window') && !bounds) { console.error(`unknown window "${val('window')}" (${Object.keys(WINDOWS).join(', ')})`); process.exit(2); }
if (bounds && (bounds.length !== 4 || bounds.some(Number.isNaN))) { console.error('--bounds wants lon0,lon1,lat0,lat1'); process.exit(2); }
const full = flag('full') && !bounds, write = full;
const res = val('res') ? +val('res') : undefined;
const previewDir = 'assets/terrain-lab/proto' + (bounds ? `/${val('window') ?? 'bounds'}` : '');

const outDir = val('out') ? `public/world-test/${val('out')}` : undefined;
const pipe = buildPipeline({ res, bounds, write, outDir, previewDir });
const { stages } = pipe;
const names = stages.map((s) => s.name);
if (flag('list')) { console.log(names.join('\n')); process.exit(0); }
for (const n of [val('from'), val('only')]) if (n && !names.includes(n)) { console.error(`unknown stage "${n}" (${names.join(', ')})`); process.exit(2); }

const ui = new Reporter(stages.map((s) => ({ name: s.name, weight: s.weight, pending: !!s.pending })));
pipe.setReporter(ui);
console.log(`\n terrain ${bounds ? `window ${val('window') ?? bounds.join(',')}` : full ? 'whole world, writing public/world' : 'whole world, dry run (--full writes public/world)'}  ${pipe.size.W}×${pipe.size.H} px\n`);

const from = val('from') ? names.indexOf(val('from')) : 0, only = val('only');
let failed = false;
for (const [i, s] of stages.entries()) {
  if (s.pending) { ui.skip(i, 'pending', s.pending); continue; }
  const off = s.off?.();
  if (off) { ui.skip(i, 'skipped', off); continue; }
  ui.begin(i);
  try {
    // a stage is reloaded from the cache when it can be cached, its key is unchanged and it is not forced to rerun
    const rerun = flag('no-cache') || (val('from') !== undefined && i >= from);
    const hit = s.cache && !rerun ? cache.load(s.name, s.key) : null;
    if (hit) {
      ui.task('from cache', 1); s.cache.set(hit.arrays, hit.scalars);
      ui.end('cached', 'unchanged since last run');
    } else {
      await s.run();
      if (s.cache) { const { arrays, scalars } = s.cache.get(); cache.save(s.name, s.key, arrays, scalars); }
      if (flag('preview') && s.preview) { const f = await pipe.preview(s.preview, previewDir); ui.note(`preview ${f}`); }
      ui.end('ok', s.info?.() ?? '');
    }
    if (flag('preview') && hit && s.preview) { const f = await pipe.preview(s.preview, previewDir); ui.clear(); console.log(`     preview ${f}`); }
  } catch (e) {
    ui.end('fail', e?.message ?? String(e)); console.error(e?.stack ?? e); failed = true; break;
  }
  if (only && s.name === only) { for (let j = i + 1; j < stages.length; j++) ui.skip(j, 'skipped', `--only ${only}`); break; }
}

const checks = [];
if (!failed) {
  try { checks.push(...pipe.checks()); } catch { checks.push({ name: 'terrain checks', state: 'pending', detail: 'needs the height stages (run without --only)' }); }
  if (write) { // the lore claims are about positions, not heights, but the gate is the same one the commit hook runs
    const r = spawnSync('npm', ['run', '--silent', 'lore', '--', 'check'], { shell: true, encoding: 'utf8' });
    checks.push({ name: 'npm run lore -- check', state: r.status === 0 ? 'ok' : 'fail', detail: r.status === 0 ? '' : (r.stdout + r.stderr).trim().split('\n').slice(-2).join(' | ') });
  } else checks.push({ name: 'npm run lore -- check', state: 'pending', detail: 'runs with --full' });
}
if (checks.some((c) => c.state === 'fail')) failed = true;
ui.finish(checks, failed);
process.exit(failed ? 1 : 0);

function readHelp() {
  return `npm run terrain -- [options]
  --window trident|vale|reach   bake a part of the world (rivers and plains / mountains and a valley); writes nothing to public/world
  --bounds lon0,lon1,lat0,lat1   a custom window
  --full                  bake the whole world and write public/world and src/globe/relief-bounds.json
  --preview               write a PNG after each stage (assets/terrain-lab/proto/) and print its path
  --from <stage>          rerun from this stage on, ignoring its cache
  --only <stage>          run up to and including this stage
  --no-cache              ignore every cached stage
  --res <deg>             degrees per pixel (default 0.035, about 4.2 km)
  --out <name>            write the maps to public/world-test/<name>/ (works for a window), seen with ?bake=<name>
  --detach                run in its own console window that stays open (use with --full --preview for the whole world)
  --list                  list the stages
Progress is also written to assets/terrain-lab/status.json.`;
}
