import test from 'node:test';
import assert from 'node:assert/strict';
import { accumulate, bedProfile, nearestOwner, pathPixels, priorityFlood } from './hydrology.mjs';

// a 9×7 land block with a pit in the middle, ringed by a ridge, with one low gap on the east: sea (inactive) on the west and east columns
const W = 9, H = 7, N = W * H;
const h = new Float32Array(N).fill(1), active = new Uint8Array(N).fill(1);
for (let y = 0; y < H; y++) { active[y * W] = 0; active[y * W + W - 1] = 0; h[y * W] = h[y * W + W - 1] = -1; }
for (let y = 2; y <= 4; y++) for (let x = 3; x <= 5; x++) h[y * W + x] = 0.2; // the pit
h[3 * W + 6] = 0.6; h[3 * W + 7] = 0.5; // a gap out to the east

test('priority-flood fills the pit to its spill height and drains everything', () => {
  const { filled, recv } = priorityFlood({ W, H }, h, active);
  for (let i = 0; i < N; i++) assert.ok(filled[i] >= h[i] - 1e-9);
  assert.ok(filled[3 * W + 4] >= 0.6 - 1e-6, 'the pit is filled up to the gap');
  // every active cell reaches an outlet by following receivers
  for (let i = 0; i < N; i++) { if (!active[i]) continue; let c = i, steps = 0; while (recv[c] >= 0 && steps++ < N) c = recv[c]; assert.ok(steps < N && recv[c] === -1, `cell ${i} drains`); }
});

test('accumulation conserves the water: what leaves at the outlets is the rain that fell', () => {
  const { recv } = priorityFlood({ W, H }, h, active);
  const rain = new Float32Array(N); let total = 0;
  for (let i = 0; i < N; i++) if (active[i]) { rain[i] = 1; total++; }
  const { Q, unresolved } = accumulate(recv, rain, active);
  assert.equal(unresolved, 0);
  let out = 0; for (let i = 0; i < N; i++) if (active[i] && recv[i] === -1) out += Q[i];
  assert.equal(Math.round(out), total);
});

test('a river bed never rises downstream, stays under the ground it cuts and above the floor', () => {
  const ground = Float32Array.from({ length: 200 }, (_, j) => 1 - j / 250 + 0.15 * Math.sin(j / 3) + (j === 120 ? 0.4 : 0)); // noisy, with a ridge
  const incision = Float32Array.from({ length: 200 }, (_, j) => 0.01 + 0.0001 * j);
  const bed = bedProfile(ground, incision, 0.001);
  for (let j = 1; j < bed.length; j++) assert.ok(bed[j] <= bed[j - 1] + 1e-9, `rises at ${j}`);
  for (let j = 0; j < bed.length; j++) { assert.ok(bed[j] >= 0.001 - 1e-9); assert.ok(bed[j] <= Math.max(ground[j], 0.001) + 1e-9, `above the ground at ${j}`); }
});

test('nearestOwner gives the distance to, and the index of, the nearest source', () => {
  const g = { W: 10, H: 3, KM: 2, cosRow: new Float32Array(3).fill(1) }, src = new Uint8Array(30);
  src[1 * 10 + 1] = 1;
  const { d, own } = nearestOwner(g, src);
  assert.equal(d[1 * 10 + 4], 6); assert.equal(own[1 * 10 + 4], 11);
});

test('a polyline becomes the ordered pixels it crosses', () => {
  const px = pathPixels([[0.5, 0.5], [5.5, 0.5]], 10, 3);
  assert.deepEqual(px, [0, 1, 2, 3, 4, 5]);
});
