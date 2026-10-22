// Claude Code PostToolUse hook (Edit|Write): after a lore-relevant file changes, regenerate what derives from it and run the lore
// checks. Silent when all is well; on a failure it prints the failures to stderr and exits 2, which Claude Code feeds back to the model.
import { spawnSync } from 'node:child_process';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const file = (JSON.parse(input || '{}').tool_input?.file_path ?? '').replaceAll('\\', '/');
const WATCHED = /(tools\/world\/places\.raw\.txt|src\/globe\/wallLine\.ts|tools\/books\/(place-checks|island-places|travel|lore-roads)\.json)$/;
if (!WATCHED.test(file)) process.exit(0);

const run = (args) => spawnSync('node', args, { encoding: 'utf8' });
if (/places\.raw\.txt|wallLine\.ts/.test(file)) { // the checks read src/world-data.ts, which is generated from these
  const g = run(['tools/world/consensus.mjs']);
  if (g.status) { console.error('npm run places failed:\n' + (g.stderr || g.stdout)); process.exit(2); }
}
const c = run(['tools/lore/lore.mjs', 'check', '--quiet']);
if (c.status) {
  console.error(`Lore check failed after editing ${file}:\n${c.stdout}\nFix the place against the book or wiki passage (npm run lore -- place "<Name>"), or correct the claim if the source says otherwise. Roads: npm run lore -- roads.`);
  process.exit(2);
}
