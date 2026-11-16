// Collects everything the dossier needs and stores it. Runs in the dossier
// page (so long scans aren't cut off by the service worker going idle).

import { store, normName, canonPos } from './util.js';
import { pool, DAY, HOUR } from './net.js';
import * as sl from './sleeper.js';
import { loadCrosswalk, loadKtc, loadFantasyCalc, loadDpValues, buildBook, leagueFormat, cached } from './values.js';
import { loadWeeklyEcr } from './fp.js';
import { loadHistory } from './history.js';
import { loadDraftIntel, loadFpRookies } from './draft.js';
import { scoreLine } from './startsit.js';
import { fetchJSON } from './net.js';

const noop = () => {};

export async function settings() {
  return { ...DEFAULTS, ...(await store.get('dossierSettings', {})) };
}

export async function saveSettings(patch) {
  return store.update('dossierSettings', (s) => ({ ...DEFAULTS, ...s, ...patch }), {});
}

const DEFAULTS = { username: '', leagueId: '', teamUserId: '', strategy: 'auto', lastSeen: 0 };
export const NEED_TEAM = 'Pick your team: open sleeper.com in this browser while logged in, or choose your league and team below.';

// Whose team the dossier is built for.
//   1. A team picked in "Your team" (teamUserId), if it isn't the logged-in account.
//   2. Otherwise the account logged in to sleeper.com in this browser.
//   3. Otherwise the Sleeper username typed in Settings.
// `own` is true only when the team belongs to the logged-in account: offers,
// background alerts and waiver claims need that, because they act with the login.
async function whoAmI(cfg) {
  const auth = await sl.getAuth();
  const loginId = auth.userId ? String(auth.userId) : null;
  const pick = cfg.teamUserId ? String(cfg.teamUserId) : null;
  if (pick && pick !== loginId) {
    const u = await sl.user(pick).catch(() => null);
    return { userId: pick, username: (u && u.display_name) || pick, viaLogin: false, picked: true, loginId };
  }
  if (loginId) return { userId: loginId, username: auth.displayName || cfg.username, viaLogin: true, picked: !!pick, loginId };
  if (!cfg.username) throw new Error(NEED_TEAM);
  const u = await sl.user(cfg.username);
  if (!u || !u.user_id) throw new Error(`No Sleeper user called "${cfg.username}".`);
  return { userId: String(u.user_id), username: u.display_name, viaLogin: false, picked: false, loginId };
}

const leagueRow = (l) => ({ id: String(l.league_id), name: l.name, type: (l.settings || {}).type, size: l.total_rosters, season: String(l.season || '') });

export async function listLeagues(username) {
  const who = await whoAmI({ ...(await settings()), username, teamUserId: '' });
  const st = await sl.state();
  const season = st.league_season || st.season;
  const leagues = (await sl.userLeagues(who.userId, season)) || [];
  return { who, season, leagues: leagues.map(leagueRow) };
}

// "Your team" picker, step 1. `query` is a Sleeper league ID, a Sleeper
// username, or blank for the account logged in to sleeper.com.
export async function findLeagues(query) {
  const q = String(query || '').trim();
  if (/^\d{10,}$/.test(q)) {
    const l = await sl.league(q).catch(() => null);
    if (l && l.league_id) return { leagues: [leagueRow(l)], via: 'id' };
  }
  let userId, name;
  if (!q) {
    const auth = await sl.getAuth();
    if (!auth.userId) throw new Error('No Sleeper login in this browser yet. Enter your Sleeper username or league ID instead.');
    userId = String(auth.userId);
    name = auth.displayName || 'you';
  } else {
    const u = await sl.user(q).catch(() => null);
    if (!u || !u.user_id) throw new Error(`No Sleeper league or user matches "${q}".`);
    userId = String(u.user_id);
    name = u.display_name;
  }
  const st = await sl.state();
  const season = st.league_season || st.season;
  const leagues = (await sl.userLeagues(userId, season)) || [];
  if (!leagues.length) throw new Error(`No ${season} Sleeper leagues found for ${name}.`);
  return { leagues: leagues.map(leagueRow), via: 'user', userId, name };
}

