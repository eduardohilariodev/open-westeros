// The one entry point for checking the map against the lore (books, wiki, blog). Run: npm run lore -- <verb> [args]
//   find <term> [term ...]   sentences of the novels / Fire & Blood / World of Ice & Fire with every term (book, chapter)
//   place "<Name>"           everything about one place: position, passages, the wiki page, river / coast / road distances, checks
//   check [--quiet]          every lore check: place-checks, sea sweep, stated distances; exit 1 on any failure
//   roads                    regenerate the places and the roads from the lore, then check
//   report                   how much of the map has a lore claim
//   sources                  which sources are present and how fresh
// Sources, highest first: the novels, World of Ice & Fire, Fire & Blood, the wiki (docs/sources/wiki), the blog (docs/sources/atlas-blog), the maps.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

const [verb, ...args] = process.argv.slice(2);
const run = (script, a = [], opts = {}) => spawnSync('node', [script, ...a], { encoding: 'utf8', ...opts });
const clean = (s) => s.split('\n').filter((l) => !/ExperimentalWarning|--trace-warnings|^\(Use `node/.test(l)).join('\n').trimEnd();
const show = (r) => { const o = clean(r.stdout + r.stderr); if (o) console.log(o); return r.status ?? 1; };

const checks = () => {
  const out = [], fail = [];
  const pc = clean(run('tools/books/place-checks.mjs').stdout).split('\n').filter(Boolean);
  const off = pc.filter((l) => !l.startsWith('OK '));
  fail.push(...off); out.push(`place checks: ${pc.length - off.length} ok, ${off.length} off`);
  const sw = run('tools/books/sea-sweep.mjs'), swl = clean(sw.stdout).split('\n').filter(Boolean);
  fail.push(...swl.filter((l) => l.startsWith('WET') || l.startsWith('NOTE'))); out.push(swl.at(-1));
  const tc = clean(run('tools/books/travel-check.mjs').stdout).split('\n');
  const dist = tc.slice(0, tc.findIndex((l) => l.startsWith('## Lore roads'))).filter((l) => l.includes('<-- off by'));
  const wind = tc.filter((l) => l.includes('NOT CONNECTED'));
  fail.push(...dist.map((l) => 'DIST ' + l.trim().slice(0, 150)), ...wind.map((l) => 'ROAD ' + l.trim())); out.push(`stated distances: ${dist.length} off; roads not connected: ${wind.length}`);
  const tl = clean(run('tools/books/timeline-check.mjs').stdout).split('\n').filter(Boolean);
  const tlOff = tl.filter((l) => !l.startsWith('OK '));
  fail.push(...tlOff); out.push(`timeline changes: ${tl.length - tlOff.length} ok, ${tlOff.length} off`);
  return { out, fail };
};

switch (verb) {
  case 'find': process.exitCode = show(run('tools/books/find.mjs', args)); break;
  case 'check': {
    const { out, fail } = checks();
    if (!args.includes('--quiet') || fail.length) console.log(out.join('\n'));
    if (fail.length) console.log('FAILED:\n' + fail.map((f) => '  ' + f).join('\n'));
    process.exitCode = fail.length ? 1 : 0; break;
  }
  case 'roads': {
    if (show(run('tools/world/consensus.mjs')) || show(run('tools/blog/roads-trace.mjs'))) { process.exitCode = 1; break; }
    show(run('tools/blog/roads-check.mjs'));
    const { out, fail } = checks(); console.log(out.join('\n') + (fail.length ? '\nFAILED:\n' + fail.map((f) => '  ' + f).join('\n') : '')); process.exitCode = fail.length ? 1 : 0; break;
  }
  case 'place': {
    if (!args.length) throw new Error('usage: npm run lore -- place "Name"');
    process.exitCode = show(run('tools/lore/place.mjs', [args.join(' ')])); break;
  }
  case 'search': case 'near': process.exitCode = show(run('tools/lore/search.mjs', [verb, ...args])); break;
  case 'report': process.exitCode = show(run('tools/lore/report.mjs')); break;
  case 'sources': {
    const age = (f) => (existsSync(f) ? `${Math.round((Date.now() - statSync(f).mtimeMs) / 864e5)} d old` : 'MISSING');
    const text = existsSync('docs/sources/books/text') ? readdirSync('docs/sources/books/text').filter((f) => f.endsWith('.txt')) : [];
    console.log(`books: ${text.length} extracted (${text.map((t) => t.replace('.txt', '')).join(', ') || 'none: run node tools/books/extract.mjs'})`);
    console.log(`place index: ${age('docs/sources/books/places.json')} (node tools/books/place-index.mjs)`);
    console.log(`wiki mirror: ${existsSync('docs/sources/wiki/_places.json') ? readdirSync('docs/sources/wiki').length + ' files, ' + age('docs/sources/wiki/_places.json') : 'MISSING (npm run wiki)'}`);
    console.log(`blog: ${existsSync('docs/sources/atlas-blog') ? readdirSync('docs/sources/atlas-blog').filter((f) => f.endsWith('.md')).length + ' posts' : 'MISSING'}`);
    console.log(`claims: ${JSON.parse(readFileSync('tools/books/place-checks.json', 'utf8')).length} place checks, ${JSON.parse(readFileSync('tools/books/lore-roads.json', 'utf8')).length} lore roads, ${JSON.parse(readFileSync('tools/books/travel.json', 'utf8')).distances.length} stated distances`);
    break;
  }
  default: console.log('usage: npm run lore -- find|place|search|near|check|roads|report|sources   (see tools/lore/lore.mjs)'); process.exitCode = verb ? 1 : 0;
}
