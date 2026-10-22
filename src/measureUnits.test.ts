import test from 'node:test';
import assert from 'node:assert/strict';
import { arc, duration, imperial, landLeagues, metric, nice, seaLeagues, travelTime } from './measureUnits.ts';

test('a quarter of the way round the planet is a quarter of its circumference', () => {
  assert.ok(Math.abs(arc([1, 0, 0], [0, 1, 0], 6_915_000) - (Math.PI / 2) * 6_915_000) < 1e-6);
  assert.equal(arc([0, 0, 1], [0, 0, 1], 6_915_000), 0);
});

test('units', () => {
  assert.equal(metric(850), '850 m');
  assert.equal(metric(412_000), '412 km');
  assert.equal(imperial(1609.344 * 300), '300 mi');
  assert.equal(landLeagues(1609.344 * 300), '100 leagues');
  assert.equal(seaLeagues(1852 * 30), '10 sea leagues');
  assert.equal(nice(740), 500);
});

test('travel time: minutes, hours, then 8-hour days', () => {
  assert.equal(duration(0.5), '30 min');
  assert.equal(duration(2.5), '2 h 30 min');
  assert.equal(travelTime(80_000, 10), '1 day');   // 8 h
  assert.equal(travelTime(1_440_000, 75), '2.4 days'); // 300 land leagues by dragon
});
