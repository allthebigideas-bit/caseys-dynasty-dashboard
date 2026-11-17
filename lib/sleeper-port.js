// The Sleeper port: every Sleeper call sync makes, as one object sync is given
// instead of importing. Two adapters: the network (production) and recorded
// responses (tests).

import * as sl from './sleeper.js';

const REST = Object.keys(sl.PATHS);

// Every request gives up after the 25-second timeout in net.js.
export const networkSleeper = {
  login: sl.getAuth,
  ...Object.fromEntries(REST.map((k) => [k, sl[k]])),
  gqlTrades: sl.gqlTrades,
  gqlLeaguePlayers: sl.gqlLeaguePlayers,
  playersDict: sl.playersDict,
  projections: sl.projections,
};

// Serves recorded responses: `rest` by REST path (sleeper.js PATHS), `gql` by
// "trades:<leagueId>" and "leaguePlayers:<leagueId>". A call with nothing
// recorded rejects, as a failed request would. `calls` lists what was asked.
export function fixtureSleeper({ login = {}, rest = {}, gql = {} } = {}) {
  const calls = [];
  const serve = (table, key) => {
    calls.push(key);
    if (!(key in table)) return Promise.reject(new Error(`No fixture for ${key}`));
    return Promise.resolve(structuredClone(table[key]));
  };
  const port = {
    calls,
    login: async () => structuredClone(login),
    gqlTrades: (leagueId) => serve(gql, `trades:${leagueId}`),
    gqlLeaguePlayers: (leagueId) => serve(gql, `leaguePlayers:${leagueId}`),
    playersDict: () => serve({}, 'playersDict'),
    projections: (season, week) => serve({}, `projections:${season}:${week}`),
  };
  for (const k of REST) port[k] = (...args) => serve(rest, sl.PATHS[k](...args));
  return port;
}
