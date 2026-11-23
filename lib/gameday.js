// Game day: one head-to-head matchup scored live, laid out like a Yahoo matchup
// page. Pure functions here; the dashboard fetches and polls (see loadGameDay).
//
// Sources, all public:
// - Sleeper matchups: league-scored points per player (players_points).
// - Sleeper weekly stats: the stat line under each player.
// - ESPN scoreboard: quarter, clock and score of each NFL game.
// - Sleeper projections (already synced) and FantasyPros ECR, for the Proj and
//   ECR columns.

import { scoreLine, starterSlots, bestLineup } from './startsit.js';
import { timedFetch } from './net.js';

const ESPN_TO_SLEEPER = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
const OUT = new Set(['Out', 'IR', 'PUP', 'Sus', 'Suspended', 'NA', 'DNR', 'COV']);
const TEAM_SD = 24; // spread of a team's weekly score, as in intel.js

export function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// ESPN scoreboard → { [team]: game } with each game listed under both teams.
// game: { state: 'pre'|'in'|'post', period, clock, detail, start, home, away, hs, as, done }
export function parseScoreboard(json) {
  const out = {};
  for (const ev of (json && json.events) || []) {
    const c = ev.competitions && ev.competitions[0];
    if (!c) continue;
    const st = c.status || ev.status || {};
    const ty = st.type || {};
    const side = (h) => (c.competitors || []).find((x) => x.homeAway === h) || {};
    const ab = (x) => { const a = (x.team && x.team.abbreviation) || ''; return ESPN_TO_SLEEPER[a] || a; };
    const H = side('home'), A = side('away');
    const g = {
      state: ty.state || 'pre',
      done: !!ty.completed,
      period: Number(st.period) || 0,
      clock: st.displayClock || '',
      detail: ty.shortDetail || ty.detail || '',
      start: Date.parse(c.date || ev.date) || null,
      home: ab(H), away: ab(A),
      hs: Number(H.score) || 0, as: Number(A.score) || 0,
    };
    if (!g.home || !g.away) continue;
    out[g.home] = g;
    out[g.away] = g;
  }
  return out;
}

// Share of a game still to play, 0..1.
export function remaining(g) {
  if (!g) return 1;
  if (g.done || g.state === 'post') return 0;
  if (g.state !== 'in') return 1;
  if (g.period > 4) return 0.02; // overtime
  const [m, s] = String(g.clock || '0:00').split(':').map(Number);
  const left = (4 - g.period) * 15 + (Number.isFinite(m) ? m : 0) + (Number.isFinite(s) ? s / 60 : 0);
  return Math.max(0.02, Math.min(1, left / 60));
}

const ORD = ['', '1st', '2nd', '3rd', '4th'];

