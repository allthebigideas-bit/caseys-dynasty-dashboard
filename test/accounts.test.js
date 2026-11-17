import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swapAccount } from '../lib/accounts.js';

// A stand-in for chrome.storage.local.
function fakeStorage(init = {}) {
  const mem = structuredClone(init);
  return {
    mem,
    async get(keys) { const o = {}; for (const k of [].concat(keys)) if (k in mem) o[k] = structuredClone(mem[k]); return o; },
    async set(obj) { Object.assign(mem, structuredClone(obj)); },
    async remove(keys) { for (const k of [].concat(keys)) delete mem[k]; },
  };
}

test('swapAccount: A logs out, B starts clean, A gets everything back', async () => {
  const st = fakeStorage({ notes: { 3: 'sells low' }, plans: { x: 1 }, 'alerts:feed': [1, 2], dossierSettings: { leagueId: 'L' } });

  await swapAccount('A', 'B', st);
  assert.equal(st.mem.notes, undefined, "B doesn't see A's notes");
  assert.equal(st.mem.plans, undefined);
  assert.deepEqual(st.mem['account:A'].notes, { 3: 'sells low' }, "A's notes are parked");
  assert.deepEqual(st.mem.dossierSettings, { leagueId: 'L' }, 'shared settings are left alone');

  st.mem.notes = { 5: 'B note' };
  await swapAccount('B', 'A', st);
  assert.deepEqual(st.mem.notes, { 3: 'sells low' }, "A's notes come back");
  assert.deepEqual(st.mem.plans, { x: 1 });
  assert.deepEqual(st.mem['alerts:feed'], [1, 2]);
  assert.equal(st.mem['account:A'], undefined, 'parked copy is cleared once restored');
  assert.deepEqual(st.mem['account:B'].notes, { 5: 'B note' }, "B's notes are parked");

  await swapAccount('A', 'B', st);
  assert.deepEqual(st.mem.notes, { 5: 'B note' }, "B's notes come back too");
});

test('swapAccount: same account or no new account changes nothing', async () => {
  const st = fakeStorage({ notes: { 1: 'x' } });
  await swapAccount('A', 'A', st);
  await swapAccount('A', null, st);
  assert.deepEqual(st.mem, { notes: { 1: 'x' } });
});
