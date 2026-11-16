// Background watcher: new offers to you, new league trades and new trade-block
// listings, each graded with KTC and sent as a Chrome notification.

import { store, notify, normTradeAssets } from './util.js';
import * as sl from './sleeper.js';
import { playerValue, pickValue } from './values.js';
import { ktcVerdict, letterGrade, gainPct } from './ktcmath.js';

const MAX_SEEN = 1500;

function nameOf(dict, sid) {
  const d = dict[sid];
  return d ? d[0] : sid;
}

function pickLabel(pk, names) {
  const r = ['', '1st', '2nd', '3rd', '4th', '5th'][pk.round] || `${pk.round}th`;
  return `${pk.season} ${r} (${names[pk.roster_id] || 'team ' + pk.roster_id})`;
}

// Light refresh of the stored league data: rosters, traded picks, this week's
// transactions and the latest offers. Full history still comes from a full sync.
export async function quickRefresh(raw0, trades = null, blockItems = null) {
  const leagueId = raw0.league.league_id;
  const week = (raw0.nfl && raw0.nfl.week) || 1;
  const [rosters, tradedPicks, txW] = await Promise.all([
    sl.leagueRosters(leagueId), sl.tradedPicks(leagueId), sl.transactions(leagueId, week).catch(() => null),
  ]);
  // Patch whatever is stored now (a full sync may have finished meanwhile).
  const raw = (await store.get('dossier:raw', null)) || raw0;
  if (String(raw.league.league_id) !== String(leagueId)) return raw;
  if (Array.isArray(rosters) && rosters.length) raw.rosters = rosters;
  if (Array.isArray(tradedPicks)) raw.tradedPicks = tradedPicks;
  if (Array.isArray(txW)) {
    const byId = new Map((raw.txns || []).map((t) => [t.transaction_id, t]));
    for (const t of txW) byId.set(t.transaction_id, t);
    raw.txns = [...byId.values()];
  }
  if (Array.isArray(trades) && trades.length && raw.gql) {
    const byId = new Map((raw.gql.trades || []).map((t) => [String(t.transaction_id), t]));
    for (const t of trades) byId.set(String(t.transaction_id), t);
    raw.gql = { ...raw.gql, ok: true, trades: [...byId.values()] };
  }
  if (Array.isArray(blockItems)) raw.block = { ...(raw.block || {}), ok: true, items: blockItems, error: null };
  raw.quickAt = Date.now();
  await store.set('dossier:raw', raw);
  return raw;
}

