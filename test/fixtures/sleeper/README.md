# Sleeper fixtures

Recorded from the test league, Casey's Dynasty League (`1313340828264960001`), and served to tests by `fixtureSleeper` in `lib/sleeper-port.js`.

- `rest.json`: REST responses keyed by path (`PATHS` in `lib/sleeper.js`). Re-record with `node scripts/record-fixtures.js`; it needs no login. Under the Claude Code sandbox, prefix it with `NODE_USE_ENV_PROXY=1` so Node's fetch goes through the sandbox's proxy.
- `league.json`: the IDs the recording used (the login, the rival picked for "viewing as").
- `gql.json`: offers (`trades:<leagueId>`) and the trade block (`leaguePlayers:<leagueId>`). They need a login, so no script records them.

## Capturing gql.json by hand

`gql.json` is a stand-in until someone captures it: two of the league's completed trades rewritten in the GraphQL shape, and two made-up trade-block entries. To capture the real thing, open the dashboard while logged in to sleeper.com, open DevTools on it, and run:

```js
const sl = await import('/lib/sleeper.js');
const id = '1313340828264960001';
const trades = (await sl.gqlTrades(id)).slice(0, 6);
const lp = (await sl.gqlLeaguePlayers(id)).filter((p) => p.settings && p.settings.otb).slice(0, 4);
copy(JSON.stringify({ [`trades:${id}`]: trades, [`leaguePlayers:${id}`]: lp }, null, 1));
```

Paste the clipboard into `gql.json`. Keep pending offers only if their owners don't mind them in the repo. The snippet copies responses only, never the login token.
