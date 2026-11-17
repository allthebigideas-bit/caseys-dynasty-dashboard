import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownTeam } from '../lib/ownteam.js';

const rosters = [
  { roster_id: 1, owner_id: '123', co_owners: ['456'] },
  { roster_id: 2, owner_id: '999', co_owners: null },
];

test('ownTeam: no login is logged out', () => {
  assert.equal(ownTeam({ rosters, rosterId: 1 }, null), 'loggedOut');
  assert.equal(ownTeam({ rosters, rosterId: 1 }, { userId: null }), 'loggedOut');
});

test('ownTeam: the login owns the viewed team', () => {
  assert.equal(ownTeam({ rosters, rosterId: 1 }, { userId: '123' }), 'own');
});

test('ownTeam: a co-owner owns the team too', () => {
  assert.equal(ownTeam({ rosters, rosterId: 1 }, { userId: '456' }), 'own');
});

test('ownTeam: another manager\'s team is viewing as', () => {
  assert.equal(ownTeam({ rosters, rosterId: 2 }, { userId: '123' }), 'viewingAs');
  assert.equal(ownTeam({ rosters, rosterId: 2 }, { userId: '456' }), 'viewingAs');
});

test('ownTeam: numeric and string IDs compare equal', () => {
  const numeric = [{ roster_id: 1, owner_id: 123, co_owners: [456] }];
  assert.equal(ownTeam({ rosters: numeric, rosterId: '1' }, { userId: '123' }), 'own');
  assert.equal(ownTeam({ rosters: numeric, rosterId: 1 }, { userId: '456' }), 'own');
  assert.equal(ownTeam({ rosters, rosterId: 1 }, { userId: 123 }), 'own');
});

test('ownTeam: a team picked by its primary owner\'s ID is still a co-owner\'s own team', () => {
  // Settings stores the primary owner's user ID; the viewed roster is theirs.
  const picked = rosters.find((r) => r.owner_id === '123');
  assert.equal(ownTeam({ rosters, rosterId: picked.roster_id }, { userId: '456' }), 'own');
});

test('ownTeam: missing rosters never open the gate', () => {
  assert.equal(ownTeam({ rosters: null, rosterId: 1 }, { userId: '123' }), 'viewingAs');
  assert.equal(ownTeam({ rosters, rosterId: 7 }, { userId: '123' }), 'viewingAs');
  assert.equal(ownTeam(null, { userId: '123' }), 'viewingAs');
  assert.equal(ownTeam(null, null), 'loggedOut');
});
