// Grid hydrology for the terrain pipeline: nearest-river distance, priority-flood depression filling with flow directions,
// flow accumulation, and the monotone bed profile of a river. All on the bake grid (row-major, W×H); pure functions on typed arrays.

/** Distance in km to the nearest set pixel of `source`, and the index of that pixel (two-pass chamfer, each row's true pixel width). */
export function nearestOwner({ W, H, KM, cosRow }, source) {
  const N = W * H, d = new Float32Array(N).fill(1e9), own = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (source[i]) { d[i] = 0; own[i] = i; }
  const relax = (i, j, c) => { if (d[j] + c < d[i]) { d[i] = d[j] + c; own[i] = own[j]; } };
  for (let y = 0; y < H; y++) {
    const cx = KM * cosRow[y], cd = Math.hypot(cx, KM);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x > 0) relax(i, i - 1, cx);
      if (y > 0) { relax(i, i - W, KM); if (x > 0) relax(i, i - W - 1, cd); if (x < W - 1) relax(i, i - W + 1, cd); }
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    const cx = KM * cosRow[y], cd = Math.hypot(cx, KM);
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (x < W - 1) relax(i, i + 1, cx);
      if (y < H - 1) { relax(i, i + W, KM); if (x < W - 1) relax(i, i + W + 1, cd); if (x > 0) relax(i, i + W - 1, cd); }
    }
  }
  return { d, own };
}

const NB = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/**
 * Priority-Flood (Barnes 2014) with flow directions. `active` marks the cells that take part (land); every other cell is an outlet
 * (sea, lake) and so is the edge of the grid. Depressions are filled to their spill height; each active cell drains to the cell it
 * was flooded from (a D8 receiver, -1 at an outlet). eps makes flats drain.
 */
export function priorityFlood({ W, H }, h, active, eps = 1e-5) {
  const N = W * H, filled = Float32Array.from(h), recv = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  let n = 0; for (let i = 0; i < N; i++) if (active[i]) n++;
  const keys = new Float32Array(n + 1), ids = new Int32Array(n + 1); let size = 0;
  const push = (k, id) => {
    let i = size++;
    while (i > 0) { const p = (i - 1) >> 1; if (keys[p] <= k) break; keys[i] = keys[p]; ids[i] = ids[p]; i = p; }
    keys[i] = k; ids[i] = id;
  };
  const pop = () => {
    const k = keys[--size], id = ids[size]; let i = 0;
    for (;;) {
      let c = 2 * i + 1; if (c >= size) break;
      if (c + 1 < size && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= k) break;
      keys[i] = keys[c]; ids[i] = ids[c]; i = c;
    }
    keys[i] = k; ids[i] = id;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!active[i]) { closed[i] = 1; continue; }
    let edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    if (!edge) for (const [dx, dy] of NB) if (!active[i + dy * W + dx]) { edge = true; break; }
    if (edge) { closed[i] = 1; push(h[i], i); }
  }
  while (size > 0) {
    const key = keys[0], c = ids[0]; pop();
    const cx = c % W, cy = (c / W) | 0;
    for (const [dx, dy] of NB) {
      const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x; if (closed[j]) continue;
      closed[j] = 1; recv[j] = c;
      const f = Math.max(h[j], key + eps); filled[j] = f; push(f, j);
    }
  }
  return { filled, recv };
}

/** Flow accumulation: each cell passes its water (starting from rain) to its receiver, upstream first. Returns Q and how many cells a cycle left unresolved. */
export function accumulate(recv, rain, active) {
  const N = recv.length, Q = Float32Array.from(rain), indeg = new Int32Array(N), queue = new Int32Array(N);
  let tail = 0, head = 0, total = 0;
  for (let i = 0; i < N; i++) if (active[i]) { total++; if (recv[i] >= 0) indeg[recv[i]]++; }
  for (let i = 0; i < N; i++) if (active[i] && indeg[i] === 0) queue[tail++] = i;
  while (head < tail) {
    const c = queue[head++], r = recv[c];
    if (r >= 0) { Q[r] += Q[c]; if (--indeg[r] === 0) queue[tail++] = r; }
  }
  const stuck = new Uint8Array(N); // cells a cycle (or what drains into one) kept from being resolved
  if (head < total) { const done = new Uint8Array(N); for (let k = 0; k < head; k++) done[queue[k]] = 1; for (let i = 0; i < N; i++) if (active[i] && !done[i]) stuck[i] = 1; }
  return { Q, unresolved: total - head, stuck };
}

/**
 * The bed of a river, source to mouth: the lowest ground met upstream of each point (so it never rises downstream; a ridge on the way is
 * cut through) minus an incision, never below `floor`. ground and incision are per point along the path.
 */
export function bedProfile(ground, incision, floor = 0.001, step = 2e-5) {
  const bed = new Float32Array(ground.length); let lowest = Infinity;
  for (let j = 0; j < ground.length; j++) { lowest = Math.min(lowest, ground[j]); bed[j] = Math.max(floor, lowest - incision[j]); }
  // never rising, and falling by at least `step` (2 cm) where the floor allows: a flat bed lets the flood order drain against the river
  for (let j = 1; j < bed.length; j++) bed[j] = Math.max(floor, Math.min(bed[j], bed[j - 1] - step));
  return bed;
}

/** The cycles among the `stuck` cells of a receiver map (each a list of cell indices). */
export function cycles(recv, stuck) {
  const stamp = new Int32Array(recv.length).fill(-1), out = []; let s = 0;
  for (let i = 0; i < recv.length; i++) {
    if (!stuck[i] || stamp[i] >= 0) continue;
    const walk = []; let c = i;
    while (c >= 0 && stuck[c] && stamp[c] < 0) { stamp[c] = s; walk.push(c); c = recv[c]; }
    if (c >= 0 && stuck[c] && stamp[c] === s) out.push(walk.slice(walk.indexOf(c)));
    s++;
  }
  return out;
}

/** Pixels (row-major index) a polyline of pixel coordinates passes over, in order, without repeats; points off the grid are dropped. */
export function pathPixels(pts, W, H) {
  const out = []; let last = -1;
  const add = (x, y) => { const px = Math.floor(x), py = Math.floor(y); if (px < 0 || py < 0 || px >= W || py >= H) return; const i = py * W + px; if (i !== last) { out.push(i); last = i; } };
  for (let k = 0; k + 1 < pts.length; k++) {
    const [x0, y0] = pts[k], [x1, y1] = pts[k + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s < n; s++) add(x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n);
  }
  const [xe, ye] = pts[pts.length - 1]; add(xe, ye);
  return out;
}
