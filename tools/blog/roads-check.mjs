// Checks src/roads.json against the road distances the blog states (docs/sources/atlas-blog/_roads.md): shortest road path between
// two places, snapped to the nearest road junction/end, vs. the quoted miles. Usage: node tools/blog/roads-check.mjs
import { snap, dijkstra } from './roads-graph.mjs';

// [from, to, miles the blog quotes]
const CHECKS = [
  ["King's Landing", 'Winterfell', 1500], ["King's Landing", 'Lannisport', 800], ["King's Landing", "Storm's End", 400],
  ['Castle Black', "Storm's End", 2600], ['Volantis', 'Mantarys', 600], ['Mantarys', 'Bhorash', 450], ['Asabhad', 'Qarth', 500],
];
for (const [a, b, miles] of CHECKS) {
  const [na, da] = snap(a), [nb, db] = snap(b), d = dijkstra(na, nb);
  console.log(`${a} -> ${b}: ${d === undefined ? 'not connected' : Math.round(d) + ' mi'} (blog ${miles}); snapped ${Math.round(da)} / ${Math.round(db)} mi from the places`);
}
