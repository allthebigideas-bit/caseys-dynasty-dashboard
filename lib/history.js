// Values "at the time": DynastyProcess publishes its dynasty values to GitHub
// every week, so the repository history is a weekly record of player and pick
// values going back to 2019. For each trade we load the snapshot from the
// week it happened and grade it with those values.

import { store, normName, canonPos } from './util.js';
import { fetchJSON, fetchText, parseCSV, pool, DAY } from './net.js';
import { pickKey } from './values.js';

const COMMITS = 'https://api.github.com/repos/dynastyprocess/data/commits?path=files/values.csv&per_page=100';
const RAW = (sha) => `https://raw.githubusercontent.com/dynastyprocess/data/${sha}/files/values.csv`;

async function commitList(sinceTs) {
  const hit = await store.get('dpCommits', null);
  if (hit && Date.now() - hit.at < DAY && hit.oldest <= sinceTs) return hit.list;
  const list = [];
  for (let page = 1; page <= 5; page++) {
    const arr = await fetchJSON(`${COMMITS}&page=${page}`, { headers: { accept: 'application/vnd.github+json' } });
    if (!Array.isArray(arr) || !arr.length) break;
    for (const c of arr) list.push({ sha: c.sha, at: Date.parse(c.commit.committer.date) });
    if (list[list.length - 1].at < sinceTs) break;
  }
  if (!list.length) throw new Error('GitHub returned no DynastyProcess history');
  await store.set('dpCommits', { at: Date.now(), oldest: list[list.length - 1].at, list });
  return list;
}

// Compact snapshot: { top, fp: {fpId: value}, nm: {"name|POS": value}, pk: {pickKey: value}, slot: {"2026 pick 1.05": value} }
function compact(rows, superflex) {
  const col = superflex ? 'value_2qb' : 'value_1qb';
  const out = { top: 0, fp: {}, nm: {}, pk: {}, slot: {} };
  for (const r of rows) {
    const v = Number(r[col]) || 0;
    if (!v) continue;
    out.top = Math.max(out.top, v);
    if (r.pos === 'PICK') {
      const slot = /\b(20\d\d)\s+Pick\s+([1-9])\.(\d{1,2})\b/i.exec(r.player);
      if (slot) out.slot[`${slot[1]} pick ${Number(slot[2])}.${String(Number(slot[3])).padStart(2, '0')}`] = v;
      const k = pickKey(r.player);
      if (k) {
        // Slot picks fold into their tier; keep the tier's best-known average.
        const prev = out.pk[k];
        out.pk[k] = prev ? Math.round((prev + v) / 2) : v;
      }
      continue;
    }
    if (r.fp_id) out.fp[r.fp_id] = v;
    out.nm[`${normName(r.player)}|${canonPos(r.pos)}`] = v;
  }
  return out;
}

async function snapshot(sha, superflex) {
  const key = `dpv:${superflex ? 'sf' : '1qb'}:${sha}`;
  const hit = await store.get(key, null);
  if (hit) return hit;
  const snap = compact(parseCSV(await fetchText(RAW(sha), { timeout: 30000 })), superflex);
  await store.set(key, snap);
  return snap;
}

// dates: trade timestamps. Returns { pick(ts) → sha, snaps: {sha: snapshot} }.
export async function loadHistory(dates, { superflex = false, onStep = () => {}, max = 60 } = {}) {
  const valid = dates.filter(Boolean);
  if (!valid.length) return { byDate: {}, snaps: {} };
  const oldest = Math.min(...valid);
  const list = await commitList(oldest);
  const byDate = {};
  for (const ts of valid) {
    const c = list.find((x) => x.at <= ts + 2 * 86400e3) || list[list.length - 1];
    byDate[ts] = c.sha;
  }
  const shas = [...new Set(Object.values(byDate))].slice(0, max);
  onStep(`Loading values from the week of each trade (${shas.length} weeks)`);
  const res = await pool(shas, 4, (sha) => snapshot(sha, superflex));
  const snaps = {};
  shas.forEach((sha, i) => { if (res[i] && !res[i].error) snaps[sha] = res[i]; });
  return { byDate, snaps };
}
