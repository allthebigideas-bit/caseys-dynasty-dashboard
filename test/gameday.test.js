import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScoreboard, remaining, gameText, statLine, buildGameDay, indexStats, standings, weekSpan } from '../lib/gameday.js';

const ev = (home, away, hs, as, status) => ({
  date: '2026-11-22T18:00Z',
  competitions: [{
    date: '2026-11-22T18:00Z',
    status,
    competitors: [
      { homeAway: 'home', score: String(hs), team: { abbreviation: home } },
      { homeAway: 'away', score: String(as), team: { abbreviation: away } },
    ],
  }],
});
const LIVE = { period: 4, displayClock: '4:27', type: { state: 'in', completed: false, shortDetail: '4:27 - 4th' } };
const FINAL = { period: 4, displayClock: '0:00', type: { state: 'post', completed: true, shortDetail: 'Final' } };
const PRE = { period: 0, displayClock: '0:00', type: { state: 'pre', completed: false, shortDetail: '11/23 - 1:00 PM EST' } };
const board = { events: [ev('DAL', 'TEN', 51, 23, LIVE), ev('HOU', 'IND', 26, 3, FINAL), ev('NYJ', 'WSH', 0, 0, PRE)] };

test('scoreboard is keyed by both teams, with ESPN codes mapped to Sleeper', () => {
  const g = parseScoreboard(board);
  assert.equal(g.DAL, g.TEN);
  assert.ok(g.WAS, 'WSH becomes WAS');
  assert.equal(g.DAL.state, 'in');
  assert.equal(g.HOU.done, true);
});

test('time left in a game', () => {
  const g = parseScoreboard(board);
  assert.ok(Math.abs(remaining(g.DAL) - 4.45 / 60) < 0.001);
  assert.equal(remaining(g.HOU), 0);
  assert.equal(remaining(g.NYJ), 1);
});

test('game text reads like Yahoo, own score first', () => {
  const g = parseScoreboard(board);
  assert.equal(gameText(g.DAL, 'DAL'), '4th 4:27, 51-23 vs TEN');
  assert.equal(gameText(g.TEN, 'TEN'), '4th 4:27, 23-51 @ DAL');
  assert.equal(gameText(g.HOU, 'HOU'), 'Final (W) 26-3 vs IND');
  assert.equal(gameText(g.IND, 'IND'), 'Final (L) 3-26 @ HOU');
});

test('stat lines', () => {
  assert.equal(statLine({ pass_yd: 194, pass_td: 3, pass_int: 1, rush_yd: 27 }, 'QB'), '194 Pass Yds, 3 Pass TD, 1 Int, 27 Rush Yds');
  assert.equal(statLine({ rush_yd: 67, rush_td: 1, rec: 3, rec_yd: 24, rec_td: 1 }, 'RB'), '67 Rush Yds, 1 Rush TD, 3 Rec, 24 Rec Yds, 1 Rec TD');
  assert.equal(statLine({ fgm: 1, fgm_lng: 44, xpm: 6 }, 'K'), '1 FG (long 44), 6 PAT Made');
  assert.equal(statLine({ sack: 4, int: 1, pts_allow: 13, gp: 1 }, 'DEF'), '4 Sack, 1 Int, PA 13');
});

test('DEF stat rows keyed by team code', () => {
  assert.deepEqual(Object.keys(indexStats([{ player_id: 'TEAM_CHI', stats: { sack: 2 } }, { player_id: '9758', stats: {} }])), ['9758', 'CHI']);
});

const league = { roster_positions: ['QB', 'RB', 'FLEX', 'DEF', 'BN', 'BN'], scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rec: 1, rec_yd: 0.1 } };
const dict = {
  q1: ['C.J. Stroud', 'QB', 'HOU'], r1: ['Javonte Williams', 'RB', 'DAL'], w1: ['Garrett Wilson', 'WR', 'NYJ'], b1: ['Bench Guy', 'WR', 'KC'],
  q2: ['Opp QB', 'QB', 'TEN'], r2: ['Opp RB', 'RB', 'IND'], w2: ['Opp WR', 'WR', 'WAS'],
};
const proj = {
  q1: { stats: { pass_yd: 250, pass_td: 2 } }, r1: { stats: { rush_yd: 80, rec: 2, rec_yd: 20 } }, w1: { stats: { rec: 5, rec_yd: 60 } },
  q2: { stats: { pass_yd: 250, pass_td: 2 } }, r2: { stats: { rush_yd: 80 } }, w2: { stats: { rec: 5, rec_yd: 60 } }, DAL: { stats: { pts_std: 8 } },
};
const matchups = [
  { roster_id: 1, matchup_id: 1, points: 40, starters: ['q1', 'r1', 'w1', 'DAL'], players: ['q1', 'r1', 'w1', 'DAL', 'b1'], players_points: { q1: 21.46, r1: 18.6, w1: 0, DAL: 0, b1: 0 } },
  { roster_id: 2, matchup_id: 1, points: 12, starters: ['q2', 'r2', 'w2', '0'], players: ['q2', 'r2', 'w2'], players_points: { q2: 9, r2: 3, w2: 0 } },
];

test('a live matchup: points, projections, players left and win chance', () => {
  const games = parseScoreboard(board);
  const gd = buildGameDay({ league, matchups, rid: 1, dict, proj, games });
  const [qb, rb, flex, def] = gd.a.starters;
  assert.equal(qb.state, 'final');
  assert.equal(qb.liveProj, 21.46, 'a finished game projects what it scored');
  assert.equal(rb.state, 'live');
  assert.ok(rb.liveProj > 18.6 && rb.liveProj < 18.6 + 14, 'live: points so far plus a slice of the projection');
  assert.equal(flex.state, 'pre');
  assert.equal(flex.liveProj, 11, 'not started: the projection');
  assert.equal(def.pos, 'DEF');
  assert.equal(gd.a.left, 3, 'QB is done; RB, FLEX and DEF still playing or to play');
  assert.equal(gd.b.starters[3].sid, null, 'an empty slot');
  assert.equal(gd.a.bench[0].name, 'Bench Guy');
  assert.equal(gd.a.bench[0].state, 'bye', 'KC is not on the board');
  assert.ok(gd.winA > 0.5 && gd.winA < 1);
});

test('finished matchup is decided', () => {
  const done = { events: board.events.map((e) => ({ ...e, competitions: [{ ...e.competitions[0], status: FINAL }] })) };
  const gd = buildGameDay({ league, matchups, rid: 2, dict, proj, games: parseScoreboard(done) });
  assert.equal(gd.winA, 0);
  assert.equal(gd.a.left, 0);
});

test('no matchup for a team returns null', () => {
  assert.equal(buildGameDay({ league, matchups, rid: 9, dict }), null);
});

test('standings by wins then points for', () => {
  assert.deepEqual(standings([{ rid: 1, w: 5, l: 5, t: 0, pf: 900 }, { rid: 2, w: 6, l: 4, t: 0, pf: 800 }, { rid: 3, w: 5, l: 5, t: 0, pf: 950 }]), { 2: 1, 3: 2, 1: 3 });
});

test('week span from game dates', () => {
  assert.match(weekSpan(parseScoreboard(board)), /Nov 2[12]/);
});
