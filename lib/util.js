// Shared helpers: storage, logging, name/team normalisation.

import { chromeStore } from './store.js';

export const store = chromeStore;

const LOG_MAX = 600;

export async function log(level, leagueName, msg) {
  const entry = { ts: Date.now(), level, league: leagueName || '', msg };
  await store.update('log', (arr) => {
    arr.push(entry);
    return arr.slice(-LOG_MAX);
  }, []);
  // Mirror to the service-worker console for debugging.
  (level === 'error' ? console.error : console.log)(`[CDD] ${leagueName || ''} ${msg}`);
  return entry;
}

export const APP_NAME = "Casey's Dynasty Dashboard";

export function notify(title, message) {
  try {
    chrome.notifications.create('', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message: String(message).slice(0, 250),
      priority: 2,
    });
  } catch (e) {
    console.warn('notify failed', e);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- player matching ------------------------------------------------------

const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g;

export function normName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.'’`,-]/g, ' ')
    .replace(SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TEAM_ALIAS = {
  JAC: 'JAX', WSH: 'WAS', LA: 'LAR', STL: 'LAR', SD: 'LAC', OAK: 'LV', LVR: 'LV',
  KCC: 'KC', GBP: 'GB', NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB', ARZ: 'ARI', BLT: 'BAL', CLV: 'CLE', HST: 'HOU',
};

export function canonTeam(t) {
  if (!t) return '';
  const u = String(t).toUpperCase().trim();
  return TEAM_ALIAS[u] || u;
}

export function canonPos(p) {
  const u = String(p || '').toUpperCase().trim();
  if (u === 'DST' || u === 'D/ST' || u === 'D' || u === 'DEF') return 'DEF';
  if (u === 'PK') return 'K';
  // Yahoo display_position can be "WR,TE" — take the first.
  return u.split(/[,/]/)[0];
}

// Choose the best candidate for a ranked player out of a list of
// {name, pos, team, ...} records. Returns null when nothing matches.
export function bestMatch(target, candidates) {
  const pos = canonPos(target.pos);
  const team = canonTeam(target.team);
  if (pos === 'DEF') {
    return candidates.find((c) => canonPos(c.pos) === 'DEF' && canonTeam(c.team) === team) || null;
  }
  const n = normName(target.name);
  let pool = candidates.filter((c) => normName(c.name) === n);
  if (!pool.length) return null;
  const samePos = pool.filter((c) => canonPos(c.pos) === pos);
  if (samePos.length) pool = samePos;
  if (pool.length > 1 && team) {
    const sameTeam = pool.filter((c) => canonTeam(c.team) === team);
    if (sameTeam.length) pool = sameTeam;
  }
  return pool[0];
}

export function playerKey(p) {
  const pos = canonPos(p.pos);
  if (pos === 'DEF') return `DEF|${canonTeam(p.team)}`;
  return `${normName(p.name)}|${pos}`;
}

// ---- time ------------------------------------------------------------------

// Next occurrence of local "HH:MM". If we're already inside the run window
// (between that time and giveUpHours after it) return today's time.
// When the next overnight run should start checking: `hhmm` local time on the
// morning waivers process. `processDay` is the JS weekday (0 = Sunday) of that
// morning, or null for leagues with daily waivers. A window that has started but
// not yet passed `giveUpHours` counts as the next one.
export function nextWindowStart(hhmm, giveUpHours, now = Date.now(), processDay = null) {
  const [h, m] = String(hhmm || '00:55').split(':').map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  for (let i = 0; i < 8; i++) {
    const start = d.getTime();
    if ((processDay == null || d.getDay() === processDay) && now <= start + giveUpHours * 3600e3) return start;
    d.setDate(d.getDate() + 1);
    d.setHours(h, m, 0, 0);
  }
  return d.getTime();
}

// Sleeper's waiver_day_of_week counts from Monday (the default, 2, is the
// Wednesday-morning run). Returns the JS weekday of the processing morning, or
// null when the league runs daily waivers.
export function sleeperWaiverDay(settings = {}) {
  if (settings.daily_waivers) return null;
  const w = settings.waiver_day_of_week;
  return w == null || w === '' ? 3 : (Number(w) + 1) % 7;
}

export function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

// Classify an error message coming back from a platform add.
export function classifyError(msg, status) {
  const m = String(msg || '').toLowerCase();
  if (status === 401 || /unauthori[sz]ed|token|expired|jwt|not logged|login/.test(m)) return 'auth';
  if (/waiver/.test(m)) return 'waiver';
  if (/already|not available|unavailable|is owned|rostered|on another team|on a team|no longer available|not a free agent/.test(m)) return 'taken';
  if (/roster.*full|too many|exceed|max(imum)? .*players|roster limit|position limit/.test(m)) return 'rosterfull';
  return 'other';
}

// Sleeper's REST API gives traded picks as objects; its GraphQL API (offers)
// gives them as comma strings like "orig,season,round,x,y" (and FAAB as
// "sender,receiver,amount"). Normalise both into the REST shape. When the
// order of the two owner fields is ambiguous, the side that owns the pick
// right now (an unaccepted offer hasn't moved it) is the one giving it up.
export function normTradeAssets(tx, ownerNow = null) {
  const rids = (tx.roster_ids || []).map(Number);
  const parsePick = (p) => {
    if (p && typeof p === 'object' && p.season != null) return { ...p, season: String(p.season), round: Number(p.round), roster_id: Number(p.roster_id), owner_id: Number(p.owner_id), previous_owner_id: Number(p.previous_owner_id) };
    let s = p;
    if (typeof s === 'string' && s.trim().startsWith('{')) { try { return parsePick(JSON.parse(s)); } catch { return null; } }
    if (typeof s !== 'string') return null;
    const f = s.split(',').map((x) => x.trim());
    if (f.length < 4) return null;
    let orig, season, round, a, b;
    const yi = f.findIndex((x) => Number(x) >= 2000 && Number(x) < 2100);
    if (yi === 0) [season, round, orig, a, b] = f; // "season,round,orig,..."
    else [orig, season, round, a, b] = f; // "orig,season,round,..." (same order as trade-block pick ids)
    orig = Number(orig); round = Number(round); a = Number(a); b = b != null && b !== '' ? Number(b) : null;
    if (b == null || !rids.includes(b)) b = rids.find((r) => r !== a);
    // Sleeper's format is orig,season,round,receiver,giver for every status
    // (checked against the public transactions record of completed trades), so
    // no guessing from who holds the pick today: that flips on old offers once
    // the pick changes hands.
    const owner = a, prev = b;
    return { season: String(season), round, roster_id: orig, owner_id: owner, previous_owner_id: prev };
  };
  const parseBudget = (w) => {
    if (w && typeof w === 'object') return { sender: Number(w.sender), receiver: Number(w.receiver), amount: Number(w.amount) };
    if (typeof w !== 'string') return null;
    const [sender, receiver, amount] = w.split(',').map(Number);
    return { sender, receiver, amount };
  };
  return {
    ...tx,
    roster_ids: rids,
    draft_picks: (tx.draft_picks || []).map(parsePick).filter(Boolean),
    unparsedPicks: (tx.draft_picks || []).filter((p) => !parsePick(p)).map((p) => (typeof p === 'string' ? p : JSON.stringify(p))),
    waiver_budget: (tx.waiver_budget || []).map(parseBudget).filter(Boolean),
  };
}