// "4th 4:27, 51-23 vs TEN" / "Final (W) 26-3 vs IND" / "Sun 3:05 PM vs NYJ"
export function gameText(g, team) {
  if (!g || !team) return '';
  const home = g.home === team;
  const opp = home ? g.away : g.home;
  const mine = home ? g.hs : g.as, theirs = home ? g.as : g.hs;
  const where = `${home ? 'vs' : '@'} ${opp}`;
  if (g.done || g.state === 'post') {
    const r = mine > theirs ? 'W' : mine < theirs ? 'L' : 'T';
    return `Final (${r}) ${mine}-${theirs} ${where}`;
  }
  if (g.state === 'in') {
    const per = /half/i.test(g.detail) ? 'Half' : g.period > 4 ? 'OT' : ORD[g.period] || '';
    const clk = per === 'Half' ? '' : ` ${g.clock}`;
    return `${per}${clk}, ${mine}-${theirs} ${where}`;
  }
  if (!g.start) return where;
  const d = new Date(g.start);
  const day = d.toLocaleDateString([], { weekday: 'short' });
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time} ${where}`;
}

// Yahoo-style stat line: "194 Pass Yds, 3 Pass TD, 1 Int, 27 Rush Yds".
export function statLine(st, pos) {
  if (!st) return '';
  const n = (k) => Number(st[k] || 0);
  const parts = [];
  const add = (v, label) => { if (v) parts.push(`${Math.round(v * 10) / 10} ${label}`); };
  if (pos === 'DEF') {
    add(n('sack'), 'Sack'); add(n('int'), 'Int'); add(n('fum_rec'), 'Fum Rec'); add(n('safe'), 'Safe');
    add(n('def_td') + n('def_st_td'), 'TD');
    if (st.pts_allow != null && (n('gp') || n('pts_allow'))) parts.push(`PA ${n('pts_allow')}`);
    return parts.join(', ');
  }
  if (pos === 'K') {
    const fg = n('fgm'), xp = n('xpm');
    if (fg) parts.push(`${fg} FG${n('fgm_lng') ? ` (long ${n('fgm_lng')})` : ''}`);
    if (n('fgmiss')) parts.push(`${n('fgmiss')} FG miss`);
    if (xp) parts.push(`${xp} PAT Made`);
    return parts.join(', ');
  }
  add(n('pass_yd'), 'Pass Yds'); add(n('pass_td'), 'Pass TD'); add(n('pass_int'), 'Int'); add(n('pass_sack'), 'Sack');
  add(n('rush_yd'), 'Rush Yds'); add(n('rush_td'), 'Rush TD');
  add(n('rec'), 'Rec'); add(n('rec_yd'), 'Rec Yds'); add(n('rec_td'), 'Rec TD');
  add(n('fum_lost'), 'Fum Lost'); add(n('pr_td') + n('kr_td'), 'Ret TD');
  if (!parts.length && (n('rush_yd') < 0 || n('rec_yd') < 0)) { if (n('rush_yd')) parts.push(`${n('rush_yd')} Rush Yds`); }
  return parts.join(', ');
}

// Sleeper weekly stats array → { [player_id]: stats }. DEF rows may come as
// "TEAM_CHI"; key them by the plain team code Sleeper rosters use.
export function indexStats(arr) {
  const out = {};
  for (const r of arr || []) {
    if (!r || !r.player_id || !r.stats) continue;
    const id = String(r.player_id).replace(/^TEAM_/, '');
    out[id] = r.stats;
  }
  return out;
}

// Standings rank (wins, then points for) for "6-4-0 | 4th".
export function standings(teams) {
  const s = [...teams].sort((a, b) => (b.w + b.t / 2) - (a.w + a.t / 2) || b.pf - a.pf);
  return Object.fromEntries(s.map((t, i) => [t.rid, i + 1]));
}

// One side of the matchup: starters slot by slot, then the bench.
function side(m, { slots, dict, proj, fpBySid, stats, games, scoring }) {
  const pts = m.players_points || {};
  const starters = m.starters || [];
  const startSet = new Set(starters.filter((s) => s && s !== '0'));
  const hasBoard = Object.keys(games).length > 0;
  const row = (sid, slot) => {
    if (!sid || sid === '0') return { slot, sid: null };
    const d = dict[sid] || [];
    const pos = d[1] || (/^[A-Z]{2,3}$/.test(sid) ? 'DEF' : '');
    const nflTeam = d[2] || (pos === 'DEF' ? sid : '');
    const pr = proj[sid];
    const fp = fpBySid[sid];
    const g = nflTeam ? games[nflTeam] || null : null;
    const p0 = pr ? scoreLine(pr.stats, scoring, pos) : null;
    const projPts = p0 != null ? p0 : fp && fp.pts != null ? fp.pts : 0;
    const scored = pts[sid] != null ? Number(pts[sid]) : null;
    // Not on a board that has games = bye. No board at all (ESPN down): fall back to the projection.
    const rem = !nflTeam ? 0 : g ? remaining(g) : hasBoard ? 0 : pr ? 1 : 0;
    const out = OUT.has(d[4]);
    const live = out && rem === 1 ? 0 : (scored || 0) + projPts * rem;
    const state = !g ? (pr && !hasBoard ? 'pre' : 'bye') : g.done || g.state === 'post' ? 'final' : g.state === 'in' ? 'live' : 'pre';
    return {
      slot, sid, name: d[0] || sid, pos, team: nflTeam, inj: d[4] || '',
      pts: scored, proj: Math.round(projPts * 100) / 100, liveProj: Math.round(live * 100) / 100,
      ecr: fp ? fp.ecr : null, posRank: fp ? fp.posRank : '', fpProj: fp && fp.pts != null ? fp.pts : null,
      line: statLine(stats[sid], pos), game: state === 'bye' ? 'Bye' : g ? gameText(g, nflTeam) : pr && pr.opp ? `vs ${pr.opp}` : '',
      state, rem: out && rem === 1 ? 0 : rem,
    };
  };
  const startRows = slots.map((slot, i) => row(starters[i], slot));
  const bench = (m.players || []).filter((s) => !startSet.has(s)).map((s) => row(s, 'BN'))
    .sort((a, b) => (b.pts || 0) - (a.pts || 0) || b.proj - a.proj);
  const sum = (k) => Math.round(startRows.reduce((a, r) => a + (r.sid ? Number(r[k] || 0) : 0), 0) * 100) / 100;
  const points = m.points != null ? Number(m.points) : sum('pts');
  const projRem = startRows.reduce((a, r) => a + (r.sid ? r.proj * r.rem : 0), 0);
  const origProj = sum('proj');
  return {
    rid: m.roster_id, starters: startRows, bench, points,
    origProj, liveProj: Math.round((points + projRem) * 100) / 100,
    left: startRows.filter((r) => r.sid && r.rem > 0).length,
    remShare: origProj > 0 ? Math.min(1, projRem / origProj) : 0,
  };
}

// Build the matchup the page shows. `matchups` is Sleeper's array for the week.
export function buildGameDay({ league, matchups, rid, dict, proj = {}, fpBySid = {}, stats = {}, games = {} }) {
  const slots = starterSlots(league.roster_positions);
  const scoring = league.scoring_settings || {};
  const mine = (matchups || []).find((m) => m.roster_id === rid);
  if (!mine || mine.matchup_id == null) return null;
  const opp = matchups.find((m) => m.matchup_id === mine.matchup_id && m.roster_id !== rid);
  const ctx = { slots, dict, proj, fpBySid, stats, games, scoring };
  const a = side(mine, ctx);
  const b = opp ? side(opp, ctx) : null;
  let winA = null;
  if (b) {
    const sd = Math.sqrt((TEAM_SD * Math.sqrt(a.remShare)) ** 2 + (TEAM_SD * Math.sqrt(b.remShare)) ** 2);
    const diff = a.liveProj - b.liveProj;
    winA = sd < 0.5 ? (diff > 0 ? 1 : diff < 0 ? 0 : 0.5) : phi(diff / sd);
  }
  return { a, b, winA, slots };
}

// Standings as if this week ended on the live projections. `teams` carry the
// season so far: { rid, name, w, l, t, pf, maxPf } (Sleeper's PF and max PF count
// finished weeks only). Adds, per team, this week's projected result and points,
// and this week's best possible lineup twice: on points scored so far (Max PF)
// and on live projections (Proj. max PF).
export function liveStandings({ teams, league, matchups, dict, proj = {}, fpBySid = {}, stats = {}, games = {} }) {
  const nowRank = standings(teams);
  const r2 = (x) => Math.round(x * 100) / 100;
  const rows = teams.map((t) => {
    const gd = buildGameDay({ league, matchups, rid: t.rid, dict, proj, fpBySid, stats, games });
    const base = { rid: t.rid, name: t.name, w: t.w, l: t.l, t: t.t || 0, nowRank: nowRank[t.rid], pf: t.pf, maxPf: t.maxPf || 0 };
    if (!gd) return { ...base, wk: null, projW: t.w, projL: t.l, projT: t.t || 0, projPf: t.pf, maxNow: t.maxPf || 0, maxProj: t.maxPf || 0, wkMax: 0, wkMaxProj: 0 };
    const all = [...gd.a.starters, ...gd.a.bench].filter((r) => r.sid);
    const pool = all.map((r) => ({ id: r.sid, pos: r.pos }));
    const by = Object.fromEntries(all.map((r) => [r.sid, r]));
    const best = (k) => bestLineup(gd.slots, pool, (p) => Number(by[p.id][k] || 0)).reduce((s, id) => s + (id ? Number(by[id][k] || 0) : 0), 0);
    const wkMax = best('pts');
    const wkMaxProj = best('liveProj');
    const win = gd.winA;
    const res = win == null ? null : win > 0.5 ? 'W' : win < 0.5 ? 'L' : 'T';
    return {
      ...base,
      wk: { pts: gd.a.points, proj: gd.a.liveProj, opp: gd.b ? gd.b.liveProj : null, oppRid: gd.b ? gd.b.rid : null, win, res },
      projW: t.w + (res === 'W' ? 1 : 0), projL: t.l + (res === 'L' ? 1 : 0), projT: (t.t || 0) + (res === 'T' ? 1 : 0),
      projPf: r2(t.pf + gd.a.liveProj),
      wkMax: r2(wkMax), wkMaxProj: r2(wkMaxProj),
      maxNow: r2((t.maxPf || 0) + wkMax), maxProj: r2((t.maxPf || 0) + wkMaxProj),
    };
  });
  rows.sort((a, b) => (b.projW + b.projT / 2) - (a.projW + a.projT / 2) || b.projPf - a.projPf);
  rows.forEach((r, i) => { r.projRank = i + 1; });
  return rows;
}

// Every pairing of the week, for the scoreboard strip.
export function pairings(matchups) {
  const by = {};
  for (const m of matchups || []) if (m.matchup_id != null) (by[m.matchup_id] = by[m.matchup_id] || []).push(m);
  return Object.values(by).map((p) => p.sort((x, y) => x.roster_id - y.roster_id));
}

// Week span from the games on the board: "Nov 19 – Nov 23".
export function weekSpan(games) {
  const t = [...new Set(Object.values(games))].map((g) => g.start).filter(Boolean).sort((x, y) => x - y);
  if (!t.length) return '';
  const f = (ms) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return f(t[0]) === f(t[t.length - 1]) ? f(t[0]) : `${f(t[0])} – ${f(t[t.length - 1])}`;
}

export function anyLive(games) {
  return Object.values(games).some((g) => g.state === 'in');
}

// Fetch the live inputs for one week. `sl` is the Sleeper module (matchups, projections).
export async function loadGameDay({ sl, leagueId, season, week, needProj }) {
  const bust = `_=${Date.now()}`;
  const json = (url) => timedFetch(url, { timeout: 20000 }, (res) => {
    if (!res.ok) throw new Error(`${new URL(url).host} → HTTP ${res.status}`);
    return res.json();
  });
  const [matchups, statsArr, board, proj] = await Promise.all([
    sl.matchups(leagueId, week),
    json(`https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=regular&${bust}`).catch(() => []),
    json(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}&${bust}`).catch((e) => ({ error: e.message })),
    needProj ? sl.projections(season, week).catch(() => ({})) : Promise.resolve(null),
  ]);
  return {
    matchups: Array.isArray(matchups) ? matchups : [],
    stats: indexStats(statsArr),
    games: parseScoreboard(board),
    boardError: board && board.error ? board.error : null,
    proj,
    at: Date.now(),
  };
}
