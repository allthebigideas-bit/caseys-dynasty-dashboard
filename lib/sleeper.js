// Sleeper adapter.
// Reads use the public REST API (api.sleeper.app, no login).
// Writes use Sleeper's private GraphQL endpoint with the login token the
// content script copies out of sleeper.com. That endpoint is undocumented and
// unofficial: it can change without notice.

import { store, canonPos, canonTeam } from './util.js';

const REST = 'https://api.sleeper.app/v1';
const GQL = 'https://sleeper.com/graphql';
const FANTASY_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

export function decodeJwt(token) {
  try {
    const part = String(token).split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

export async function getAuth() {
  const s = await store.get('settings', {});
  return s.sleeper || {};
}

export async function saveToken(token) {
  const payload = decodeJwt(token);
  if (!payload || !payload.user_id) return { ok: false, error: 'Token did not decode' };
  const settings = await store.get('settings', {});
  const prev = settings.sleeper || {};
  settings.sleeper = {
    ...prev,
    token,
    userId: String(payload.user_id),
    displayName: payload.display_name || prev.displayName || '',
    exp: payload.exp ? payload.exp * 1000 : null,
    capturedAt: Date.now(),
  };
  await store.set('settings', settings);
  return { ok: true, sleeper: settings.sleeper };
}

async function rest(path, { bust = false } = {}) {
  const url = REST + path + (bust ? (path.includes('?') ? '&' : '?') + '_=' + Date.now() : '');
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Sleeper ${path} → HTTP ${res.status}`);
  return res.json();
}

export async function gql(op, query, variables = {}) {
  const auth = await getAuth();
  if (!auth.token) {
    const e = new Error('No Sleeper login token yet. Open sleeper.com while logged in.');
    e.kind = 'auth';
    throw e;
  }
  if (auth.exp && Date.now() > auth.exp) {
    const e = new Error('Sleeper login token has expired. Open sleeper.com to refresh it.');
    e.kind = 'auth';
    throw e;
  }
  const res = await fetch(GQL, {
    method: 'POST',
    headers: {
      authorization: auth.token,
      'content-type': 'application/json',
      accept: 'application/json',
      'x-sleeper-graphql-op': op,
    },
    body: JSON.stringify({ operationName: op, query, variables }),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    const e = new Error(`Sleeper GraphQL ${op}: HTTP ${res.status}, non-JSON reply`);
    e.status = res.status;
    throw e;
  }
  if (body.errors && (Array.isArray(body.errors) ? body.errors.length : true)) {
    const errs = Array.isArray(body.errors) ? body.errors : [body.errors];
    const msg = errs.map((x) => (typeof x === 'string' ? x : x.message || JSON.stringify(x))).join('; ');
    const e = new Error(msg);
    e.status = res.status;
    if (errs.some((x) => x && (x.code === 'unauthorized' || /unauthori/i.test(x.message || '')))) e.kind = 'auth';
    throw e;
  }
  if (res.status === 401 || res.status === 403) {
    const e = new Error(`Sleeper refused the request (HTTP ${res.status})`);
    e.status = res.status;
    e.kind = 'auth';
    throw e;
  }
  return body.data || {};
}

export const state = () => rest('/state/nfl');

export async function resolveUserId(username) {
  const auth = await getAuth();
  if (auth.userId) return auth.userId;
  if (!username) throw new Error('Open sleeper.com while logged in (or enter your Sleeper username).');
  const u = await rest(`/user/${encodeURIComponent(username)}`);
  if (!u || !u.user_id) throw new Error(`Sleeper user "${username}" not found`);
  return String(u.user_id);
}

// Returns league records in the extension's common shape.
export async function myLeagues(username) {
  const userId = await resolveUserId(username);
  const st = await state();
  const season = st.league_season || st.season;
  const leagues = (await rest(`/user/${userId}/leagues/nfl/${season}`)) || [];
  const out = [];
  for (const lg of leagues) {
    const rosters = await rest(`/league/${lg.league_id}/rosters`);
    const mine = rosters.find((r) => String(r.owner_id) === userId || (r.co_owners || []).map(String).includes(userId));
    if (!mine) continue;
    const s = lg.settings || {};
    out.push({
      uid: `sleeper:${lg.league_id}`,
      platform: 'sleeper',
      leagueId: String(lg.league_id),
      name: lg.name,
      season: String(season),
      rosterId: mine.roster_id,
      waiverType: ['Rolling', 'Reverse standings', 'FAAB'][s.waiver_type] || String(s.waiver_type ?? ''),
      waiverInfo: describeWaivers(s),
      rosterPlayers: (mine.players || []).filter((p) => !(mine.taxi || []).includes(p)),
      updatedAt: Date.now(),
    });
  }
  return out;
}

function describeWaivers(s) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const parts = [];
  if (s.waiver_day_of_week !== undefined && days[s.waiver_day_of_week]) parts.push(`clears ${days[s.waiver_day_of_week]}`);
  if (s.daily_waivers) parts.push(`daily waivers${s.daily_waivers_hour !== undefined ? ' @ hour ' + s.daily_waivers_hour : ''}`);
  if (s.waiver_clear_days !== undefined) parts.push(`${s.waiver_clear_days}-day hold after drops`);
  return parts.join(' · ');
}

export async function rosters(leagueId) {
  return rest(`/league/${leagueId}/rosters`, { bust: true });
}

// Compact player dictionary for fantasy positions:
// { id: [name, pos, team, age, injuryStatus, yearsExp, active(1/0)] }
// Inactive players are kept so old trades still have names.
export const P = { NAME: 0, POS: 1, TEAM: 2, AGE: 3, INJ: 4, EXP: 5, ACTIVE: 6 };

export async function playersDict(force = false) {
  const cached = await store.get('sleeperPlayers2', null);
  const fresh = cached && cached.v === 3; // v3 adds depth-chart order (for handcuffs)
  if (!force && fresh && Date.now() - cached.fetchedAt < 20 * 3600e3) return cached.map;
  const raw = await rest('/players/nfl');
  const map = {};
  const now = Date.now();
  for (const [id, p] of Object.entries(raw)) {
    const pos = canonPos(p.position || (p.fantasy_positions || [])[0]);
    if (!FANTASY_POS.has(pos)) continue;
    const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
    if (!name) continue;
    let age = p.age ?? null;
    if (p.birth_date) {
      const b = Date.parse(p.birth_date);
      if (!Number.isNaN(b)) age = Math.round(((now - b) / (365.25 * 86400e3)) * 10) / 10;
    }
    const active = pos === 'DEF' || p.active !== false ? 1 : 0;
    map[id] = [name, pos, canonTeam(p.team || (pos === 'DEF' ? id : '')), age, p.injury_status || '', p.years_exp ?? null, active, p.depth_chart_order ?? null];
  }
  await store.set('sleeperPlayers2', { v: 3, fetchedAt: Date.now(), map });
  return map;
}

export function dictToList(map, { all = false } = {}) {
  return Object.entries(map)
    .filter(([, d]) => all || d[6] !== 0)
    .map(([id, [name, pos, team]]) => ({ id, name, pos, team }));
}

// ---- league reads used by the dossier ------------------------------------------

export const user = (nameOrId) => rest(`/user/${encodeURIComponent(nameOrId)}`);
export const userLeagues = (userId, season) => rest(`/user/${userId}/leagues/nfl/${season}`);
export const league = (id) => rest(`/league/${id}`);
export const leagueUsers = (id) => rest(`/league/${id}/users`);
export const matchups = (id, week) => rest(`/league/${id}/matchups/${week}`, { bust: true });
export const transactions = (id, week) => rest(`/league/${id}/transactions/${week}`, { bust: true });
export const tradedPicks = (id) => rest(`/league/${id}/traded_picks`, { bust: true });
export const leagueDrafts = (id) => rest(`/league/${id}/drafts`);
export const draftPicks = (draftId) => rest(`/draft/${draftId}/picks`);
export const leagueRosters = (id) => rest(`/league/${id}/rosters`, { bust: true });

export async function projections(season, week) {
  const q = 'season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF&order_by=pts_ppr';
  const res = await fetch(`https://api.sleeper.com/projections/nfl/${season}/${week}?${q}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Sleeper projections → HTTP ${res.status}`);
  const arr = await res.json();
  const out = {};
  for (const r of arr || []) {
    if (!r || !r.player_id || out[r.player_id]) continue;
    out[r.player_id] = { stats: r.stats || {}, opp: r.opponent || '', team: r.team || '', gameId: r.game_id || '', date: r.date || '' };
  }
  return out;
}

// Every trade the logged-in user can see in a league: completed trades for
// the whole league, plus pending, rejected and cancelled ones involving you.
const TRADES_Q = `query league_transactions_filtered($league_id: Snowflake!, $type_filters: [String], $limit: Int) {
  league_transactions_filtered(league_id: $league_id, type_filters: $type_filters, limit: $limit) {
    transaction_id status type creator roster_ids consenter_ids created leg adds drops draft_picks waiver_budget
  }
}`;

// Same query plus the time the offer was answered (accepted, rejected or
// withdrawn). If Sleeper doesn't recognise the field, fall back to the query
// without it and remember that for this session.
const TRADES_Q2 = TRADES_Q.replace('created leg', 'created status_updated leg');
let statusUpdatedOk = true;

export async function gqlTrades(leagueId, limit = 500) {
  const vars = { league_id: String(leagueId), type_filters: ['trade'], limit };
  if (statusUpdatedOk) {
    try {
      const d = await gql('league_transactions_filtered', TRADES_Q2, vars);
      return d.league_transactions_filtered || [];
    } catch (e) {
      if (!/status_updated|field|Cannot query/i.test(e.message)) throw e;
      statusUpdatedOk = false;
    }
  }
  const d = await gql('league_transactions_filtered', TRADES_Q, vars);
  return d.league_transactions_filtered || [];
}

// League-wide player flags, including the trade block (settings.otb = roster
// id that listed it, otb_added_at = when).
const LP_Q = `query league_players($league_id: Snowflake!) { league_players(league_id: $league_id) { player_id settings } }`;

export async function gqlLeaguePlayers(leagueId) {
  const d = await gql('league_players', LP_Q, { league_id: String(leagueId) });
  return d.league_players || [];
}

const TXN_QUERY = `query league_transactions_filtered($league_id: Snowflake!, $type_filters: [String], $status_filters: [String], $leg_filters: [Int], $limit: Int) {
  league_transactions_filtered(league_id: $league_id, type_filters: $type_filters, status_filters: $status_filters, leg_filters: $leg_filters, limit: $limit) {
    transaction_id status type created leg
  }
}`;

// IDs of waiver claims that have finished processing (complete or failed)
// around the current week. Used as the "waivers have run" signal: a new ID
// appearing after we armed means the run happened.
export async function processedWaiverIds(leagueId) {
  const st = await state();
  const w = Number(st.leg || st.week || 1);
  const legs = [w - 1, w, w + 1].filter((x) => x > 0);
  try {
    const data = await gql('league_transactions_filtered', TXN_QUERY, {
      league_id: leagueId,
      type_filters: ['waiver'],
      status_filters: ['complete', 'failed'],
      leg_filters: legs,
      limit: 200,
    });
    return { via: 'graphql', ids: (data.league_transactions_filtered || []).map((t) => String(t.transaction_id)) };
  } catch (e) {
    if (e.kind === 'auth') throw e;
    // Fall back to REST (can lag a few minutes behind because of caching).
    const ids = [];
    for (const leg of legs) {
      const txns = await rest(`/league/${leagueId}/transactions/${leg}`, { bust: true });
      for (const t of txns || []) {
        if (t.type === 'waiver' && (t.status === 'complete' || t.status === 'failed')) ids.push(String(t.transaction_id));
      }
    }
    return { via: 'rest', ids, gqlError: e.message };
  }
}

const ADD_MUTATION = `mutation create_free_agent($league_id: Snowflake!, $roster_id: Int!, $adds: JSON, $drops: JSON) {
  create_free_agent(league_id: $league_id, roster_id: $roster_id, adds: $adds, drops: $drops) {
    transaction_id status type created adds drops
  }
}`;

export async function addDrop(leagueId, rosterId, addId, dropId) {
  const adds = addId ? { [addId]: Number(rosterId) } : {};
  const drops = dropId ? { [dropId]: Number(rosterId) } : {};
  const data = await gql('create_free_agent', ADD_MUTATION, {
    league_id: String(leagueId),
    roster_id: Number(rosterId),
    adds,
    drops,
  });
  const txn = data.create_free_agent;
  if (!txn || !txn.transaction_id) throw new Error('Sleeper returned no transaction — the add did not go through');
  if (txn.status && txn.status !== 'complete') {
    // A "pending" add most likely means Sleeper turned it into a waiver claim
    // because the player is still on waivers. Don't retry it (that would stack
    // duplicate claims); the engine flags it for the user instead.
    const e = new Error(`Sleeper recorded this as "${txn.status}" (transaction ${txn.transaction_id}) — the player may still be on waivers. Check the Sleeper app.`);
    e.kind = txn.status === 'pending' ? 'pending' : 'other';
    throw e;
  }
  return txn;
}

// Connection test: proves the token works for an authenticated read, and
// lists which add/waiver mutations Sleeper currently exposes (diagnostic).
export async function testConnection(leagueId) {
  const out = { token: false, authRead: null, mutations: null };
  const auth = await getAuth();
  out.token = !!auth.token;
  out.user = auth.displayName;
  out.expires = auth.exp;
  if (leagueId) {
    try {
      const r = await processedWaiverIds(leagueId);
      out.authRead = r.via === 'graphql' ? 'ok' : `fell back to REST (${r.gqlError})`;
    } catch (e) {
      out.authRead = 'failed: ' + e.message;
    }
  }
  for (const q of ['{ __schema { mutation_type { fields { name } } } }', '{ __schema { mutationType { fields { name } } } }']) {
    try {
      const d = await gql('introspect', q.replace('{ __schema', 'query introspect { __schema'));
      const t = d.__schema && (d.__schema.mutation_type || d.__schema.mutationType);
      if (t && t.fields) {
        out.mutations = t.fields.map((f) => f.name).filter((n) => /free_agent|waiver/.test(n));
        break;
      }
    } catch { /* try the other spelling */ }
  }
  return out;
}
