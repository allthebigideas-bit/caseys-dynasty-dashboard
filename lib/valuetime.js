// Value over time: each team's value from this season's rookie draft to today,
// and a bridge that explains the change.
//
//   draft-day value
//   + trades          value received minus value given, valued the week of each trade
//   + waivers added   players added (waivers, free agency, commissioner moves), valued that week
//   - value lost      players dropped or released, valued that week
//   + residual        everything else: the assets a team held gaining or losing value
//   = today's value
//
// Assets are keys: "p:<sleeperId>" for players, "k:<season>:<round>:<originalRosterId>" for picks.
// Draft-day rosters are rebuilt by undoing every move made since the draft,
// starting from today's rosters.

const POS_KEYS = ['QB', 'RB', 'WR', 'TE', 'Picks', 'Other'];

/**
 * @param {object} o
 * @param {Array<{rid:number, keys:string[], endValue:number}>} o.teams   today's holdings and value
 * @param {Array<{at:number, kind:'trade'|'move', sides:Object<number,{inn:string[], out:string[], released:string[]}>}>} o.moves
 *        completed trades and roster moves (any order); `out` goes to another team in a trade, `released` to waivers
 * @param {number} o.draftAt           when this season's rookie draft finished
 * @param {number} o.now
 * @param {(key:string, ts:number) => number} o.valueAt   value of an asset in the week of ts
 * @param {(key:string) => string} o.posOf                QB/RB/WR/TE/Picks/Other
 */
export function valueOverTime({ teams, moves, draftAt, now, valueAt, posOf }) {
  const after = moves.filter((m) => m.at > draftAt && m.at <= now).sort((a, b) => a.at - b.at);
  const hold = {};
  for (const t of teams) hold[t.rid] = new Set(t.keys);

  // Undo moves, newest first, to get draft-day rosters.
  for (const m of [...after].reverse()) {
    for (const [rid, s] of Object.entries(m.sides)) {
      const h = hold[rid];
      if (!h) continue;
      for (const k of s.inn) h.delete(k);
      for (const k of [...s.out, ...s.released]) h.add(k);
    }
  }
  const start = Object.fromEntries(Object.entries(hold).map(([rid, h]) => [rid, new Set(h)]));

  const sumAt = (keys, ts) => {
    let v = 0;
    for (const k of keys) v += valueAt(k, ts) || 0;
    return v;
  };
  const byPos = (keys, ts) => {
    const out = Object.fromEntries(POS_KEYS.map((p) => [p, 0]));
    for (const k of keys) out[posOf(k) in out ? posOf(k) : 'Other'] += valueAt(k, ts) || 0;
    return out;
  };

  // Without today's book (values didn't load) fall back to the latest weekly values for "today".
  const bookOk = teams.some((t) => t.endValue > 0);
  const endOf = Object.fromEntries(teams.map((t) => [t.rid, bookOk ? t.endValue || 0 : sumAt(t.keys, now)]));
  const rows = {};
  for (const t of teams) {
    rows[t.rid] = { rid: t.rid, start: sumAt(start[t.rid], draftAt), trades: 0, tradeCount: 0, added: 0, addCount: 0, lost: 0, lostCount: 0, end: endOf[t.rid], startByPos: byPos(start[t.rid], draftAt), endByPos: byPos(t.keys, now) };
  }

  // Weekly points from draft day, plus today.
  const ticks = [];
  for (let ts = draftAt; ts < now; ts += 7 * 86400e3) ticks.push(ts);
  const series = Object.fromEntries(teams.map((t) => [t.rid, []]));
  let i = 0;
  const live = Object.fromEntries(Object.entries(start).map(([rid, h]) => [rid, new Set(h)]));
  for (const ts of ticks) {
    while (i < after.length && after[i].at <= ts) applyMove(after[i++]);
    for (const t of teams) series[t.rid].push({ at: ts, v: sumAt(live[t.rid], ts) });
  }
  while (i < after.length) applyMove(after[i++]);
  for (const t of teams) series[t.rid].push({ at: now, v: endOf[t.rid], today: true });

  function applyMove(m) {
    for (const [rid, s] of Object.entries(m.sides)) {
      const r = rows[rid], h = live[rid];
      if (!r || !h) continue;
      const vin = sumAt(s.inn, m.at), vout = sumAt(s.out, m.at), vrel = sumAt(s.released, m.at);
      if (m.kind === 'trade') {
        r.trades += vin - vout;
        r.tradeCount++;
      } else {
        r.added += vin;
        r.addCount += s.inn.length;
      }
      if (m.kind !== 'trade') r.lost += vout;
      r.lost += vrel;
      r.lostCount += s.released.length + (m.kind === 'trade' ? 0 : s.out.length);
      for (const k of s.inn) h.add(k);
      for (const k of [...s.out, ...s.released]) h.delete(k);
    }
  }

  // Did replaying every move land on today's rosters? If not, some move is
  // missing from Sleeper's list and the residual carries it.
  const mismatch = {};
  for (const t of teams) {
    const want = new Set(t.keys), got = live[t.rid];
    const extra = [...got].filter((k) => !want.has(k)), missing = [...want].filter((k) => !got.has(k));
    if (extra.length || missing.length) mismatch[t.rid] = { extra, missing };
  }

  for (const r of Object.values(rows)) {
    r.residual = r.end - r.start - r.trades - r.added + r.lost;
    r.change = r.end - r.start;
  }
  return {
    endSource: bookOk ? 'book' : 'weekly', draftAt, now, rows, series, mismatch, posKeys: POS_KEYS };
}
