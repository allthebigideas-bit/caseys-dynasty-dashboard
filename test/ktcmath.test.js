import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ktcVerdict, fcAdjustment, gainPct, letterGrade } from '../lib/ktcmath.js';

test('letterGrade: an even trade is a B', () => {
  assert.equal(letterGrade(5000, 5000), 'B');
});

test('letterGrade: band edges', () => {
  // edge = (r - g) / (r + g), so r = 135, g = 65 gives exactly 0.35.
  assert.equal(letterGrade(135, 65), 'A+');
  assert.equal(letterGrade(122, 78), 'A');
  assert.equal(letterGrade(113, 87), 'A-');
  assert.equal(letterGrade(105, 95), 'B+');
  assert.equal(letterGrade(95, 105), 'B-');
  assert.equal(letterGrade(87, 113), 'C');
  assert.equal(letterGrade(78, 122), 'D');
  assert.equal(letterGrade(65, 135), 'F');
});

test('letterGrade mirrors: winning side and losing side', () => {
  assert.equal(letterGrade(9000, 1000), 'A+');
  assert.equal(letterGrade(1000, 9000), 'F');
});

test('gainPct survives an empty trade', () => {
  assert.equal(gainPct(0, 0), 0);
});

test('fcAdjustment: credit goes to the side sending fewer pieces', () => {
  assert.deepEqual(fcAdjustment([5000], [5000]), [0, 0]);
  const [a1, a2] = fcAdjustment([8000], [4000, 4000]);
  assert.ok(a1 > 0);
  assert.equal(a2, 0);
  assert.deepEqual(fcAdjustment([], [4000]), [0, 0]);
});

test('ktcVerdict: a 1-for-1 of equal value is fair with no adjustment', () => {
  const v = ktcVerdict([6000], [6000], 6000);
  assert.equal(v.fair, true);
  assert.equal(v.total1, v.total2);
});

test('ktcVerdict: a star beats a pile of depth', () => {
  const v = ktcVerdict([9000], [3000, 3000, 3000], 9000);
  assert.ok(v.adj1 > 0, 'the one-star side gets the package adjustment');
  assert.ok(v.total1 > v.raw1);
});
