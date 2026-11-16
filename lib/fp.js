// FantasyPros weekly expert consensus (ECR) for start/sit.
// First choice: FantasyPros' own weekly ranking pages (freshest, updates
// through Sunday). Fallback: the DynastyProcess daily mirror of the same data
// on GitHub, which is PPR-only.

import { canonPos, canonTeam } from './util.js';
import { fetchText, parseCSV, extractAssigned, HOUR } from './net.js';
import { cached } from './values.js';

function pages(ppr) {
  const p = ppr >= 1 ? 'ppr-' : ppr >= 0.5 ? 'half-point-ppr-' : '';
  return ['qb', `${p}rb`, `${p}wr`, `${p}te`, 'dst', 'k'];
}

function fromEcrData(data) {
  if (!data || !Array.isArray(data.players)) return [];
  return data.players.map((p) => ({
    fp: String(p.player_id),
    name: p.player_name,
    pos: canonPos(p.player_position_id),
    team: canonTeam(p.player_team_id),
    ecr: Number(p.rank_ecr) || null,
    posRank: p.pos_rank || '',
    grade: p.start_sit_grade || '',
    opp: p.player_opponent || '',
    bye: p.player_bye_week ? Number(p.player_bye_week) : null,
    kickoff: p.player_game_kickoff_ts ? Number(p.player_game_kickoff_ts) * 1000 : null,
    gameStatus: p.player_game_status || '',
    pts: p.r2p_pts ? Number(p.r2p_pts) : null,
    tier: p.tier || null,
    week: data.week || null,
  }));
}

async function direct(ppr) {
  const out = [];
  let week = null;
  for (const page of pages(ppr)) {
    const html = await fetchText(`https://www.fantasypros.com/nfl/rankings/${page}.php`, { timeout: 25000, credentials: 'include' });
    const data = extractAssigned(html, 'ecrData');
    const rows = fromEcrData(data);
    if (!rows.length) throw new Error(`FantasyPros ${page} page had no rankings`);
    week = week || (data && data.week);
    out.push(...rows);
  }
  return { source: 'FantasyPros', week, rows: out };
}

async function mirror() {
  const rows = parseCSV(await fetchText('https://raw.githubusercontent.com/dynastyprocess/data/master/files/fp_latest_weekly.csv'));
  return {
    source: 'FantasyPros (DynastyProcess daily mirror, PPR)',
    week: null,
    scraped: rows[0] && rows[0].scrape_date,
    rows: rows.filter((r) => ['QB', 'RB', 'WR', 'TE', 'DST', 'K'].includes(r.pos)).map((r) => ({
      fp: r.fantasypros_id,
      name: r.player_name,
      pos: canonPos(r.pos),
      team: canonTeam(r.team),
      ecr: Number(r.ecr) || null,
      posRank: r.pos_rank || '',
      grade: r.start_sit_grade || '',
      opp: r.player_opponent || '',
      bye: r.player_bye_week ? Number(r.player_bye_week) : null,
      kickoff: r.player_game_kickoff_ts ? Number(r.player_game_kickoff_ts) * 1000 : null,
      gameStatus: r.player_game_status || '',
      pts: r.r2p_pts ? Number(r.r2p_pts) : null,
      tier: null,
      week: null,
    })),
  };
}

export async function loadWeeklyEcr(ppr, opts) {
  return cached(`src:fpweekly:${ppr}`, 3 * HOUR, async () => {
    try {
      return await direct(ppr);
    } catch (e) {
      const m = await mirror();
      m.directError = e.message;
      return m;
    }
  }, opts);
}
