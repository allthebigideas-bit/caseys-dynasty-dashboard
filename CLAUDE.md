Chrome MV3 extension (no build step): a dynasty-league dashboard for one Sleeper team.

- Terms (login, viewed team, own team): `GLOSSARY.md`. Offers, alerts, waiver claims and Refresh ask the own-team gate, `ownTeam()` in `lib/ownteam.js`.
- `dossier/dossier.js` is ~3.8k lines with very long lines: grep for the view or action (`viewWaivers`, `actions.arm`) and read around it.
- Sync (`createSync` in `lib/sync.js`) is given the Sleeper port (`lib/sleeper-port.js`) and storage (`lib/store.js`); tests pass the fixture adapter and `memoryStore()`. Fixtures: `test/fixtures/sleeper/README.md`.
- Checks: `npm test`, plus what `.github/workflows/test.yml` runs.

<important if="you are checking a change in a browser">
Follow `docs/browser-testing.md`.
</important>

## Agent skills

### Issue tracker

GitHub Issues on `allthebigideas-bit/caseys-dynasty-dashboard`, alongside the PRs. See `docs/agents/issue-tracker.md`.

### Triage labels

The six default roles, each label named after its role (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, `parked`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
