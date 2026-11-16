// Trade trees: follow everything a team received in a trade forward in time.
// A pick becomes the player drafted with it; a player traded on becomes what
// came back; a player still on the roster (or a pick still owned) is a leaf
// valued at today's price. The tree's total is what the trade turned into.

// trades: [{ id, created, rids, sides: { rid: { inP:[sid], outP:[sid], inK:[pick], outK:[pick] } } }]
//   in today's roster-id space, sorted oldest first. pick: { season, round, orig, became? }
// ctx: { rosterOf(rid) → [sid], releases: [{ rid, sid, at }], playerNow(sid), pickNow(season, round, orig),
//        season (current league season), draftDate(season) }
export function makeTreeBuilder(trades, ctx) {
  const sameKey = (a, b) => Number(a.season) === Number(b.season) && Number(a.round) === Number(b.round) && Number(a.orig) === Number(b.orig);
  const received = (t, rid) => {
    const s = t.sides[rid];
    if (!s) return [];
    return [...s.inP.map((sid) => ({ kind: 'player', sid })), ...s.inK.map((k) => ({ kind: 'pick', ...k }))];
  };

  // When does an asset leave this team by trade after `ts`?
  const exitTrade = (rid, node, ts) => trades.find((x) => x.created > ts && x.sides[rid] && (node.kind === 'player' ? x.sides[rid].outP.includes(node.sid) : x.sides[rid].outK.some((k) => sameKey(k, node))));

  // Grow a list of assets together, so assets that were packaged into the same
  // later trade show that trade once, with its return underneath.
  function growList(rid, items, ts, depth, seen) {
    const out = [];
    const groups = new Map();
    for (const node of items) {
      const t = depth > 7 ? null : exitTrade(rid, node, ts);
      if (t) {
        if (!groups.has(t.id)) { groups.set(t.id, { t, items: [] }); out.push({ _group: t.id }); }
        groups.get(t.id).items.push(node);
      } else out.push(leaf(rid, node, ts, depth, seen));
    }
    return out.map((x) => {
      if (!x._group) return x;
      const { t, items: its } = groups.get(x._group);
      const key = `${rid}|${t.id}`;
      const children = seen.has(key) ? [] : (seen.add(key), growList(rid, received(t, rid), t.created, depth + 1, seen));
      const fullTotal = children.reduce((s, c) => s + c.total, 0);
      // Credit the branch only with its share of the deal: what the tree's assets were worth on
      // the day of that later trade, out of everything this team sent in it.
      const cut = ctx.shareOf ? ctx.shareOf(t, rid, its) : { share: 1 };
      const total = fullTotal * cut.share;
      // Everything else this team sent in that deal (assets not from this tree), so the
      // bubble can show the full trade, not just the branch being followed.
      const side = t.sides[rid] || { outP: [], outK: [] };
      const alsoSent = [
        ...side.outP.filter((sid) => !its.some((x) => x.kind === 'player' && x.sid === sid)).map((sid) => ({ kind: 'player', sid })),
        ...side.outK.filter((k) => !its.some((x) => x.kind === 'pick' && sameKey(x, k))).map((k) => ({ kind: 'pick', ...k })),
      ];
      const base = { status: 'traded', at: t.created, via: t.id, partner: t.rids.filter((r) => r !== rid), children, total, fullTotal, share: cut.share, sentThen: cut.tree, sentAll: cut.all, valSrc: cut.src, parts: cut.parts, alsoSent };
      if (its.length === 1) return { ...its[0], ...base };
      return { kind: 'package', items: its, ...base };
    });
  }

  function leaf(rid, node, ts, depth, seen) {
    const out = { ...node, children: [] };
    if (node.kind === 'player') {
      if (ctx.rosterOf(rid).includes(node.sid)) {
        out.status = 'kept';
        out.value = ctx.playerNow(node.sid);
      } else {
        const rel = ctx.releases.find((r) => r.rid === rid && r.sid === node.sid && r.at > ts);
        out.status = rel ? 'released' : 'gone';
        out.at = rel ? rel.at : null;
        out.value = 0;
      }
    } else if (node.became) {
      out.status = 'drafted';
      out.children = growList(rid, [{ kind: 'player', sid: node.became, draftedWith: node.no || null }], ctx.draftDate(node.season), depth + 1, seen);
    } else if (Number(node.season) > ctx.season) {
      out.status = 'owned';
      out.value = ctx.pickNow(node.season, node.round, node.orig);
    } else {
      out.status = 'unknown';
      out.value = 0;
    }
    out.total = out.children.length ? out.children.reduce((s, c) => s + c.total, 0) : out.value || 0;
    return out;
  }

  return function treeFor(trade, rid) {
    const seen = new Set([`${rid}|${trade.id}`]);
    const nodes = growList(rid, received(trade, rid), trade.created, 1, seen);
    const later = new Set();
    walk(nodes, (n) => { if (n.status === 'traded' && n.via) later.add(n.via); });
    let held = 0, playersNow = 0;
    walk(nodes, (n) => { if (!n.children.length && (n.status === 'kept' || n.status === 'owned')) { held++; if (n.status === 'kept') playersNow++; } });
    return { nodes, total: nodes.reduce((s, n) => s + n.total, 0), branches: countBranches(nodes), generations: gens(nodes), laterTrades: later.size, held, playersNow };
  };
}

function walk(nodes, fn) { for (const n of nodes) { fn(n); walk(n.children, fn); } }

// Generations: how many times the haul was flipped (traded on, or a pick spent) down the longest line.
function gens(nodes) {
  let g = 0;
  for (const x of nodes) g = Math.max(g, (x.status === 'traded' || x.status === 'drafted' ? 1 : 0) + gens(x.children));
  return g;
}

function countBranches(nodes) {
  let n = 0;
  for (const x of nodes) n += (x.children.length ? 1 + countBranches(x.children) : 0);
  return n;
}
