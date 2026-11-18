// Player and pick values: KeepTradeCut (primary), FantasyCalc (second
// opinion + redraft value), DynastyProcess (ID crosswalk + fallback values).
// Everything is cached in extension storage and folded into one compact
// "value book" that both the dashboard and the background worker read.

import { store, normName, canonPos, canonTeam } from './util.js';
import { fetchText, fetchJSON, parseCSV, extractScriptJSON, extractAssigned, HOUR, DAY } from './net.js';

const DP = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/';
const KTC_URLS = [
  'https://keeptradecut.com/trade-calculator',
  'https://keeptradecut.com/dynasty-rankings',
];

// ---- cache helper ------------------------------------------------------------

export async function cached(key, ttl, loader, { force = false } = {}) {
  const hit = await store.get(key, null);
  if (!force && hit && Date.now() - hit.at < ttl) return { ...hit, fresh: false };
  try {
    const data = await loader();
    const rec = { at: Date.now(), data };
    await store.set(key, rec);
    return { ...rec, fresh: true };
  } catch (e) {
    if (hit) return { ...hit, fresh: false, error: e.message, stale: true };
    throw e;
  }
}

// ---- pick labels -----------------------------------------------------------------

const ORD = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, first: 1, second: 2, third: 3, fourth: 4 };

// "2027 Mid 1st", "2027 1st (Early)", "2027 Round 1", "2026 Pick 1.05" → key
export function pickKey(label) {
  const s = String(label || '').toLowerCase();
  const y = /\b(20\d\d)\b/.exec(s);
  if (!y) return null;
  const slot = /\b([1-9])\.(\d{1,2})\b/.exec(s);
  if (slot) return `${y[1]} ${Number(slot[1])} ${tierForSlot(Number(slot[2]))}`;
  const tierM = /\b(early|mid|late)\b/.exec(s);
  let round = null;
  const r1 = /\bround\s*([1-9])\b/.exec(s) || /\br([1-9])\b/.exec(s);
  if (r1) round = Number(r1[1]);
  else for (const tok of s.replace(/[()]/g, ' ').split(/\s+/)) if (ORD[tok]) { round = ORD[tok]; break; }
  if (!round) return null;
  return `${y[1]} ${round} ${tierM ? tierM[1] : 'any'}`;
}

export function tierForSlot(slot, teams = 12) {
  const third = teams / 3;
  if (slot <= third) return 'early';
  if (slot <= 2 * third) return 'mid';
  return 'late';
}

// ---- sources ------------------------------------------------------------------------

export async function loadCrosswalk(opts) {
  return cached('src:crosswalk', 3 * DAY, async () => {
    const rows = parseCSV(await fetchText(DP + 'db_playerids.csv', { timeout: 60000 }));
    const out = [];
    for (const r of rows) {
      if (!r.sleeper_id) continue;
      out.push([r.sleeper_id, r.ktc_id || '', r.fantasypros_id || '', r.name || '', r.position || '', r.team || '']);
    }
    if (out.length < 1000) throw new Error('ID crosswalk looked incomplete');
    return out;
  }, opts);
}

function alt(block, key, tierKeys) {
  const base = Number(block && block[key]) || 0;
  if (!base) return null;
  return [base, ...tierKeys.map((k) => {
    const t = block[k];
    if (t && Number(t[key])) return Number(t[key]);
    return t && t.value && block.value ? Math.round(base * (t.value / block.value)) : base;
  })];
}

