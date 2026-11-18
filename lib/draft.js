// Rookie draft intelligence.
//
// 1. Class history from DynastyProcess's weekly value files on GitHub:
//    - each rookie class right after its NFL draft (mid-June snapshot), which
//      stands in for rookie-draft order, and what those players are worth now
//      → hit rates by rookie-draft slot, position mix of past classes.
//    - next year's 1st-round pick value at this same point of the calendar in
//      earlier years → how the market rates the coming class against others.
// 2. A prospect board for next year's class: FantasyPros dynasty rookie
//    rankings when they cover that class, or a board the user pastes in.

import { store, normName, canonPos } from './util.js';
import { fetchJSON, fetchText, parseCSV, extractAssigned, DAY } from './net.js';
import { pickKey } from './values.js';

const COMMITS = 'https://api.github.com/repos/dynastyprocess/data/commits?path=files/values.csv';
const RAW = (sha) => `https://raw.githubusercontent.com/dynastyprocess/data/${sha}/files/values.csv`;
const VALUE_POS = ['QB', 'RB', 'WR', 'TE'];

// Commit closest to (at or before) a date, using the API's since/until filter.
async function commitNear(ts) {
  const key = `dpc:${new Date(ts).toISOString().slice(0, 10)}`;
  const hit = await store.get(key, null);
  if (hit) return hit;
  const since = new Date(ts - 12 * DAY).toISOString();
  const until = new Date(ts + DAY).toISOString();
  const arr = await fetchJSON(`${COMMITS}&since=${since}&until=${until}&per_page=1`, { headers: { accept: 'application/vnd.github+json' } });
  const c = Array.isArray(arr) && arr[0] ? { sha: arr[0].sha, at: Date.parse(arr[0].commit.committer.date) } : null;
  if (c && ts < Date.now() - 3 * DAY) await store.set(key, c);
  return c;
}

// Full snapshot: every player with draft year and value, plus pick values.
function full(rows, superflex) {
  const col = superflex ? 'value_2qb' : 'value_1qb';
  const out = { top: 0, players: [], pk: {} };
  for (const r of rows) {
    const v = Number(r[col]) || 0;
    if (!v) continue;
    out.top = Math.max(out.top, v);
    if (r.pos === 'PICK') {
      const k = pickKey(r.player);
      if (k) out.pk[k] = out.pk[k] ? Math.round((out.pk[k] + v) / 2) : v;
      continue;
    }
    const pos = canonPos(r.pos);
    if (!VALUE_POS.includes(pos)) continue;
    out.players.push([r.fp_id || '', r.player, pos, Number(r.draft_year) || null, v]);
  }
  return out;
}

async function snapAt(ts, superflex) {
  const c = await commitNear(ts);
  if (!c) return null;
  const key = `dpx:${superflex ? 'sf' : '1qb'}:${c.sha}`;
  const hit = await store.get(key, null);
  if (hit) return hit;
  const snap = { ...full(parseCSV(await fetchText(RAW(c.sha), { timeout: 30000 })), superflex), at: c.at };
  await store.set(key, snap);
  return snap;
}

const SLOT_BUCKETS = [
  ['1.01–1.03', 1, 3], ['1.04–1.06', 4, 6], ['1.07–1.09', 7, 9], ['1.10–1.12', 10, 12],
  ['2.01–2.06', 13, 18], ['2.07–2.12', 19, 24], ['3rd round', 25, 36],
];
// "Hit" = a top-24 RB, top-30 WR, top-12 QB or top-12 TE by dynasty value now.
const HIT = { QB: 12, RB: 24, WR: 30, TE: 12 };