export async function check() {
  const raw = await store.get('dossier:raw', null);
  const book = await store.get('dossier:book', null);
  if (!raw || !book) return { skipped: 'no dossier yet' };
  const auth = await sl.getAuth();
  if (!auth.token) return { skipped: 'no Sleeper login' };
  // Offers and alerts are about the logged-in owner's team. When the dossier is
  // showing someone else's team (picked in Settings), stay quiet.
  if (String(raw.me.userId) !== String(auth.userId)) return { skipped: 'the dossier is showing a team that is not your Sleeper login' };
  const dict = await sl.playersDict();
  const tiers = (await store.get('dossier:pickTiers', {})) || {};
  const leagueId = raw.league.league_id;
  const myRid = raw.me.rosterId;
  const names = {};
  for (const r of raw.rosters) {
    const u = (raw.users || []).find((x) => x.user_id === r.owner_id);
    names[r.roster_id] = u ? u.display_name : `Team ${r.roster_id}`;
  }

  const seen = (await store.get('alerts:seen', null)) || { trades: [], block: [], init: false };
  const seenT = new Set(seen.trades);
  const seenB = new Set(seen.block);
  const feed = (await store.get('alerts:feed', [])) || [];
  const push = (item) => { feed.unshift({ at: Date.now(), ...item }); };

  const valueOf = (sid) => playerValue(book, sid).v;
  const pickVal = (pk) => pickValue(book, Number(pk.season), pk.round, tiers[`${pk.season}:${pk.roster_id}`] || 'mid');

  // Trades and offers
  let trades = [];
  try {
    trades = await sl.gqlTrades(leagueId, 80);
  } catch (e) {
    return { error: e.message };
  }
  let changed = false;
  for (const t0 of trades) {
    const t = normTradeAssets(t0);
    const id = String(t.transaction_id);
    const key = `${id}:${t.status}`;
    if (seenT.has(key)) continue;
    seenT.add(key);
    if (!seen.init) continue;
    changed = true;
    const rids = t.roster_ids || [];
    const recv = {};
    for (const rid of rids) recv[rid] = { names: [], vals: [] };
    for (const [pid, rid] of Object.entries(t.adds || {})) if (recv[rid]) { recv[rid].names.push(nameOf(dict, pid)); recv[rid].vals.push(valueOf(pid)); }
    for (const pk of t.draft_picks || []) if (recv[pk.owner_id]) { recv[pk.owner_id].names.push(pickLabel(pk, names)); recv[pk.owner_id].vals.push(pickVal(pk)); }
    let verdict = null;
    if (rids.length === 2) {
      const [A, B] = rids;
      const va = recv[A].vals.filter((v) => v > 0), vb = recv[B].vals.filter((v) => v > 0);
      if (va.length || vb.length) {
        const vd = ktcVerdict(va.length ? va : [0], vb.length ? vb : [0], book.ktcTop);
        verdict = { [A]: { grade: letterGrade(vd.total1, vd.total2), gain: gainPct(vd.total1, vd.total2) }, [B]: { grade: letterGrade(vd.total2, vd.total1), gain: gainPct(vd.total2, vd.total1) }, fair: vd.fair };
      }
    }
    const fresh = Date.now() - (t.created || 0) < 2 * 86400e3;
    if (t.status === 'proposed' && rids.includes(myRid)) {
      const other = rids.find((r) => r !== myRid);
      const fromMe = String(t.creator) === String(raw.me.userId);
      if (fromMe) continue;
      const g = verdict && verdict[myRid];
      const msg = `You get ${recv[myRid].names.join(', ') || 'nothing'}. They get ${recv[other].names.join(', ') || 'nothing'}.${g ? ` KTC: ${g.grade} for you (${g.gain >= 0 ? '+' : ''}${Math.round(g.gain * 100)}%).` : ''}`;
      notify(`Offer from ${names[other]}`, msg);
      push({ kind: 'offer', title: `Offer from ${names[other]}`, body: msg });
    } else if (t.status === 'complete' && fresh) {
      const parts = rids.map((r) => `${names[r]} gets ${recv[r].names.join(', ') || 'nothing'}${verdict ? ` (${verdict[r].grade})` : ''}`);
      const msg = parts.join('. ') + '.';
      notify(`Trade: ${rids.map((r) => names[r]).join(' ↔ ')}`, msg);
      push({ kind: 'trade', title: `Trade: ${rids.map((r) => names[r]).join(' ↔ ')}`, body: msg });
    } else if ((t.status === 'rejected' || t.status === 'cancelled') && rids.includes(myRid) && fresh) {
      push({ kind: 'offer', title: `Offer ${t.status} (${rids.filter((r) => r !== myRid).map((r) => names[r]).join(', ')})`, body: `You'd have received ${recv[myRid].names.join(', ') || 'nothing'}.` });
    }
  }

  // Trade block
  let blockNow = null;
  try {
    const lp = await sl.gqlLeaguePlayers(leagueId);
    blockNow = lp.filter((p) => p.settings && p.settings.otb);
    const added = [];
    for (const p of lp) {
      const st = p.settings || {};
      if (!st.otb) continue;
      const key = `${p.player_id}:${st.otb}:${st.otb_added_at || ''}`;
      if (seenB.has(key)) continue;
      seenB.add(key);
      if (!seen.init || st.otb === myRid) continue;
      const label = String(p.player_id).includes(',')
        ? (() => { const [o, y, r] = String(p.player_id).split(',').map(Number); return pickLabel({ season: y, round: r, roster_id: o }, names); })()
        : nameOf(dict, p.player_id);
      added.push({ rid: st.otb, label });
    }
    if (added.length) {
      const byTeam = {};
      for (const a of added) (byTeam[a.rid] ||= []).push(a.label);
      const msg = Object.entries(byTeam).map(([rid, ls]) => `${names[rid]}: ${ls.join(', ')}`).join('. ');
      notify('New on the trade block', msg);
      push({ kind: 'block', title: 'New on the trade block', body: msg });
    }
  } catch { /* block is a nice-to-have */ }

  // Keep rosters, pick ownership and offers current between full syncs, so a
  // trade shows up in the dossier (picks, rookie draft, offers) within minutes.
  if (changed || !raw.quickAt || Date.now() - raw.quickAt > 30 * 60e3) {
    try { await quickRefresh(raw, trades, blockNow); } catch (e) { console.warn('[WV] quick refresh', e); }
  }

  await store.set('alerts:seen', { trades: [...seenT].slice(-MAX_SEEN), block: [...seenB].slice(-MAX_SEEN), init: true });
  await store.set('alerts:feed', feed.slice(0, 100));
  await store.set('alerts:lastCheck', Date.now());
  return { ok: true };
}
