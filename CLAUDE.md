Chrome MV3 extension (no build step): a dynasty-league dashboard for one Sleeper team.

- Terms (login, viewed team, own team): `GLOSSARY.md`. Offers, alerts and waiver claims go through `ownsTeam()` in `lib/util.js`.
- `dossier/dossier.js` is ~3.8k lines with very long lines: grep for the view or action (`viewWaivers`, `actions.arm`) and read around it.
- Checks: `npm test`, plus what `.github/workflows/test.yml` runs.

<important if="you are checking a change in a browser">
Follow `docs/browser-testing.md`.
</important>
