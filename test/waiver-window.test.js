import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextWindowStart, sleeperWaiverDay } from '../lib/util.js';

// Local times, so the test holds in any time zone. Nov 2026: Mon 16, Tue 17, Wed 18.
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const WED = 3;

test("Sleeper's waiver_day_of_week counts from Monday: the default 2 is the Wednesday-morning run", () => {
  assert.equal(sleeperWaiverDay({ waiver_day_of_week: 2 }), WED);
  assert.equal(sleeperWaiverDay({ waiver_day_of_week: 6 }), 0); // Sunday
  assert.equal(sleeperWaiverDay({}), WED);
  assert.equal(sleeperWaiverDay({ daily_waivers: 1, waiver_day_of_week: 2 }), null);
});

test('armed Monday afternoon, a weekly league waits for Wednesday morning, not Tuesday', () => {
  assert.equal(nextWindowStart('00:55', 4, at(16, 15), WED), at(18, 0, 55));
});

test('armed Tuesday evening, the run is a few hours away', () => {
  assert.equal(nextWindowStart('00:55', 4, at(17, 21), WED), at(18, 0, 55));
});

test('armed during the window, it counts; once the window has passed, the next week', () => {
  assert.equal(nextWindowStart('00:55', 4, at(18, 2), WED), at(18, 0, 55));
  assert.equal(nextWindowStart('00:55', 4, at(18, 6), WED), at(25, 0, 55));
});

test('daily waivers: the next night, as before', () => {
  assert.equal(nextWindowStart('00:55', 4, at(16, 15), null), at(17, 0, 55));
  assert.equal(nextWindowStart('00:55', 4, at(16, 3), null), at(16, 0, 55));
});