function parseKtc(html) {
  let arr = extractScriptJSON(html, 'ktc-players');
  if (!Array.isArray(arr)) arr = extractAssigned(html, 'playersArray');
  if (!Array.isArray(arr) || arr.length < 100) return null;
  const tierKeys = ['tep', 'tepp', 'teppp'];
  const players = [];
  for (const e of arr) {
    const o = e.oneQBValues || {};
    const sf = e.superflexValues || {};
    const pick = e.position === 'RDP' || e.position === 'PICK';
    const row = {
      id: String(e.playerID ?? e.playerId ?? ''),
      name: e.playerName || '',
      pos: pick ? 'PICK' : canonPos(e.position),
      team: canonTeam(e.team),
      age: e.age ?? null,
      v: [o.value || 0, ...tierKeys.map((k) => (o[k] && o[k].value) || o.value || 0)],
      sf: [sf.value || 0, ...tierKeys.map((k) => (sf[k] && sf[k].value) || sf.value || 0)],
      // KTC's other value sources: Tradesourced (vftValue) and Crowd + Trades (blendValue).
      // TE-premium tiers use the source's own number when KTC has one, else the crowd TE+ bump.
      vt: alt(o, 'vftValue', tierKeys), sft: alt(sf, 'vftValue', tierKeys),
      vb: alt(o, 'blendValue', tierKeys), sfb: alt(sf, 'blendValue', tierKeys),
      rank: o.rank || null,
      posRank: o.positionalRank || null,
      trend: o.overallTrend ?? null,
      sfTrend: sf.overallTrend ?? null,
    };
    players.push(row);
  }
  return players;
}

