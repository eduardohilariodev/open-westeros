// How the canon river lines are oriented: counts of which end touches the sea, a lake or another river (see river-orient.mjs for the rule).
//   node tools/world/river-direction.mjs
import fs from 'node:fs';
import { makeSinks, orientLine } from './river-orient.mjs';

const world = JSON.parse(fs.readFileSync(new URL('../../src/vector-world.json', import.meta.url), 'utf8'));
const sinks = makeSinks(world), count = {}, flipped = { kept: 0, reversed: 0 };
world.rivers.forEach((r, i) => {
  if (r.length < 3) return;
  const { line, why } = orientLine(world, i, sinks);
  count[why] = (count[why] ?? 0) + 1; flipped[line[0] === r[0] ? 'kept' : 'reversed']++;
});
console.log({ lines: world.rivers.filter((r) => r.length >= 3).length, ...count }, 'stored order kept (source first):', flipped.kept, 'reversed:', flipped.reversed);
