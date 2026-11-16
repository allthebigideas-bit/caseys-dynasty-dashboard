// Cross-league comparison: settings, how many players each league rosters by
// position, QB depth, and the players held in one league but not the other.

import * as sl from './sleeper.js';

const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const SCORE_KEYS = [
  ['rec', 'Points per catch'],
  ['bonus_rec_te', 'TE premium (extra per catch)'],
  ['bonus_rec_rb', 'RB bonus per catch'],
  ['bonus_rec_wr', 'WR bonus per catch'],
  ['pass_td', 'Passing TD'],
  ['pass_yd', 'Per passing yard'],
  ['pass_int', 'Interception'],
  ['rush_yd', 'Per rushing yard'],
  ['rec_yd', 'Per receiving yard'],
  ['rush_td', 'Rushing TD'],
  ['rec_td', 'Receiving TD'],
  ['bonus_pass_yd_300', '300+ passing yards bonus'],
  ['bonus_rush_yd_100', '100+ rushing yards bonus'],
  ['bonus_rec_yd_100', '100+ receiving yards bonus'],
  ['fum_lost', 'Fumble lost'],
];

// Fetch another league's settings and rosters (REST, public).
export async function fetchLeague(id) {
  const [league, rosters, users] = await Promise.all([sl.league(id), sl.leagueRosters(id), sl.leagueUsers(id).catch(() => [])]);
  return { at: Date.now(), league, rosters, users };
}

const round2 = (x) => Math.round(Number(x || 0) * 100) / 100;

function settingsOf(L) {
  const rp = L.roster_positions || [];
  const s = L.settings || {};
  const starters = rp.filter((x) => x !== 'BN' && x !== 'IR' && x !== 'TAXI');
  const sc = L.scoring_settings || {};
  return {
    name: (L.name || '').trim(),
    teams: L.total_rosters || 0,
    starters,
    startersTxt: summarise(starters),
    bench: rp.filter((x) => x === 'BN').length,
    taxi: Number(s.taxi_slots || 0),
    ir: Number(s.reserve_slots || 0),
    total: starters.length + rp.filter((x) => x === 'BN').length,
    sf: rp.includes('SUPER_FLEX') || rp.filter((x) => x === 'QB').length > 1,
    scoring: Object.fromEntries(SCORE_KEYS.map(([k]) => [k, round2(sc[k])])),
    type: s.type,
  };
}

function summarise(slots) {
  const c = {};
  for (const x of slots) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).map(([k, n]) => (n > 1 ? `${n} ${k}` : k)).join(', ');
}

function heldOf(rosters) {
  const all = [];
  let ir = 0, taxi = 0;
  const perTeam = [];
  for (const r of rosters || []) {
    const ps = r.players || [];
    all.push(...ps);
    ir += (r.reserve || []).length;
    taxi += (r.taxi || []).length;
    perTeam.push(ps.length);
  }
  return { set: new Set(all), total: all.length, ir, taxi, perTeam };
}

