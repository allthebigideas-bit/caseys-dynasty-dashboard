import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDraft } from '../lib/mock.js';

const board = [
  { name: 'A', pos: 'WR' }, { name: 'B', pos: 'QB' }, { name: 'C', pos: 'RB' }, { name: 'D', pos: 'QB' },
  { name: 'E', pos: 'WR' }, { name: 'F', pos: 'TE' }, { name: 'G', pos: 'RB' }, { name: 'H', pos: 'WR' },
];
const flat = { QB: 6, RB: 6, WR: 6, TE: 6 };

test('opening picks are best available', () => {
  const r = mockDraft({ order: [{ rid: 1 }, { rid: 2 }], board, posRank: { 1: { ...flat, WR: 1 }, 2: { ...flat, QB: 1 } }, teams: 12 });
  assert.deepEqual(r.map((x) => x.player.name), ['A', 'B']);
  assert.equal(r[1].reason, 'bpa');
});

test('a team stacked at QB passes on a QB for its weakest position', () => {
  const order = [{ rid: 9 }, { rid: 9 }, { rid: 9 }, { rid: 4 }];
  // rid 4 has the best QB room and the worst RB room: B (QB) is next on the board but C (RB) fits.
  const r = mockDraft({ order, board, posRank: { 9: flat, 4: { QB: 1, RB: 12, WR: 6, TE: 6 } }, teams: 12, bpaPicks: 0 });
  assert.equal(r[3].player.pos, 'RB');
  assert.equal(r[3].reason, 'need');
});

test('need never reaches past the window', () => {
  const order = [{ rid: 4 }];
  const r = mockDraft({ order, board, posRank: { 4: { QB: 1, RB: 1, WR: 1, TE: 12 } }, teams: 12, bpaPicks: 0, window: 3 });
  assert.notEqual(r[0].player.pos, 'TE');
});

test('every prospect is used once', () => {
  const order = Array.from({ length: 8 }, (_, i) => ({ rid: (i % 4) + 1 }));
  const r = mockDraft({ order, board, posRank: {}, teams: 4 });
  assert.equal(new Set(r.map((x) => x.player.name)).size, 8);
});
