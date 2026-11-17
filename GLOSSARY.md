# Casey's Dynasty Dashboard

A Chrome extension that builds a dynasty-league dashboard for one Sleeper team at a time, and acts in Sleeper (offers, alerts, overnight waiver claims) on behalf of whoever is logged in.

## Language

**Login**:
The Sleeper account signed in to sleeper.com in this Chrome.
_Avoid_: me, user, account (on its own)

**Viewed team**:
The team the dashboard is currently showing; any team in the league can be picked.
_Avoid_: my team, selected team

**Own team**:
The viewed team when it belongs to the login: the login is its owner or one of its co-owners. Offers, alerts and waiver claims exist only for the own team.
_Avoid_: mine, owned

**Logged out**:
The state of having no login in this Chrome. No team is the own team, so offers, alerts and waiver claims are unavailable.
_Avoid_: guest, anonymous

**Waiver plan**:
The own team's target players, drop spots and timing for overnight claims. One per league.
_Avoid_: claim list, setup

**Armed**:
Said of a waiver plan scheduled to run in the next waiver window.
_Avoid_: on, enabled, scheduled

**Run**:
One overnight attempt to make a waiver plan's claims, from the window opening until it succeeds or gives up.
_Avoid_: job, attempt (on its own)

**Viewing as**:
The state of showing a viewed team that isn't the own team.
_Avoid_: viewing other, impersonating