// a = our league, b = the other. dict: sleeper players map (v3). valueOf(sid) → number.
export function compareLeagues(a, b, dict, valueOf = () => 0) {
  const P = (sid) => {
    const d = dict[sid];
    return d ? { id: sid, name: d[0], pos: d[1], team: d[2], age: d[3], inj: d[4], active: d[6], depth: d[7] } : { id: sid, name: sid, pos: /^[A-Z]{2,3}$/.test(sid) ? 'DEF' : '?', team: '', age: null, inj: '' };
  };
  const sa = settingsOf(a.league), sb = settingsOf(b.league);
  const ha = heldOf(a.rosters), hb = heldOf(b.rosters);
  const posCount = (h) => {
    const c = Object.fromEntries([...POS, 'Other'].map((p) => [p, 0]));
    for (const sid of h.set) { const p = P(sid).pos; if (c[p] != null) c[p]++; else c.Other++; }
    return c;
  };
  const ca = posCount(ha), cb = posCount(hb);
  const positions = [...POS, 'Other'].filter((p) => ca[p] || cb[p]).map((p) => ({
    pos: p, a: ca[p], b: cb[p], diff: ca[p] - cb[p],
    aPer: sa.teams ? ca[p] / sa.teams : 0, bPer: sb.teams ? cb[p] / sb.teams : 0,
  }));

  // QBs: how deep each league goes into the real NFL depth charts.
  const nflStarters = Object.keys(dict).filter((sid) => { const d = dict[sid]; return d && d[1] === 'QB' && d[2] && d[7] === 1 && d[6] !== 0; });
  const qbStats = (h, s) => {
    const qbs = [...h.set].filter((sid) => P(sid).pos === 'QB');
    return {
      held: qbs.length,
      perTeam: s.teams ? qbs.length / s.teams : 0,
      startersHeld: nflStarters.filter((sid) => h.set.has(sid)).length,
      backupsHeld: qbs.filter((sid) => (P(sid).depth || 9) >= 2).length,
      freeStarters: nflStarters.filter((sid) => !h.set.has(sid)).map(P),
      slots: s.starters.filter((x) => x === 'QB').length + (s.sf ? s.starters.filter((x) => x === 'SUPER_FLEX').length : 0),
    };
  };
  const qa = qbStats(ha, sa), qb = qbStats(hb, sb);

  const enrich = (sid) => ({ ...P(sid), v: valueOf(sid) });
  const order = (x, y) => (POS.indexOf(x.pos) + 1 || 99) - (POS.indexOf(y.pos) + 1 || 99) || y.v - x.v || x.name.localeCompare(y.name);
  const onlyA = [...ha.set].filter((sid) => !hb.set.has(sid)).map(enrich).sort(order);
  const onlyB = [...hb.set].filter((sid) => !ha.set.has(sid)).map(enrich).sort(order);
  const shared = [...ha.set].filter((sid) => hb.set.has(sid)).length;

  // Plain-English takeaways.
  const notes = [];
  const sameLineup = sa.startersTxt === sb.startersTxt;
  notes.push(sameLineup
    ? `Same starting lineup (${sa.startersTxt}).`
    : `Different starting lineups: ${sa.name} starts ${sa.startersTxt}; ${sb.name} starts ${sb.startersTxt}.`);
  const spots = (s) => s.total + s.taxi + s.ir;
  if (sa.bench === sb.bench && sa.taxi === sb.taxi) notes.push(`Same bench (${sa.bench}) and taxi (${sa.taxi}).${sa.ir !== sb.ir ? ` IR differs: ${sa.ir} vs ${sb.ir}, which is ${Math.abs(sa.ir - sb.ir) * sa.teams} extra spots across the league.` : ''}`);
  else notes.push(`Roster spots per team: ${spots(sa)} in ${sa.name} (${sa.bench} bench, ${sa.taxi} taxi, ${sa.ir} IR) vs ${spots(sb)} in ${sb.name} (${sb.bench} bench, ${sb.taxi} taxi, ${sb.ir} IR).`);
  if (sa.sf !== sb.sf) notes.push(`${sa.sf ? sa.name : sb.name} is superflex, so QB counts aren't comparable one-for-one.`);
  notes.push(`${ha.total} players rostered in ${sa.name} vs ${hb.total} in ${sb.name}. ${shared} are held in both.`);
  const qd = qa.held - qb.held;
  notes.push(`QBs: ${qa.held} vs ${qb.held} (${qa.perTeam.toFixed(1)} vs ${qb.perTeam.toFixed(1)} per team). NFL starting QBs rostered: ${qa.startersHeld} vs ${qb.startersHeld}.${Math.abs(qd) <= 3 ? ' QB holding is about the same.' : ` ${qd > 0 ? sa.name : sb.name} holds ${Math.abs(qd)} more.`}`);
  const big = positions.filter((p) => p.pos !== 'QB' && Math.abs(p.diff) >= 4).sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  if (big.length) notes.push(`Biggest differences: ${big.map((p) => `${p.pos} ${p.diff > 0 ? '+' : ''}${p.diff} in ${sa.name}`).join(', ')}.`);
  const scDiff = SCORE_KEYS.filter(([k]) => sa.scoring[k] !== sb.scoring[k]);
  if (scDiff.length) notes.push(`Scoring differs on: ${scDiff.map(([k, l]) => `${l} (${sa.scoring[k]} vs ${sb.scoring[k]})`).join('; ')}.`);
  else notes.push('Scoring is the same on every setting compared.');

  return {
    a: { s: sa, total: ha.total, ir: ha.ir, taxi: ha.taxi, perTeam: ha.perTeam, qb: qa },
    b: { s: sb, total: hb.total, ir: hb.ir, taxi: hb.taxi, perTeam: hb.perTeam, qb: qb },
    positions, shared, onlyA, onlyB, notes, scoreKeys: SCORE_KEYS,
  };
}
