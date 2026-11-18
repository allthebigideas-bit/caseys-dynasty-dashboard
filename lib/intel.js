// The analysis core. Pure: takes the raw league snapshot plus values and
// projections, returns the whole dossier model. No network, no storage.

import { valueOverTime } from './valuetime.js';
import { playerValue, pickValue, tierForSlot } from './values.js';
import { normName, normTradeAssets } from './util.js';
import { makeTreeBuilder } from './trees.js';
import { projectAll, PEAK } from './aging.js';
import { ktcVerdict, letterGrade, gainPct } from './ktcmath.js';
import { starterSlots, bestLineup, buildStartSit } from './startsit.js';

export const CODENAMES = ['KESTREL', 'JACKAL', 'MONGOOSE', 'CONDOR', 'VIPER', 'BADGER', 'HERON', 'LYNX', 'RAVEN', 'COBRA', 'WOLVERINE', 'FALCON', 'MARLIN', 'ORCA', 'BISON', 'OCELOT', 'PUMA', 'STOAT', 'IBIS', 'MAMBA'];
const AGE_CUT = { QB: 28, RB: 25, WR: 26, TE: 27 };
// Trade finder age curve: full value up to the position's peak, a small bonus
// for players younger than that, then a slide to the cliff and a steep fall after.
const AGE_CURVE = { QB: { peak: 27, cliff: 33 }, RB: { peak: 24, cliff: 28 }, WR: { peak: 25, cliff: 30 }, TE: { peak: 26, cliff: 30 } };
export function ageFactor(pos, age, bias = 1) {
  const c = AGE_CURVE[pos];
  if (!c || !age || !bias) return 1;
  let f;
  if (age <= c.peak) f = 1 + Math.min(0.15, (c.peak - age) * 0.04);
  else if (age <= c.cliff) f = 1 - ((age - c.peak) / (c.cliff - c.peak)) * 0.35;
  else f = Math.max(0.4, 0.65 - (age - c.cliff) * 0.08);
  return Math.max(0.25, 1 + (f - 1) * bias);
}
const VALUE_POS = ['QB', 'RB', 'WR', 'TE'];
const DAYMS = 86400e3;
export const POSTURES = {
  'ALL-IN': { tone: 'buy', blurb: 'Pushing chips in to win this year.' },
  CONTENDER: { tone: 'buy', blurb: 'Built to win now.' },
  MIDDLE: { tone: 'mid', blurb: 'Not clearly buying or selling.' },
  REBUILDING: { tone: 'sell', blurb: 'Building for later years.' },
  TANKING: { tone: 'sell', blurb: 'Losing on purpose or checked out — a seller.' },
};

// ---- small helpers ----------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(r) {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
const avg = (a) => (a.length ? sum(a) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function pctRank(values, v) {
  // 0 = worst, 1 = best
  if (values.length < 2) return 0.5;
  const below = values.filter((x) => x < v).length;
  const equal = values.filter((x) => x === v).length - 1;
  return (below + equal / 2) / (values.length - 1);
}
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
export const roundName = (r) => ordinal(Number(r));
const fmtK = (v) => (v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(v)));
const dateStr = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
const dur = (ms) => { if (ms == null) return '—'; const h = ms / 3600e3; return h < 1 ? `${Math.max(1, Math.round(ms / 60e3))} min` : h < 48 ? `${Math.round(h)} hr` : `${Math.round(h / 24)} days`; };
const daysAgo = (ts, now) => Math.max(0, Math.round((now - ts) / DAYMS));

// ---- model ------------------------------------------------------------------------

