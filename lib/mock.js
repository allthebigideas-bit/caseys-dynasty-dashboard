// Mock draft: walk the draft order and give each team a prospect from the
// board, weighing talent (board rank) against the team's weakest positions.
//
// - The first few picks are best player available: elite prospects go early
//   no matter what.
// - After that, each team looks at the next handful of prospects and scores
//   them: talent falls off with board rank, and a position where the team
//   ranks near the bottom of the league counts for more than one where it's
//   already stacked. A team that just traded for a starting QB ranks high at
//   QB, so a QB slides past it.
// - Drafting a position fills some of that need for the team's later picks.

const POS = ['QB', 'RB', 'WR', 'TE'];

/**
 * @param {object} o
 * @param {Array<{rid:number}>} o.order          picks in draft order
 * @param {Array<{name:string, pos:string}>} o.board  prospects, best first
 * @param {Object<number, Object<string, number>>} o.posRank  each team's league rank at QB/RB/WR/TE (1 = best room)
 * @param {number} o.teams                        number of teams (for scaling ranks)
 * @param {number} [o.bpaPicks=3]                 opening picks that are pure best available
 * @param {number} [o.window=7]                   how many available prospects a team weighs
 * @returns {Array<{player:object|null, boardRank:number|null, reason:'bpa'|'need'|'value'|null, needPos:string|null}>}
 */
export function mockDraft({ order, board, posRank, teams, bpaPicks = 3, window = 7 }) {
  const avail = board.map((p, i) => ({ ...p, boardRank: i + 1 })).filter((p) => POS.includes(p.pos));
  const n = Math.max(2, teams || 12);
  const rank = {};
  for (const [rid, r] of Object.entries(posRank || {})) rank[rid] = { ...r };
  const talent = (br) => Math.exp(-(br - 1) / 14);
  const need = (rid, pos) => {
    const r = rank[rid] && rank[rid][pos];
    if (r == null) return 1;
    return 0.7 + 0.6 * Math.max(0, Math.min(1, (r - 1) / (n - 1))); // best room 0.7, worst room 1.3
  };
  const worst = (rid) => {
    const r = rank[rid] || {};
    return POS.filter((p) => r[p] != null).sort((a, b) => r[b] - r[a])[0] || null;
  };
  return order.map((pk, i) => {
    if (!avail.length) return { player: null, boardRank: null, reason: null, needPos: null };
    let pickIdx = 0;
    let reason = 'bpa';
    if (i >= bpaPicks) {
      const cands = avail.slice(0, window);
      let best = -1;
      cands.forEach((c, j) => {
        const sc = talent(c.boardRank) * need(pk.rid, c.pos);
        if (sc > best) { best = sc; pickIdx = j; }
      });
      if (pickIdx > 0) reason = avail[pickIdx].pos === worst(pk.rid) ? 'need' : 'value';
    }
    const player = avail.splice(pickIdx, 1)[0];
    // Drafting a position fills part of the hole for this team's later picks.
    if (rank[pk.rid] && rank[pk.rid][player.pos] != null) rank[pk.rid][player.pos] = Math.max(1, rank[pk.rid][player.pos] - Math.ceil(n / 3));
    const r0 = posRank && posRank[pk.rid] ? posRank[pk.rid][player.pos] : null;
    return { player, boardRank: player.boardRank, reason, needPos: reason === 'bpa' ? null : player.pos, needRank: r0 };
  });
}
