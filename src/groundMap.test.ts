import test from 'node:test';
import assert from 'node:assert/strict';
import { LCC_N, Q, grid, origin, scaleAt } from './globe/groundMap.ts';

const f = Math.fround, rad = (d: number) => (d * Math.PI) / 180;

// the vertex shader's groundDelta, with every operation rounded to float32 as a GPU does
function delta(dl: number, dp: number, org: { rho: number; theta: number }, phi: number) {
  const sin = (v: number) => f(Math.sin(f(v))), cos = (v: number) => f(Math.cos(f(v)));
  const s0 = sin(phi), s1 = sin(f(phi + dp));
  const q = f(f(2 * cos(phi + 0.5 * dp) * sin(0.5 * dp)) / f(1 - f(s0 * s1)));
  const dL = f(q + f(q * q * q) / 3);
  const x = f(-LCC_N * dL), em1 = f(x * (1 + x * (0.5 + x * (1 / 6 + x * (1 / 24 + x / 120)))));
  const rho = f(org.rho), th = f(org.theta), dRho = f(rho * em1), dT = f(LCC_N * dl), t1 = f(th + dT);
  const sd = f(2 * cos(th + 0.5 * dT) * sin(0.5 * dT)), cd = f(-2 * sin(th + 0.5 * dT) * sin(0.5 * dT));
  return [f(dRho * sin(t1)) + f(rho * sd), -(f(dRho * cos(t1)) + f(rho * cd))];
}

test('a vertex offset from its node origin matches the full projection to a millimetre', () => {
  for (const [lon, lat] of [[10, 52], [-30, 40], [60, 70], [95, 35], [20, 76]]) {
    for (const [dx, dy] of [[0.1, 0.05], [-0.15, 0.1], [0.0001, -0.0001], [0.12, -0.13]]) { // up to ~17 km, a finest node
      const o = origin(rad(lon), rad(lat)), [gx, gy] = delta(rad(dx), rad(dy), o, rad(lat));
      const a = grid(rad(lon), rad(lat)), b = grid(rad(lon + dx), rad(lat + dy));
      assert.ok(Math.abs(gx - (b.x - a.x)) < 0.01 && Math.abs(gy - (b.y - a.y)) < 0.01, `${lon},${lat} +${dx},${dy}: ${gx - (b.x - a.x)} ${gy - (b.y - a.y)}`);
    }
  }
});

test('origins are reduced into one period', () => {
  const o = origin(rad(-40), rad(35));
  assert.ok(o.x >= 0 && o.x < Q && o.y >= 0 && o.y < Q);
});

test('the grid is real metres between the standard parallels', () => {
  for (const lat of [22, 30, 40, 50, 62, 70]) assert.ok(Math.abs(scaleAt(rad(lat)) - 1) < 0.06, `${lat}`);
  assert.ok(scaleAt(rad(77)) < 1.14);
});

test('every power-of-two tile up to 2^14 m divides the period', () => {
  for (let k = 0; k <= 14; k++) assert.equal(Q % 2 ** k, 0);
});