export async function loadDraftIntel({ season, superflex = false, teams = 12, onStep = () => {} }) {
  const now = Date.now();
  const cur = await snapAt(now, superflex);
  if (!cur) throw new Error('No DynastyProcess snapshot found');
  // current positional ranks
  const posRank = {};
  const byPos = {};
  for (const p of cur.players) (byPos[p[2]] ||= []).push(p);
  for (const pos of Object.keys(byPos)) byPos[pos].sort((a, b) => b[4] - a[4]).forEach((p, i) => { posRank[p[0] || `${normName(p[1])}|${pos}`] = i + 1; });
  const nowOf = {};
  for (const p of cur.players) nowOf[p[0] || `${normName(p[1])}|${p[2]}`] = p[4];
  // DynastyProcess left draft_year as "NA" for that year's rookies in some
  // snapshots (all of summer 2023), which silently dropped the whole class.
  // Fall back to the draft year in today's file.
  const draftYearNow = {};
  for (const p of cur.players) if (p[0] && p[3]) draftYearNow[p[0]] = p[3];
  const classOf = (p) => p[3] || (p[0] && draftYearNow[p[0]]) || null;

  const classes = {};
  const firstYear = Math.max(2020, season - 6);
  for (let y = firstYear; y <= season; y++) {
    onStep(`Reading the ${y} rookie class`);
    const june = Date.UTC(y, 5, 15);
    if (june > now) continue;
    let snap;
    try { snap = await snapAt(june, superflex); } catch { snap = null; }
    if (!snap) continue;
    const rookies = snap.players.filter((p) => classOf(p) === y).sort((a, b) => b[4] - a[4]).slice(0, 36);
    if (!rookies.length) continue;
    const posMix = { QB: 0, RB: 0, WR: 0, TE: 0 };
    for (const p of rookies.slice(0, 24)) posMix[p[2]]++;
    const top12 = rookies.slice(0, 12).reduce((s, p) => s + p[4], 0) / (12 * snap.top);
    const players = rookies.map((p, i) => {
      const id = p[0] || `${normName(p[1])}|${p[2]}`;
      const pr = posRank[id] || null;
      return { slot: i + 1, fp: p[0], name: p[1], pos: p[2], then: Math.round((p[4] / snap.top) * 10000), now: nowOf[id] ? Math.round((nowOf[id] / cur.top) * 10000) : 0, posRank: pr, hit: pr != null && pr <= HIT[p[2]] };
    });
    classes[y] = { year: y, posMix, top12, players, mature: y <= season - 2 };
  }

  // Market view: next year's mid 1st, relative to the top asset, at this same
  // point in the calendar in earlier years.
  const doy = new Date(now);
  const market = [];
  for (let y = firstYear + 1; y <= season + 2; y++) {
    const ts = y <= season + 1 ? Date.UTC(y - 1, doy.getUTCMonth(), doy.getUTCDate()) : now;
    if (ts > now) continue;
    onStep(`Reading ${y} pick values`);
    let snap;
    try { snap = ts === now ? cur : await snapAt(ts, superflex); } catch { snap = null; }
    if (!snap) continue;
    const v1 = snap.pk[`${y} 1 mid`] ?? snap.pk[`${y} 1 any`];
    const v2 = snap.pk[`${y} 2 mid`] ?? snap.pk[`${y} 2 any`];
    if (v1 == null) continue;
    market.push({ year: y, r1: v1 / snap.top, r2: v2 != null ? v2 / snap.top : null, at: snap.at, current: y >= season + 1 });
  }

  // Hit rates by slot from classes that have had two seasons to develop.
  const mature = Object.values(classes).filter((c) => c.mature);
  const hitRates = SLOT_BUCKETS.map(([label, a, b]) => {
    const ps = mature.flatMap((c) => c.players.filter((p) => p.slot >= a && p.slot <= b).map((p) => ({ ...p, year: c.year })));
    const hits = ps.filter((p) => p.hit);
    return { label, a, b, n: ps.length, rate: ps.length ? hits.length / ps.length : null, avgNow: ps.length ? Math.round(ps.reduce((s, p) => s + p.now, 0) / ps.length) : 0, best: [...ps].sort((x, y) => y.now - x.now).slice(0, 3).map((p) => `${p.name} (${p.year})`), busts: ps.filter((p) => !p.hit).sort((x, y) => x.now - y.now).slice(0, 2).map((p) => `${p.name} (${p.year})`) };
  });
  // Hit rate by position in rounds 1-2
  const posHit = {};
  for (const pos of VALUE_POS) {
    const ps = mature.flatMap((c) => c.players.filter((p) => p.slot <= 24 && p.pos === pos));
    posHit[pos] = { n: ps.length, hits: ps.filter((p) => p.hit).length, rate: ps.length ? ps.filter((p) => p.hit).length / ps.length : null };
  }
  return { at: now, classes, market, hitRates, posHit, teams, note: 'Rookie-draft order approximated by each class\'s dynasty value in mid-June after the NFL draft.' };
}

// ---- prospect board ---------------------------------------------------------------------

