// Start/sit: projects every player with the league's own scoring, blends in
// FantasyPros' consensus, and builds the best legal lineup around anyone
// already locked by kickoff.

const FLEX_ELIG = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
};
const OUT = new Set(['Out', 'IR', 'PUP', 'Sus', 'Suspended', 'NA', 'DNR', 'COV']);

export function eligible(slot, pos) {
  if (FLEX_ELIG[slot]) return FLEX_ELIG[slot].includes(pos);
  return slot === pos;
}

export function starterSlots(rosterPositions) {
  return (rosterPositions || []).filter((s) => !['BN', 'IR', 'TAXI'].includes(s));
}

// Score a Sleeper projection line with the league's scoring settings.
export function scoreLine(stats, scoring, pos) {
  if (!stats) return null;
  if (pos === 'DEF' || pos === 'K') return stats.pts_std ?? stats.pts_ppr ?? null;
  let s = 0, used = 0;
  for (const [k, w] of Object.entries(scoring || {})) {
    const v = stats[k];
    if (typeof v === 'number' && typeof w === 'number') { s += v * w; used++; }
  }
  if (!used || !Number.isFinite(s)) return stats.pts_ppr ?? null;
  return Math.round(s * 10) / 10;
}

// Fill slots greedily: fixed positions first, then flexes from most to least
// restrictive. Exact for QB/RB/WR/TE/FLEX-style rosters.
export function bestLineup(slots, players, value, fixed = {}) {
  const order = slots.map((s, i) => i).sort((a, b) => {
    const fa = FLEX_ELIG[slots[a]] ? FLEX_ELIG[slots[a]].length : 0;
    const fb = FLEX_ELIG[slots[b]] ? FLEX_ELIG[slots[b]].length : 0;
    return fa - fb;
  });
  const used = new Set(Object.values(fixed).filter(Boolean));
  const out = slots.map((_, i) => fixed[i] ?? null);
  for (const i of order) {
    if (out[i] !== null && i in fixed) continue;
    let best = null, bv = -Infinity;
    for (const p of players) {
      if (used.has(p.id) || !eligible(slots[i], p.pos)) continue;
      const v = value(p);
      if (v > bv) { bv = v; best = p; }
    }
    if (best) { out[i] = best.id; used.add(best.id); }
  }
  return out;
}

export function buildStartSit({ league, week, myRoster, matchupsThisWeek, dict, proj, fpBySid, now = Date.now() }) {
  const slots = starterSlots(league.roster_positions);
  const scoring = league.scoring_settings || {};
  const mine = matchupsThisWeek.find((m) => m.roster_id === myRoster.roster_id) || null;
  const current = mine ? mine.starters || [] : (myRoster.starters || []);
  const pool = (myRoster.players || []).filter((id) => !(myRoster.reserve || []).includes(id) && !(myRoster.taxi || []).includes(id));

  const info = (id) => {
    const d = dict[id] || [id, '', ''];
    const pos = d[1];
    const pr = proj[id];
    const fp = fpBySid[id];
    const sl = pr ? scoreLine(pr.stats, scoring, pos) : null;
    let fpPts = fp && fp.pts != null ? fp.pts : null;
    if (fpPts != null && pos === 'TE' && pr && pr.stats && scoring.bonus_rec_te) fpPts += (pr.stats.rec || 0) * scoring.bonus_rec_te;
    const parts = [sl, fpPts].filter((x) => x != null && Number.isFinite(x));
    const pts = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
    const inj = d[4] || '';
    const bye = !!(fp && fp.bye === week);
    const noProj = !pr && !fp;
    const out = OUT.has(inj) || bye || noProj;
    const kickoff = fp && fp.kickoff ? fp.kickoff : pr && pr.date ? Date.parse(pr.date) : null;
    const locked = !!(fp && /progress|final|complete|in_progress|post/i.test(fp.gameStatus || '')) || (kickoff && kickoff <= now);
    return {
      id, name: d[0], pos, team: d[2], inj, bye, noProj, out, locked,
      pts: out ? 0 : Math.round(pts * 10) / 10,
      sleeperPts: sl, fpPts: fpPts != null ? Math.round(fpPts * 10) / 10 : null,
      ecr: fp ? fp.ecr : null, posRank: fp ? fp.posRank : '', grade: fp ? fp.grade : '', opp: fp ? fp.opp : pr ? (pr.opp ? `vs ${pr.opp}` : '') : '',
      kickoff,
    };
  };

  const players = pool.map(info);
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  // Locked starters stay where they are; locked bench players can't come in.
  const fixed = {};
  current.forEach((id, i) => { if (id && id !== '0' && byId[id] && byId[id].locked) fixed[i] = id; });
  const candidates = players.filter((p) => !p.locked || Object.values(fixed).includes(p.id));
  const rec = bestLineup(slots, candidates, (p) => p.pts - (p.inj === 'Questionable' ? 0.6 : p.inj === 'Doubtful' ? 4 : 0), fixed);

  const total = (ids) => ids.reduce((s, id) => s + (byId[id] ? byId[id].pts : 0), 0);
  const curIds = slots.map((_, i) => current[i] && current[i] !== '0' ? current[i] : null);
  const swaps = [];
  const curSet = new Set(curIds.filter(Boolean));
  const recSet = new Set(rec.filter(Boolean));
  const ins = rec.filter((id) => id && !curSet.has(id)).map((id) => byId[id]).filter(Boolean);
  const outs = curIds.filter((id) => id && !recSet.has(id)).map((id) => byId[id] || { id, name: (dict[id] || [id])[0], pos: (dict[id] || [])[1], pts: 0 });
  ins.sort((a, b) => b.pts - a.pts);
  // Pair each player coming in with the one going out at the same position
  // when there is one, otherwise the weakest player leaving.
  const left = [...outs].sort((a, b) => a.pts - b.pts);
  for (const p of ins) {
    let i = left.findIndex((o) => o.pos === p.pos);
    if (i < 0) i = 0;
    swaps.push({ start: p, sit: left.length ? left.splice(i, 1)[0] : null });
  }
  for (const o of left) swaps.push({ start: null, sit: o });
  const empty = curIds.map((id, i) => (id ? null : slots[i])).filter(Boolean);

  const flags = [];
  for (const id of curIds) {
    const p = id && byId[id];
    if (!p) continue;
    if (p.bye) flags.push({ id, kind: 'bye', text: `${p.name} is on bye` });
    else if (OUT.has(p.inj)) flags.push({ id, kind: 'out', text: `${p.name} is ${p.inj}` });
    else if (p.inj === 'Doubtful' || p.inj === 'Questionable') flags.push({ id, kind: 'q', text: `${p.name} is ${p.inj}` });
  }

  return {
    week,
    slots,
    current: curIds,
    recommended: rec,
    players: byId,
    bench: players.filter((p) => !recSet.has(p.id)).sort((a, b) => b.pts - a.pts),
    currentPts: Math.round(total(curIds) * 10) / 10,
    bestPts: Math.round(total(rec) * 10) / 10,
    swaps,
    empty,
    flags,
    matchupId: mine ? mine.matchup_id : null,
  };
}

// Projected points for any roster's best lineup (for opponent previews).
export function projectedBest({ league, roster, dict, proj, fpBySid, week }) {
  const r = buildStartSit({ league, week, myRoster: roster, matchupsThisWeek: [], dict, proj, fpBySid });
  return r.bestPts;
}