export function buildModel(raw, ctx) {
  const { book, dict = {}, fpBySid = {}, proj = {}, snaps = {}, valueHistory = {}, prefs = {}, now = Date.now() } = ctx;
  const hist = ctx.hist || { byDate: {}, snaps: {} };
  const sidToFp = ctx.sidToFp || {};
  const managerNotes = ctx.managerNotes || {};
  const prod = ctx.prod || null;
  const L = raw.league;
  const S = L.settings || {};
  const season = Number(L.season);
  const week = Number(raw.nfl.week) || 1;
  const regEnd = (S.playoff_week_start || 15) - 1;
  const slots = starterSlots(L.roster_positions);
  const slotCount = {};
  for (const s of slots) slotCount[s] = (slotCount[s] || 0) + 1;
  const myRid = raw.me.rosterId;
  const notes = [];

  // -- players & values
  const P = (sid) => {
    const d = dict[sid];
    return d ? { id: sid, name: d[0], pos: d[1], team: d[2], age: d[3], inj: d[4] } : { id: sid, name: /^\d+$/.test(sid) ? `Player ${sid}` : sid, pos: /^[A-Z]{2,3}$/.test(sid) ? 'DEF' : '', team: '', age: null, inj: '' };
  };
  const V = (sid) => playerValue(book, sid);
  const asset = (sid) => {
    const p = P(sid);
    const x = V(sid);
    const redraft = x.redraft != null ? x.redraft : VALUE_POS.includes(p.pos) ? Math.round(x.v * 0.7) : 0;
    return { ...p, kind: 'player', v: x.v, ktc: x.ktc, fc: x.fc, redraft, trend30: x.trend30, ktcTrend: x.ktcTrend, src: x.src };
  };

  // Value of an asset in a DynastyProcess snapshot from the week of a trade.
  // DynastyProcess values use a much steeper scale than KTC (a depth WR can be
  // 60 there and 3,000 on KTC), so "then" values are converted to the KTC
  // scale by rank: an asset that ranked Nth in that week's DynastyProcess file
  // gets the value of today's Nth-ranked asset in the book.
  const ktcCurve = (() => {
    const arr = [];
    for (const sid of Object.keys(book.players || {})) { const v = playerValue(book, sid).v; if (v > 0) arr.push(v); }
    for (const kk of Object.keys(book.picks || {})) { const p2 = book.picks[kk]; const v = p2[0] != null ? p2[0] : p2[1] != null ? p2[1] * (book.fcToKtc || 1) : 0; if (v > 0) arr.push(v); }
    return arr.sort((x, y) => y - x);
  })();
  const dpSorted = new Map();
  const toKtc = (dp, v) => {
    if (!v || !ktcCurve.length) return v || 0;
    if (!dpSorted.has(dp)) dpSorted.set(dp, [...Object.values(dp.fp || {}), ...Object.values(dp.pk || {})].filter((x) => x > 0).sort((x, y) => y - x));
    const sd = dpSorted.get(dp);
    let lo = 0, hi = sd.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sd[mid] > v) lo = mid + 1; else hi = mid; }
    // Rank, not percentile: DynastyProcess files range from under 400 to
    // nearly 700 rows week to week, and a percentile mapping moved every
    // value up or down with the file's length.
    let i = Math.min(ktcCurve.length - 1, lo);
    // Ties and values between two ranks: interpolate toward the next rank.
    const above = lo > 0 ? sd[lo - 1] : null;
    const frac = above != null && above > sd[lo] && sd[lo] != null ? Math.max(0, Math.min(1, (above - v) / (above - sd[lo]))) : 0;
    const prev = Math.max(0, i - 1);
    return Math.round(lo > 0 && frac < 1 ? ktcCurve[prev] + (ktcCurve[i] - ktcCurve[prev]) * frac : ktcCurve[i]);
  };
  function dpValue(dp, a) {
    if (!dp) return a.v;
    return toKtc(dp, dpRaw(dp, a));
  }
  function dpRaw(dp, a) {
    if (a.kind === 'pick') {
      if (a.no) {
        const [r, sl] = a.no.split('.');
        const v = dp.slot[`${a.season} pick ${Number(r)}.${String(Number(sl)).padStart(2, '0')}`];
        if (v) return v;
      }
      const v = dp.pk[`${a.season} ${a.round} mid`] ?? dp.pk[`${a.season} ${a.round} any`];
      if (v != null) return v;
      const years = Object.keys(dp.pk).map((k) => Number(k.split(' ')[0])).filter(Boolean);
      if (!years.length) return 0;
      const last = Math.max(...years);
      const base = dp.pk[`${last} ${a.round} mid`] ?? dp.pk[`${last} ${a.round} any`] ?? 0;
      return Number(a.season) > last ? Math.round(base * Math.pow(0.92, Number(a.season) - last)) : base;
    }
    const fp = sidToFp[a.id];
    let v = fp ? dp.fp[fp] : null;
    if (v == null) v = dp.nm[`${normName(a.name)}|${a.pos}`];
    return v || 0;
  }

  // -- teams
  const users = Object.fromEntries((raw.users || []).map((u) => [u.user_id, u]));
  const teams = (raw.rosters || []).map((r) => {
    const u = users[r.owner_id] || {};
    const st = r.settings || {};
    return {
      rid: r.roster_id,
      userId: r.owner_id,
      userIds: [r.owner_id, ...(r.co_owners || [])].filter(Boolean),
      name: u.display_name || `Team ${r.roster_id}`,
      teamName: (u.metadata && u.metadata.team_name) || '',
      avatar: u.avatar || null,
      // Custom team logo uploaded for this league (a full URL), when the manager set one.
      logo: u.metadata && typeof u.metadata.avatar === 'string' && /^https:\/\//.test(u.metadata.avatar) ? u.metadata.avatar : null,
      codename: CODENAMES[(r.roster_id - 1) % CODENAMES.length],
      isMe: r.roster_id === myRid,
      roster: r,
      w: st.wins || 0, l: st.losses || 0, t: st.ties || 0,
      pf: (st.fpts || 0) + (st.fpts_decimal || 0) / 100,
      pa: (st.fpts_against || 0) + (st.fpts_against_decimal || 0) / 100,
      faab: S.waiver_budget != null ? S.waiver_budget - (st.waiver_budget_used || 0) : null,
      note: managerNotes[r.owner_id] || null,
    };
  });
  for (const t of teams) t.avoid = !!(t.note && (t.note.tags || []).includes('avoid'));
  const byRid = Object.fromEntries(teams.map((t) => [t.rid, t]));
  const ridByUser = {};
  for (const t of teams) for (const u of t.userIds) ridByUser[u] = t.rid;
  const me = byRid[myRid];
  if (!me) throw new Error('Your team was not found in this league.');

  for (const t of teams) {
    t.assets = (t.roster.players || []).map(asset).sort((a, b) => b.v - a.v);
    t.value = sum(t.assets.map((a) => a.v));
    t.posValue = Object.fromEntries(VALUE_POS.map((pos) => [pos, sum(t.assets.filter((a) => a.pos === pos).map((a) => a.v))]));
    const aged = t.assets.filter((a) => a.age && a.v > 0);
    t.trueAge = aged.length ? sum(aged.map((a) => a.v * a.age)) / sum(aged.map((a) => a.v)) : null;
    const lineup = bestLineup(slots, t.assets, (a) => a.redraft);
    t.winNowIds = lineup.filter(Boolean);
    t.winNow = sum(t.winNowIds.map((id) => t.assets.find((a) => a.id === id)?.redraft || 0));
    t.youth = sum(t.assets.filter((a) => a.age && AGE_CUT[a.pos] && a.age < AGE_CUT[a.pos]).map((a) => a.v));
    t.games = t.w + t.l + t.t;
    t.winPct = t.games ? (t.w + t.t / 2) / t.games : 0.5;
  }

  // -- weekly results, lineup efficiency, team scoring strength
  const completedWeeks = Object.keys(raw.matchups || {}).map(Number).filter((w) => w < week && w <= regEnd).sort((a, b) => a - b);
  const weekly = {}; // rid -> [{w, pts, opt, empty}]
  for (const w of completedWeeks) {
    for (const m of raw.matchups[w] || []) {
      if (!m || m.points == null) continue;
      const pp = m.players_points || {};
      const pool = (m.players || []).map((id) => ({ id, pos: P(id).pos }));
      const opt = bestLineup(slots, pool, (p) => pp[p.id] || 0);
      const optPts = sum(opt.map((id) => pp[id] || 0));
      const empty = (m.starters || []).filter((s) => !s || s === '0').length + Math.max(0, slots.length - (m.starters || []).length);
      (weekly[m.roster_id] ||= []).push({ w, pts: m.points, opt: optPts, empty, starters: m.starters || [], sp: m.starters_points || [], players: m.players || [], mid: m.matchup_id });
    }
  }
  for (const t of teams) {
    const wk = (weekly[t.rid] || []).filter((x) => x.pts > 0 || x.opt > 0);
    t.weeks = wk;
    t.eff = wk.length ? sum(wk.map((x) => x.pts)) / Math.max(1, sum(wk.map((x) => x.opt))) : null;
    t.benchLeft = sum(wk.map((x) => Math.max(0, x.opt - x.pts)));
    t.emptySlots = sum(wk.map((x) => x.empty));
    t.avgPts = wk.length ? avg(wk.map((x) => x.pts)) : null;
  }
  const effMed = median(teams.map((t) => t.eff).filter((x) => x != null));
  const benchMed = median(teams.map((t) => t.benchLeft));

  // -- best lineup each team can field right now, from healthy players' points per game
  // (this season, falling back to the season projection). This is what the season
  // projection uses, so trades, injuries and lineup mistakes don't skew it.
  const OUTSTAT = /^(Out|IR|PUP|Sus|Suspended|NA)$/i;
  const ppgOf = (sid) => {
    const c = prod && prod.cur && prod.cur[sid];
    if (c && c[0] >= 2) return c[1] / c[0];
    const pj = prod && prod.proj && prod.proj[sid];
    return pj && pj[0] ? pj[1] / pj[0] : 0;
  };
  for (const t of teams) {
    const pool = (t.roster.players || []).filter((sid) => !OUTSTAT.test(P(sid).inj || '')).map((sid) => ({ id: sid, pos: P(sid).pos }));
    const ids = bestLineup(slots, pool, (pl) => ppgOf(pl.id)).filter(Boolean);
    t.bestNow = sum(ids.map(ppgOf));
    t.bestNowIds = ids;
    t.optAvg = t.weeks.length ? avg(t.weeks.map((x) => x.opt)) : null;
  }

  // -- playoff odds by simulation
  const sim = simulate(teams, raw, { week, regEnd, playoffTeams: S.playoff_teams || 6, byes: (S.playoff_teams || 6) === 6 ? 2 : 0 });
  for (const t of teams) Object.assign(t, sim[t.rid]);
  // Results, points against and all-play record (vs every team, every week)
  {
    const byWeek = {};
    for (const t of teams) for (const x of t.weeks || []) (byWeek[x.w] ||= []).push({ rid: t.rid, pts: x.pts, mid: x.mid });
    for (const t of teams) {
      t.results = [];
      t.pa = 0;
      t.allPlay = { w: 0, l: 0, t: 0 };
      for (const x of t.weeks || []) {
        const wk = byWeek[x.w] || [];
        const opp = wk.find((y) => y.mid === x.mid && y.rid !== t.rid);
        if (opp) { t.pa += opp.pts; t.results.push({ w: x.w, res: x.pts > opp.pts ? 'W' : x.pts < opp.pts ? 'L' : 'T', pts: x.pts, opp: opp.pts, oppRid: opp.rid }); }
        for (const y of wk) if (y.rid !== t.rid) { if (x.pts > y.pts) t.allPlay.w++; else if (x.pts < y.pts) t.allPlay.l++; else t.allPlay.t++; }
      }
      // Remaining opponents and how strong they are (best-lineup strength)
      t.remaining = [];
      for (let w = week; w <= regEnd; w++) {
        const ms = (raw.matchups && raw.matchups[w]) || [];
        const mine = ms.find((m2) => m2.roster_id === t.rid);
        const o = mine && ms.find((m2) => m2.matchup_id === mine.matchup_id && m2.roster_id !== t.rid);
        if (o) t.remaining.push({ w, rid: o.roster_id });
      }
    }
    const strengths = teams.map((t) => t.strength).sort((a, b) => b - a);
    for (const t of teams) {
      const opp = t.remaining.map((r) => (byRid[r.rid] ? byRid[r.rid].strength : null)).filter((x) => x != null);
      t.sos = opp.length ? avg(opp) : null;
    }
    const sosSorted = teams.map((t) => t.sos).filter((x) => x != null).sort((a, b) => b - a);
    for (const t of teams) t.sosRank = t.sos != null ? sosSorted.indexOf(t.sos) + 1 : null; // 1 = hardest
    for (const t of teams) t.strengthRank = strengths.indexOf(t.strength) + 1;
  }
  // Max PF ("potential points"): best possible lineup each week, so far plus
  // projected for the rest of the regular season at the team's own weekly pace.
  const remainingWeeks = Math.max(0, regEnd - week + 1);
  for (const t of teams) {
    const rs = t.roster.settings || {};
    const fromSleeper = rs.ppts != null ? Number(rs.ppts) + Number(rs.ppts_decimal || 0) / 100 : null;
    const fromWeeks = sum((t.weeks || []).map((x) => x.opt));
    t.maxPf = fromSleeper || fromWeeks || 0;
    const perWeek = t.weeks && t.weeks.length ? fromWeeks / t.weeks.length : t.maxPf / Math.max(1, week - 1);
    t.maxPfProj = t.maxPf + perWeek * remainingWeeks;
  }
  const orderMethod = prefs.draftOrder || 'standings';
  const playoffN = S.playoff_teams || 6;
  const byFinish = [...teams].sort((a, b) => b.expRank - a.expRank || a.expWins - b.expWins); // worst first
  let draftOrder = byFinish;
  if (orderMethod === 'maxpf_all') draftOrder = [...teams].sort((a, b) => a.maxPfProj - b.maxPfProj);
  else if (orderMethod === 'maxpf') {
    const out = byFinish.slice(0, teams.length - playoffN).sort((a, b) => a.maxPfProj - b.maxPfProj);
    draftOrder = [...out, ...byFinish.slice(teams.length - playoffN)];
  }
  const projSlot = Object.fromEntries(draftOrder.map((t, i) => [t.rid, i + 1]));

  // -- draft picks ledger
  const rounds = S.draft_rounds || 4;
  const traded = (raw.tradedPicks || []).filter((p) => Number(p.season) > season);
  const pickSeasons = [...new Set([season + 1, season + 2, ...traded.map((p) => Number(p.season))])].sort();
  // Seasons Sleeper won't let you trade yet (e.g. until next year's dues are paid).
  // Your choice in Settings wins; otherwise next year's draft is open, later ones
  // are open only if Sleeper already shows a trade involving them.
  const tradedSeasons = new Set(traded.map((p) => Number(p.season)));
  const locks = prefs.pickLocks || {};
  const lockedSeasons = pickSeasons.filter((y) => (locks[y] != null ? !!locks[y] : y > season + 1 && !tradedSeasons.has(y)));
  const isLocked = (y) => lockedSeasons.includes(Number(y));
  const picks = [];
  for (const y of pickSeasons) {
    for (let r = 1; r <= rounds; r++) {
      for (const t of teams) {
        const tp = traded.find((p) => Number(p.season) === y && p.round === r && p.roster_id === t.rid);
        const owner = tp ? tp.owner_id : t.rid;
        const slot = y === season + 1 ? projSlot[t.rid] : null;
        const tier = slot ? tierForSlot(slot, teams.length) : 'mid';
        picks.push({ kind: 'pick', season: y, round: r, orig: t.rid, owner, slot, tier, v: pickValue(book, y, r, tier), traded: !!tp && owner !== t.rid, locked: isLocked(y) });
      }
    }
  }
  const pickLabel = (p) => `${p.season} ${roundName(p.round)}${p.slot ? ` (proj. ${p.round}.${String(p.slot).padStart(2, '0')})` : ''}${p.orig !== p.owner ? ` via ${byRid[p.orig] ? byRid[p.orig].name : 'team ' + p.orig}` : ''}`;
  for (const p of picks) p.label = pickLabel(p);
  for (const t of teams) {
    t.picks = picks.filter((p) => p.owner === t.rid);
    t.tradePicks = t.picks.filter((p) => !p.locked);
    t.pickValue = sum(t.picks.map((p) => p.v));
    t.future = t.youth + t.pickValue;
    t.totalValue = t.value + t.pickValue;
  }

  // -- trades: normalise, value, grade
  // Which completed draft is the "Y" rookie draft: the one labelled Y, or a
  // draft held in calendar year Y under the previous season's league.
  const allDrafts = (raw.drafts || []).filter((d) => d.picks && d.picks.length);
  const draftForYear = (y) => {
    const exact = allDrafts.filter((d) => Number(d.season) === y && d.type !== 'startup');
    if (exact.length) return exact.sort((a, b) => (a.picks.length) - (b.picks.length))[0];
    return allDrafts.find((d) => d.startTime && new Date(d.startTime).getUTCFullYear() === y && Number(d.season) === y - 1) || null;
  };
  const resolvePick = (pk) => {
    const d = draftForYear(Number(pk.season));
    if (!d) return null;
    const orig = Number(pk.roster_id);
    let slot = Object.keys(d.slotToRoster || {}).find((s2) => Number(d.slotToRoster[s2]) === orig);
    if (!slot && d.draftOrder) {
      // Fall back to the draft order by user: the original team's owner(s).
      const t = byRid[orig];
      const uids = t ? t.userIds.map(String) : [];
      const u = Object.keys(d.draftOrder).find((uid) => uids.includes(String(uid)));
      if (u) slot = d.draftOrder[u];
    }
    if (!slot) return null;
    const hit = d.picks.find((x) => Number(x.round) === Number(pk.round) && Number(x.draft_slot) === Number(slot));
    return hit && hit.player_id ? { sid: hit.player_id, no: `${hit.round}.${String(hit.draft_slot).padStart(2, '0')}` } : null;
  };
  const tradePickAsset = (pk, nameOf) => {
    const y = Number(pk.season);
    const base = { kind: 'pick', season: y, round: pk.round, orig: pk.roster_id, key: `k:${y}:${pk.round}:${pk.roster_id}` };
    const origName = nameOf(pk.roster_id);
    if (y <= season) {
      const res = resolvePick(pk);
      if (res) {
        const a = asset(res.sid);
        return { ...base, v: a.v, redraft: a.redraft, label: `${y} ${res.no} (${origName})`, became: res.sid, becameName: a.name, no: res.no };
      }
      return { ...base, v: 0, redraft: 0, label: `${y} ${roundName(pk.round)} (${origName}) — used`, unknown: true };
    }
    const live = picks.find((p) => p.season === y && p.round === pk.round && p.orig === pk.roster_id);
    const tier = live ? live.tier : 'mid';
    return { ...base, v: pickValue(book, y, pk.round, tier), redraft: 0, label: `${y} ${roundName(pk.round)} (${origName}${live && live.slot ? `, proj. ${pk.round}.${String(live.slot).padStart(2, '0')}` : ''})` };
  };

  const pickHolder = (y, r, orig) => { const live = picks.find((p) => p.season === Number(y) && p.round === Number(r) && p.orig === Number(orig)); return live ? live.owner : Number(orig); };
  function normTrade(tx0, seasonOf, nameOf, src) {
    const tx = normTradeAssets(tx0, src === 'history' ? null : pickHolder);
    const sides = {};
    for (const rid of tx.roster_ids || []) sides[rid] = { rid, inP: [], outP: [], inK: [], outK: [], faabIn: 0, faabOut: 0, released: [] };
    const adds = tx.adds || {}, drops = tx.drops || {};
    for (const [pid, rid] of Object.entries(adds)) if (sides[rid]) sides[rid].inP.push(pid);
    for (const [pid, rid] of Object.entries(drops)) if (sides[rid]) (pid in adds ? sides[rid].outP : sides[rid].released).push(pid);
    for (const pk of tx.draft_picks || []) {
      const a = tradePickAsset(pk, nameOf);
      if (sides[pk.owner_id]) sides[pk.owner_id].inK.push(a);
      if (sides[pk.previous_owner_id]) sides[pk.previous_owner_id].outK.push(a);
    }
    for (const wb of tx.waiver_budget || []) {
      if (sides[wb.receiver]) sides[wb.receiver].faabIn += wb.amount;
      if (sides[wb.sender]) sides[wb.sender].faabOut += wb.amount;
    }
    const answered = tx.status !== 'proposed' && tx.status_updated && tx.status_updated > tx.created ? Number(tx.status_updated) : null;
    return { answeredAt: answered, openMs: answered ? answered - tx.created : tx.status === 'proposed' ? now - tx.created : null, unparsedPicks: tx.unparsedPicks || [], id: String(tx.transaction_id), created: tx.created, status: tx.status, leg: tx.leg, season: seasonOf, creator: tx.creator, rids: tx.roster_ids || [], sides, src, consenters: tx.consenter_ids || [] };
  }

  const snapUpdates = {};
  function gradeTrade(nt, current = true) {
    const rids = nt.rids;
    const recv = {};
    for (const rid of rids) {
      const s = nt.sides[rid];
      recv[rid] = [...s.inP.map((sid) => ({ ...asset(sid), key: `p:${sid}` })), ...s.inK];
    }
    const snap = snaps[nt.id];
    const dp = !snap && hist.byDate && hist.byDate[nt.created] ? hist.snaps[hist.byDate[nt.created]] : null;
    const valueOf = (a, useSnap) => {
      if (!useSnap) return a.v;
      if (snap) return snap.vals && snap.vals[a.key] != null ? snap.vals[a.key] : a.v;
      return dpValue(dp, a);
    };
    const topFor = () => book.ktcTop; // "then" values are already on the KTC scale
    const grade = (useSnap) => {
      const out = {};
      if (rids.length === 2) {
        const [A, B] = rids;
        const va = recv[A].map((a) => valueOf(a, useSnap)).filter((x) => x > 0);
        const vb = recv[B].map((a) => valueOf(a, useSnap)).filter((x) => x > 0);
        if (!va.length && !vb.length) return null;
        const vd = ktcVerdict(va.length ? va : [0], vb.length ? vb : [0], topFor(useSnap));
        out[A] = { got: vd.total1, gave: vd.total2, raw: vd.raw1, adj: vd.adj1, grade: letterGrade(vd.total1, vd.total2), gain: gainPct(vd.total1, vd.total2) };
        out[B] = { got: vd.total2, gave: vd.total1, raw: vd.raw2, adj: vd.adj2, grade: letterGrade(vd.total2, vd.total1), gain: gainPct(vd.total2, vd.total1) };
        out.fair = vd.fair;
      } else {
        for (const rid of rids) {
          const got = sum(recv[rid].map((a) => valueOf(a, useSnap)));
          const s = nt.sides[rid];
          const gave = sum([...s.outP.map((sid) => V(sid).v), ...s.outK.map((k) => k.v)]);
          out[rid] = { got, gave, raw: got, adj: 0, grade: letterGrade(got, gave), gain: gainPct(got, gave) };
        }
        out.fair = rids.every((r) => Math.abs(out[r].gain) < 0.05);
      }
      return out;
    };
    nt.recv = recv;
    nt.now = grade(false);
    if (snap) { nt.then = grade(true); nt.thenAt = snap.at; nt.thenSrc = 'KeepTradeCut, the day we first saw it'; }
    else if (current && nt.created && now - nt.created < 10 * DAYMS) {
      // Recent trade: KTC values today are the values at the time. (Weekly DynastyProcess
      // rankings converted by rank would differ from KTC for reasons that aren't time.)
      nt.then = nt.now; nt.thenAt = now; nt.thenSrc = 'KeepTradeCut (the trade is less than 10 days old)';
    }
    else if (dp) { nt.then = grade(true); nt.thenSrc = 'DynastyProcess rankings from that week, converted to the KTC scale'; }
    if (nt.then) {
      nt.thenVals = {};
      for (const rid of rids) for (const a of recv[rid]) nt.thenVals[a.key] = Math.round(valueOf(a, true));
    }
    if (!snap && current && nt.created && now - nt.created < 3 * DAYMS) {
      // First time we see a recent trade: remember today's values for "then vs now".
      const vals = {};
      for (const rid of rids) for (const a of recv[rid]) vals[a.key] = a.v;
      snapUpdates[nt.id] = { at: now, vals };
    }
    const winnerOf = (g) => {
      if (!g) return null;
      const ranked = rids.map((r) => [r, g[r].gain]).sort((a, b) => b[1] - a[1]);
      return g.fair ? null : ranked[0][0];
    };
    nt.winner = winnerOf(nt.now);
    nt.winnerThen = nt.then ? winnerOf(nt.then) : undefined;
    // The grade that judges the deal itself is the one from when it was made.
    nt.deal = nt.then || nt.now;
    return nt;
  }

  const nameNow = (rid) => (byRid[rid] ? byRid[rid].name : `team ${rid}`);
  // Completed trades: Sleeper's public transaction list, plus any completed
  // trade the logged-in view knows about that the public list missed (offseason
  // trades or a week that failed to load).
  const restDone = (raw.txns || []).filter((t) => t.type === 'trade' && t.status === 'complete');
  const restIds = new Set(restDone.map((t) => String(t.transaction_id)));
  const gqlDone = ((raw.gql && raw.gql.trades) || []).filter((t) => t.status === 'complete' && !restIds.has(String(t.transaction_id)));
  const leagueTrades = [...restDone, ...gqlDone].map((t) => gradeTrade(normTrade(t, season, nameNow, 'league')));
  // Earlier seasons, mapped to today's managers through user ids.
  const histTrades = [];
  const mapByH = new Map();
  for (const h of raw.history || []) {
    const hUsers = Object.fromEntries((h.rosters || []).map((r) => [r.roster_id, r.owner_id]));
    const ridMap = (rid) => ridByUser[hUsers[rid]] || null;
    const nameOf = (rid) => { const cur = ridMap(rid); return cur ? nameNow(cur) : (h.userNames && h.userNames[hUsers[rid]]) || `team ${rid}`; };
    // Remap that season's roster ids onto today's managers (unknown ones get 1000+id).
    const mapR = (rid) => (rid == null ? rid : ridMap(rid) || 1000 + Number(rid));
    const names = {};
    for (const r of Object.keys(hUsers)) names[mapR(r)] = nameOf(r);
    const nameMapped = (r) => names[r] || nameNow(r);
    const remapObj = (o) => Object.fromEntries(Object.entries(o || {}).map(([pid, rid]) => [pid, mapR(rid)]));
    for (const t of h.trades || []) {
      const tx = {
        ...t,
        roster_ids: (t.roster_ids || []).map(mapR),
        adds: remapObj(t.adds), drops: remapObj(t.drops),
        draft_picks: (t.draft_picks || []).map((pk) => ({ ...pk, roster_id: mapR(pk.roster_id), owner_id: mapR(pk.owner_id), previous_owner_id: mapR(pk.previous_owner_id) })),
        waiver_budget: (t.waiver_budget || []).map((w) => ({ ...w, sender: mapR(w.sender), receiver: mapR(w.receiver) })),
      };
      const nt = gradeTrade(normTrade(tx, Number(h.season), nameMapped, 'history'), false);
      nt.nameOf = Object.fromEntries(nt.rids.map((r) => [r, nameMapped(r)]));
      histTrades.push(nt);
    }
    mapByH.set(h, mapR);
  }

  // The same trade can come back twice: once from this season's list and once
  // from last season's league (offseason trades), or as identical copies.
  {
    const sig = (nt) => `${[...nt.rids].sort().join('-')}|${nt.rids.map((r) => `${r}:${[...nt.sides[r].inP].sort().join(',')}:${nt.sides[r].inK.map((k2) => k2.key).sort().join(',')}`).sort().join('|')}`;
    const seenIds = new Set(leagueTrades.map((nt) => nt.id));
    const seenSig = leagueTrades.map((nt) => ({ s: sig(nt), at: nt.created }));
    const keep = [];
    for (const nt of histTrades) {
      if (seenIds.has(nt.id)) continue;
      const g = sig(nt);
      if (seenSig.some((x) => x.s === g && Math.abs(x.at - nt.created) < 3 * DAYMS)) continue;
      seenIds.add(nt.id);
      seenSig.push({ s: g, at: nt.created });
      keep.push(nt);
    }
    histTrades.length = 0;
    histTrades.push(...keep);
  }

  // Non-trade roster moves (commissioner edits, waivers, free agents), for
  // explaining gaps in a player's trade history.
  const playerMoves = {};
  const addMoves = (txns, mapR = (x) => x) => {
    for (const t of txns || []) {
      if (t.type === 'trade' || (t.status && t.status !== 'complete')) continue;
      for (const [pid, rid] of Object.entries(t.adds || {})) (playerMoves[pid] ||= []).push({ to: mapR(rid), from: t.drops && t.drops[pid] != null ? mapR(t.drops[pid]) : null, type: t.type, at: t.created });
      for (const [pid, rid] of Object.entries(t.drops || {})) if (!(t.adds || {})[pid]) (playerMoves[pid] ||= []).push({ to: null, from: mapR(rid), type: t.type, at: t.created });
    }
  };
  addMoves(raw.txns);
  for (const h of raw.history || []) addMoves(h.moves, mapByH.get(h) || ((x) => x));

  // -- trade trees: what each side's haul turned into
  const releases = [];
  const addReleases = (txns) => {
    for (const t of txns || []) {
      if (t.type === 'trade' || t.status !== 'complete') continue;
      const adds = t.adds || {};
      for (const [pid, rid] of Object.entries(t.drops || {})) if (!(pid in adds) || adds[pid] !== rid) releases.push({ rid, sid: pid, at: t.created });
    }
  };
  addReleases(raw.txns);
  for (const h of raw.history || []) addReleases((h.moves || []).map((t) => ({ ...t, status: t.status || 'complete', drops: Object.fromEntries(Object.entries(t.drops || {}).map(([pid, rid]) => [pid, (mapByH.get(h) || ((x) => x))(rid)])), adds: Object.fromEntries(Object.entries(t.adds || {}).map(([pid, rid]) => [pid, (mapByH.get(h) || ((x) => x))(rid)])) })));
  const allTrades = [...leagueTrades, ...histTrades].sort((a, b) => a.created - b.created);

  // Every starting-lineup slot we have, across this season and the synced earlier ones.
  const lineups = []; // {season, w, rid, starters, sp}
  for (const [rid, wks] of Object.entries(weekly)) for (const wk of wks) lineups.push({ season, w: wk.w, rid: Number(rid), starters: wk.starters, sp: wk.sp });
  for (const h of raw.history || []) {
    const mapR = mapByH.get(h) || ((x) => x);
    for (const [w, ms] of Object.entries(h.matchups || {})) for (const m0 of ms || []) lineups.push({ season: Number(h.season), w: Number(w), rid: mapR(m0.roster_id), starters: m0.starters || [], sp: m0.starters_points || [] });
  }
  const startsBy = {}; // sid -> [{season, w, rid, pts}]
  for (const l of lineups) l.starters.forEach((sid, i) => { if (sid && sid !== '0') (startsBy[sid] ||= []).push({ season: l.season, w: l.w, rid: l.rid, pts: Number(l.sp[i]) || 0 }); });
  // A timestamp as a comparable (season, week) number: season*100 + week. Week 1 opens the
  // Tuesday after Labor Day; anything before that (offseason, Jan-Aug) is week 0 of that year's season.
  const nflWeekKey = (ts) => {
    if (!Number.isFinite(ts)) return Infinity;
    const y = new Date(ts).getUTCFullYear();
    const sep1 = new Date(Date.UTC(y, 8, 1)).getUTCDay();
    const open = Date.UTC(y, 8, 1 + ((8 - sep1) % 7)) + 1.5 * DAYMS; // Tuesday noon UTC after Labor Day
    if (ts < open) return y * 100;
    return y * 100 + Math.min(99, Math.floor((ts - open) / (7 * DAYMS)) + 1);
  };
  // Starting-lineup points a player scored for this team between two dates (start week counts, end week doesn't).
  const ptsHeld = (rid, sid, fromTs, toTs) => {
    const a = nflWeekKey(fromTs), b = nflWeekKey(toTs);
    let pts = 0, starts = 0;
    for (const x of startsBy[sid] || []) {
      const key = x.season * 100 + x.w;
      if (x.rid === rid && key >= a && key < b) { pts += x.pts; starts++; }
    }
    return { pts: Math.round(pts * 10) / 10, starts };
  };

  const treeTrades = allTrades.map((nt) => ({ id: nt.id, created: nt.created, rids: nt.rids, sides: nt.sides }));
  const fullById = Object.fromEntries(allTrades.map((nt) => [nt.id, nt]));
  const treeFor = makeTreeBuilder(treeTrades, {
    rosterOf: (rid) => (byRid[rid] ? byRid[rid].roster.players || [] : []),
    releases,
    playerNow: (sid) => V(sid).v,
    pickNow: (y, r, orig) => { const live = picks.find((p) => p.season === Number(y) && p.round === Number(r) && p.orig === Number(orig)); return live ? live.v : pickValue(book, Number(y), Number(r), 'mid'); },
    season,
    draftDate: (y) => Date.UTC(Number(y), 3, 1),
    ptsHeld,
    // Values on the day of a later trade (DynastyProcess that week, or KTC for recent trades),
    // used to split that deal's return between the tree's assets and anything else sent with them.
    shareOf: (t, rid, items) => {
      const nt = fullById[t.id];
      const side = t.sides[rid];
      const keyOf = (x) => (x.kind === 'pick' || x.round != null ? `k:${Number(x.season)}:${Number(x.round)}:${Number(x.orig)}` : `p:${x.sid || x}`);
      const vNow = (key) => {
        if (key.startsWith('p:')) return V(key.slice(2)).v || 0;
        const [, y, r, o] = key.split(':');
        const live = picks.find((p) => p.season === Number(y) && p.round === Number(r) && p.orig === Number(o));
        return live ? live.v : pickValue(book, Number(y), Number(r), 'mid');
      };
      const thenV = nt && nt.thenVals ? nt.thenVals : null;
      const val = (key) => (thenV && thenV[key] != null ? thenV[key] : vNow(key));
      const allKeys = [...side.outP.map((sid) => `p:${sid}`), ...side.outK.map((k) => keyOf({ kind: 'pick', ...k }))];
      const treeKeys = items.map(keyOf);
      const tv = treeKeys.reduce((a, key) => a + val(key), 0);
      const av = allKeys.reduce((a, key) => a + val(key), 0);
      const share = av > 0 ? Math.min(1, tv / av) : (allKeys.length ? treeKeys.length / allKeys.length : 1);
      const tset = new Set(treeKeys);
      const parts = {
        tree: treeKeys.map((key) => ({ key, v: Math.round(val(key)) })),
        extra: allKeys.filter((key) => !tset.has(key)).map((key) => ({ key, v: Math.round(val(key)) })),
      };
      return { share, tree: Math.round(tv), all: Math.round(av), parts, src: thenV ? (nt.thenSrc || 'values at the time') : "today's values (no history for that week)" };
    },
  });
  const tradeById = Object.fromEntries(treeTrades.map((t) => [t.id, t]));
  // Every asset a side's tree holds today, each at the tree's credited share (value × shares on its path).
  const creditedList = (nodes, f = 1, out = []) => {
    for (const n of nodes || []) {
      if (n.status === 'traded' || n.kind === 'package') creditedList(n.children, f * (n.share != null ? n.share : 1), out);
      else if (n.status === 'drafted') creditedList(n.children, f, out);
      else if ((n.total || 0) > 0) out.push(n.total * f);
    }
    return out;
  };
  for (const nt of allTrades) {
    nt.tree = {};
    for (const rid of nt.rids) nt.tree[rid] = treeFor(tradeById[nt.id], rid);
    // Value today on the same footing as the grade at the trade. Two-team trades are graded with
    // KTC's calculator (raw sum + package adjustment for the side with fewer, better pieces), so
    // today's trees go through the same calculator; a raw sum would overrate the side with more pieces.
    for (const rid of nt.rids) { const t = nt.tree[rid]; t.raw = t.total; t.adj = 0; }
    if (nt.rids.length === 2) {
      const [A, B] = nt.rids;
      const la = creditedList(nt.tree[A].nodes), lb = creditedList(nt.tree[B].nodes);
      if (la.length && lb.length) {
        const vd = ktcVerdict(la, lb, book.ktcTop);
        nt.tree[A].adj = vd.adj1;
        nt.tree[B].adj = vd.adj2;
      }
      for (const rid of nt.rids) nt.tree[rid].total = nt.tree[rid].raw + nt.tree[rid].adj;
    }
    const totals = nt.rids.map((r) => [r, nt.tree[r].total]);
    const sumT = sum(totals.map((x) => x[1]));
    nt.treeEdge = Object.fromEntries(totals.map(([r, v]) => [r, sumT ? (v - (sumT - v) / Math.max(1, nt.rids.length - 1)) / sumT : 0]));
  }

  // Starter points from traded players, across every season we have lineups for.
  // For each side: points its new players scored in its starting lineup after
  // the trade (gained) and points the players it sent away scored in their new
  // team's starting lineup (lost). Picks count once used: the drafted player's
  // starts for the team that made the pick.
  // (lineups / startsBy are built above the trade trees, which use them too)
  const after = (x, y, w) => x.season > y || (x.season === y && x.w >= (w || 0));
  const ptsFor = (sid, rid, y, w) => (startsBy[sid] || []).filter((x) => x.rid === rid && after(x, y, w)).reduce((t, x) => t + x.pts, 0);
  const lineupSeasons = [...new Set(lineups.map((l) => l.season))];
  for (const nt of [...leagueTrades, ...histTrades]) {
    const y = nt.season || season;
    nt.pts = {};
    for (const rid of nt.rids) {
      const sd = nt.sides[rid];
      let gained = 0;
      for (const sid of sd.inP) gained += ptsFor(sid, rid, y, nt.leg);
      for (const k2 of sd.inK) if (k2.became) gained += ptsFor(k2.became, rid, Number(k2.season), 1);
      let lost = 0;
      for (const sid of sd.outP) { const to = nt.rids.find((r) => r !== rid && nt.sides[r].inP.includes(sid)); if (to != null) lost += ptsFor(sid, to, y, nt.leg); }
      for (const k2 of sd.outK) { const to = nt.rids.find((r) => r !== rid && nt.sides[r].inK.some((x) => x.key === k2.key)); if (to != null && k2.became) lost += ptsFor(k2.became, to, Number(k2.season), 1); }
      nt.pts[rid] = { gained: Math.round(gained * 10) / 10, lost: Math.round(lost * 10) / 10, net: Math.round((gained - lost) * 10) / 10 };
    }
    nt.ptsSince = Object.fromEntries(nt.rids.map((r) => [r, nt.pts[r].gained]));
    nt.ptsCovered = lineupSeasons.filter((x) => x >= y).sort();
  }
  leagueTrades.sort((a, b) => b.created - a.created);

  // -- offers that involved you (pending, rejected, cancelled, done)
  const gqlTrades = (raw.gql && raw.gql.trades) || [];
  const offers = gqlTrades
    .filter((t) => (t.roster_ids || []).includes(myRid) && t.status !== 'complete')
    .map((t) => {
      const nt = gradeTrade(normTrade(t, season, nameNow, 'offer'), true);
      nt.other = nt.rids.find((r) => r !== myRid);
      nt.fromMe = me.userIds.includes(String(nt.creator)) || String(nt.creator) === String(raw.me.userId);
      return nt;
    })
    .sort((a, b) => b.created - a.created);
  const pending = offers.filter((o) => o.status === 'proposed');

  // What each manager has asked you for, offered you, and turned down.
  for (const t of teams) { t.asked = {}; t.offeredUp = {}; t.refused = {}; t.offerCount = 0; }
  for (const o of offers) {
    const t = byRid[o.other];
    if (!t) continue;
    t.offerCount++;
    const theirs = o.sides[t.rid], mine = o.sides[myRid];
    if (!o.fromMe) {
      for (const sid of theirs.inP) (t.asked[sid] ||= []).push({ at: o.created, status: o.status, id: o.id });
      for (const sid of mine.inP) (t.offeredUp[sid] ||= []).push({ at: o.created, status: o.status });
    } else if (o.status === 'rejected') {
      for (const sid of mine.inP) (t.refused[sid] ||= []).push({ at: o.created });
    }
  }
  // Completed trades with you count as "asked" evidence too.
  for (const nt of leagueTrades) {
    if (!nt.rids.includes(myRid)) continue;
    const other = nt.rids.find((r) => r !== myRid);
    const t = byRid[other];
    if (!t) continue;
    for (const sid of nt.sides[other].inP) (t.asked[sid] ||= []).push({ at: nt.created, status: 'complete', id: nt.id });
  }

  // -- how each manager deals with you: offers, rejections, hindsight
  const byMeCreated = (t) => me.userIds.includes(String(t.creator)) || String(t.creator) === String(raw.me.userId);
  for (const t of teams) {
    t.dealings = null;
    if (t.rid === myRid) continue;
    const mineWith = offers.filter((o) => o.other === t.rid && o.rids.length === 2);
    const done = gqlTrades.filter((x) => x.status === 'complete' && (x.roster_ids || []).length === 2 && x.roster_ids.includes(myRid) && x.roster_ids.includes(t.rid));
    const doneMine = done.filter(byMeCreated).length;
    const sent = mineWith.filter((o) => o.fromMe), recv = mineWith.filter((o) => !o.fromMe);
    const g = (o, rid, when = 'deal') => (o[when] && o[when][rid] ? o[when][rid].gain : null);
    const ask = (o, rid, when = 'deal') => (o[when] && o[when][rid] && o[when][rid].gave > 0 ? o[when][rid].got / o[when][rid].gave - 1 : null);
    for (const o of mineWith) {
      o.rejectedBy = o.status === 'rejected' ? (o.fromMe ? 'them' : 'me') : null;
      o.withdrawnBy = o.status === 'cancelled' ? (o.fromMe ? 'me' : 'them') : null;
      o.myThen = g(o, myRid);
      o.myNow = g(o, myRid, 'now');
      if (o.rejectedBy || o.withdrawnBy) {
        const n = o.myNow;
        if (n == null) o.hindsight = null;
        else if (o.fromMe) {
          const why = o.rejectedBy ? ['His rejection cost you.', 'The rejection saved you.'] : ['Pulling it cost you.', 'Good thing you pulled it.'];
          o.hindsight = n > 0.05 ? { tone: 'warn', text: `Today this deal would be ${Math.round(n * 100)}% in your favour. ${why[0]}` } : n < -0.05 ? { tone: 'good', text: `Today you'd be ${Math.round(-n * 100)}% behind on it. ${why[1]}` } : { tone: 'mid', text: 'Still roughly even today.' };
        }
        else o.hindsight = n > 0.05 ? { tone: 'warn', text: `You'd be ${Math.round(n * 100)}% ahead on it today. Worth revisiting.` } : n < -0.05 ? { tone: 'good', text: `Good call: it would be ${Math.round(-n * 100)}% against you today.` } : { tone: 'mid', text: 'Still roughly even today.' };
      }
    }
    const hisRejects = sent.filter((o) => o.rejectedBy === 'them');
    const myRejects = recv.filter((o) => o.rejectedBy === 'me');
    // His ask: in offers HE sent you, how much more value he'd receive than give.
    // Offers he withdrew within an hour (usually mistakes) are left out.
    const askOffers = recv.filter((o) => ask(o, t.rid) != null && !(o.withdrawnBy === 'them' && o.openMs != null && o.openMs < 3600e3));
    const asks = askOffers.map((o) => ask(o, t.rid));
    for (const o of recv) { o.hisAsk = ask(o, t.rid); o.hisAskNow = ask(o, t.rid, 'now'); }
    const avgAsk = asks.length ? avg(asks) : null;
    const fairTurnedDown = hisRejects.filter((o) => (g(o, t.rid) ?? -1) >= -0.05);
    const sentTotal = sent.length + doneMine;
    const acceptRate = sentTotal ? doneMine / sentTotal : null;
    const touches = mineWith.length + done.length;
    const insights = [];
    let ease = 50;
    if (sentTotal) {
      insights.push({ dir: acceptRate >= 0.4 ? 'good' : acceptRate === 0 && sentTotal >= 2 ? 'sell' : 'mid', text: `Accepted ${doneMine} of ${sentTotal} offer${sentTotal === 1 ? '' : 's'} you sent.` });
      ease += (acceptRate - 0.3) * 60;
    }
    if (fairTurnedDown.length) {
      insights.push({ dir: 'sell', text: `Turned down ${fairTurnedDown.length} offer${fairTurnedDown.length === 1 ? '' : 's'} that were fair or better for him at the time. Value alone won't move him.` });
      ease -= 10 * fairTurnedDown.length;
    }
    if (avgAsk != null) {
      if (avgAsk >= 0.12) { insights.push({ dir: 'sell', text: `His offers to you ask for ${Math.round(avgAsk * 100)}% more value than he gives, on average. Expect lowball openers; counter, don't accept.` }); ease -= 15; }
      else if (avgAsk < -0.05) { insights.push({ dir: 'good', text: `His offers have leaned your way (${Math.round(-avgAsk * 100)}% in your favour on average). He pays to get deals done.` }); ease += 15; }
      else if (avgAsk <= 0.05) { insights.push({ dir: 'good', text: `His offers are close to fair (${avgAsk >= 0 ? '+' : ''}${Math.round(avgAsk * 100)}% for him on average).` }); ease += 10; }
      else insights.push({ dir: 'mid', text: `His offers lean his way by ${Math.round(avgAsk * 100)}% on average, a normal opening ask.` });
    }
    if (recv.length + (done.length - doneMine) >= 2) { insights.push({ dir: 'good', text: `He comes to you: ${recv.length + done.length - doneMine} offers started by him.` }); ease += 8; }
    const regret = myRejects.filter((o) => (o.myNow ?? 0) > 0.05);
    if (regret.length) insights.push({ dir: 'buy', text: `${regret.length} offer${regret.length === 1 ? '' : 's'} you turned down would look good for you today.` });
    const tags = (t.note && t.note.tags) || [];
    if (tags.includes('public')) insights.push({ dir: 'sell', text: 'Your note: he negotiates in public. Keep offers private and expect the group chat to hear about them.' });
    if (tags.includes('hard')) ease -= 10;
    if (tags.includes('fair')) ease += 10;
    ease = Math.max(0, Math.min(100, Math.round(ease)));
    const label = touches < 2 ? 'Not enough history' : ease >= 65 ? 'Easy to deal with' : ease >= 40 ? 'Workable' : 'Difficult';
    const med = (arr) => { const v = arr.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    const doneTx = done.map((x) => ({ fromMe: byMeCreated(x), ms: x.status_updated && x.status_updated > x.created ? x.status_updated - x.created : null }));
    const hisResponse = med([...sent.filter((o) => o.answeredAt && !o.withdrawnBy).map((o) => o.openMs), ...doneTx.filter((x) => x.fromMe).map((x) => x.ms)]);
    const myResponse = med([...recv.filter((o) => o.answeredAt && !o.withdrawnBy).map((o) => o.openMs), ...doneTx.filter((x) => !x.fromMe).map((x) => x.ms)]);
    const waiting = sent.filter((o) => o.status === 'proposed').map((o) => o.openMs);
    if (hisResponse != null) insights.push({ dir: hisResponse > 3 * 86400e3 ? 'sell' : hisResponse < 6 * 3600e3 ? 'good' : 'mid', text: `He usually answers your offers in ${dur(hisResponse)}${waiting.length ? `; one has been waiting ${dur(Math.max(...waiting))}` : ''}.` });
    t.dealings = { askN: asks.length, hisResponse, myResponse, waitingMs: waiting.length ? Math.max(...waiting) : null, offers: mineWith, done: done.length, doneMine, sent: sent.length, recv: recv.length, hisRejects: hisRejects.length, myRejects: myRejects.length, withdrawn: mineWith.filter((o) => o.withdrawnBy).length, avgAsk, ease, label, insights, touches };
  }

  // -- every offer other managers have sent you (pending, rejected, withdrawn, accepted)
  const incoming = [];
  {
    const r8 = (d, rid) => (d && d[rid] && d[rid].gave > 0 ? d[rid].got / d[rid].gave - 1 : null);
    const gqlById = Object.fromEntries(gqlTrades.map((x) => [String(x.transaction_id), x]));
    const push = (nt, status, openMs) => {
      const rid = nt.rids.find((r) => r !== myRid);
      incoming.push({ id: nt.id, nt, rid, status, created: nt.created, openMs, ask: r8(nt.deal, rid), askNow: r8(nt.now, rid), thenSrc: nt.thenSrc || null });
    };
    for (const o of offers) if (!o.fromMe && o.rids.length === 2 && o.rids.includes(myRid)) push(o, o.status, o.openMs);
    for (const nt of leagueTrades) {
      const gq = gqlById[nt.id];
      if (!gq || nt.rids.length !== 2 || !nt.rids.includes(myRid) || byMeCreated(gq)) continue;
      push(nt, 'complete', gq.status_updated && gq.status_updated > gq.created ? gq.status_updated - gq.created : null);
    }
    incoming.sort((a, b) => b.created - a.created);
  }

  // -- your own offers: how they've gone, and what asking price gets accepted
  let myOffers = null;
  const ratio = (d, rid) => (d && d[rid] && d[rid].gave > 0 ? d[rid].got / d[rid].gave - 1 : null);
  {
    const ltById = Object.fromEntries(leagueTrades.map((nt) => [nt.id, nt]));
    const mineSent = offers.filter((o) => o.fromMe);
    const doneSent = gqlTrades.filter((x) => x.status === 'complete' && (x.roster_ids || []).includes(myRid) && byMeCreated(x)).map((x) => ltById[String(x.transaction_id)]).filter(Boolean);
    const rows = [
      ...mineSent.map((o) => ({ openMs: o.openMs, status: o.status, rid: o.other, ask: ratio(o.deal, myRid), now: ratio(o.now, myRid), created: o.created, id: o.id })),
      ...doneSent.map((nt) => ({ openMs: (gqlTrades.find((x) => String(x.transaction_id) === nt.id) || {}).status_updated ? gqlTrades.find((x) => String(x.transaction_id) === nt.id).status_updated - nt.created : null, status: 'complete', rid: nt.rids.find((r) => r !== myRid), ask: ratio(nt.deal, myRid), now: ratio(nt.now, myRid), created: nt.created, id: nt.id })),
    ].sort((a, b) => b.created - a.created);
    const cnt = (st) => rows.filter((r) => r.status === st).length;
    const asks = (arr) => { const v = arr.map((r) => r.ask).filter((x) => x != null); return v.length ? avg(v) : null; };
    const buckets = [['Fair or giving value (≤ +5%)', -9, 0.05], ['Modest ask (+5% to +15%)', 0.05, 0.15], ['Big ask (+15% to +30%)', 0.15, 0.3], ['Lowball (over +30%)', 0.3, 9]].map(([label, lo, hi]) => {
      const b = rows.filter((r) => r.ask != null && r.ask > lo && r.ask <= hi && (r.status === 'complete' || r.status === 'rejected'));
      const acc = b.filter((r) => r.status === 'complete').length;
      return { label, n: b.length, accepted: acc, rate: b.length ? acc / b.length : null };
    });
    const per = {};
    for (const r of rows) { const x = (per[r.rid] ||= { sent: 0, accepted: 0, rejected: 0 }); x.sent++; if (r.status === 'complete') x.accepted++; if (r.status === 'rejected') x.rejected++; }
    const decided = rows.filter((r) => r.status === 'complete' || r.status === 'rejected');
    const insights = [];
    if (decided.length) insights.push(`${Math.round((cnt('complete') / decided.length) * 100)}% of your offers that got an answer were accepted (${cnt('complete')} of ${decided.length}).`);
    const aA = asks(rows.filter((r) => r.status === 'complete')), aR = asks(rows.filter((r) => r.status === 'rejected'));
    if (aA != null && aR != null) insights.push(`Accepted offers asked for ${aA >= 0 ? '+' : ''}${Math.round(aA * 100)}% on average; rejected ones asked for ${aR >= 0 ? '+' : ''}${Math.round(aR * 100)}%.`);
    else if (aR != null) insights.push(`Your rejected offers asked for ${aR >= 0 ? '+' : ''}${Math.round(aR * 100)}% on average.`);
    const sweet = buckets.filter((b) => b.n >= 2 && b.rate).sort((a, b) => b.rate - a.rate)[0];
    if (sweet) insights.push(`Best acceptance so far: ${sweet.label.toLowerCase()} at ${Math.round(sweet.rate * 100)}%.`);
    const regretful = rows.filter((r) => r.status === 'rejected' && r.now != null && r.now < -0.05).length;
    if (regretful) insights.push(`${regretful} of your rejected offers would be losing value for you today. Not every rejection was a loss.`);
    { const answered = rows.filter((r) => r.openMs != null && r.status !== 'proposed' && r.status !== 'cancelled').map((r) => r.openMs).sort((a, b) => a - b); if (answered.length) insights.push(`Managers typically answer your offers in ${dur(answered[Math.floor(answered.length / 2)])}.`); }
    myOffers = { rows, sent: rows.length, accepted: cnt('complete'), rejected: cnt('rejected'), withdrawn: cnt('cancelled'), pending: cnt('proposed'), avgAsk: asks(rows), avgAccepted: aA, avgRejected: aR, buckets, per, insights };
  }

  // -- this league's rookie drafts: what each pick became, who drafts well
  const leagueDrafts = [];
  const drafter = {};
  for (const d of raw.drafts || []) {
    if (!d.picks || !d.picks.length || Number(d.season) > season) continue;
    const ps = d.picks.filter((p) => p.player_id).map((p) => ({ ...p, pick_no: p.pick_no || (p.round - 1) * teams.length + Number(p.draft_slot || 0), v: V(p.player_id).v, name: P(p.player_id).name, pos: P(p.player_id).pos, rid: p.roster_id }));
    const order = [...ps].sort((a, b) => b.v - a.v);
    ps.forEach((p) => { p.valueRank = order.indexOf(p) + 1; p.edge = p.pick_no - p.valueRank; });
    ps.sort((a, b) => a.pick_no - b.pick_no);
    leagueDrafts.push({ season: Number(d.season), picks: ps });
    if (Number(d.season) <= season - 1 || ps.length) for (const p of ps) { const x = (drafter[p.rid] ||= { n: 0, edge: 0, best: null, worst: null }); x.n++; x.edge += p.edge; if (!x.best || p.edge > x.best.edge) x.best = p; if (!x.worst || p.edge < x.worst.edge) x.worst = p; }
  }
  leagueDrafts.sort((a, b) => b.season - a.season);
  for (const t of teams) { const x = drafter[t.rid]; t.drafting = x && x.n ? { n: x.n, avgEdge: x.edge / x.n, best: x.best, worst: x.worst } : null; }

  // -- trade block
  const block = [];
  if (raw.block && raw.block.items) {
    for (const lp of raw.block.items) {
      const st = lp.settings || {};
      if (!st.otb) continue;
      const id = String(lp.player_id);
      let item;
      if (id.includes(',')) {
        const [orig, y, r] = id.split(',').map(Number);
        const live = picks.find((p) => p.season === y && p.round === r && p.orig === orig);
        // Sleeper can leave the block flag on after a trade: only list what the team still owns.
        if (live && live.owner !== Number(st.otb)) continue;
        item = live ? { ...live } : { kind: 'pick', season: y, round: r, orig, v: pickValue(book, y, r, 'mid'), label: `${y} ${roundName(r)}` };
      } else {
        const holder = teams.find((t) => t.rid === Number(st.otb));
        if (holder && !(holder.roster.players || []).includes(id)) continue;
        item = asset(id);
      }
      block.push({ ...item, rid: st.otb, at: st.otb_added_at || null });
    }
  }
  block.sort((a, b) => (b.at || 0) - (a.at || 0));
  for (const t of teams) t.block = block.filter((b) => b.rid === t.rid);

  // -- needs and surplus
  const posStarters = { ...Object.fromEntries(VALUE_POS.map((p) => [p, slotCount[p] || 0])) };
  const startQ = {};
  const kthBest = {};
  for (const t of teams) {
    startQ[t.rid] = {};
    kthBest[t.rid] = {};
    for (const pos of VALUE_POS) {
      const k = Math.max(1, posStarters[pos]);
      const vals = t.assets.filter((a) => a.pos === pos).map((a) => a.redraft).sort((a, b) => b - a);
      startQ[t.rid][pos] = sum(vals.slice(0, k));
      kthBest[t.rid][pos] = vals[k - 1] || 0;
    }
  }
  const medKth = Object.fromEntries(VALUE_POS.map((pos) => [pos, median(teams.map((t) => kthBest[t.rid][pos]))]));
  for (const t of teams) {
    t.posRank = {};
    t.needs = [];
    t.surplus = [];
    for (const pos of VALUE_POS) {
      const sorted = teams.map((x) => startQ[x.rid][pos]).sort((a, b) => b - a);
      const rank = sorted.indexOf(startQ[t.rid][pos]) + 1;
      t.posRank[pos] = rank;
      if (posStarters[pos] && rank > Math.ceil(teams.length * 0.6)) t.needs.push(pos);
      const k = Math.max(1, posStarters[pos]);
      const depth = t.assets.filter((a) => a.pos === pos).slice(k + (pos === 'RB' || pos === 'WR' ? 1 : 0));
      const spare = depth.filter((a) => a.redraft >= medKth[pos] && a.redraft > 0);
      if (spare.length) t.surplus.push({ pos, players: spare.map((a) => a.id) });
    }
    t.needs.sort((a, b) => t.posRank[b] - t.posRank[a]);
  }

  // -- positional ranks: every team's room at QB/RB/WR/TE, ranked two ways.
  // Dynasty: KTC value of the players that matter long-term (starters plus the
  // next man up). Season: points per game of the healthy players who'd start
  // now (flex counted as one extra RB and one extra WR).
  const POSR = ['QB', 'RB', 'WR', 'TE'];
  const flexN = slots.filter((x) => /FLEX/.test(x)).length;
  const deepN = (pos) => Math.max(1, posStarters[pos] || 1) + (pos === 'RB' || pos === 'WR' ? Math.max(1, flexN) + 1 : 1);
  const seasonN = (pos) => Math.max(1, posStarters[pos] || 1) + ((pos === 'RB' || pos === 'WR') && flexN ? 1 : 0);
  const positional = { order: POSR, depth: {}, startN: {}, teams: {}, players: {} };
  for (const pos of POSR) {
    positional.depth[pos] = deepN(pos);
    positional.startN[pos] = seasonN(pos);
    const all = [];
    for (const t of teams) {
      for (const a of t.assets) if (a.pos === pos) all.push({ id: a.id, name: a.name, team: a.team, age: a.age, inj: a.inj, v: a.v, ppg: Math.round(ppgOf(a.id) * 10) / 10, rid: t.rid });
    }
    all.sort((a, b) => b.v - a.v);
    all.forEach((x, i) => { x.vRank = i + 1; });
    [...all].sort((a, b) => b.ppg - a.ppg).forEach((x, i) => { x.pRank = x.ppg > 0 ? i + 1 : null; });
    positional.players[pos] = all;
  }
  for (const t of teams) {
    const row = {};
    for (const pos of POSR) {
      const mine = positional.players[pos].filter((x) => x.rid === t.rid);
      const healthy = mine.filter((x) => !OUTSTAT.test(x.inj || '')).map((x) => x.ppg).sort((a, b) => b - a);
      row[pos] = {
        n: mine.length,
        dyn: sum(mine.slice(0, positional.depth[pos]).map((x) => x.v)),
        season: Math.round(sum(healthy.slice(0, positional.startN[pos])) * 10) / 10,
        top: mine.slice(0, 3).map((x) => x.id),
        age: mine.length ? avg(mine.slice(0, positional.depth[pos]).map((x) => x.age || 0).filter(Boolean)) || null : null,
      };
    }
    positional.teams[t.rid] = row;
  }
  for (const pos of POSR) {
    for (const key of ['dyn', 'season']) {
      const sorted = teams.map((t) => positional.teams[t.rid][pos][key]).sort((a, b) => b - a);
      for (const t of teams) positional.teams[t.rid][pos][key + 'Rank'] = sorted.indexOf(positional.teams[t.rid][pos][key]) + 1;
    }
  }
  for (const t of teams) {
    const r = positional.teams[t.rid];
    r.dynAvg = avg(POSR.map((pos) => r[pos].dynRank));
    r.seasonAvg = avg(POSR.map((pos) => r[pos].seasonRank));
  }

  // -- other leagues: exposure ("crushes") and trading habits elsewhere
  for (const t of teams) {
    const o = raw.others && raw.others[t.userId];
    t.elsewhere = null;
    if (!o || !o.leagues) continue;
    const lgs = o.leagues.filter((l) => String(l.id) !== String(L.league_id));
    const count = {};
    for (const sid of t.roster.players || []) count[sid] = 1;
    const acquired = {};
    let nTrades = 0, picksIn = 0, picksOut = 0;
    const ageIn = [], ageOut = [];
    const posIn = {};
    for (const l of lgs) {
      for (const sid of l.players || []) count[sid] = (count[sid] || 0) + 1;
      for (const tr of l.trades || []) {
        nTrades++;
        picksIn += tr.picksIn || 0;
        picksOut += tr.picksOut || 0;
        // Retired or teamless players (someone trading for Tom Brady in a
        // joke league) say nothing about how a manager builds a team.
        const real = (p) => p.team && p.team !== 'FA' && p.age && p.age < 40;
        for (const sid of tr.in || []) {
          const p = P(sid);
          if (!real(p)) continue;
          acquired[sid] = (acquired[sid] || 0) + 1;
          ageIn.push(p.age);
          if (p.pos) posIn[p.pos] = (posIn[p.pos] || 0) + 1;
        }
        for (const sid of tr.out || []) { const p = P(sid); if (real(p)) ageOut.push(p.age); }
      }
    }
    const nL = lgs.length + 1;
    const threshold = Math.max(2, Math.ceil(nL * 0.3));
    const crushes = nL < 4 ? [] : Object.entries(count)
      .filter(([sid, c]) => c >= threshold && VALUE_POS.includes(P(sid).pos) && P(sid).team)
      .map(([sid, c]) => ({ ...asset(sid), count: c, of: nL }))
      .sort((a, b) => b.count - a.count || b.v - a.v)
      .slice(0, 10);
    t.elsewhere = {
      leagues: lgs.length,
      dynasty: lgs.filter((l) => l.type === 2).length,
      names: lgs.map((l) => l.name),
      exposure: count,
      crushes,
      acquired,
      trades: nTrades,
      picksIn, picksOut,
      ageIn: ageIn.length ? avg(ageIn) : null,
      ageOut: ageOut.length ? avg(ageOut) : null,
      posIn,
      at: o.at,
      partial: !!o.partial,
    };
  }

  // -- posture: who is buying, who is selling
  const recentCut = now - 200 * DAYMS;
  const vals = (k) => teams.map((t) => t[k]);
  for (const t of teams) {
    const flow = { now: 0, fut: 0, n: 0, telling: [] };
    for (const nt of leagueTrades) {
      if (!nt.rids.includes(t.rid) || nt.created < recentCut) continue;
      const s = nt.sides[t.rid];
      const inNow = sum(s.inP.map((sid) => asset(sid).redraft));
      const outNow = sum(s.outP.map((sid) => asset(sid).redraft));
      const futOf = (sid) => { const a = asset(sid); return a.age && AGE_CUT[a.pos] && a.age < AGE_CUT[a.pos] ? a.v : 0; };
      const inFut = sum(s.inP.map(futOf)) + sum(s.inK.map((k) => k.v));
      const outFut = sum(s.outP.map(futOf)) + sum(s.outK.map((k) => k.v));
      const dir = (inNow - outNow) - (inFut - outFut);
      flow.now += inNow - outNow;
      flow.fut += inFut - outFut;
      flow.n++;
      flow.telling.push({ nt, dir });
    }
    flow.score = flow.n ? Math.tanh((flow.now - flow.fut) / 4000) : 0;
    flow.telling.sort((a, b) => Math.abs(b.dir) - Math.abs(a.dir));
    t.flow = flow;
  }
  for (const t of teams) {
    const nowPct = pctRank(vals('winNow'), t.winNow);
    const recPct = pctRank(teams.map((x) => x.winPct * 1000 + x.pf / 100), t.winPct * 1000 + t.pf / 100);
    const futPct = pctRank(vals('future'), t.future);
    const C = 100 * (0.3 * nowPct + 0.25 * recPct + 0.2 * (t.playoffOdds ?? 0.5) + 0.25 * (0.5 + 0.5 * t.flow.score));
    const blockVets = t.block.filter((b) => b.kind === 'player' && b.age >= 27 && b.redraft >= 1500);
    const blockYouth = t.block.filter((b) => (b.kind === 'pick') || (b.kind === 'player' && b.age && b.age <= 24));
    const tells = [];
    if (t.flow.score < -0.2) tells.push('selling');
    if (blockVets.length >= 2) tells.push('block');
    if (t.eff != null && effMed && t.eff < effMed - 0.04) tells.push('eff');
    if (t.emptySlots >= 2) tells.push('empty');
    if ((t.playoffOdds ?? 1) < 0.05) tells.push('odds');
    let label;
    if (C >= 72 && t.flow.score > 0.25) label = 'ALL-IN';
    else if (C >= 58) label = 'CONTENDER';
    else if (C >= 42) label = 'MIDDLE';
    else if (recPct <= 0.2 && tells.length >= 2) label = 'TANKING';
    else label = 'REBUILDING';

    // Evidence, each tagged with the direction it points.
    const ev = [];
    const pfRank = [...teams].sort((a, b) => b.pf - a.pf).findIndex((x) => x.rid === t.rid) + 1;
    const nowRank = [...teams].sort((a, b) => b.winNow - a.winNow).findIndex((x) => x.rid === t.rid) + 1;
    const futRank = [...teams].sort((a, b) => b.future - a.future).findIndex((x) => x.rid === t.rid) + 1;
    ev.push({ dir: recPct >= 0.6 ? 'buy' : recPct <= 0.35 ? 'sell' : 'mid', text: `${t.w}-${t.l}${t.t ? '-' + t.t : ''}, ${ordinal(pfRank)} in points scored (${Math.round(t.pf)})` });
    ev.push({ dir: nowRank <= 4 ? 'buy' : nowRank >= teams.length - 3 ? 'sell' : 'mid', text: `Best possible lineup ranks ${ordinal(nowRank)} of ${teams.length} on this-season value` });
    if (t.playoffOdds != null) ev.push({ dir: t.playoffOdds >= 0.6 ? 'buy' : t.playoffOdds <= 0.15 ? 'sell' : 'mid', text: `${Math.round(t.playoffOdds * 100)}% playoff odds (${Math.round(t.expWins * 10) / 10} projected wins)` });
    ev.push({ dir: futRank <= 3 ? 'sell' : 'mid', text: `Future capital (young players + picks) ranks ${ordinal(futRank)}${t.picks.length > rounds * 2 ? `; holds ${t.picks.length} picks over ${pickSeasons.length} drafts` : ''}` });
    for (const { nt, dir } of t.flow.telling.slice(0, 2)) {
      if (Math.abs(dir) < 1500) continue;
      const s = nt.sides[t.rid];
      const got = [...s.inP.map((sid) => P(sid).name), ...s.inK.map((k) => k.label)].join(', ');
      const gave = [...s.outP.map((sid) => { const a = P(sid); return a.age ? `${a.name} (${Math.round(a.age)})` : a.name; }), ...s.outK.map((k) => k.label)].join(', ');
      ev.push({ dir: dir > 0 ? 'buy' : 'sell', text: `${dateStr(nt.created)}: ${dir > 0 ? 'bought' : 'sold'} — gave ${gave || 'nothing'} for ${got || 'nothing'}` });
    }
    if (blockVets.length) ev.push({ dir: 'sell', text: `Veterans on the trade block: ${blockVets.slice(0, 4).map((b) => b.name).join(', ')}` });
    if (blockYouth.length && !blockVets.length) ev.push({ dir: 'buy', text: `Shopping youth/picks on the block: ${blockYouth.slice(0, 3).map((b) => b.name || b.label).join(', ')}` });
    if (t.eff != null && t.weeks.length >= 2) {
      const d = t.eff - effMed;
      ev.push({ dir: d < -0.04 ? 'sell' : d > 0.02 ? 'buy' : 'mid', text: `Started ${Math.round(t.eff * 100)}% of his best possible points; left ${Math.round(t.benchLeft)} on the bench (league median ${Math.round(benchMed)})${t.emptySlots ? `; ${t.emptySlots} empty starting slot${t.emptySlots > 1 ? 's' : ''}` : ''}` });
    }
    const dirWanted = POSTURES[label].tone;
    const agree = ev.filter((e) => e.dir === dirWanted).length;
    const disagree = ev.filter((e) => e.dir !== 'mid' && e.dir !== dirWanted).length;
    const conf = dirWanted === 'mid' ? (disagree <= 2 ? 'medium' : 'low') : agree - disagree >= 3 ? 'high' : agree - disagree >= 1 ? 'medium' : 'low';
    t.posture = { label, score: Math.round(C), conf, nowPct, futPct, recPct, tells, evidence: ev, ...POSTURES[label] };
  }
  const myStrategy = prefs.strategy && prefs.strategy !== 'auto' ? prefs.strategy : ['ALL-IN', 'CONTENDER', 'MIDDLE'].includes(me.posture.label) ? 'contend' : 'rebuild';

  // -- demand map: who wants each of your players
  const lastNdays = (arr, n) => arr.filter((x) => now - x.at < n * DAYMS);
  function interest(t, a) {
    if (t.isMe || !VALUE_POS.includes(a.pos)) return { score: 0, why: [] };
    const why = [];
    let score = 0;
    const asked = t.asked[a.id] || [];
    if (asked.length) {
      const w = sum(asked.map((x) => Math.exp(-(now - x.at) / (90 * DAYMS))));
      score += 3 * w + (asked.length > 1 ? 1 : 0);
      why.push({ k: 'asked', text: `Asked you for him ${asked.length}× (last ${dateStr(Math.max(...asked.map((x) => x.at)))})` });
    }
    const rank = t.posRank[a.pos];
    const startsForThem = a.redraft > (kthBest[t.rid][a.pos] || 0);
    if (t.needs.includes(a.pos)) { score += 1.5; why.push({ k: 'need', text: `Weak at ${a.pos} (${ordinal(rank)} of ${teams.length})` }); }
    if (startsForThem && a.redraft > 0) { score += 1; why.push({ k: 'start', text: `Would start for him` }); }
    const lab = t.posture.label;
    if ((lab === 'ALL-IN' || lab === 'CONTENDER') && a.redraft >= 2500) { score += lab === 'ALL-IN' ? 2 : 1.2; why.push({ k: 'posture', text: `${lab === 'ALL-IN' ? 'All-in' : 'Contending'} — buys proven starters` }); }
    if ((lab === 'REBUILDING' || lab === 'TANKING') && a.age && a.age <= 24) { score += 1.5; why.push({ k: 'posture', text: 'Rebuilding — collects young players' }); }
    if ((lab === 'REBUILDING' || lab === 'TANKING') && a.age && a.age >= 27) score -= 1.5;
    const ex = t.elsewhere;
    if (ex) {
      const c = (ex.exposure[a.id] || 0) - ((t.roster.players || []).includes(a.id) ? 1 : 0);
      if (c >= 2) { score += Math.min(3, 1 + 0.5 * (c - 2)); why.push({ k: 'crush', text: `Rosters him in ${c} of his other ${ex.leagues} leagues` }); }
      else if (c === 1 && ex.leagues <= 3) { score += 0.5; why.push({ k: 'crush', text: `Rosters him in another league` }); }
      if (ex.acquired[a.id]) { score += 1; why.push({ k: 'traded', text: `Traded for him elsewhere ${ex.acquired[a.id]}×` }); }
    }
    const recentPos = leagueTrades.filter((nt) => nt.rids.includes(t.rid) && now - nt.created < 120 * DAYMS && nt.sides[t.rid].inP.some((sid) => P(sid).pos === a.pos)).length;
    if (recentPos) { score += 0.5; why.push({ k: 'history', text: `Traded for a ${a.pos} in the last 4 months` }); }
    if (t.block.some((b) => b.kind === 'player' && b.pos === a.pos && b.redraft >= a.redraft * 0.6)) score -= 0.5;
    if (starterOf[a.id] && ownerOf[starterOf[a.id]] === t.rid) { score += 1.5; why.push({ k: 'cuff', text: `Handcuff to his ${P(starterOf[a.id]).name}` }); }
    if (t.avoid) { score *= 0.6; why.push({ k: 'note', text: 'Your note: avoid deals with him' }); }
    return { score: Math.round(score * 10) / 10, why };
  }
  // -- RB handcuffs: each NFL team's lead back and the back behind him
  // (Sleeper depth chart first, dynasty value as the tiebreak).
  const cuffOf = {}, starterOf = {};
  {
    const byTeam = {};
    for (const [sid, d] of Object.entries(dict)) {
      if (d[1] !== 'RB' || d[6] === 0 || !d[2] || d[2] === 'FA') continue;
      (byTeam[d[2]] ||= []).push({ sid, order: d[7] != null ? Number(d[7]) : 9, v: V(sid).v });
    }
    for (const arr of Object.values(byTeam)) {
      arr.sort((x, y) => x.order - y.order || y.v - x.v);
      const [lead, back] = arr;
      if (lead && back && lead.v >= 1200) { cuffOf[lead.sid] = back.sid; starterOf[back.sid] = lead.sid; }
    }
  }
  const ownerOf = {};
  for (const t of teams) for (const sid of t.roster.players || []) ownerOf[sid] = t.rid;
  for (const t of teams) {
    t.cuffs = { theyHoldMine: [], iHoldTheirs: [] };
    if (t.rid === myRid) continue;
    for (const sid of me.roster.players || []) if (cuffOf[sid] && ownerOf[cuffOf[sid]] === t.rid) t.cuffs.theyHoldMine.push({ starter: sid, cuff: cuffOf[sid] });
    for (const sid of t.roster.players || []) if (cuffOf[sid] && ownerOf[cuffOf[sid]] === myRid) t.cuffs.iHoldTheirs.push({ starter: sid, cuff: cuffOf[sid] });
  }
  const myCuffsHeldBy = teams.flatMap((t) => t.cuffs.theyHoldMine.map((c) => ({ ...c, rid: t.rid })));

  const askedIds = new Set(teams.flatMap((t) => Object.keys(t.asked)));
  const myCore = me.assets.filter((a, i) => VALUE_POS.includes(a.pos) && ((a.v > 0 && i < 16) || askedIds.has(a.id) || (starterOf[a.id] && ownerOf[starterOf[a.id]] !== myRid && ownerOf[starterOf[a.id]] != null)));
  const demand = myCore.map((a) => {
    const suitors = teams.filter((t) => !t.isMe).map((t) => ({ rid: t.rid, ...interest(t, a) })).filter((s) => s.score >= 1.5).sort((x, y) => y.score - x.score);
    return { asset: a, suitors: suitors.slice(0, 3), heat: suitors.length ? suitors[0].score : 0, asked: suitors.some((s) => s.why.some((w) => w.k === 'asked')) };
  }).sort((x, y) => (y.asked ? 1 : 0) - (x.asked ? 1 : 0) || y.heat - x.heat || y.asset.v - x.asset.v);
  for (const t of teams) {
    t.wants = t.isMe ? [] : myCore.map((a) => ({ asset: a, ...interest(t, a) })).filter((x) => x.score >= 1.5).sort((a, b) => b.score - a.score).slice(0, 6);
  }

  // -- trade finder
  // Two tests for every package: it must look fair to the other manager by KTC
  // (so he might accept), and it must be good for you by YOUR valuation:
  //  - draft picks are worth a bit less than KTC says (pickDiscount, default 15%),
  //  - in a 1QB league a QB you don't need is worth much less to you,
  //  - rebuilding: older players are worth less to you, picks and youth count fully;
  //    contending: proven starters count fully, far-off picks less,
  //  - players at positions you need count a little more.
  const myNeeds = me.needs;
  const myWeak = Object.fromEntries(VALUE_POS.map((pos) => [pos, kthBest[myRid][pos] || 0]));
  const pickDiscount = prefs.pickDiscount != null ? Number(prefs.pickDiscount) : 0.15;
  const oneQB = !book.fmt || !book.fmt.superflex;
  const myStarters = new Set(me.winNowIds);
  // How hard to lean young: the setting (off / normal / strong), eased off for
  // contenders who still need proven starters.
  const youthBias = (prefs.youthBias != null ? Number(prefs.youthBias) : 1) * (myStrategy === 'contend' ? 0.7 : 1);
  const myVal = (a, receiving) => {
    let v = a.v || 0;
    if (a.kind === 'pick') {
      v *= 1 - pickDiscount;
      if (myStrategy === 'contend' && Number(a.season) > season + 1) v *= 0.9;
      return v;
    }
    if (receiving) {
      if (a.pos === 'QB' && oneQB && !myNeeds.includes('QB')) v *= 0.55;
      v *= ageFactor(a.pos, a.age, youthBias);
      if (myStrategy === 'rebuild' && a.age && a.age >= AGE_CUT[a.pos]) v *= 0.9;
      if (myStrategy === 'contend' && a.redraft != null && a.redraft < myWeak[a.pos]) v *= 0.85;
      if (myNeeds.includes(a.pos)) v *= 1.1;
      if (starterOf[a.id] && ownerOf[starterOf[a.id]] === myRid) v = Math.max(v * 1.3, v + 300); // insurance for your RB
    } else {
      // Giving away: an old player costs you less than his market value, a young one more.
      v *= ageFactor(a.pos, a.age, youthBias);
      if (myStrategy === 'contend' && myStarters.has(a.id)) v *= 1.1; // losing a starter hurts more when contending
    }
    return v;
  };
  const asPick = (p) => ({ ...p, id: `pick:${p.season}:${p.round}:${p.orig}`, name: p.label });
  const shopId = prefs.shop || null;
  const shopAsset = shopId ? me.assets.find((a2) => a2.id === shopId) || null : null;
  const myAddOns = me.assets.filter((a2) => VALUE_POS.includes(a2.pos) && a2.v >= 150 && a2.v <= 2500 && !myStarters.has(a2.id) && a2.id !== shopId).sort((x, y) => y.v - x.v).slice(0, 4);
  const myPicksSmall = me.tradePicks.filter((p) => p.round >= 2).map(asPick).slice(0, 3);
  const finder = [];
  const finderSkipped = [];
  for (const t of teams) {
    if (t.isMe) continue;
    if (t.avoid) { finderSkipped.push(t.rid); continue; }
    let gives;
    if (shopAsset) {
      const hisCuffs = t.cuffs.iHoldTheirs.map((c) => me.assets.find((a2) => a2.id === c.cuff)).filter((a2) => a2 && a2.id !== shopId);
      const shopCuff = cuffOf[shopId] ? me.assets.find((a2) => a2.id === cuffOf[shopId]) : null; // sell an RB with his own backup
      gives = [[shopAsset], ...myAddOns.slice(0, 3).map((x) => [shopAsset, x]), ...myPicksSmall.slice(0, 2).map((x) => [shopAsset, x]), ...hisCuffs.map((x) => [shopAsset, x]), ...(shopCuff ? [[shopAsset, shopCuff]] : [])];
    } else {
      const givePool = [...new Map([
        ...t.wants.slice(0, 4).map((w) => [w.asset.id, w.asset]),
        ...me.surplus.flatMap((s2) => s2.players.map((sid) => [sid, me.assets.find((a2) => a2.id === sid)])).filter(([, a2]) => a2 && t.needs.includes(a2.pos)),
        // Rebuilding: your older players are what you sell.
        ...(myStrategy === 'rebuild' || youthBias > 0 ? me.assets.filter((a2) => VALUE_POS.includes(a2.pos) && a2.age && a2.age >= AGE_CUT[a2.pos] - (myStrategy === 'rebuild' ? 1 : 0) && a2.v >= 1500 && !(myStrategy === 'contend' && myStarters.has(a2.id))).map((a2) => [a2.id, a2]) : []),
      ]).values()].filter(Boolean).filter((a2) => myStrategy !== 'contend' || !myNeeds.includes(a2.pos)).slice(0, 7);
      const hisCuffs = t.cuffs.iHoldTheirs.map((c) => me.assets.find((a2) => a2.id === c.cuff)).filter(Boolean);
      gives = givePool.flatMap((g) => [[g], ...givePool.filter((g2) => g2 !== g && g2.v < g.v).slice(0, 2).map((g2) => [g, g2]), ...hisCuffs.filter((c) => c.id !== g.id).map((c) => [g, c])]);
    }
    let getsP;
    if (myStrategy === 'contend') {
      getsP = t.assets.filter((a2) => VALUE_POS.includes(a2.pos) && a2.redraft > myWeak[a2.pos] && a2.v > 300 && !(youthBias > 0 && a2.age && AGE_CURVE[a2.pos] && a2.age > AGE_CURVE[a2.pos].cliff));
      if (t.posture.tone === 'buy') getsP = getsP.filter((a2) => !t.winNowIds.includes(a2.id) || t.surplus.some((s2) => s2.pos === a2.pos));
    } else {
      getsP = t.assets.filter((a2) => VALUE_POS.includes(a2.pos) && a2.age && a2.age < AGE_CUT[a2.pos] && a2.v >= 1000);
    }
    // A QB you don't need is a poor return in a 1QB league.
    if (oneQB && !myNeeds.includes('QB')) getsP = getsP.filter((a2) => a2.pos !== 'QB');
    getsP = getsP.sort((x, y) => myVal(y, true) - myVal(x, true)).slice(0, 7);
    for (const c of t.cuffs.theyHoldMine) { const a2 = t.assets.find((x) => x.id === c.cuff); if (a2 && !getsP.includes(a2)) getsP.push(a2); }
    const getsK = t.tradePicks.filter((p) => p.v >= 400).map(asPick).sort((x, y) => y.v - x.v).slice(0, myStrategy === 'rebuild' ? 6 : 3);
    const singles = [...getsP, ...getsK];
    const getSets = [];
    for (let i = 0; i < singles.length; i++) {
      getSets.push([singles[i]]);
      for (let j = i + 1; j < singles.length; j++) {
        getSets.push([singles[i], singles[j]]);
        // Three-piece returns: a player or pick plus two picks (typical rebuild haul).
        for (let k2 = j + 1; k2 < singles.length; k2++) if (singles[j].kind === 'pick' && singles[k2].kind === 'pick') getSets.push([singles[i], singles[j], singles[k2]]);
      }
    }
    const ideas = [];
    for (const give of gives) {
      const g1 = give.map((a2) => a2.v).filter((x) => x > 0);
      if (!g1.length) continue;
      const myCost = sum(give.map((a2) => myVal(a2, false)));
      for (const get of getSets) {
        const g2 = get.map((a2) => a2.v).filter((x) => x > 0);
        if (!g2.length) continue;
        const vd = ktcVerdict(g2, g1, book.ktcTop); // side1 = what I receive
        const ktcGain = gainPct(vd.total1, vd.total2);
        if (ktcGain < -0.03 || ktcGain > 0.07) continue; // must look fair to him by KTC
        const myGet = sum(get.map((a2) => myVal(a2, true))) + (vd.adj1 || 0) * 0.8;
        const myGain = gainPct(myGet, myCost + (vd.adj2 || 0) * 0.8);
        if (myGain < 0) continue; // must be good for you by your valuation
        let score = myGain * 20;
        score += sum(give.map((a2) => (t.wants.find((w) => w.asset.id === a2.id) || { score: 0 }).score)) * 0.6;
        score += sum(get.map((a2) => (a2.kind === 'pick' ? (myStrategy === 'rebuild' ? 1.2 : 0) : myNeeds.includes(a2.pos) ? 1.5 : 0)));
        if (t.posture.tone === 'buy' && give.some((a2) => a2.redraft >= 2500)) score += 1;
        if (t.posture.tone === 'sell' && myStrategy === 'contend' && get.some((a2) => a2.kind === 'player' && a2.age >= 26 && a2.age <= (AGE_CURVE[a2.pos] || {}).peak + 2)) score += 1;
        // Lean young: reward getting players before their peak and moving players past it.
        if (youthBias > 0) {
          score += youthBias * 0.6 * get.filter((a2) => a2.age && AGE_CURVE[a2.pos] && a2.age < AGE_CURVE[a2.pos].peak).length;
          score += youthBias * 0.5 * give.filter((a2) => a2.age && AGE_CURVE[a2.pos] && a2.age > AGE_CURVE[a2.pos].peak).length;
          score -= youthBias * 0.8 * get.filter((a2) => a2.age && AGE_CURVE[a2.pos] && a2.age > AGE_CURVE[a2.pos].cliff).length;
        }
        score -= (get.length - 1) * 0.3;
        const cuffNotes = [];
        for (const a2 of get) if (starterOf[a2.id] && ownerOf[starterOf[a2.id]] === myRid) { score += 1.2; cuffNotes.push(`${a2.name} is ${P(starterOf[a2.id]).name}'s handcuff`); }
        for (const a2 of give) if (starterOf[a2.id] && ownerOf[starterOf[a2.id]] === t.rid) { score += 1; cuffNotes.push(`${a2.name} backs up his ${P(starterOf[a2.id]).name}`); }
        if (shopAsset && give.length === 2 && give[1].id === cuffOf[shopAsset.id]) cuffNotes.push(`${give[1].name} goes with ${shopAsset.name} as his handcuff`);
        ideas.push({ cuffNotes, give, get, myGain, ktcGain, fair: vd.fair, mine: vd.total1, theirs: vd.total2, myGet: Math.round(myGet), myCost: Math.round(myCost), score });
      }
    }
    ideas.sort((x, y) => y.score - x.score);
    const picked = [];
    for (const idea of ideas) {
      if (picked.length >= (shopAsset ? 3 : 2)) break;
      if (picked.some((p) => (!shopAsset && p.give[0].id === idea.give[0].id) || p.get[0].id === idea.get[0].id)) continue;
      picked.push(idea);
    }
    if (picked.length) finder.push({ rid: t.rid, ideas: picked, best: picked[0].score });
  }
  finder.sort((x, y) => y.best - x.best);
  const finderOpts = { shop: shopAsset ? shopAsset.id : null, pickDiscount, strategy: myStrategy, oneQB, youthBias: prefs.youthBias != null ? Number(prefs.youthBias) : 1 };

  // -- market movers on league rosters
  const rostered = teams.flatMap((t) => t.assets.filter((a) => VALUE_POS.includes(a.pos) && a.v > 300).map((a) => ({ ...a, rid: t.rid })));
  const histDays = Object.keys(valueHistory).sort();
  const weekAgoKey = histDays.find((d) => now - Date.parse(d) <= 8 * DAYMS && now - Date.parse(d) >= 6 * DAYMS) || null;
  for (const a of rostered) {
    a.pct30 = a.fc && a.trend30 != null ? a.trend30 / Math.max(1, a.fc - a.trend30) : null;
    const old = weekAgoKey && valueHistory[weekAgoKey][a.id];
    a.d7 = old ? a.v - old : null;
  }
  const movers = rostered.filter((a) => a.pct30 != null);
  const risers = [...movers].sort((a, b) => b.pct30 - a.pct30).slice(0, 10);
  const fallers = [...movers].sort((a, b) => a.pct30 - b.pct30).slice(0, 10);
  const sellHigh = movers.filter((a) => a.rid === myRid && a.pct30 >= 0.1 && a.age && (a.age >= 27 || (a.pos === 'RB' && a.age >= 25))).sort((a, b) => b.pct30 - a.pct30);
  const buyLow = movers.filter((a) => a.rid !== myRid && a.pct30 <= -0.1 && a.age && a.age <= 25 && a.v >= 1500).map((a) => ({ ...a, sellerTone: byRid[a.rid].posture.tone })).sort((a, b) => (a.sellerTone === 'sell' ? -1 : 0) - (b.sellerTone === 'sell' ? -1 : 0) || a.pct30 - b.pct30);

  // -- start/sit for you
  let startSit = null;
  try {
    startSit = buildStartSit({ league: L, week, myRoster: me.roster, matchupsThisWeek: (raw.matchups && raw.matchups[week]) || [], dict, proj, fpBySid, now });
    if (startSit.matchupId != null) {
      const oppM = ((raw.matchups && raw.matchups[week]) || []).find((m) => m.matchup_id === startSit.matchupId && m.roster_id !== myRid);
      if (oppM && byRid[oppM.roster_id]) {
        const opp = byRid[oppM.roster_id];
        const oss = buildStartSit({ league: L, week, myRoster: opp.roster, matchupsThisWeek: [oppM], dict, proj, fpBySid, now });
        const sd = 24;
        const z = (startSit.bestPts - oss.currentPts) / Math.sqrt(2 * sd * sd);
        startSit.opponent = { rid: opp.rid, projected: oss.currentPts, best: oss.bestPts, winProb: phi(z) };
      }
    }
  } catch (e) {
    notes.push(`Start/sit unavailable: ${e.message}`);
  }

  // -- aging: where each roster's production is heading
  let aging = null;
  if (prod) {
    const rosteredBy = {};
    for (const t of teams) for (const sid of t.roster.players || []) rosteredBy[sid] = t.rid;
    const pool = [];
    const posVals = {};
    for (const [sid, d] of Object.entries(dict)) {
      if (!VALUE_POS.includes(d[1]) || d[6] === 0 || !d[2] || d[2] === 'FA') continue;
      const v = V(sid).v;
      pool.push({ id: sid, name: d[0], pos: d[1], team: d[2], age: d[3], v });
      (posVals[d[1]] ||= []).push(v);
    }
    for (const p of pool) {
      const arr = posVals[p.pos];
      p.posValuePct = arr.length ? arr.filter((x) => x < p.v).length / arr.length : 0.5;
    }
    const { players: pj, lines } = projectAll(pool, prod, { season, teams: teams.length });
    const offSlots = slots.filter((x) => x !== 'DEF' && x !== 'K');
    for (const t of teams) {
      t.trajectory = [0, 1, 2, 3].map((k) => {
        const cands = (t.roster.players || []).filter((sid) => pj[sid]).map((sid) => ({ id: sid, pos: pj[sid].pos, ppg: pj[sid].seasons[k].ppg }));
        const ids = bestLineup(offSlots, cands, (c) => c.ppg).filter(Boolean);
        return sum(ids.map((id) => cands.find((c) => c.id === id).ppg));
      });
    }
    for (let k = 0; k <= 3; k++) {
      const order = [...teams].sort((a, b) => b.trajectory[k] - a.trajectory[k]);
      order.forEach((t, i) => { (t.trajRank ||= [])[k] = i + 1; });
    }
    const mine = (me.roster.players || []).filter((sid) => pj[sid]).map((sid) => ({ ...pj[sid], rid: myRid })).sort((a, b) => b.seasons[0].ppg - a.seasons[0].ppg);
    const sell = mine.filter((p) => p.phase === 'declining' && p.v >= 1500 && p.trend <= -0.1).sort((a, b) => b.v - a.v);
    const targets = Object.values(pj)
      .filter((p) => rosteredBy[p.id] !== myRid && p.age != null && p.age < PEAK[p.pos][1] && (p.phase === 'rising' || p.age <= PEAK[p.pos][0] + 0.5) && p.seasons[1].ppg >= 0.9 * (lines[p.pos] || 0))
      .map((p) => ({ ...p, rid: rosteredBy[p.id] ?? null, bargain: (p.next3 / Math.max(300, p.v)) * 1000, fitsNeed: me.needs.includes(p.pos) }))
      .sort((a, b) => b.next3 - a.next3)
      .slice(0, 40);
    for (const x of targets) if (x.rid != null) x.ownerTone = byRid[x.rid].posture.tone;
    aging = { players: pj, lines, mine, sell, targets };
  }

  // -- every roster's value by career phase (rising / at peak / declining / picks)
  const pjAll = aging ? aging.players : {};
  for (const t of teams) {
    const ph = { rising: 0, peak: 0, declining: 0, picks: t.pickValue || 0 };
    const who = { rising: [], peak: [], declining: [] };
    for (const a of t.assets) {
      if (!VALUE_POS.includes(a.pos) || !a.v) continue;
      let phase = pjAll[a.id] && pjAll[a.id].phase;
      if (!phase) {
        const pk = PEAK[a.pos];
        phase = !a.age ? 'peak' : a.age < pk[0] ? 'rising' : a.age <= pk[1] + 0.99 ? 'peak' : 'declining';
      }
      ph[phase] += a.v;
      who[phase].push(a.id);
    }
    const tot = ph.rising + ph.peak + ph.declining + ph.picks || 1;
    t.phase = { ...ph, total: tot, who, share: { rising: ph.rising / tot, peak: ph.peak / tot, declining: ph.declining / tot, picks: ph.picks / tot } };
  }
  for (const key of ['rising', 'declining']) {
    [...teams].sort((a, b) => b.phase.share[key] - a.phase.share[key]).forEach((t, i) => { t.phase[key + 'Rank'] = i + 1; });
  }

  // -- your schedule: remaining opponents, how they're playing, byes on both sides
  const teamBye = {};
  for (const [sid, f] of Object.entries(fpBySid)) { const tm = dict[sid] && dict[sid][2]; if (tm && f.bye) teamBye[tm] = f.bye; }
  const byeOf = (sid) => teamBye[(dict[sid] || [])[2]] || null;
  const pfRank = Object.fromEntries([...teams].sort((a, b) => b.pf - a.pf).map((t, i) => [t.rid, i + 1]));
  const standRank = Object.fromEntries([...teams].sort((a, b) => b.w - a.w || b.pf - a.pf).map((t, i) => [t.rid, i + 1]));
  const schedule = [];
  for (let w = week; w <= regEnd; w++) {
    const ms = (raw.matchups && raw.matchups[w]) || [];
    const mine = ms.find((x) => x.roster_id === myRid);
    if (!mine || mine.matchup_id == null) continue;
    const opp = ms.find((x) => x.matchup_id === mine.matchup_id && x.roster_id !== myRid);
    const o = opp && byRid[opp.roster_id];
    if (!o) continue;
    const a = sim[myRid], b = sim[o.rid];
    const winProb = phi((a.strength - b.strength) / Math.sqrt(a.sd ** 2 + b.sd ** 2));
    const last3 = o.weeks.slice(-3).map((x) => x.pts);
    const form = o.avgPts && last3.length ? avg(last3) - o.avgPts : 0;
    schedule.push({
      week: w, rid: o.rid, winProb,
      record: `${o.w}-${o.l}${o.t ? '-' + o.t : ''}`, standing: standRank[o.rid], pfRank: pfRank[o.rid],
      avgPts: o.avgPts, last3: last3.length ? avg(last3) : null, form,
      results: o.weeks.slice(-5).map((x) => { const opp2 = (raw.matchups[x.w] || []).find((y) => y.matchup_id === x.mid && y.roster_id !== o.rid); return opp2 ? (x.pts > opp2.points ? 'W' : x.pts < opp2.points ? 'L' : 'T') : '?'; }),
      myByes: me.winNowIds.filter((sid) => byeOf(sid) === w),
      oppByes: o.winNowIds.filter((sid) => byeOf(sid) === w),
      posture: o.posture.tone,
    });
  }
  const myStarterInj = me.winNowIds.filter((sid) => { const inj = (dict[sid] || [])[4]; return inj && /out|ir|doubtful|pup|sus/i.test(inj); });

  // -- value over time: from the startup draft (or this season / this rookie draft) to today,
  // with a bridge and a per-asset ledger (see lib/valuetime.js)
  let valueTime = null;
  const DAY_MS = 86400e3;
  const vot = ctx.vot;
  if (vot && vot.draftAt) {
    const pickKeyOf = (p) => `k:${p.season}:${p.round}:${p.orig}`;
    const keysOf = (sd) => ({ inn: [...sd.inP.map((x) => `p:${x}`), ...sd.inK.map((x) => x.key)], out: [...sd.outP.map((x) => `p:${x}`), ...sd.outK.map((x) => x.key)], released: (sd.released || []).map((x) => `p:${x}`) });
    const moves = [];
    // Trades, priced exactly as Trade summary prices them ("Net then").
    for (const [list, src] of [[leagueTrades, 'cur'], [histTrades, 'old']]) {
      for (const nt of list) {
        if (!nt.created) continue;
        const sides = {}, net = {};
        for (const rid of nt.rids) {
          sides[rid] = keysOf(nt.sides[rid]);
          if (nt.deal && nt.deal[rid]) net[rid] = nt.deal[rid].got - nt.deal[rid].gave;
        }
        moves.push({ at: nt.created, kind: 'trade', id: nt.id, src, sides, net, vals: nt.thenVals || null });
      }
    }
    // Waivers, free agents and drops: this season and earlier seasons (mapped to today's teams).
    const seasonMap = { [season]: (rid) => rid };
    const seasonRosters = { [season]: raw.rosters || [] };
    for (const h of raw.history || []) { if (mapByH.has(h)) seasonMap[Number(h.season)] = mapByH.get(h); seasonRosters[Number(h.season)] = h.rosters || []; }
    const addMove = (t, mapR) => {
      const sides = {};
      const side = (rid) => (sides[rid] ||= { inn: [], out: [], released: [] });
      for (const [pid, rid] of Object.entries(t.adds || {})) side(mapR(rid)).inn.push(`p:${pid}`);
      for (const [pid, rid] of Object.entries(t.drops || {})) side(mapR(rid)).released.push(`p:${pid}`);
      moves.push({ at: t.created, kind: 'move', sides });
    };
    for (const t of raw.txns || []) if (t.type !== 'trade' && t.status === 'complete') addMove(t, seasonMap[season]);
    for (const h of raw.history || []) for (const t of h.moves || []) if (mapByH.has(h)) addMove(t, mapByH.get(h));
    // Drafts: the oldest one is the startup draft (the starting rosters); every
    // later one swaps each team's picks for the players it took.
    const drafts = (raw.drafts || []).filter((d) => d.picks && d.picks.length).map((d) => ({ ...d, at: Number(d.lastPicked || d.startTime) || 0 })).filter((d) => d.at).sort((x, y) => x.at - y.at);
    const startup = drafts[0] || null;
    const consumedAt = {};
    for (const d of drafts) {
      const y = Number(d.season);
      consumedAt[y] = Math.max(consumedAt[y] || 0, d.at);
      if (d === startup) continue;
      const mapR = seasonMap[y] || ((rid) => rid);
      const slotRoster = { ...(d.slotToRoster || {}) };
      if (!Object.keys(slotRoster).length) {
        const byOwner = Object.fromEntries((seasonRosters[y] || []).map((r) => [String(r.owner_id), r.roster_id]));
        for (const [uid, slot] of Object.entries(d.draftOrder || {})) if (byOwner[uid]) slotRoster[slot] = byOwner[uid];
      }
      const sides = {};
      for (const pk of d.picks) {
        if (!pk.player_id || !pk.roster_id) continue;
        const rid = mapR(pk.roster_id);
        const orig = mapR(Number(slotRoster[pk.draft_slot]) || pk.roster_id);
        const sd = (sides[rid] ||= { inn: [], out: [], released: [] });
        sd.inn.push(`p:${pk.player_id}`);
        sd.out.push(`k:${y}:${pk.round}:${orig}`);
      }
      moves.push({ at: d.at, kind: 'draft', sides, season: y });
    }
    const memo = new Map();
    // ts: the loaded snapshot date to value with; real: when the asset is held.
    // A pick is worth its pick value until its draft, then nothing (it became a player).
    const pickGone = (y, real) => (consumedAt[y] ? real > consumedAt[y] : y < season);
    const valueAt = (key, ts, real) => {
      let gone = false;
      if (key.startsWith('k:')) gone = pickGone(Number(key.split(':')[1]), real);
      const mk = `${key}@${ts}@${gone ? 1 : 0}`;
      if (memo.has(mk)) return memo.get(mk);
      const sha = vot.byDate && vot.byDate[ts];
      const dp = sha && vot.snaps ? vot.snaps[sha] : null;
      let v;
      if (key.startsWith('k:')) {
        const [, y, r] = key.split(':');
        const a = { kind: 'pick', season: Number(y), round: Number(r) };
        v = gone ? 0 : dp ? dpValue(dp, a) : pickValue(book, Number(y), Number(r), 'mid');
      } else {
        const a = asset(key.slice(2));
        v = dp ? dpValue(dp, a) : a.v;
      }
      memo.set(mk, v || 0);
      return v || 0;
    };
    const posOf = (key) => (key.startsWith('k:') ? 'Picks' : VALUE_POS.includes(P(key.slice(2)).pos) ? P(key.slice(2)).pos : 'Other');
    const loaded = Object.keys(vot.byDate || {}).map(Number).sort((a, b) => a - b);
    const nearest = (ts) => { let best = null; for (const d of loaded) { if (d <= ts) best = d; else break; } return best ?? loaded[0]; };
    const vAt = (key, ts) => valueAt(key, vot.byDate && vot.byDate[ts] ? ts : nearest(ts), ts);
    const livePick = new Map(picks.map((p) => [pickKeyOf(p), p.v]));
    const endValueOf = (key) => {
      if (key.startsWith('k:')) { const [, y, r] = key.split(':'); return pickGone(Number(y), now) ? 0 : livePick.get(key) ?? pickValue(book, Number(y), Number(r), 'mid'); }
      return asset(key.slice(2)).v || 0;
    };
    const tm = teams.map((t) => ({ rid: t.rid, keys: [...(t.roster.players || []).map((x) => `p:${x}`), ...t.picks.map(pickKeyOf)], endValue: t.totalValue }));
    const run = (start, from) => { const r = valueOverTime({ teams: tm, moves, start, now, valueAt: vAt, posOf, endValueOf }); r.from = from; return r; };
    const windows = {};
    if (startup && loaded.length && loaded[0] <= startup.at + 7 * DAY_MS) windows.startup = run(startup.at, 'startup');
    if (vot.seasonStart && vot.seasonStart < vot.draftAt - 7 * DAY_MS) windows.season = run(vot.seasonStart, 'season');
    windows.draft = run(vot.draftAt, 'draft');
    valueTime = { windows, startup: startup ? { season: Number(startup.season), at: startup.at } : null };
    const curCount = {}, oldCount = {};
    for (const nt of leagueTrades) for (const r of nt.rids) curCount[r] = (curCount[r] || 0) + 1;
    for (const nt of histTrades) for (const r of nt.rids) oldCount[r] = (oldCount[r] || 0) + 1;
    valueTime.tradeCounts = { cur: curCount, old: oldCount };
    if (windows.draft.endSource === 'book') for (const t of teams) {
      const other = t.value - sum(VALUE_POS.map((pos) => t.posValue[pos] || 0));
      const bp = { ...Object.fromEntries(VALUE_POS.map((pos) => [pos, t.posValue[pos] || 0])), Picks: t.pickValue, Other: Math.max(0, other) };
      for (const w of Object.values(windows)) w.rows[t.rid].endByPos = bp;
    }
  }

  const brief = buildBrief({ teams, byRid, me, myRid, pending, offers, leagueTrades, demand, block, picks, startSit, sellHigh, buyLow, season, week, S, prefs, now, P, aging });

  return {
    builtAt: now,
    draftOrderMethod: orderMethod,
    league: { id: L.league_id, name: L.name, season, week, regEnd, deadline: S.trade_deadline || null, slots, rounds, teams: teams.length, playoffTeams: S.playoff_teams || 6, scoring: L.scoring_settings, format: book.fmt },
    me: myRid,
    myStrategy,
    teams,
    byRid,
    picks,
    pickSeasons,
    lockedSeasons,
    positional,
    leagueTrades,
    valueTime,
    histTrades,
    offers,
    pending,
    block,
    demand,
    finder,
    finderSkipped,
    finderOpts,
    myCuffsHeldBy,
    aging,
    schedule,
    myStarterInj,
    myOffers,
    incoming,
    leagueDrafts,
    playerMoves,
    teamBye,
    market: { risers, fallers, sellHigh, buyLow, hasKtcHistory: !!weekAgoKey },
    startSit,
    brief,
    snapUpdates,
    notes,
    valueSource: book.primary,
  };
}