const NFL = new Set(['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAC', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS', 'FA']);

export async function loadFpRookies(classYear) {
  const urls = [
    `https://www.fantasypros.com/nfl/rankings/dynasty-rookies.php`,
    `https://www.fantasypros.com/nfl/rankings/rookies.php`,
  ];
  const errors = [];
  for (const url of urls) {
    try {
      const html = await fetchText(url, { timeout: 25000, credentials: 'include' });
      const data = extractAssigned(html, 'ecrData');
      if (!data || !Array.isArray(data.players) || !data.players.length) { errors.push(`${url}: no rankings`); continue; }
      const yr = Number(data.year || data.season || (/(20\d\d)\s+(?:dynasty\s+)?rookie/i.exec(html) || [])[1]);
      const players = data.players.map((p) => ({ rank: Number(p.rank_ecr) || null, name: p.player_name, pos: canonPos(p.player_position_id), school: p.player_team_id || '', tier: p.tier || null, fp: String(p.player_id) }))
        .filter((p) => VALUE_POS.includes(p.pos));
      const prospects = players.filter((p) => !NFL.has(String(p.school).toUpperCase()));
      // If most names already have NFL teams, the page is still on the drafted class.
      if (prospects.length < players.length * 0.5 || (yr && yr !== classYear)) { errors.push(`${url}: shows the ${yr || 'current'} class, not ${classYear}`); continue; }
      return { source: 'FantasyPros dynasty rookie rankings', url, at: Date.now(), year: classYear, players: prospects.sort((a, b) => a.rank - b.rank) };
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
    }
  }
  throw new Error(errors.join('; '));
}

// College names, longest first, for splitting "Jeremiah Smith Ohio State Jr"
// into name and school when a pasted table has lost its column breaks.
const SCHOOLS = `Air Force|Akron|Alabama|Alabama A&M|Alabama State|Appalachian State|Arizona|Arizona State|Arkansas|Arkansas State|Army|Auburn|Ball State|Baylor|Boise State|Boston College|Bowling Green|Buffalo|BYU|Cal|California|Central Michigan|Charlotte|Cincinnati|Clemson|Coastal Carolina|Colorado|Colorado State|Connecticut|UConn|Delaware|Duke|East Carolina|Eastern Michigan|FIU|Florida|Florida Atlantic|Florida International|Florida State|Florida A&M|Fresno State|Georgia|Georgia Southern|Georgia State|Georgia Tech|Hawaii|Houston|Illinois|Indiana|Iowa|Iowa State|Jackson State|Jacksonville State|James Madison|Kansas|Kansas State|Kennesaw State|Kent State|Kentucky|Liberty|Louisiana|Louisiana Tech|Louisiana-Monroe|UL Monroe|Louisville|LSU|Marshall|Maryland|Memphis|Miami|Miami (Fla.)|Miami (FL)|Miami (Ohio)|Miami (OH)|Michigan|Michigan State|Middle Tennessee|Minnesota|Mississippi State|Missouri|Missouri State|Navy|NC State|Nebraska|Nevada|New Mexico|New Mexico State|North Carolina|North Dakota State|South Dakota State|North Texas|Northern Illinois|Northwestern|Notre Dame|Ohio|Ohio State|Oklahoma|Oklahoma State|Old Dominion|Ole Miss|Oregon|Oregon State|Penn State|Pittsburgh|Pitt|Purdue|Rice|Rutgers|Sam Houston|San Diego State|San Jose State|SMU|South Alabama|South Carolina|South Florida|USF|Southern Miss|Stanford|Syracuse|TCU|Temple|Tennessee|Texas|Texas A&M|Texas State|Texas Tech|Toledo|Troy|Tulane|Tulsa|UAB|UCF|UCLA|UNLV|USC|Utah|Utah State|UTEP|UTSA|Vanderbilt|Virginia|Virginia Tech|Wake Forest|Washington|Washington State|West Virginia|Western Kentucky|Western Michigan|Wisconsin|Wyoming|Montana|Montana State|Idaho|Villanova|Princeton|Harvard|Yale|Youngstown State|Illinois State|Northern Iowa|Southern Illinois|Tennessee State|Grambling|Howard|Furman|Samford|Richmond|William & Mary|Incarnate Word|Abilene Christian|Stephen F. Austin|Weber State|UC Davis|Sacramento State|Eastern Washington|Southeastern Louisiana|Nicholls|Lindenwood|Holy Cross|Fordham|Lehigh|Lafayette|Bucknell|Colgate`.split('|').sort((a, b) => b.length - a.length);
const CLASSES = /^(?:R-?|RS-?|Redshirt )?(Fr|Freshman|So|Soph|Sophomore|Jr|Junior|Sr|Senior|Gr|Grad|Graduate|5th|Super Sr)\.?$/i;
const POS_RE = /(^|\s)(QB|RB|WR|TE|HB|FB)(?=\s|$|\d)/; // uppercase only, so names like "Te'o" don't match

function splitNameSchool(text) {
  let words = text.trim().split(' ');
  let cls = null;
  if (words.length > 1 && CLASSES.test(words[words.length - 1])) cls = words.pop().replace(/\.$/, '');
  const joined = words.join(' ');
  for (const sc of SCHOOLS) {
    if (joined.toLowerCase().endsWith(' ' + sc.toLowerCase())) return { name: joined.slice(0, joined.length - sc.length).trim(), school: sc, cls };
  }
  return { name: joined, school: '', cls };
}

// Accepts many pasted formats, e.g.
//  "1. Jeremiah Smith WR Ohio State"
//  "1 Jeremiah Smith Ohio State Jr WR 1 6-4 222 ..."   (CBS Sports prospect rankings)
//  "Smith, Jeremiah - WR (Ohio State)", tab or comma separated rows.
export function parseBoard(text) {
  const out = [];
  for (const line0 of String(text || '').split(/\r?\n/)) {
    // Tab-separated rows (copied from a table with columns intact)
    if (line0.includes('\t')) {
      const cells = line0.split('\t').map((c) => c.trim()).filter(Boolean);
      const pi = cells.findIndex((c) => /^(QB|RB|WR|TE|HB|FB)$/.test(c));
      if (pi > 0) {
        const pos = cells[pi].replace(/HB|FB/, 'RB');
        const lead = cells.slice(0, pi);
        const srcRank = /^\d+$/.test(lead[0]) ? Number(lead.shift()) : null;
        const clsIdx = lead.findIndex((c) => CLASSES.test(c));
        const cls = clsIdx >= 0 ? lead.splice(clsIdx, 1)[0] : null;
        const name = lead[0] || '';
        const school = lead.slice(1).join(' ');
        const rest = cells.slice(pi + 1);
        const posRank = rest[0] && /^\d+$/.test(rest[0]) ? Number(rest[0]) : null;
        const ht = rest.find((c) => /^\d-\d{1,2}$/.test(c)) || null;
        const wt = rest.find((c) => /^\d{3}$/.test(c)) || null;
        if (name) out.push({ rank: out.length + 1, srcRank, name, pos, school, cls, posRank, ht, wt: wt ? Number(wt) : null, tier: null });
        continue;
      }
    }
    const line = line0.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const m = POS_RE.exec(line);
    if (!m) continue;
    const pos = m[2].replace(/HB|FB/, 'RB');
    const posStart = m.index + m[1].length;
    let before = line.slice(0, posStart).trim();
    let after = line.slice(posStart + m[2].length).trim();
    let srcRank = null;
    const rk = /^(?:#?(\d+)[.)]?|rank\s*(\d+))\s+/i.exec(before);
    if (rk) { srcRank = Number(rk[1] || rk[2]); before = before.slice(rk[0].length); }
    before = before.replace(/[-–,|(]+\s*$/, '').trim();
    if (/,/.test(before) && before.split(',').length === 2) before = before.split(',').reverse().map((x) => x.trim()).join(' ');
    if (!before) continue;
    const tierM = /\btier\s*(\d+)/i.exec(line);
    // Stats after the position: position rank, height (6-4), weight (222)
    let posRank = null, ht = null, wt = null;
    const pr = /^(\d{1,3})(?=\s|$)/.exec(after);
    const htM = /\b(\d-\d{1,2})\b/.exec(after);
    const wtM = htM ? /^\s*(\d{3})\b/.exec(after.slice(htM.index + htM[0].length)) : null;
    if (htM) { ht = htM[1]; wt = wtM ? Number(wtM[1]) : null; if (pr && pr.index < htM.index) posRank = Number(pr[1]); }
    // School: inside the name part (CBS style) or after the position ("WR Ohio State")
    let { name, school, cls } = splitNameSchool(before);
    if (!school) {
      const tail = after.replace(/\btier\s*\d+/i, '').replace(/^[\s\-–,|)(]+/, '').replace(/[()]/g, '').trim();
      if (!htM && tail && !/^\d/.test(tail)) {
        const parts = tail.split(' ');
        if (parts.length > 1 && CLASSES.test(parts[parts.length - 1])) cls = parts.pop();
        school = parts.join(' ');
      }
    }
    out.push({ rank: out.length + 1, srcRank, name, pos, school, cls, posRank, ht, wt, tier: tierM ? Number(tierM[1]) : null });
  }
  return out;
}

// Boards saved before the parser understood stats columns had height and
// weight stuck in "school". Re-read them.
export function repairBoard(board) {
  if (!board || !board.players || !board.players.some((p) => /^\d+\s+\d-\d{1,2}/.test(p.school || '') || (p.school === '' && / (Jr|Sr|Soph|So|Fr)$/.test(p.name)))) return board;
  const lines = board.players.map((p) => `${p.srcRank || p.rank} ${p.name} ${p.pos} ${p.school || ''}${p.tier ? ` Tier ${p.tier}` : ''}`);
  return { ...board, players: parseBoard(lines.join('\n')), repaired: true };
}
