// Runs the coast refinement pipeline step by step in one window, with a status line per step, and copies everything to a log.
// Usage: node tools/world/coast-run.mjs [logfile]      (npm run coast:run)
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const log = createWriteStream(process.argv[2] ?? join(tmpdir(), 'coast-run.log'));
const out = (s) => { process.stdout.write(s); log.write(s); };
const STEPS = [
  ['refine coasts', 'node tools/world/coast-refine.mjs'],
  ['sea sweep', 'node tools/books/sea-sweep.mjs'],
  ['regenerate roads and check lore', 'node tools/lore/lore.mjs roads'],
  ['bake relief', 'node tools/world/relief-bake.mjs'],
  ['type check', 'npx tsc --noEmit'],
  ['tests', 'npm test'],
];
const t0 = Date.now(), done = [];
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
for (const [i, [name, cmd]] of STEPS.entries()) {
  out(`\n=== STEP ${i + 1}/${STEPS.length}: ${name}  [${stamp()}]\n$ ${cmd}\n`);
  const code = await new Promise((res) => {
    const p = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => out(d.toString())); p.stderr.on('data', (d) => out(d.toString())); p.on('close', res);
  });
  done.push(`${code ? 'FAIL' : 'ok  '} ${name}`);
  if (code) { out(`\n*** step ${i + 1} failed (exit ${code}); stopping\n`); break; }
}
out(`\n=== SUMMARY [${stamp()}]\n${done.join('\n')}\n${done.length < STEPS.length || done.some((d) => d.startsWith('FAIL')) ? 'NOT DONE' : 'ALL DONE'}\n`);
log.end();