function phi(z) {
  // standard normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function simulate(teams, raw, { week, regEnd, playoffTeams, byes = 0 }) {
  const out = {};
  const pts = {};
  for (const t of teams) pts[t.rid] = [];
  for (const w of Object.keys(raw.matchups || {}).map(Number)) {
    if (w >= week || w > regEnd) continue;
    for (const m of raw.matchups[w] || []) if (m.points > 0 && pts[m.roster_id]) pts[m.roster_id].push(m.points);
  }
  const allPts = Object.values(pts).flat();
  const leagueAvg = allPts.length ? avg(allPts) : 110;
  const avgNow = avg(teams.map((t) => t.winNow)) || 1;
  const strength = {};
  // Everything on the "best lineup" scale: each team is assumed to start its best
  // lineup from here on. History uses each week's optimal points (max PF), and the
  // current roster's best lineup (healthy players' points per game) carries more
  // weight, so recent trades and injuries count.
  const optAll = teams.flatMap((t) => (t.weeks || []).map((x) => x.opt)).filter((x) => x > 0);
  const optLeague = optAll.length ? avg(optAll) : leagueAvg / 0.88;
  const bestVals = teams.map((t) => t.bestNow).filter((x) => x > 0);
  const bestLeague = bestVals.length ? avg(bestVals) : optLeague;
  for (const t of teams) {
    const hist = (t.weeks || []).map((x) => x.opt).filter((x) => x > 0);
    const n = hist.length;
    const own = n ? avg(hist) : optLeague;
    const shrunk = (own * n + optLeague * 6) / (n + 6);
    // Best lineup now, rescaled so the league average matches the history scale.
    const now = t.bestNow > 0 ? t.bestNow * (optLeague / bestLeague) : shrunk;
    const mean = 0.45 * shrunk + 0.55 * now;
    const spread = n >= 4 ? Math.sqrt(avg(hist.map((x) => (x - own) ** 2))) : 0;
    strength[t.rid] = { mean, sd: Math.max(20, 0.19 * mean, spread * 0.9) };
  }
  const sched = [];
  for (let w = week; w <= regEnd; w++) {
    const ms = (raw.matchups && raw.matchups[w]) || [];
    const byM = {};
    for (const m of ms) if (m.matchup_id != null) (byM[m.matchup_id] ||= []).push(m.roster_id);
    const pairs = Object.values(byM).filter((p) => p.length === 2);
    if (pairs.length) sched.push(pairs);
  }
  const N = 3000;
  const r = rng(1234567);
  const made = {}, wins = {}, rankSum = {}, seeds = {};
  for (const t of teams) { made[t.rid] = 0; wins[t.rid] = 0; rankSum[t.rid] = 0; seeds[t.rid] = new Array(teams.length).fill(0); }
  for (let i = 0; i < N; i++) {
    const W = {}, PF = {};
    for (const t of teams) { W[t.rid] = t.w + t.t / 2; PF[t.rid] = t.pf; }
    for (const pairs of sched) {
      for (const [a, b] of pairs) {
        if (!strength[a] || !strength[b]) continue;
        const sa = strength[a].mean + strength[a].sd * normal(r);
        const sb = strength[b].mean + strength[b].sd * normal(r);
        PF[a] += sa; PF[b] += sb;
        if (sa > sb) W[a]++; else W[b]++;
      }
    }
    const order = teams.map((t) => t.rid).sort((x, y) => W[y] - W[x] || PF[y] - PF[x]);
    order.forEach((rid, k) => {
      rankSum[rid] += k + 1;
      seeds[rid][k]++;
      if (k < playoffTeams) made[rid]++;
      wins[rid] += W[rid];
    });
  }
  for (const t of teams) {
    out[t.rid] = {
      playoffOdds: sched.length ? made[t.rid] / N : null,
      expWins: wins[t.rid] / N,
      expRank: rankSum[t.rid] / N,
      strength: strength[t.rid].mean,
      sd: strength[t.rid].sd,
      seedOdds: seeds[t.rid].map((x) => x / N),
      topSeed: seeds[t.rid][0] / N,
      byeOdds: byes ? seeds[t.rid].slice(0, byes).reduce((a, b) => a + b, 0) / N : null,
    };
  }
  return out;
}

