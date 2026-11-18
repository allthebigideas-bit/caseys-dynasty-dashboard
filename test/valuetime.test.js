import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueOverTime } from '../lib/valuetime.js';

const DAY = 86400e3;
const D = Date.UTC(2026, 4, 1); // draft day
const NOW = D + 30 * DAY;

// Values move over time: each asset has a value before and after day 10.
const VAL = { 'p:a': [100, 150], 'p:b': [80, 60], 'p:c': [50, 50], 'p:w': [10, 40], 'p:x': [30, 0], 'k:2027:1:1': [70, 90] };
const valueAt = (k, ts) => (VAL[k] ? VAL[k][ts < D + 10 * DAY ? 0 : 1] : 0);
const posOf = (k) => (k.startsWith('k:') ? 'Picks' : 'WR');

// Today: team 1 holds b (got in trade) and w (waiver add); team 2 holds a and the pick.
// Moves: day 5, trade: 1 sends a + pick for b. Day 12, team 1 drops x and adds w.
const moves = [
  { at: D + 5 * DAY, kind: 'trade', sides: { 1: { inn: ['p:b'], out: ['p:a', 'k:2027:1:1'], released: [] }, 2: { inn: ['p:a', 'k:2027:1:1'], out: ['p:b'], released: [] } } },
  { at: D + 12 * DAY, kind: 'move', sides: { 1: { inn: ['p:w'], out: [], released: ['p:x'] } } },
];
const teams = [
  { rid: 1, keys: ['p:b', 'p:w', 'p:c'], endValue: 60 + 40 + 50 },
  { rid: 2, keys: ['p:a', 'k:2027:1:1'], endValue: 150 + 90 },
];

test('draft-day rosters are today minus every move since', () => {
  const r = valueOverTime({ teams, moves, draftAt: D, now: NOW, valueAt, posOf });
  // Team 1 at the draft: a, pick, c, x = 100 + 70 + 50 + 30
  assert.equal(r.rows[1].start, 250);
  assert.equal(r.rows[2].start, 80);
  assert.deepEqual(r.mismatch, {}, 'replaying the moves lands on today');
});

test('the bridge adds up: start + trades + added - lost + residual = today', () => {
  const r = valueOverTime({ teams, moves, draftAt: D, now: NOW, valueAt, posOf });
  for (const row of Object.values(r.rows)) {
    assert.equal(row.start + row.trades + row.added - row.lost + row.residual, row.end);
  }
  const t1 = r.rows[1];
  assert.equal(t1.trades, 80 - (100 + 70), 'trade valued the week it happened');
  assert.equal(t1.added, 40);
  assert.equal(t1.lost, 0, 'x was worth 0 the week he was dropped');
  assert.equal(r.rows[2].trades, 170 - 80);
});

test('weekly series starts at draft-day value and ends at today', () => {
  const r = valueOverTime({ teams, moves, draftAt: D, now: NOW, valueAt, posOf });
  assert.equal(r.series[1][0].v, 250);
  assert.equal(r.series[1].at(-1).v, 150);
  assert.ok(r.series[1].at(-1).today);
  // Week 2 (day 7): after the trade, before the waiver move: b + c + x at early values.
  assert.equal(r.series[1][1].v, 80 + 50 + 30);
});

test('rookie draft moves count in their own column', () => {
  const v = { 'k:2026:1:1': 3000, 'p:R': 4000, 'p:A': 1000 };
  const r = valueOverTime({
    teams: [{ rid: 1, keys: ['p:A', 'p:R'], endValue: 5200 }],
    moves: [{ at: 50, kind: 'draft', sides: { 1: { inn: ['p:R'], out: ['k:2026:1:1'], released: [] } } }],
    start: 0, now: 100, valueAt: (k) => v[k] || 0, posOf: () => 'WR',
  });
  const row = r.rows[1];
  assert.equal(row.start, 4000);
  assert.equal(row.draft, 1000);
  assert.equal(row.lost, 0);
  assert.equal(row.residual, 5200 - 4000 - 1000);
});

test('the ledger accounts for the whole residual', () => {
  const v = { 'p:A': 1000, 'p:B': 2000, 'p:C': 500, 'k:2027:1:1': 3000 };
  const later = { 'p:A': 1500, 'p:B': 1800, 'p:C': 700, 'k:2027:1:1': 3100 };
  const valueAt = (k, ts) => (ts >= 50 ? later[k] : v[k]) || 0;
  const r = valueOverTime({
    teams: [{ rid: 1, keys: ['p:B', 'p:C'], endValue: 2800 }, { rid: 2, keys: ['p:A', 'k:2027:1:1'], endValue: 4700 }],
    moves: [
      { at: 10, kind: 'trade', sides: { 1: { inn: ['p:B'], out: ['p:A'], released: [] }, 2: { inn: ['p:A'], out: ['p:B'], released: [] } }, net: { 1: 900, 2: -900 } },
      { at: 60, kind: 'move', sides: { 1: { inn: ['p:C'], out: [], released: [] } } },
    ],
    start: 0, now: 100, valueAt, posOf: () => 'WR', endValueOf: (k) => later[k],
  });
  for (const rid of [1, 2]) {
    const row = r.rows[rid];
    assert.equal(Math.round(row.assetAppr + row.pkgAdj + row.other), Math.round(row.residual));
  }
  assert.equal(r.rows[1].trades, 900);
  assert.equal(r.rows[1].pkgAdj, 1000 - 900);
  assert.equal(r.rows[1].other, 2800 - (1800 + 700));
  assert.equal(r.ledger[1].adds.length, 1);
});

test('a new pick year starts counting at the draft that rolls it in', () => {
  const later = (k, ts) => (k === 'k:2028:1:1' ? (ts >= 50 ? 3000 : 0) : 1000);
  const r = valueOverTime({
    teams: [{ rid: 1, keys: ['p:A', 'k:2028:1:1'], endValue: 4000 }],
    moves: [{ at: 50, kind: 'roll', match: (k) => k.startsWith('k:2028:') }],
    start: 0, now: 100, valueAt: later, posOf: () => 'Picks', endValueOf: (k) => (k === 'p:A' ? 1000 : 3000),
  });
  const row = r.rows[1];
  assert.equal(row.start, 1000);
  assert.equal(row.newPicks, 3000);
  assert.equal(row.residual, 0);
  assert.equal(Math.round(row.assetAppr + row.pkgAdj + row.other), 0);
});
