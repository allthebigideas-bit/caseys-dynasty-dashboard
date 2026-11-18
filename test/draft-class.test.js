import { test } from 'node:test';
import assert from 'node:assert/strict';

// Two DynastyProcess snapshots: June 2023, where the rookies' draft_year is
// "NA" (as it really was all that summer), and today, which has it.
const HEAD = 'player,pos,team,age,draft_year,ecr_1qb,ecr_2qb,ecr_pos,value_1qb,value_2qb,scrape_date,fp_id';
const JUNE = [HEAD, 'Bijan Robinson,RB,ATL,NA,NA,3,7,1,9700,8700,2023-06-09,23133', 'Sam LaPorta,TE,DET,NA,NA,119,131,13,640,475,2023-06-09,22978', 'Old Vet,WR,KC,30,2015,50,60,20,3000,2800,2023-06-09,111'].join('\n');
const NOW = [HEAD, 'Bijan Robinson,RB,ATL,24,2023,1,3,1,9900,9500,2026-11-18,23133', 'Sam LaPorta,TE,DET,25,2023,60,70,4,5000,4600,2026-11-18,22978', 'Old Vet,WR,KC,33,2015,200,220,80,500,400,2026-11-18,111'].join('\n');
const COMMITS = [{ sha: 'now', at: Date.now() - 3600e3 }, { sha: 'june23', at: Date.UTC(2023, 5, 9) }];

test('a rookie class whose snapshot lost its draft years still counts', async () => {
  const mem = {};
  globalThis.chrome = { storage: { local: { async get(k) { const o = {}; for (const x of [].concat(k)) if (x in mem) o[x] = mem[x]; return o; }, async set(o) { Object.assign(mem, o); }, async remove() {} } } };
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.host === 'api.github.com') {
      const since = Date.parse(u.searchParams.get('since')), until = Date.parse(u.searchParams.get('until'));
      const c = COMMITS.filter((x) => x.at >= since && x.at <= until).slice(0, 1);
      return new Response(JSON.stringify(c.map((x) => ({ sha: x.sha, commit: { committer: { date: new Date(x.at).toISOString() } } }))));
    }
    return new Response(u.pathname.includes('/june23/') ? JUNE : NOW);
  };
  const { loadDraftIntel } = await import('../lib/draft.js');
  const d = await loadDraftIntel({ season: 2026 });
  const c = d.classes[2023];
  assert.ok(c, 'the 2023 class is found');
  assert.deepEqual(c.players.map((p) => p.name), ['Bijan Robinson', 'Sam LaPorta']);
  assert.equal(d.posHit.TE.n, 1);
  assert.equal(d.posHit.TE.rate, 1, 'LaPorta is a top-12 TE today');
});
