import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSync } from '../lib/sync.js';
import { fixtureSleeper } from '../lib/sleeper-port.js';
import { memoryStore } from '../lib/store.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/sleeper/${name}`, import.meta.url)));
const rest = fixture('rest.json');
const gql = fixture('gql.json');
const { leagueId, loginId, rivalId, username } = fixture('league.json');

// In the test league the login (Pooptoad) has roster 8 and the rival roster 1.
const LOGIN_ROSTER = 8;
const RIVAL_ROSTER = 1;

const login = { userId: loginId, displayName: username };

function setup({ login: who = login, settings = {}, rest: recorded = rest } = {}) {
  const sleeper = fixtureSleeper({ login: who, rest: recorded, gql });
  const store = memoryStore({ dossierSettings: settings });
  return { sleeper, store, sync: createSync({ sleeper, store }) };
}

test('sync: by default the viewed team is the login\'s team', async () => {
  const { sync } = setup();
  const raw = await sync.syncLeague();
  assert.equal(raw.me.userId, loginId);
  assert.equal(raw.me.rosterId, LOGIN_ROSTER);
  assert.equal(raw.me.viaLogin, true);
  assert.equal(String(raw.league.league_id), leagueId);
});

test('sync: a team picked in Settings is the viewed team', async () => {
  const { sync } = setup({ settings: { leagueId, teamUserId: rivalId } });
  const raw = await sync.syncLeague();
  assert.equal(raw.me.userId, rivalId);
  assert.equal(raw.me.rosterId, RIVAL_ROSTER);
  assert.equal(raw.me.viaLogin, false);
  assert.equal(raw.me.loginId, loginId);
});

test('sync: logged out, the team comes from the username in Settings', async () => {
  const { sync } = setup({ login: {}, settings: { username } });
  const raw = await sync.syncLeague();
  assert.equal(raw.me.rosterId, LOGIN_ROSTER);
  assert.equal(raw.me.loginId, null);
});

test('sync: offers are fetched for the own team', async () => {
  const { sync, sleeper } = setup();
  const raw = await sync.syncLeague();
  assert.ok(sleeper.calls.includes(`trades:${leagueId}`));
  assert.equal(raw.gql.ok, true);
  assert.equal(raw.gql.trades.length, gql[`trades:${leagueId}`].length);
});

test('sync: viewing as, offers are never asked for', async () => {
  const { sync, sleeper } = setup({ settings: { leagueId, teamUserId: rivalId } });
  const raw = await sync.syncLeague();
  assert.ok(!sleeper.calls.includes(`trades:${leagueId}`));
  assert.equal(raw.gql.skipped, true);
  assert.match(raw.gql.error, /Offers only show for the team that belongs/);
});

test('sync: logged out, offers are never asked for', async () => {
  const { sync, sleeper } = setup({ login: {}, settings: { username } });
  const raw = await sync.syncLeague();
  assert.ok(!sleeper.calls.includes(`trades:${leagueId}`));
  assert.equal(raw.gql.skipped, true);
  assert.match(raw.gql.error, /Log in to sleeper\.com/);
});

test('sync: the trade block loads whoever the viewed team is', async () => {
  const { sync } = setup({ settings: { leagueId, teamUserId: rivalId } });
  const raw = await sync.syncLeague();
  assert.equal(raw.block.ok, true);
  assert.deepEqual(raw.block.items.map((p) => p.settings.otb).sort(), [1, 8]);
});

test('sync: the own team\'s league is registered for waivers', async () => {
  const { sync, store } = setup();
  await sync.syncLeague();
  const rec = (await store.get('leagues', {}))[`sleeper:${leagueId}`];
  assert.equal(rec.rosterId, LOGIN_ROSTER);
  assert.equal(rec.ownerUserId, loginId);
  assert.equal(rec.leagueId, leagueId);
});

test('sync: viewing as or logged out, no league is registered for waivers', async () => {
  for (const opts of [{ settings: { leagueId, teamUserId: rivalId } }, { login: {}, settings: { username } }]) {
    const { sync, store } = setup(opts);
    await sync.syncLeague();
    assert.deepEqual(await store.get('leagues', {}), {});
  }
});

test('sync: the synced league is saved as the league in Settings', async () => {
  const { sync } = setup();
  await sync.syncLeague();
  assert.equal((await sync.settings()).leagueId, leagueId);
});

test('sync: a co-owner\'s picked team is the own team', async () => {
  // The rival's roster with the login added as a co-owner.
  const path = `/league/${leagueId}/rosters`;
  const rosters = rest[path].map((r) => (r.roster_id === RIVAL_ROSTER ? { ...r, co_owners: [loginId] } : r));
  const { sync, sleeper, store } = setup({ settings: { leagueId, teamUserId: rivalId }, rest: { ...rest, [path]: rosters } });
  const raw = await sync.syncLeague();
  assert.equal(raw.me.rosterId, RIVAL_ROSTER);
  assert.ok(sleeper.calls.includes(`trades:${leagueId}`));
  const rec = (await store.get('leagues', {}))[`sleeper:${leagueId}`];
  assert.equal(rec.rosterId, RIVAL_ROSTER);
  assert.equal(rec.ownerUserId, loginId);
});
