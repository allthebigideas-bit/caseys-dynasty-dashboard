// Recent real trades for a player from FantasyCalc's trade database.
// FantasyCalc doesn't document this API, so a few known URL shapes are tried
// and the response is read loosely. If none work, the caller shows that the
// source is unavailable rather than guessing.

import { fetchJSON } from './net.js';
import { store } from './util.js';

const urls = (id, qbs, teams) => [
  `https://api.fantasycalc.com/trades/implied/${id}?isDynasty=true&numQbs=${qbs}&numTeams=${teams}`,
  `https://api.fantasycalc.com/trades?playerId=${id}&isDynasty=true&numQbs=${qbs}&numTeams=${teams}`,
  `https://api.fantasycalc.com/trades/player/${id}?isDynasty=true&numQbs=${qbs}`,
];

const nameOf = (x) => {
  if (x == null) return null;
  if (typeof x === 'string') return x;
  if (x.name) return x.name;
  if (x.player && x.player.name) return x.player.name;
  if (x.playerName) return x.playerName;
  return null;
};

const sideOf = (s) => (Array.isArray(s) ? s.map(nameOf).filter(Boolean) : s && typeof s === 'object' ? Object.values(s).flatMap((v) => (Array.isArray(v) ? v.map(nameOf).filter(Boolean) : [])) : []);

// Find trade-like objects anywhere in the response.
function collect(node, out, depth = 0) {
  if (!node || depth > 5) return;
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out, depth + 1)); return; }
  if (typeof node !== 'object') return;
  const a = node.side1 ?? node.sideA ?? node.team1 ?? node.side_1;
  const b = node.side2 ?? node.sideB ?? node.team2 ?? node.side_2;
  if (a && b) {
    const date = node.date || node.tradeDate || node.createdAt || node.timestamp || node.created || null;
    out.push({ a: sideOf(a), b: sideOf(b), date: date ? new Date(typeof date === 'number' && date < 1e12 ? date * 1000 : date).getTime() : null, qbs: node.numQbs ?? node.qbs ?? null, teams: node.numTeams ?? null });
    return;
  }
  for (const v of Object.values(node)) collect(v, out, depth + 1);
}

export async function fcTrades(fcId, { qbs = 1, teams = 12 } = {}) {
  const key = `fctrades:${fcId}:${qbs}:${teams}`;
  const hit = await store.get(key, null);
  if (hit && Date.now() - hit.at < 12 * 3600e3) return hit;
  const errors = [];
  for (const url of urls(fcId, qbs, teams)) {
    try {
      const data = await fetchJSON(url, { timeout: 20000 });
      const trades = [];
      collect(data, trades);
      const clean = trades.filter((t) => t.a.length && t.b.length).sort((x, y) => (y.date || 0) - (x.date || 0)).slice(0, 25);
      if (!clean.length) { errors.push(`${url.split('?')[0]}: no trades in the response`); continue; }
      const res = { at: Date.now(), source: url.split('?')[0], trades: clean };
      await store.set(key, res);
      return res;
    } catch (e) {
      errors.push(`${url.split('?')[0]}: ${e.message}`);
    }
  }
  throw new Error(errors.join('; '));
}
