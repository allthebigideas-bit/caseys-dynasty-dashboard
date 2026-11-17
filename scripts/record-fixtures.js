// Records the Sleeper REST responses sync's tests serve, from the test league.
// It runs the real sync over a port that saves each response, so the fixtures
// hold exactly what sync asks for. Public reads only: no login, no token.
//
//   node scripts/record-fixtures.js
//
// Offers and the trade block need a login, so this never records them:
// test/fixtures/sleeper/gql.json is captured by hand (see the README there).

import { writeFile } from 'node:fs/promises';
import { createSync } from '../lib/sync.js';
import { networkSleeper } from '../lib/sleeper-port.js';
import { memoryStore } from '../lib/store.js';
import { PATHS } from '../lib/sleeper.js';

const DIR = new URL('../test/fixtures/sleeper/', import.meta.url);
const LEAGUE_ID = '1313340828264960001'; // Casey's Dynasty League
const USERNAME = 'Pooptoad';
const LOGIN_ID = '1263912537670307840'; // Pooptoad's user ID

const rest = {};
const recorder = (login) => {
  const port = { ...networkSleeper, login: async () => login };
  for (const k of Object.keys(PATHS)) {
    port[k] = async (...args) => {
      let res = await networkSleeper[k](...args);
      // Members' other leagues aren't the test league's to publish.
      if (k === 'userLeagues') res = res.filter((l) => String(l.league_id) === LEAGUE_ID);
      rest[PATHS[k](...args)] = res;
      return res;
    };
  }
  const noToken = () => Promise.reject(Object.assign(new Error('Not recorded: needs a login'), { kind: 'auth' }));
  port.gqlTrades = noToken;
  port.gqlLeaguePlayers = noToken;
  return port;
};

// League-mates' other leagues would mean hundreds of requests: mark every
// member as scanned just now so sync skips them.
const rosters = await networkSleeper.leagueRosters(LEAGUE_ID);
const others = Object.fromEntries(rosters.map((r) => [r.owner_id, { at: Date.now(), leagues: [] }]));
const rivalId = rosters.map((r) => String(r.owner_id)).find((id) => id !== LOGIN_ID);

const run = async (login, settings) => {
  const store = memoryStore({ dossierSettings: settings, [`others:${LEAGUE_ID}`]: others });
  const sync = createSync({ sleeper: recorder(login), store });
  await sync.syncLeague();
  await sync.leagueTeams(LEAGUE_ID);
};
const login = { userId: LOGIN_ID, displayName: USERNAME };
await run(login, {}); // the own team, by default
await run(login, { leagueId: LEAGUE_ID, teamUserId: rivalId }); // viewing as a rival
await run({}, { username: USERNAME }); // logged out, team by username

const lines = Object.keys(rest).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(rest[k])}`);
await writeFile(new URL('rest.json', DIR), `{\n${lines.join(',\n')}\n}\n`);
await writeFile(new URL('league.json', DIR), `${JSON.stringify({ leagueId: LEAGUE_ID, loginId: LOGIN_ID, username: USERNAME, rivalId, recordedAt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`);
console.log(`Recorded ${lines.length} responses for league ${LEAGUE_ID}.`);