function buildBrief(c) {
  const { teams, byRid, me, myRid, pending, offers, leagueTrades, demand, block, picks, startSit, sellHigh, buyLow, season, week, S, prefs, now, P, aging } = c;
  const items = [];
  const name = (rid) => (byRid[rid] ? byRid[rid].name : 'someone');
  const assetNames = (side) => [...side.inP.map((sid) => P(sid).name), ...side.inK.map((k) => k.label)].join(', ') || 'nothing';

  for (const o of pending) {
    const g = o.now && o.now[myRid];
    items.push({ rids: [o.other],
      score: 100, kind: 'offer', tone: g && g.gain >= 0 ? 'good' : 'bad',
      title: `${o.fromMe ? 'Your offer to' : 'Offer from'} ${name(o.other)} is waiting`,
      body: `You get ${assetNames(o.sides[myRid])}; they get ${assetNames(o.sides[o.other])}.${g ? ` KTC grade for you: ${g.grade} (${g.gain >= 0 ? '+' : ''}${Math.round(g.gain * 100)}%).` : ''}`,
      link: { tab: 'trades', sub: 'offers' },
    });
  }

  if (startSit) {
    const real = startSit.swaps.filter((s) => s.start && (!s.sit || s.start.pts - s.sit.pts >= 1));
    const urgent = startSit.flags.filter((f) => f.kind === 'bye' || f.kind === 'out');
    if (urgent.length || startSit.empty.length) {
      items.push({ score: 95, kind: 'lineup', tone: 'bad', title: `Fix your week ${week} lineup`, body: [...urgent.map((f) => f.text + ' and is in your lineup'), ...startSit.empty.map((s) => `Your ${s} slot is empty`)].join('. ') + '.', link: { tab: 'startsit' } });
    } else if (real.length && startSit.bestPts - startSit.currentPts >= 1.5) {
      items.push({ score: 75, kind: 'lineup', tone: 'warn', title: `${real.length} lineup change${real.length > 1 ? 's' : ''} worth ${Math.round((startSit.bestPts - startSit.currentPts) * 10) / 10} projected points`, body: real.slice(0, 3).map((s) => `Start ${s.start.name}${s.sit ? ` over ${s.sit.name}` : ''}`).join('; ') + '.', link: { tab: 'startsit' } });
    }
  }

  const lastSeen = prefs.lastSeen || 0;
  for (const nt of leagueTrades.filter((t) => t.created > lastSeen && now - t.created < 14 * DAYMS).slice(0, 4)) {
    const w = nt.winner;
    items.push({ rids: nt.rids,
      score: 72, kind: 'trade', tone: 'info',
      title: `New trade: ${nt.rids.map(name).join(' ↔ ')}`,
      body: nt.rids.map((r) => `${name(r)} got ${assetNames(nt.sides[r])} (${nt.now ? nt.now[r].grade : '?'})`).join('. ') + (w ? `. KTC edge: ${name(w)}.` : '. KTC calls it fair.'),
      link: { tab: 'trades', sub: 'ledger', id: nt.id },
    });
  }

  if (S.trade_deadline && week <= S.trade_deadline) {
    const left = S.trade_deadline - week;
    if (left <= 2) items.push({ score: 70, kind: 'deadline', tone: left <= 2 ? 'warn' : 'info', title: left === 0 ? 'Trade deadline is this week' : `${left} week${left > 1 ? 's' : ''} to the trade deadline (week ${S.trade_deadline})`, body: 'Contenders pay the most right before it.', link: { tab: 'trades', sub: 'finder' } });
  }

  for (const d of demand.filter((x) => x.suitors.some((s) => s.why.some((w) => w.k === 'asked'))).slice(0, 3)) {
    const s = d.suitors[0];
    items.push({ rids: [s.rid], sid: d.asset.id, score: 80, kind: 'demand', tone: 'good', title: `${name(s.rid)} wants ${d.asset.name}`, body: s.why.map((w) => w.text).join('. ') + '.', link: { tab: 'demand' } });
  }
  for (const d of demand.filter((x) => x.heat >= 4 && !x.suitors.some((s) => s.why.some((w) => w.k === 'asked')) && !byRid[x.suitors[0].rid].avoid).slice(0, 2)) {
    const s = d.suitors[0];
    items.push({ rids: [s.rid], sid: d.asset.id, score: 55, kind: 'demand', tone: 'good', title: `Likely buyer for ${d.asset.name}: ${name(s.rid)}`, body: s.why.map((w) => w.text).join('. ') + '.', link: { tab: 'demand' } });
  }

  for (const t of teams.filter((x) => !x.isMe && x.posture.label === 'TANKING').sort((a, b) => a.posture.score - b.posture.score).slice(0, 2)) {
    const vets = t.assets.filter((a) => a.age >= 26 && a.redraft >= 2500).slice(0, 4);
    items.push({ rids: [t.rid], score: 66, kind: 'posture', tone: 'sell', title: `${t.name} is tanking (${t.w}-${t.l})`, body: `${t.posture.evidence.filter((e) => e.dir === 'sell').slice(0, 2).map((e) => e.text).join('. ')}.${vets.length ? ` Vets he should sell: ${vets.map((a) => a.name).join(', ')}.` : ''}`, link: { tab: 'subjects', id: t.rid } });
  }
  for (const t of teams.filter((x) => !x.isMe && x.posture.label === 'ALL-IN').sort((a, b) => b.posture.score - a.posture.score).slice(0, 2)) {
    items.push({ rids: [t.rid], score: 62, kind: 'posture', tone: 'buy', title: `${t.name} is all-in (${t.w}-${t.l})`, body: `${t.posture.evidence.filter((e) => e.dir === 'buy').slice(0, 2).map((e) => e.text).join('. ')}.${t.needs.length ? ` Needs ${t.needs.join(', ')}.` : ''}`, link: { tab: 'subjects', id: t.rid } });
  }

  const recentBlock = block.filter((b) => b.rid !== myRid && b.at && now - b.at < 7 * DAYMS && (b.kind === 'pick' || me.needs.includes(b.pos)));
  if (recentBlock.length) items.push({ rids: [...new Set(recentBlock.slice(0, 5).map((b) => b.rid))], score: 52, kind: 'block', tone: 'info', title: `New on the trade block this week`, body: recentBlock.slice(0, 5).map((b) => `${b.name || b.label} (${name(b.rid)})`).join(', ') + '.', link: { tab: 'subjects' } });

  const top1 = picks.filter((p) => p.season === season + 1 && p.round === 1 && p.slot && p.slot <= 3).sort((a, b) => a.slot - b.slot);
  for (const p of top1.slice(0, 2)) {
    items.push({ rids: [...new Set([p.orig, p.owner])], score: 45, kind: 'pick', tone: 'info', title: `${name(p.orig)}'s ${p.season} 1st projects as pick 1.${String(p.slot).padStart(2, '0')}`, body: p.owner === p.orig ? `${name(p.orig)} still owns it.` : `${name(p.owner)} owns it now.`, link: { tab: 'picks' } });
  }

  if (sellHigh.length) items.push({ score: 42, kind: 'market', tone: 'warn', title: `Sell-high window: ${sellHigh.slice(0, 2).map((a) => a.name).join(', ')}`, body: sellHigh.slice(0, 3).map((a) => `${a.name} +${Math.round(a.pct30 * 100)}% in 30 days at age ${Math.round(a.age)}`).join('; ') + '.', link: { tab: 'market' } });
  if (buyLow.length) items.push({ rids: [...new Set(buyLow.slice(0, 3).map((a) => a.rid))], score: 40, kind: 'market', tone: 'info', title: `Buy-low: ${buyLow.slice(0, 2).map((a) => a.name).join(', ')}`, body: buyLow.slice(0, 3).map((a) => `${a.name} (${name(a.rid)}) ${Math.round(a.pct30 * 100)}% in 30 days`).join('; ') + '.', link: { tab: 'market' } });

  if (aging && me.trajectory && me.trajectory[0] > 0) {
    const [y0, , y2] = me.trajectory;
    const drop = y2 / y0 - 1;
    if (drop <= -0.06) items.push({ score: 58, kind: 'aging', tone: 'warn', title: `Your lineup is aging: ${Math.round(y0)} → ${Math.round(y2)} points per week by ${season + 2}`, body: `Your best lineup projects ${Math.round(drop * 100)}% lower in two seasons (league rank ${ordinal(me.trajRank[0])} now, ${ordinal(me.trajRank[2])} then). ${aging.sell.length ? `Sell before the drop: ${aging.sell.slice(0, 3).map((p) => p.name).join(', ')}.` : ''}`, link: { tab: 'rising' } });
    const t2 = aging.targets.filter((x) => x.rid != null && !byRid[x.rid].avoid).sort((a, b) => (b.fitsNeed ? 1 : 0) - (a.fitsNeed ? 1 : 0) || b.next3 - a.next3).slice(0, 2);
    for (const x of t2) items.push({ rids: [x.rid], sid: x.id, score: 50, kind: 'aging', tone: 'good', title: `Coming into his peak: ${x.name} (${x.pos}, ${Math.floor(x.age)})`, body: `Projects ${x.seasons[1].ppg.toFixed(1)} points per game next season and ${x.seasons[2].ppg.toFixed(1)} the year after. Owned by ${byRid[x.rid].name}${byRid[x.rid].posture.tone === 'sell' ? ', who is selling' : ''}.`, link: { tab: 'rising' } });
  }

  if (me.playoffOdds != null) items.push({ rids: [me.rid], score: 35, kind: 'odds', tone: me.playoffOdds >= 0.5 ? 'good' : 'warn', title: `Your playoff odds: ${Math.round(me.playoffOdds * 100)}%`, body: `${me.w}-${me.l}, ${Math.round(me.pf)} points. Projected ${Math.round(me.expWins * 10) / 10} wins. Your posture reads ${me.posture.label.toLowerCase()}.`, link: { tab: 'subjects', id: me.rid } });

  return items.sort((a, b) => b.score - a.score);
}

export { fmtK, dateStr, daysAgo, ordinal, dur };
