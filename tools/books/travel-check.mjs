// Checks the places and src/roads.json against what the books state (tools/books/travel.json, lore-roads.json):
// 1. each stated distance vs the great-circle and road miles between our places (a wrong ratio points at a misplaced place or a
//    wrong scale, so audit the place before the road);
// 2. each lore road's waypoints in order: miles from the waypoint to the nearest main road, and road miles per leg vs
//    great-circle (a leg that is not connected, or winds more than ~1.6x, is a defect in the network).
// Usage: node tools/books/travel-check.mjs
import { readFileSync } from 'node:fs';
import { dijkstra, gc, place, roads, snap, toLines } from '../blog/roads-graph.mjs';

const { distances } = JSON.parse(readFileSync('tools/books/travel.json', 'utf8'));
const lore = JSON.parse(readFileSync('tools/books/lore-roads.json', 'utf8'));
const r0 = (n) => (n < 10 ? n.toFixed(1) : Math.round(n));
const roadMiles = (a, b) => { const d = dijkstra(snap(a)[0], snap(b)[0]); return d === undefined ? 'no road' : r0(d); };

console.log('## Stated distances (book | ours straight | ours by road)');
for (const d of distances) {
  const g = gc(place(d.from), place(d.to)), flag = Math.abs(g - d.miles) > Math.max(8, 0.3 * d.miles) ? '  <-- off by ' + (g / d.miles).toFixed(2) + 'x' : ''; // places are rounded to 0.01 deg (~0.75 mi), and the books round their distances
  console.log(`${`${d.from} -> ${d.to}`.padEnd(44)} ${String(d.miles).padStart(5)} | ${String(r0(g)).padStart(5)} | ${String(roadMiles(d.from, d.to)).padStart(7)}  (${d.how}, ${d.cite})${flag}`);
}

console.log('\n## Lore roads (waypoint: miles to the nearest main road, tracks not counted | leg: road miles / straight miles, places snapped to the nearest junction)');
for (const r of lore) {
  console.log(`\n${r.name}${r.miles ? ` (stated ${r.miles} mi)` : ''}`);
  let total = 0, ok = true;
  r.via.forEach((w, i) => {
    let at; try { at = place(w); } catch { console.log(`  ${w}: NO PLACE in the data`); ok = false; return; }
    let leg = '';
    if (i) {
      const p = r.via[i - 1], g = gc(place(p), at), m = dijkstra(snap(p)[0], snap(w)[0]);
      if (m === undefined) leg = `  | leg from ${p}: NOT CONNECTED`; else if (snap(p)[0] === snap(w)[0]) leg = `  | leg from ${p}: same junction, ${r0(g)} mi apart`; else { total += m; leg = `  | leg from ${p}: ${r0(m)} / ${r0(g)}${m / g > 1.6 ? '  <-- winds ' + (m / g).toFixed(1) + 'x' : ''}`; }
    }
    const d = toLines(at, roads);
    console.log(`  ${w.padEnd(20)} ${String(r0(d)).padStart(4)} mi${d > 20 ? ' <-- far' : ''}${leg}`);
  });
  if (ok && total) console.log(`  road total ${r0(total)} mi`);
}
