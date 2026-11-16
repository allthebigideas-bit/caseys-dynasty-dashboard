import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownsTeam } from '../lib/util.js';

const raw = { me: { userId: '123' } };

test('ownsTeam: the login owns the viewed team', () => {
  assert.equal(ownsTeam(raw, { userId: 123 }), true);
});

test('ownsTeam: viewing someone else, or no login, is not owning', () => {
  assert.equal(ownsTeam(raw, { userId: '999' }), false);
  assert.equal(ownsTeam(raw, { userId: null }), false);
  assert.equal(ownsTeam(raw, null), false);
  assert.equal(ownsTeam(null, { userId: '123' }), false);
});
