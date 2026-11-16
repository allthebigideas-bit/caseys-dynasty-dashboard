# Issue tracker: GitHub (fork)

Issues and specs live on the fork, mntropy/caseys-dynasty-dashboard, not on origin (allthebigideas-bit, read-only for us). Pull requests still go to origin.

- Every `gh issue` command passes `-R mntropy/caseys-dynasty-dashboard`. In this clone `gh` defaults to origin.
- Run each `gh` command on its own, with the sandbox off. Pass any body that contains backticks with `--body-file`.
- A PR merged into origin may not close a fork issue through "Closes #n". After the merge, comment on the ticket with a link to the PR, then close it.

Below, `R` stands for `-R mntropy/caseys-dynasty-dashboard`, and `<owner>/<repo>` in `gh api` paths is `mntropy/caseys-dynasty-dashboard`.

## Conventions

- **Create an issue**: `gh issue create R --title "..." --body-file <file>`.
- **Read an issue**: `gh issue view <number> R --json number,title,body,labels,comments`.
- **List issues**: `gh issue list R --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create R --parent <parent> ...`, or `gh issue edit <parent> R --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh issue create R --blocked-by <n>,<n> ...` or `gh issue edit <child> R --add-blocked-by <blocker>` (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Count open blockers**: `gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by` (open blockers only; 0 means startable). `gh issue view <n> R --json blockedBy` also lists closed blockers, so filter it: `--jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`.
- **Comment on an issue**: `gh issue comment <number> R --body-file <file>`
- **Apply / remove labels**: `gh issue edit <number> R --add-label "..."` / `--remove-label "..."`
- **Close**: post the explanation with `gh issue comment <number> R --body-file <file>`, then `gh issue close <number> R`. On an already-closed issue, `gh issue close --comment` drops the comment and still exits 0.

File issues only into the fork. Before the first `gh issue create` of a session, check the target with `gh repo view mntropy/caseys-dynasty-dashboard --json nameWithOwner`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number>`, then `gh pr view <number> --comments` (off a TTY, `--comments` prints only the comments, not the body), and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`. PRs live on origin and issues on the fork, so name the repo whenever it's ambiguous.

## When a skill says "publish to the issue tracker"

Create a GitHub issue on the fork.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/chart`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create R --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: see **Blocking** under Conventions.
- **Frontier query**: list the map's open children (`gh issue list R --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (see **Count open blockers**, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> R --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> R --body-file <file>`, then `gh issue close <n> R`, then append a context pointer (gist + link) to the map's Decisions-so-far.
