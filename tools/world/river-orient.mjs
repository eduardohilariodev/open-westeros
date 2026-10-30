// Which way each canon river flows. The lines come from SVG paths and are stored mouth -> source (297 of 363 have the sea or another river at
// the first point, 2 at the last: node tools/world/river-direction.mjs). Pure functions: the bake, the prototype and the tool share them.
//   ends within REACH km of a sink: sea (rank 3), a longer river (2), a lake (1), a shorter river (0.5)
//   one end touches -> that end is the mouth; both -> the higher rank; a tie or neither -> the stored order (mouth first)
const KM = 120.57, REACH = 6;
const km = (p, q) => Math.hypot((p[0] - q[0]) * KM * Math.cos(((p[1] + q[1]) / 2) * Math.PI / 180), (p[1] - q[1]) * KM);
const lengthKm = (r) => r.reduce((s, p, i) => (i ? s + km(p, r[i - 1]) : 0), 0);

/** Sinks of a world ({land, lakes, rivers}); build once, pass to orientLine. */
export function makeSinks(world) {
  const lens = world.rivers.map(lengthKm), pts = [];
  for (const ring of world.land ?? []) for (const p of ring) pts.push({ p, kind: 'sea' });
  for (const lake of world.lakes ?? []) for (const ring of lake.rings ?? [lake]) for (const p of ring) pts.push({ p, kind: 'lake' });
  world.rivers.forEach((r, i) => { for (const p of r) pts.push({ p, kind: 'river', owner: i }); });
  return { pts, lens };
}

const rank = (end, own, sinks, self) => {
  let best = 0;
  for (const s of sinks.pts) {
    if (s.owner === self || Math.abs(end[1] - s.p[1]) * KM >= REACH || Math.abs(end[0] - s.p[0]) * KM * Math.cos((end[1] * Math.PI) / 180) >= REACH || km(end, s.p) >= REACH) continue;
    const r = s.kind === 'sea' ? 3 : s.kind === 'lake' ? 1 : sinks.lens[s.owner] > own ? 2 : 0.5;
    if (r > best) best = r;
  }
  return best;
};

/** The line `world.rivers[i]` as source -> mouth, and why: 'first' | 'last' (that end touches a sink), 'rank' (both, one stronger), 'tie' | 'none' (stored order kept as mouth first). */
export function orientLine(world, i, sinks) {
  const line = world.rivers[i], own = sinks.lens[i], a = rank(line[0], own, sinks, i), b = rank(line.at(-1), own, sinks, i);
  const lastIsMouth = b > a; // equal (both 0 or a tie) keeps the stored order: mouth first
  const why = a && b ? (a === b ? 'tie' : 'rank') : a ? 'first' : b ? 'last' : 'none';
  return { line: lastIsMouth ? line : line.slice().reverse(), why };
}
