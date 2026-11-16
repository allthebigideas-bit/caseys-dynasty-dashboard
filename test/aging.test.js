import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curveAt, CURVES, PEAK } from '../lib/aging.js';

// PEAK labels the rising/peak/declining phase; the curve is near its top
// across that window (QB's 31 is 0.99).
test('curveAt is at or near 1 across each position peak', () => {
  for (const [pos, [lo, hi]] of Object.entries(PEAK)) {
    assert.equal(curveAt(pos, lo), 1, pos);
    assert.ok(curveAt(pos, hi) >= 0.98, pos);
  }
});

test('curveAt interpolates between ages', () => {
  const mid = curveAt('RB', 26.5);
  assert.ok(mid < CURVES.RB[26] && mid > CURVES.RB[27]);
});

test('curveAt clamps outside the table', () => {
  assert.equal(curveAt('RB', 40), CURVES.RB[34]);
  assert.equal(curveAt('WR', 18), CURVES.WR[20]);
});

test('curveAt is neutral for unknown positions or ages', () => {
  assert.equal(curveAt('K', 30), 1);
  assert.equal(curveAt('RB', null), 1);
});

test('curves never rise again after the peak', () => {
  for (const [pos, c] of Object.entries(CURVES)) {
    const after = Object.keys(c).map(Number).filter((a) => a >= PEAK[pos][1]).sort((a, b) => a - b);
    for (let i = 1; i < after.length; i++) assert.ok(c[after[i]] <= c[after[i - 1]], `${pos} ${after[i]}`);
  }
});
