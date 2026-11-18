// Value over time: each team's value from a start date (this season's rookie
// draft, or the start of the league season) to today, and a bridge that
// explains the change.
//
//   starting value
//   + trades          value received minus value given, valued the week of each trade
//   + rookie draft    players drafted minus the picks used (only when the window includes the draft)
//   + waivers added   players added (waivers, free agency, commissioner moves), valued that week
//   - value lost      players dropped or released, valued that week
//   + residual        everything else: the assets a team held gaining or losing value
//   = today's value
//
// Assets are keys: "p:<sleeperId>" for players, "k:<season>:<round>:<originalRosterId>" for picks.
// Starting rosters are rebuilt by undoing every move made since the start,
// starting from today's rosters.

const POS_KEYS = ['QB', 'RB', 'WR', 'TE', 'Picks', 'Other'];

/**
 * @param {object} o
 * @param {Array<{rid:number, keys:string[], endValue:number}>} o.teams   today's holdings and value
 * @param {Array<{at:number, kind:'trade'|'draft'|'move', sides:Object<number,{inn:string[], out:string[], released:string[]}>}>} o.moves
 *        completed trades and roster moves (any order); `out` goes to another team in a trade, `released` to waivers
 * @param {number} o.start             start of the window (o.draftAt is accepted too)
 * @param {number} o.now
 * @param {(key:string, ts:number) => number} o.valueAt   value of an asset in the week of ts
 * @param {(key:string) => string} o.posOf                QB/RB/WR/TE/Picks/Other
 * @param {(key:string) => number} [o.endValueOf]        today's value of one asset (for the per-asset ledger)
 *
 * A move can carry `vals` ({key: value}) to price its assets (e.g. Trade summary's
 * values at the time) and, for trades, `net` ({rid: value}) to set the Trades
 * figure exactly; any difference from the per-asset prices is reported as `pkgAdj`.
 */
export function valueOverTime({ teams, moves, start: start0, draftAt: draftAt0, now, valueAt, posOf, endValueOf = null }) {
  const draftAt = start0 ?? draftAt0;
  const after = moves.filter((m) => m.at > draftAt && m.at <= now).sort((a, b) => a.at - b.at);
  const hold = {};
  for (const t of teams) hold[t.rid] = new Set(t.keys);

  // Undo moves, newest first, to get draft-day rosters.
  for (const m of [...after].reverse()) {
    for (const [rid, s] of Object.entries(m.sides || {})) {
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
    rows[t.rid] = { rid: t.rid, start: sumAt(start[t.rid], draftAt), trades: 0, tradeRaw: 0, tradeCount: 0, draft: 0, draftCount: 0, newPicks: 0, newPickCount: 0, added: 0, addCount: 0, lost: 0, lostCount: 0, end: endOf[t.rid], startByPos: byPos(start[t.rid], draftAt), endByPos: byPos(t.keys, now), weeklyNow: sumAt(t.keys, now) };
  }

  // Per-asset ledger: when each asset came in and went out, at what value.
  const ledger = Object.fromEntries(teams.map((t) => [t.rid, { adds: [], drops: [], draft: [], trades: [], held: [], newPicks: [] }]));
  const entry = Object.fromEntries(teams.map((t) => [t.rid, new Map([...start[t.rid]].map((k) => [k, { at: draftAt, v: valueAt(k, draftAt) || 0, how: 'start' }]))]));
  const exit = (rid, k, at, v, how) => {
    const e = entry[rid] && entry[rid].get(k);
    if (!e) return;
    ledger[rid].held.push({ key: k, from: e.at, to: at, vIn: e.v, vOut: v, how: e.how, out: how });
    entry[rid].delete(k);
  };

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
    const val = (k) => (m.vals && m.vals[k] != null ? m.vals[k] : valueAt(k, m.at) || 0);
    if (m.kind === 'roll') {
      // A new year of picks starts counting (after a rookie draft, the year two
      // drafts out joins the value). Picks a team already held get their value now.
      for (const t of teams) {
        const r = rows[t.rid], e = entry[t.rid];
        for (const k of live[t.rid]) {
          if (!m.match(k)) continue;
          const cur = e.get(k);
          if (cur && cur.v) continue; // already priced (e.g. it came in a trade)
          const v = val(k);
          if (!v) continue;
          r.newPicks += v; r.newPickCount++;
          ledger[t.rid].newPicks.push({ at: m.at, key: k, v });
          e.set(k, { at: m.at, v, how: 'new' });
        }
      }
      return;
    }
    const sumV = (keys) => keys.reduce((a, k) => a + val(k), 0);
    for (const [rid, s] of Object.entries(m.sides)) {
      const r = rows[rid], h = live[rid];
      if (!r || !h) continue;
      const vin = sumV(s.inn), vout = sumV(s.out), vrel = sumV(s.released);
      if (m.kind === 'trade') {
        r.tradeRaw += vin - vout;
        r.trades += m.net && m.net[rid] != null ? m.net[rid] : vin - vout;
        r.tradeCount++;
        ledger[rid].trades.push({ at: m.at, id: m.id, src: m.src, inn: s.inn.map((k) => ({ key: k, v: val(k) })), out: s.out.map((k) => ({ key: k, v: val(k) })), net: m.net && m.net[rid] != null ? m.net[rid] : vin - vout });
      } else if (m.kind === 'draft') {
        r.draft += vin - vout;
        r.draftCount += s.inn.length;
        s.inn.forEach((k, j) => ledger[rid].draft.push({ at: m.at, pick: s.out[j] || null, vPick: s.out[j] ? val(s.out[j]) : 0, key: k, v: val(k) }));
      } else {
        r.added += vin;
        r.addCount += s.inn.length;
        for (const k of s.inn) ledger[rid].adds.push({ at: m.at, key: k, v: val(k) });
      }
      if (m.kind === 'move') r.lost += vout;
      r.lost += vrel;
      r.lostCount += s.released.length + (m.kind === 'move' ? s.out.length : 0);
      for (const k of s.released) ledger[rid].drops.push({ at: m.at, key: k, v: val(k) });
      if (m.kind === 'move') for (const k of s.out) ledger[rid].drops.push({ at: m.at, key: k, v: val(k) });
      for (const k of [...s.out, ...s.released]) { exit(Number(rid), k, m.at, val(k), m.kind); h.delete(k); }
      for (const k of s.inn) { h.add(k); entry[rid] && entry[rid].set(k, { at: m.at, v: val(k), how: m.kind }); }
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

  // Close the ledger at today's values, then split the residual into
  // asset appreciation, trade pricing (package adjustment) and anything else.
  for (const t of teams) {
    const r = rows[t.rid];
    let endAssets = 0;
    for (const [k, e] of entry[t.rid]) {
      const v = endValueOf && bookOk ? endValueOf(k) || 0 : valueAt(k, now) || 0;
      endAssets += v;
      ledger[t.rid].held.push({ key: k, from: e.at, to: now, vIn: e.v, vOut: v, how: e.how, out: 'held' });
    }
    r.residual = r.end - r.start - r.trades - r.draft - r.newPicks - r.added + r.lost;
    r.change = r.end - r.start;
    r.assetAppr = ledger[t.rid].held.reduce((a, x) => a + (x.vOut - x.vIn), 0);
    r.pkgAdj = r.tradeRaw - r.trades;
    r.other = r.residual - r.assetAppr - r.pkgAdj;
  }
  return {
    endSource: bookOk ? 'book' : 'weekly', ledger, start: draftAt, draftAt, now, rows, series, mismatch, posKeys: POS_KEYS };
}
