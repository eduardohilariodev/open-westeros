// Fast place lookup for agents, no browser: by name, kind or neighbourhood, each with the link that opens the map on it.
// Usage: node tools/lore/search.mjs search <term ...> [--kind castle] [--limit 20]
//        node tools/lore/search.mjs near <lat> <lon> [--kind town] [--limit 10]     (or: near "Name")
// (or: npm run lore -- search ... / near ...). Link: <dev server>/?place=<Name>, see src/ui/placePanel.ts.
import { PLACES } from '../../src/world-data.ts';
import { gc } from '../blog/roads-graph.mjs';

const [verb, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf('--' + k); if (i < 0) return d; const [v] = rest.splice(i, 2).slice(1); return v; };
const kind = opt('kind'), limit = +opt('limit', verb === 'near' ? 10 : 20);
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const url = (n) => `/?place=${encodeURIComponent(n)}`;
const row = (p, extra = '') => `${p[0]} | ${p[1]} | ${p[2]}, ${p[3]}${extra} | ${url(p[0])}`;
const pool = PLACES.filter((p) => !kind || p[1] === kind);

if (verb === 'search') {
  const terms = rest.map(fold);
  if (!terms.length) throw new Error('usage: search <term ...> [--kind k] [--limit n]');
  const hit = pool.map((p) => ({ p, s: terms.every((t) => fold(p[0]).includes(t)) ? (fold(p[0]).startsWith(terms[0]) ? 0 : 1) : -1 }))
    .filter((x) => x.s >= 0).sort((a, b) => a.s - b.s || a.p[0].localeCompare(b.p[0]));
  console.log(hit.slice(0, limit).map((x) => row(x.p)).join('\n') || 'no match');
  if (hit.length > limit) console.log(`... ${hit.length - limit} more (--limit)`);
} else if (verb === 'near') {
  const named = PLACES.find((p) => fold(p[0]) === fold(rest.join(' ')));
  const [lat, lon] = named ? [named[2], named[3]] : rest.map(Number);
  if (![lat, lon].every(Number.isFinite)) throw new Error('usage: near <lat> <lon> | near "Name"');
  console.log(pool.filter((p) => p !== named && p[1] !== 'road').map((p) => ({ p, d: gc([lon, lat], [p[3], p[2]]) }))
    .sort((a, b) => a.d - b.d).slice(0, limit).map(({ p, d }) => row(p, ` | ${d.toFixed(0)} mi`)).join('\n'));
} else console.log('usage: search|near (see top of tools/lore/search.mjs)');
