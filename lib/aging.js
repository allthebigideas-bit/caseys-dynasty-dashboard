// Production projections: where each player's points are heading as he ages.
//
// 1. Baseline: points per game this season, last season and Sleeper's season
//    projection, scored with the league's settings and blended by sample size.
// 2. Level: the player's rank at his position sets his tier. Elite players
//    tend to hold their peak longer, depth players fall off sooner.
// 3. Aging: typical position curves (share of peak output by age) move the
//    baseline forward one season at a time.

export const CURVES = {
  QB: { 21: 0.7, 22: 0.76, 23: 0.82, 24: 0.87, 25: 0.91, 26: 0.95, 27: 0.98, 28: 1, 29: 1, 30: 1, 31: 0.99, 32: 0.97, 33: 0.94, 34: 0.9, 35: 0.85, 36: 0.79, 37: 0.72, 38: 0.64, 39: 0.55, 40: 0.45 },
  RB: { 20: 0.72, 21: 0.82, 22: 0.91, 23: 0.97, 24: 1, 25: 1, 26: 0.96, 27: 0.89, 28: 0.8, 29: 0.7, 30: 0.6, 31: 0.5, 32: 0.4, 33: 0.32, 34: 0.25 },
  WR: { 20: 0.62, 21: 0.72, 22: 0.81, 23: 0.89, 24: 0.95, 25: 0.99, 26: 1, 27: 1, 28: 0.97, 29: 0.93, 30: 0.87, 31: 0.79, 32: 0.7, 33: 0.6, 34: 0.5, 35: 0.42 },
  TE: { 21: 0.55, 22: 0.64, 23: 0.74, 24: 0.84, 25: 0.92, 26: 0.97, 27: 1, 28: 1, 29: 0.97, 30: 0.92, 31: 0.85, 32: 0.76, 33: 0.66, 34: 0.56, 35: 0.46 },
};
export const PEAK = { QB: [28, 31], RB: [24, 25], WR: [26, 27], TE: [27, 28] };
// Tier cut-offs for a 12-team league (scaled by league size).
const TIERS = { QB: [6, 12, 24], RB: [8, 24, 40], WR: [10, 30, 50], TE: [4, 12, 20] };
const TIER_NAMES = ['Elite', 'Starter', 'Flex', 'Depth'];
const DECLINE = [0.8, 1, 1.15, 1.3];
const GAMES = 14;

export function curveAt(pos, age) {
  const c = CURVES[pos];
  if (!c || age == null) return 1;
  const ages = Object.keys(c).map(Number);
  const lo = Math.min(...ages), hi = Math.max(...ages);
  const a = Math.max(lo, Math.min(hi, age));
  const f = Math.floor(a), t = a - f;
  const v0 = c[f] ?? c[lo], v1 = c[Math.min(hi, f + 1)] ?? v0;
  return v0 + (v1 - v0) * t;
}

function phase(pos, age) {
  const p = PEAK[pos];
  if (!p || age == null) return 'unknown';
  if (age < p[0] - 0.5) return 'rising';
  if (age <= p[1] + 0.5) return 'peak';
  return 'declining';
}

// prod: { cur: {sid:[gp, pts]}, prev: {...}, proj: {...} } in league scoring.
export function baseline(sid, pos, age, prod) {
  const parts = [];
  const cur = prod.cur && prod.cur[sid];
  if (cur && cur[0] >= 2) parts.push({ ppg: cur[1] / cur[0], w: 0.5 * Math.min(cur[0], 8) / 8, src: 'this season', gp: cur[0] });
  const prev = prod.prev && prod.prev[sid];
  if (prev && prev[0] >= 4) {
    // Express last season at this season's age.
    const adj = age ? curveAt(pos, age) / Math.max(0.2, curveAt(pos, age - 1)) : 1;
    parts.push({ ppg: (prev[1] / prev[0]) * adj, w: 0.3 * Math.min(prev[0], 12) / 12, src: 'last season', gp: prev[0] });
  }
  const pj = prod.proj && prod.proj[sid];
  if (pj && pj[0] >= 1 && pj[1] > 0) parts.push({ ppg: pj[1] / pj[0], w: 0.25, src: 'projection', gp: pj[0] });
  const W = parts.reduce((s, p) => s + p.w, 0);
  if (!W) return null;
  return { ppg: parts.reduce((s, p) => s + p.ppg * p.w, 0) / W, parts };
}

// Build projections for every player with a baseline.
// players: [{ id, pos, age, v (dynasty value), posValuePct }]
export function projectAll(players, prod, { season, teams = 12, horizon = 3 } = {}) {
  const scale = teams / 12;
  const out = {};
  const byPos = {};
  for (const p of players) {
    if (!CURVES[p.pos]) continue;
    const b = baseline(p.id, p.pos, p.age, prod);
    if (!b) continue;
    out[p.id] = { ...p, base: b.ppg, parts: b.parts };
    (byPos[p.pos] ||= []).push(out[p.id]);
  }
  const lines = {};
  for (const [pos, arr] of Object.entries(byPos)) {
    arr.sort((a, b) => b.base - a.base);
    const cuts = TIERS[pos].map((n) => Math.round(n * scale));
    arr.forEach((p, i) => {
      p.posRank = i + 1;
      p.tierIdx = i < cuts[0] ? 0 : i < cuts[1] ? 1 : i < cuts[2] ? 2 : 3;
      p.tier = TIER_NAMES[p.tierIdx];
    });
    // The points-per-game a weekly starter needs at this position.
    const starterN = Math.round(({ QB: 12, RB: 24, WR: 36, TE: 12 }[pos]) * scale);
    lines[pos] = arr[Math.min(arr.length - 1, starterN - 1)] ? arr[Math.min(arr.length - 1, starterN - 1)].base : 0;
  }
  for (const p of Object.values(out)) {
    const now = curveAt(p.pos, p.age);
    p.seasons = [];
    for (let k = 0; k <= horizon; k++) {
      const age = p.age != null ? p.age + k : null;
      let r = age != null ? curveAt(p.pos, age) / Math.max(0.2, now) : 1;
      if (r < 1) r = 1 - (1 - r) * DECLINE[p.tierIdx];
      else if (r > 1) r = 1 + (r - 1) * (0.6 + 0.8 * (p.posValuePct || 0.5));
      p.seasons.push({ season: season + k, age, ppg: Math.max(0, p.base * r) });
    }
    p.phase = phase(p.pos, p.age);
    let prime = 0;
    for (let k = 0; k <= 5; k++) if (p.age != null && curveAt(p.pos, p.age + k) >= 0.93) prime++;
    p.primeYears = prime;
    p.next3 = p.seasons.slice(1, 4).reduce((s, x) => s + x.ppg * GAMES, 0);
    p.trend = p.seasons[2] ? p.seasons[2].ppg / Math.max(0.1, p.seasons[0].ppg) - 1 : 0;
    p.starterLine = lines[p.pos] || 0;
  }
  return { players: out, lines };
}

export const GAMES_PER_SEASON = GAMES;