// "Your team" picker, step 2: every team in a league.
export async function leagueTeams(leagueId) {
  const [users, rosters] = await Promise.all([sl.leagueUsers(leagueId), sl.leagueRosters(leagueId)]);
  return (rosters || []).filter((r) => r.owner_id).map((r) => {
    const u = (users || []).find((x) => String(x.user_id) === String(r.owner_id)) || {};
    const teamName = u.metadata && u.metadata.team_name;
    return { userId: String(r.owner_id), rosterId: r.roster_id, name: teamName || u.display_name || `Team ${r.roster_id}`, user: u.display_name || '', avatar: u.avatar || null };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// ---- the league snapshot ------------------------------------------------------------

export async function syncLeague({ onStep = noop, deep = false } = {}) {
  const cfg = await settings();
  onStep('Finding your league');
  const who = await whoAmI(cfg);
  const own = !!who.loginId && who.userId === who.loginId;
  const st = await sl.state();
  const season = String(st.league_season || st.season);
  const week = Math.max(1, Number(st.season_type === 'regular' ? st.week : st.week || 1) || 1);
  const leagues = (await sl.userLeagues(who.userId, season)) || [];
  const isDefault = (l) => (l.settings || {}).type === 2;
  let lg = leagues.find((l) => String(l.league_id) === String(cfg.leagueId));
  if (!lg && cfg.leagueId && cfg.teamUserId) {
    // A league picked by ID that isn't in this season's list (e.g. not started yet).
    const one = await sl.league(cfg.leagueId).catch(() => null);
    if (one && one.league_id) { lg = one; leagues.unshift(one); }
  }
  if (!lg) lg = leagues.find(isDefault) || leagues[0];
  if (!lg) throw new Error(`No ${season} Sleeper leagues found for ${who.username}.`);
  const leagueId = String(lg.league_id);

  onStep('Reading rosters and settings');
  const [league, users, rosters, tradedPicks, drafts] = await Promise.all([
    sl.league(leagueId), sl.leagueUsers(leagueId), sl.leagueRosters(leagueId), sl.tradedPicks(leagueId), sl.leagueDrafts(leagueId).catch(() => []),
  ]);
  const owns = (r) => String(r.owner_id) === who.userId || (r.co_owners || []).map(String).includes(who.userId);
  const mine = rosters.find(owns);
  if (!mine) throw new Error(who.picked ? `The team you picked isn't in ${league.name} any more. Pick your team again in Settings.` : `You don't have a team in ${league.name}.`);
  const regEnd = ((league.settings || {}).playoff_week_start || 15) - 1;

  onStep('Reading every week of results');
  const weeks = Array.from({ length: Math.max(regEnd, week) }, (_, i) => i + 1);
  const mres = await pool(weeks, 6, (w) => sl.matchups(leagueId, w));
  const matchups = {};
  weeks.forEach((w, i) => { if (Array.isArray(mres[i])) matchups[w] = mres[i]; });

  onStep('Reading transactions');
  const tweeks = Array.from({ length: Math.min(18, week + 1) + 1 }, (_, i) => i);
  const tres = await pool(tweeks, 6, (w) => sl.transactions(leagueId, w));
  // Retry any week that failed (rate limits, timeouts) so no trade is missed.
  for (let i = 0; i < tres.length; i++) {
    if (Array.isArray(tres[i])) continue;
    for (let tries = 0; tries < 2 && !Array.isArray(tres[i]); tries++) {
      await new Promise((r) => setTimeout(r, 800));
      tres[i] = await sl.transactions(leagueId, tweeks[i]).catch(() => null);
    }
  }
  const seen = new Set();
  const txns = [];
  for (const arr of tres) for (const t of Array.isArray(arr) ? arr : []) if (!seen.has(t.transaction_id)) { seen.add(t.transaction_id); txns.push(t); }

  onStep('Reading rookie drafts');
  const draftOut = [];
  const addDrafts = async (ds) => {
    for (const d of ds || []) {
      if (d.status !== 'complete') continue;
      const picks = await sl.draftPicks(d.draft_id).catch(() => []);
      draftOut.push({ season: String(d.season), type: d.type, startTime: d.start_time || null, rounds: (d.settings || {}).rounds || null, draftOrder: d.draft_order || {}, slotToRoster: d.slot_to_roster_id || {}, picks: (picks || []).map((p) => ({ round: p.round, draft_slot: p.draft_slot, pick_no: p.pick_no, player_id: p.player_id, roster_id: p.roster_id })) });
    }
  };
  await addDrafts(drafts);

  onStep('Reading earlier seasons');
  const history = [];
  let prev = league.previous_league_id;
  for (let i = 0; i < 3 && prev && prev !== '0'; i++) {
    try {
      const [pl, pu, pr, pd] = await Promise.all([sl.league(prev), sl.leagueUsers(prev), sl.leagueRosters(prev), sl.leagueDrafts(prev).catch(() => [])]);
      const ptx = await pool(Array.from({ length: 19 }, (_, k) => k), 6, (w) => sl.transactions(prev, w));
      const trades = [];
      const moves = [];
      const s2 = new Set();
      for (const arr of ptx) {
        for (const t of Array.isArray(arr) ? arr : []) {
          if (s2.has(t.transaction_id) || t.status !== 'complete') continue;
          s2.add(t.transaction_id);
          if (t.type === 'trade') trades.push(t);
          else if (t.drops || t.adds) moves.push({ type: t.type, status: t.status, created: t.created, adds: t.adds || {}, drops: t.drops });
        }
      }
      // Weekly lineups that season, for points scored by traded players.
      const pEnd = ((pl.settings || {}).playoff_week_start || 15) - 1;
      const pm = await pool(Array.from({ length: pEnd }, (_, k) => k + 1), 6, (w) => sl.matchups(prev, w)).catch(() => []);
      const matchups = {};
      (pm || []).forEach((arr, k) => {
        if (Array.isArray(arr)) matchups[k + 1] = arr.map((m) => ({ roster_id: m.roster_id, matchup_id: m.matchup_id, points: m.points, starters: m.starters || [], starters_points: m.starters_points || [] }));
      });
      history.push({ season: pl.season, leagueId: prev, rosters: pr.map((r) => ({ roster_id: r.roster_id, owner_id: r.owner_id })), userNames: Object.fromEntries(pu.map((u) => [u.user_id, u.display_name])), trades, moves, matchups });
      await addDrafts(pd);
      prev = pl.previous_league_id;
    } catch {
      break;
    }
  }

  onStep('Reading offers and the trade block');
  let gql = { ok: false, trades: [], error: null };
  let block = { ok: false, items: [], error: null };
  if (!own) {
    gql.error = who.loginId ? 'Offers only show for the team that belongs to the Sleeper account logged in to this browser.' : 'Log in to sleeper.com in this browser to see offers.';
  } else try {
    gql = { ok: true, trades: await sl.gqlTrades(leagueId), error: null };
  } catch (e) {
    gql.error = e.kind === 'auth' ? 'Log in to sleeper.com in this browser to see offers.' : e.message;
  }
  try {
    block = { ok: true, items: (await sl.gqlLeaguePlayers(leagueId)).filter((p) => p.settings && p.settings.otb), error: null };
  } catch (e) {
    block.error = e.kind === 'auth' ? 'Log in to sleeper.com in this browser to see the trade block.' : e.message;
  }

  const raw = {
    at: Date.now(),
    me: { userId: who.userId, username: who.username, rosterId: mine.roster_id, viaLogin: who.viaLogin, own, loginId: who.loginId },
    nfl: { season, week, seasonType: st.season_type },
    leagues: leagues.map((l) => ({ id: l.league_id, name: l.name, type: (l.settings || {}).type })),
    league, users, rosters, tradedPicks, matchups, txns, drafts: draftOut, history, gql, block,
    others: (await store.get(`others:${leagueId}`, {})) || {},
  };
  // League-mates' other leagues: refreshed at most once a day unless forced.
  try {
    raw.others = await scanOthers(raw, { onStep, force: deep });
  } catch (e) {
    raw.othersError = e.message;
  }
  await store.set(`dossier:raw`, raw);
  await saveSettings({ leagueId });
  // Waiver claims act with the login, so only register the logged-in owner's team.
  if (own) await registerWaiverLeague(raw);
  return raw;
}

// The overnight waiver engine keeps its own league records; keep this league's
// record current so the Waivers page works without a separate setup step.
async function registerWaiverLeague(raw) {
  const dict = (await store.get('sleeperPlayers2', null)) || { map: {} };
  const mine = raw.rosters.find((r) => r.roster_id === raw.me.rosterId) || {};
  const s = raw.league.settings || {};
  const uid = `sleeper:${raw.league.league_id}`;
  await store.update('leagues', (all) => {
    all[uid] = {
      uid,
      platform: 'sleeper',
      leagueId: String(raw.league.league_id),
      name: raw.league.name,
      season: String(raw.nfl.season),
      rosterId: raw.me.rosterId,
      ownerUserId: raw.me.userId,
      waiverType: ['Rolling', 'Reverse standings', 'FAAB'][s.waiver_type] || '',
      rosterPlayers: (mine.players || []).map((id) => {
        const d = dict.map[id];
        return d ? { id, name: d[0], pos: d[1], team: d[2] } : { id, name: id, pos: '', team: '' };
      }),
      updatedAt: Date.now(),
    };
    return all;
  }, {});
}

// ---- league-mates' other leagues -------------------------------------------------

export async function scanOthers(raw, { onStep = noop, force = false } = {}) {
  const key = `others:${raw.league.league_id}`;
  const prev = (await store.get(key, {})) || {};
  const season = raw.nfl.season;
  const maxWeek = Math.min(18, Number(raw.nfl.week) + 1);
  const members = (raw.rosters || []).map((r) => r.owner_id).filter((u) => u && u !== raw.me.userId);
  const out = { ...prev };
  let done = 0;
  for (const uid of members) {
    done++;
    const name = ((raw.users || []).find((u) => u.user_id === uid) || {}).display_name || uid;
    if (!force && prev[uid] && Date.now() - prev[uid].at < DAY) continue;
    onStep(`Scanning ${name}'s other leagues (${done}/${members.length})`);
    try {
      const lgs = ((await sl.userLeagues(uid, season)) || []).filter((l) => String(l.league_id) !== String(raw.league.league_id)).slice(0, 30);
      let partial = false;
      const leagues = await pool(lgs, 4, async (l) => {
        const rosters = await sl.leagueRosters(l.league_id);
        const theirs = rosters.find((r) => r.owner_id === uid || (r.co_owners || []).includes(uid));
        if (!theirs) return null;
        const res = await pool(Array.from({ length: maxWeek + 1 }, (_, k) => k), 5, (w) => sl.transactions(l.league_id, w));
        const trades = [];
        const s = new Set();
        for (const arr of res) {
          if (!Array.isArray(arr)) { partial = true; continue; }
          for (const t of arr) {
            if (t.type !== 'trade' || t.status !== 'complete' || s.has(t.transaction_id) || !(t.roster_ids || []).includes(theirs.roster_id)) continue;
            s.add(t.transaction_id);
            const rid = theirs.roster_id;
            const adds = t.adds || {}, drops = t.drops || {};
            trades.push({
              created: t.created,
              in: Object.keys(adds).filter((p) => adds[p] === rid),
              out: Object.keys(drops).filter((p) => drops[p] === rid && p in adds),
              picksIn: (t.draft_picks || []).filter((p) => p.owner_id === rid).length,
              picksOut: (t.draft_picks || []).filter((p) => p.previous_owner_id === rid).length,
              pin: (t.draft_picks || []).filter((p) => p.owner_id === rid).map((p) => `${p.season}:${p.round}`),
              pout: (t.draft_picks || []).filter((p) => p.previous_owner_id === rid).map((p) => `${p.season}:${p.round}`),
            });
          }
        }
        const rp = l.roster_positions || [];
        return { id: l.league_id, name: l.name, type: (l.settings || {}).type, size: l.total_rosters, sf: rp.includes('SUPER_FLEX') || rp.filter((x) => x === 'QB').length > 1, tep: Number((l.scoring_settings || {}).bonus_rec_te || 0), players: theirs.players || [], trades };
      });
      out[uid] = { at: Date.now(), leagues: leagues.filter((x) => x && !x.error), partial: partial || leagues.some((x) => x && x.error) };
    } catch (e) {
      out[uid] = { at: Date.now(), leagues: [], error: e.message };
    }
    await store.set(key, out);
  }
  return out;
}

// ---- values, rankings, projections -----------------------------------------------

export async function syncValues(raw, { onStep = noop, force = false } = {}) {
  const fmt = leagueFormat(raw.league);
  const status = {};
  onStep('Loading the Sleeper player list');
  const dict = await sl.playersDict(force);
  onStep('Loading the player ID crosswalk');
  let crosswalk = [];
  try {
    const r = await loadCrosswalk({ force });
    crosswalk = r.data;
    status.crosswalk = { ok: true, at: r.at, stale: !!r.stale };
  } catch (e) {
    status.crosswalk = { ok: false, error: e.message };
  }
  onStep('Loading KeepTradeCut values');
  let ktc = null;
  try {
    const r = await loadKtc({ force });
    ktc = r.data;
    status.ktc = { ok: true, at: r.at, n: ktc.length, stale: !!r.stale, error: r.error || null };
  } catch (e) {
    status.ktc = { ok: false, error: e.message };
  }
  onStep('Loading FantasyCalc values');
  let fc = null;
  try {
    const r = await loadFantasyCalc(fmt, { force });
    fc = r.data;
    status.fc = { ok: true, at: r.at, n: fc.length, stale: !!r.stale };
  } catch (e) {
    status.fc = { ok: false, error: e.message };
  }
  let dp = null;
  if (!ktc) {
    try {
      const r = await loadDpValues({ force });
      dp = r.data;
      status.dp = { ok: true, at: r.at };
    } catch (e) {
      status.dp = { ok: false, error: e.message };
    }
  }
  const book = buildBook({ fmt, ktc, fc, dp, crosswalk, sleeperDict: dict, status });
  await store.set('dossier:book', book);

  // Daily value history for league-rostered players (for 7-day moves and
  // "value at the time" on trades).
  const day = new Date().toISOString().slice(0, 10);
  const hist = (await store.get('valueHistory', {})) || {};
  if (!hist[day] && ktc) {
    const snap = {};
    for (const r of raw.rosters) for (const sid of r.players || []) {
      const s = book.players[sid];
      if (s && s[0] != null) snap[sid] = s[0];
    }
    hist[day] = snap;
    const keep = Object.keys(hist).sort().slice(-90);
    const trimmed = Object.fromEntries(keep.map((k) => [k, hist[k]]));
    await store.set('valueHistory', trimmed);
  }

  onStep('Loading FantasyPros weekly rankings');
  let fpBySid = {};
  try {
    const r = await loadWeeklyEcr(fmt.ppr, { force });
    const byFp = {};
    for (const [sid, , fpId] of crosswalk) if (fpId) byFp[fpId] = sid;
    const nameIdx = {};
    for (const [sid, d] of Object.entries(dict)) if (d[6] !== 0) nameIdx[`${normName(d[0])}|${canonPos(d[1])}`] = sid;
    for (const row of r.data.rows) {
      let sid = byFp[row.fp] || nameIdx[`${normName(row.name)}|${canonPos(row.pos)}`];
      if (!sid && canonPos(row.pos) === 'DEF' && dict[row.team]) sid = row.team;
      if (sid) fpBySid[sid] = row;
    }
    status.fp = { ok: true, at: r.at, source: r.data.source, week: r.data.week, scraped: r.data.scraped || null, directError: r.data.directError || null, matched: Object.keys(fpBySid).length };
  } catch (e) {
    status.fp = { ok: false, error: e.message };
  }

  onStep('Loading Sleeper projections');
  let proj = {};
  try {
    const r = await cached(`src:proj:${raw.nfl.season}:${raw.nfl.week}`, 3 * HOUR, () => sl.projections(raw.nfl.season, raw.nfl.week), { force });
    proj = r.data;
    status.proj = { ok: true, at: r.at, n: Object.keys(proj).length };
  } catch (e) {
    status.proj = { ok: false, error: e.message };
  }
  // Season production (this season, last season, season projection), scored
  // with the league's own settings, for the aging projections.
  onStep('Loading season stats for aging projections');
  let prod = null;
  try {
    const season = Number(raw.nfl.season);
    const scoring = raw.league.scoring_settings || {};
    const q = 'season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&order_by=pts_ppr';
    const load = (kind, y, ttl) => cached(`src:${kind}:${y}`, ttl, () => fetchJSON(`https://api.sleeper.com/${kind}/nfl/${y}?${q}`, { timeout: 40000 }));
    const [cur, prev, pj] = await Promise.all([load('stats', season, 6 * HOUR), load('stats', season - 1, 30 * DAY), load('projections', season, 12 * HOUR)]);
    const squash = (arr) => {
      const out = {};
      for (const r of arr || []) {
        if (!r || !r.player_id || !r.stats || out[r.player_id]) continue;
        const pos = (r.player && r.player.position) || (dict[r.player_id] || [])[1];
        const gp = Number(r.stats.gp || 0);
        if (!gp) continue;
        const pts = scoreLine(r.stats, scoring, pos);
        if (pts == null) continue;
        out[r.player_id] = [gp, Math.round(pts * 10) / 10];
      }
      return out;
    };
    prod = { cur: squash(cur.data), prev: squash(prev.data), proj: squash(pj.data) };
    await store.set('dossier:prod', prod);
    status.prod = { ok: true, at: cur.at, n: Object.keys(prod.cur).length };
  } catch (e) {
    status.prod = { ok: false, error: e.message };
  }

  // Week-by-week stats for this season: league-scored points plus usage
  // (snaps, targets, carries) for hot/cold and trend reads.
  onStep('Loading weekly stats');
  try {
    const season = Number(raw.nfl.season);
    const scoring = raw.league.scoring_settings || {};
    const lastDone = Math.min(Number(raw.nfl.week || 1) - 1, 18);
    const q = 'season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&order_by=pts_ppr';
    const weeks = {};
    let snaps = false;
    for (let w = 1; w <= lastDone; w++) {
      const ttl = w >= lastDone - 1 ? 6 * HOUR : 60 * DAY; // recent weeks get stat corrections
      const r = await cached(`src:wkstats:${season}:${w}`, ttl, () => fetchJSON(`https://api.sleeper.com/stats/nfl/${season}/${w}?${q}`, { timeout: 30000 }), { force: force && w >= lastDone - 1 });
      const out = {};
      for (const row of r.data || []) {
        const st = row && row.stats;
        if (!st || !row.player_id) continue;
        const pos = (row.player && row.player.position) || (dict[row.player_id] || [])[1];
        const played = Number(st.gp || 0) > 0 || Number(st.off_snp || 0) > 0;
        if (!played) continue;
        const pts = scoreLine(st, scoring, pos);
        const n = (k2) => (st[k2] != null ? Number(st[k2]) : null);
        if (n('off_snp') != null) snaps = true;
        out[row.player_id] = [Math.round((pts || 0) * 10) / 10, n('off_snp'), n('tm_off_snp'), n('rec_tgt'), n('rec'), n('rush_att'), n('pass_att'), Math.round((Number(st.rec_yd || 0) + Number(st.rush_yd || 0)) * 10) / 10, (row.team || (row.player && row.player.team) || '')];
      }
      weeks[w] = out;
    }
    await store.set('dossier:weekly', { season, at: Date.now(), weeks, snaps });
    status.weekly = { ok: true, at: Date.now(), weeks: lastDone, snaps };
  } catch (e) {
    status.weekly = { ok: false, error: e.message };
  }

  // Values from the week each trade happened.
  onStep('Loading values from the week of each trade');
  try {
    const dates = [];
    for (const t of raw.txns || []) if (t.type === 'trade' && t.status === 'complete') dates.push(t.created);
    for (const h of raw.history || []) for (const t of h.trades || []) dates.push(t.created);
    for (const t of (raw.gql && raw.gql.trades) || []) dates.push(t.created);
    const h = await loadHistory([...new Set(dates)], { superflex: fmt.superflex, onStep });
    await store.set('dossier:hist', h);
    status.hist = { ok: true, at: Date.now(), weeks: Object.keys(h.snaps).length };
  } catch (e) {
    status.hist = { ok: false, error: e.message };
  }

  // Rookie draft intelligence: past classes, hit rates, class strength, prospects.
  onStep('Reading past rookie classes');
  try {
    const season = Number(raw.nfl.season);
    const r = await cached(`src:draftintel:${fmt.superflex ? 'sf' : '1qb'}`, 24 * HOUR, () => loadDraftIntel({ season, superflex: fmt.superflex, teams: raw.rosters.length, onStep }), { force });
    await store.set('dossier:draft', r.data);
    status.draft = { ok: true, at: r.at, classes: Object.keys(r.data.classes).length };
  } catch (e) {
    status.draft = { ok: false, error: e.message };
  }
  try {
    const classYear = Number(raw.nfl.season) + 1;
    const r = await cached(`src:fprookies:${classYear}`, 24 * HOUR, () => loadFpRookies(classYear), { force });
    await store.set('draft:fp', r.data);
    status.prospects = { ok: true, at: r.at, n: r.data.players.length, source: r.data.source };
  } catch (e) {
    status.prospects = { ok: false, error: e.message };
  }

  const sidToFp = {};
  for (const [sid, , fpId] of crosswalk) if (fpId) sidToFp[sid] = fpId;
  book.status = status;
  await store.set('dossier:book', book);
  await store.set('dossier:aux', { fpBySid, proj, sidToFp, at: Date.now() });
  return { book, dict, fpBySid, proj, sidToFp, prod, status };
}