export async function loadKtc(opts) {
  return cached('src:ktc2', 6 * HOUR, async () => {
    let lastErr = null;
    for (const url of KTC_URLS) {
      try {
        // Send the browser's own keeptradecut.com cookies, so a site check you've
        // already passed in Chrome also covers this request.
        const players = parseKtc(await fetchText(url, { timeout: 40000, credentials: 'include' }));
        if (players) return players;
        lastErr = new Error('KeepTradeCut changed its page layout — values not found');
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }, opts);
}

export async function loadFantasyCalc(fmt, opts) {
  const p = new URLSearchParams({ isDynasty: 'true', numQbs: String(fmt.qbs), numTeams: String(fmt.teams), ppr: String(fmt.ppr), includeAdp: 'false' });
  if (fmt.fcTep) p.set('tep', fmt.fcTep);
  return cached(`src:fc:${p}`, 6 * HOUR, async () => {
    const arr = await fetchJSON('https://api.fantasycalc.com/values/current?' + p, { timeout: 30000 });
    if (!Array.isArray(arr) || arr.length < 100) throw new Error('FantasyCalc returned too few players');
    return arr.map((e) => ({
      sid: e.player.sleeperId ? String(e.player.sleeperId) : '',
      name: e.player.name,
      pos: e.player.position === 'PICK' ? 'PICK' : canonPos(e.player.position),
      team: canonTeam(e.player.maybeTeam),
      age: e.player.maybeAge ?? null,
      v: e.value || 0,
      rv: e.redraftValue || 0,
      t30: e.trend30Day || 0,
      posRank: e.positionRank || null,
      fcId: e.player.id ?? null,
    }));
  }, opts);
}

export async function loadDpValues(opts) {
  return cached('src:dpvalues', DAY, async () => {
    const [pl, pk] = await Promise.all([fetchText(DP + 'values-players.csv'), fetchText(DP + 'values-picks.csv')]);
    return {
      players: parseCSV(pl).map((r) => ({ fp: r.fp_id, name: r.player, pos: canonPos(r.pos), team: canonTeam(r.team), v1: Number(r.value_1qb) || 0, v2: Number(r.value_2qb) || 0 })),
      picks: parseCSV(pk).map((r) => ({ name: r.player, ecr1: Number(r.ecr_1qb) || 0 })),
    };
  }, opts);
}

// ---- value book ---------------------------------------------------------------------

export function leagueFormat(league) {
  const ss = league.scoring_settings || {};
  const rp = league.roster_positions || [];
  const qbs = rp.filter((p) => p === 'QB').length + rp.filter((p) => p === 'SUPER_FLEX').length;
  const teSlots = rp.filter((p) => p === 'TE').length;
  const tep = Number(ss.bonus_rec_te || 0);
  const fcTep = teSlots >= 2 || tep > 1 ? 'te++' : tep >= 0.5 ? 'te+' : null;
  // KTC's TE premium levels: TE+ = +0.5 per TE catch, TE++ = +1.0, TE+++ = +1.5.
  const ktcTier = tep >= 1.5 ? 3 : tep >= 1 ? 2 : tep >= 0.5 ? 1 : 0;
  return {
    qbs: Math.min(2, Math.max(1, qbs)),
    superflex: qbs >= 2,
    teams: league.total_rosters || 12,
    ppr: Number(ss.rec ?? 1),
    tep,
    fcTep,
    ktcTier,
  };
}

// sleeperDict: { sid: [name,pos,team,...] }
export function buildBook({ fmt, ktc, fc, dp, crosswalk, sleeperDict, status }) {
  const players = {};   // sid → [ktc, fc, redraft, fcTrend30, ktcRank, ktcPosRank, ktcTrend, dynastyProcess]
  const picks = {};     // key → [ktc, fc]
  const cw = { byKtc: {}, byFp: {} };
  for (const [sid, k, f] of crosswalk || []) {
    if (k) cw.byKtc[k] = sid;
    if (f) cw.byFp[f] = sid;
  }
  const nameIdx = {};
  for (const [sid, d] of Object.entries(sleeperDict || {})) {
    const key = `${normName(d[0])}|${canonPos(d[1])}`;
    if (!nameIdx[key] || d[2]) nameIdx[key] = sid;
  }
  const byName = (name, pos) => nameIdx[`${normName(name)}|${canonPos(pos)}`] || null;
  // [8] KTC value in the other QB format (SF if you're 1QB and vice versa), [9] FantasyCalc player id, [10] FC position rank
  const slot = (sid) => (players[sid] ||= [null, null, null, null, null, null, null, null, null, null, null]);

  let ktcTop = 0;
  const alts = { trade: { players: {}, picks: {}, top: 0 }, blend: { players: {}, picks: {}, top: 0 } };
  if (ktc) {
    const vi = fmt.ktcTier; // index into v[]: 0 base, 1 TE+, 2 TE++, 3 TE+++
    for (const p of ktc) {
      const val = fmt.superflex ? p.sf[p.pos === 'TE' ? vi : 0] : p.v[p.pos === 'TE' ? vi : 0];
      ktcTop = Math.max(ktcTop, val);
      const altVal = (one, two) => { const arr = fmt.superflex ? two : one; return arr ? arr[p.pos === 'TE' ? vi : 0] || null : null; };
      const tv = altVal(p.vt, p.sft), bv = altVal(p.vb, p.sfb);
      if (tv) alts.trade.top = Math.max(alts.trade.top, tv);
      if (bv) alts.blend.top = Math.max(alts.blend.top, bv);
      if (p.pos === 'PICK') {
        const k = pickKey(p.name);
        if (k) {
          (picks[k] ||= [null, null])[0] = val;
          if (tv) alts.trade.picks[k] = tv;
          if (bv) alts.blend.picks[k] = bv;
        }
        continue;
      }
      const sid = cw.byKtc[p.id] || byName(p.name, p.pos);
      if (!sid) continue;
      if (tv) alts.trade.players[sid] = tv;
      if (bv) alts.blend.players[sid] = bv;
      const s = slot(sid);
      s[0] = val; s[4] = p.rank; s[5] = p.posRank; s[6] = fmt.superflex ? p.sfTrend : p.trend;
      s[8] = fmt.superflex ? p.v[p.pos === 'TE' ? vi : 0] : p.sf[p.pos === 'TE' ? vi : 0];
    }
  }
  if (fc) {
    for (const p of fc) {
      if (p.pos === 'PICK') {
        const k = pickKey(p.name);
        if (k) (picks[k] ||= [null, null])[1] = p.v;
        continue;
      }
      const sid = p.sid || byName(p.name, p.pos);
      if (!sid) continue;
      const s = slot(sid);
      s[1] = p.v; s[2] = p.rv; s[3] = p.t30; s[9] = p.fcId || null; s[10] = p.posRank || null;
    }
  }
  // DynastyProcess: shown as a third opinion; used for values only when KTC and FantasyCalc are missing.
  if (dp) {
    for (const p of dp.players) {
      const sid = cw.byFp[p.fp] || byName(p.name, p.pos);
      if (!sid) continue;
      slot(sid)[7] = fmt.superflex ? p.v2 : p.v1;
    }
  }
  // Scale FantasyCalc onto the KTC scale so the two can fill each other's gaps.
  const ratios = [];
  for (const s of Object.values(players)) if (s[0] > 500 && s[1] > 500) ratios.push(s[0] / s[1]);
  ratios.sort((a, b) => a - b);
  const fcToKtc = ratios.length > 20 ? ratios[Math.floor(ratios.length / 2)] : 1;
  return {
    builtAt: Date.now(),
    fmt,
    ktcTop: ktcTop || 9999,
    fcToKtc,
    primary: ktc ? 'KTC' : fc ? 'FantasyCalc' : dp ? 'DynastyProcess' : 'none',
    ktcSource: 'crowd',
    ktcAlts: Object.keys(alts.trade.players).length > 100 ? alts : null,
    status: status || {},
    players,
    picks,
  };
}

export const KTC_SOURCES = { crowd: 'Crowdsourced', blend: 'Crowd + Trades', trade: 'Tradesourced' };

// The book as seen through one of KTC's value sources. KTC's crowdsourced values
// are the default; Tradesourced and Crowd + Trades swap in their own numbers
// (and their own top value and FantasyCalc scale), everything else unchanged.
const viewCache = new WeakMap();
export function withKtcSource(book, src) {
  if (!book || !src || src === 'crowd' || !book.ktcAlts || !book.ktcAlts[src]) return book;
  let byBook = viewCache.get(book);
  if (!byBook) viewCache.set(book, (byBook = {}));
  if (byBook[src]) return byBook[src];
  const a = book.ktcAlts[src];
  const players = {};
  for (const [sid, s] of Object.entries(book.players)) {
    const v = a.players[sid];
    players[sid] = v != null ? [v, ...s.slice(1)] : s[0] != null ? [null, ...s.slice(1)] : s;
  }
  const picks = {};
  for (const [k, arr] of Object.entries(book.picks)) picks[k] = [a.picks[k] ?? null, ...arr.slice(1)];
  const ratios = [];
  for (const s of Object.values(players)) if (s[0] > 500 && s[1] > 500) ratios.push(s[0] / s[1]);
  ratios.sort((x, y) => x - y);
  const out = { ...book, players, picks, ktcTop: a.top || book.ktcTop, fcToKtc: ratios.length > 20 ? ratios[Math.floor(ratios.length / 2)] : book.fcToKtc, ktcSource: src };
  byBook[src] = out;
  return out;
}

// Primary dynasty value for a player (KTC scale), with where it came from.
export function playerValue(book, sid) {
  const s = book.players[String(sid)];
  if (!s) return { v: 0, ktc: null, fc: null, redraft: null, trend30: null, src: null };
  const v = s[0] != null ? s[0] : s[1] != null ? Math.round(s[1] * book.fcToKtc) : s[7] != null && book.primary === 'DynastyProcess' ? s[7] : 0;
  return {
    v,
    ktc: s[0],
    fc: s[1],
    redraft: s[2],
    trend30: s[3],
    ktcRank: s[4],
    ktcPosRank: s[5],
    ktcTrend: s[6],
    dp: s[7] ?? null,
    ktcOther: s[8] ?? null,
    fcId: s[9] ?? null,
    fcPosRank: s[10] ?? null,
    src: s[0] != null ? 'KTC' : s[1] != null ? 'FC' : s[7] != null ? 'DP' : null,
  };
}

// Value of a future pick. tier: early|mid|late|any.
export function pickValue(book, season, round, tier = 'mid') {
  const get = (y, t) => book.picks[`${y} ${round} ${t}`];
  const pickNum = (arr) => (arr ? (arr[0] != null ? arr[0] : arr[1] != null ? Math.round(arr[1] * book.fcToKtc) : null) : null);
  let v = pickNum(get(season, tier)) ?? pickNum(get(season, 'mid')) ?? pickNum(get(season, 'any'));
  if (v != null) return v;
  // Season further out than the sources list: use the latest listed year, discounted.
  const years = Object.keys(book.picks).map((k) => Number(k.split(' ')[0])).filter(Boolean);
  if (!years.length) return 0;
  const last = Math.max(...years);
  if (Number(season) > last) {
    const base = pickNum(get(last, 'mid')) ?? pickNum(get(last, 'any')) ?? 0;
    return Math.round(base * Math.pow(0.92, Number(season) - last));
  }
  return 0;
}
