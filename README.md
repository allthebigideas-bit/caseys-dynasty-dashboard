# Casey's Dynasty Dashboard

A Chrome extension for our Sleeper dynasty league, built on Waiver Vulture. Every league member installs it in the Chrome where they use Sleeper. It then builds the dashboard for **their own team**: their offers, their trade targets, who wants their players, their start/sit and their waiver claims.

It covers:

- Who owns whom.
- Every trade, graded with KeepTradeCut, plus trade trees showing what traded picks turned into.
- Who's tanking and who's all-in.
- Who wants your players.
- Your own private notes on each manager.
- Players coming into their peak, and where your lineup is heading over the next three seasons.
- Weekly start/sit advice.
- Overnight waiver claims.
- Background alerts when an offer reaches you.

## Install (2 minutes)

1. Get the code: `git clone` this repo, or download it as a ZIP from GitHub (**Code → Download ZIP**) and unzip it.
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `caseys-dynasty-dashboard` folder.
5. Pin the extension and click its icon. Enter the league password from your invite.
6. Visit **sleeper.com** in the same Chrome while logged in. The dashboard picks up your login and loads your team. The first sync takes a minute or two.

**Updating:** `git pull` (or download the ZIP again over the same folder), then click the reload arrow on the extension in `chrome://extensions`. Your login, notes and settings carry over.

## Whose team it shows

- **Logged in to Sleeper in this Chrome:** your own team, automatically. Everything works, including offers, alerts and waiver claims.
- **Not logged in:** go to **Settings → Your team**, type your Sleeper username or the league ID, and choose your league and team. Everything works except offers, alerts and waiver claims, which need the login.
- **Looking at someone else's team:** pick any team under **Settings → Your team**. A "Viewing as" tag shows at the top, and offers, alerts and waiver claims stay off, since they act with your login. **Back to my own team** returns you.
- **Someone else logs in to Sleeper in this Chrome:** the dashboard switches to their team, and any waiver claims armed for the previous account are stopped.

Notes, plans and settings are stored in this Chrome only. Nothing is uploaded or shared with other league members.

## Password

The dashboard opens with a password screen. After the right password it stays unlocked in that Chrome for 30 days. **Settings → Lock dashboard** locks it again.

This is a soft lock to keep the dashboard private to the league. It is not real security: the code is in this repo, so anyone with the code can get around it.

## Splash background

The password screen uses `splash/background.jpg` and the league crest `splash/crest.png`. Replace either file to change the look. The toolbar icons in `icons/` are made from the crest.

If Settings says KeepTradeCut is unavailable, open keeptradecut.com once in this Chrome, then click **Sync now**. Until then the dossier grades with FantasyCalc values.

## Pages

The sidebar on the left has every page. The top bar has search (players and managers; Ctrl/Cmd+K), the alert history, offers waiting on you, and a **Waivers armed** switch.

- **Overview:** playoff odds, offers waiting, and weeks to the deadline. Also on this page:
  - The top item to act on.
  - Two players coming into their peak.
  - The intel list for the week. Tick an item off when you've handled it.
  - Your team card.
  - Your roster value split by career phase (rising, at peak, declining, picks).
  - Your lineup outlook for the next three seasons.
- **Managers:** one card per manager with posture, record, value, age, needs and your note. Each manager's page shows:
  - The evidence behind his posture.
  - "How to deal with him".
  - What he wants from you.
  - Your notes and tags.
  - Needs and surplus.
  - Trade block, other leagues and graded trades.
  - Roster with a three-season projection line per player.
- **Trades:**
  - **League trades:** every trade graded, with a value bar, each asset's value then and now, and a trade tree. Earlier seasons are one click away.
  - **My offers:** offers you sent and received.
  - **Trade lab:** a calculator for any two teams.
  - **Trade finder:** fair packages for each manager.
- **Demand:** for each of your valuable players, who is most likely to pay and why.
- **League compare:** this league side by side with any league-mate's other league: settings, players rostered by position, QB depth, and every player held in one league but not the other.
- **Positional ranks:** every team ranked at QB, RB, WR and TE, by dynasty value (starters plus the next man up) or by this season's points per game. Shows where each team's long-term and current ranks disagree, your strongest and weakest rooms, natural trade partners, and every rostered player ranked at each position.
- **Rising players:** players at or before their position's peak who already produce like starters. Each shows:
  - Points per game projected for this season and the next two.
  - Years of prime left.
  - A "per 1k" bargain score.

  Filters cover position, owner type and your needs. The page also charts your lineup against the league and lists your players to sell before they decline.
- **Start/Sit:** your best lineup from Sleeper projections (scored with your league's settings, including the TE bonus) and FantasyPros consensus. It also shows swaps, injury flags, and your opponent with a win chance.
- **Waivers:** the overnight claimer, now built in. On this page you can:
  - Choose drop spots and rank your targets.
  - Browse available players sorted by value, this week's projection, season points per game, FantasyPros rank, trending adds or the three-season projection.
  - Arm the claimer, run a dry run, or claim now.
  - Watch the activity log.

  "Waiver target" buttons on the Rising players page and in player panels add straight to your list.
- **Picks**, **Market** and **Settings** work as before.

## What changed in 2.22
- **Attribution math under every trade tree.** Two tables show exactly how the tree's values are worked out. *Later deals*: each deal (D1, D2, …) with the tree's players and picks and their value on that day, anything added from outside and its value, the tree's share (tree ÷ total sent), what came back at today's values, and how much is credited to the tree. *Residual value by asset*: every player or pick the tree ends in, the path of deals that led to it (with each deal's share), its value today × the combined share = the value attributable to the original trade, with a subtotal per side compared to the value at the trade (net gain or loss). The subtotals match the tree's totals.

## What changed in 2.21
- **The whole trade tree on one screen.** Both teams' sides are always drawn in one diagram; the canvas fills the screen height and Fit scales the entire tree to fit it (width and height). Layout Auto tries top-down and left-to-right and keeps whichever shows the whole tree largest. Full screen re-fits to the whole monitor.
- **Every player in every deal is drawn.** Players and picks a team added to a later deal from outside the tree now appear as faded "+ Added in this deal" boxes next to the tree's own, instead of only as text. (The PDF keeps the compact "with …" text.)

## What changed in 2.20
- **Team logos throughout the trade trees and reports.** Uses each manager's custom team logo for this league when they've uploaded one (otherwise their Sleeper avatar): in the tree's header, on every team node, in each later-deal bubble, the original-trade summary, the trade strip, the lists, and in the PDF reports (player headshots stay off in the PDF to keep it light).
- **New Most branching trades report:** the league's top 10 trade trees by number of branches (times an asset from the deal was flipped: traded on, or a pick spent, both sides counted), with generations, later deals, assets in the tree and what it's all worth today. It has its own PDF report in the same style.

## What changed in 2.19
- **Trade trees credit each branch with its fair share.** When a player from a tree was later traded together with other assets, the tree used to be credited with everything that came back. Now each later deal is split by value on the day of that deal (KTC for recent trades, DynastyProcess rankings from that week for older ones, converted to the KTC scale), and the branch is credited only with its share. Shares compound down the generations. The bubble shows "tree's share 62% → credited 4.8k" (hover for the values used). Tree totals, value gains and the lopsided ranking all use the credited values.

## What changed in 2.18.1
- **PDF report fixed for real leagues:** every page is a full landscape page with its own dark background (no white band at the bottom); the cover's top-10 table is one line per trade and always fits, with the page number of each trade's tree; trees too big for one page no longer shrink to unreadable — they continue on following pages ("continued", labelled part 1 of 2 and so on), split at branch boundaries so nothing is cut off.
- Fixed: the Most lopsided trades table (and the trade tree list) was squeezed into a small scroll box.

## What changed in 2.18
- **Better layouts for big trade trees.** New left-to-right layout: each generation is a column and flips stack down the page, so deep, branchy trees stay readable instead of sprawling sideways. Layout **Auto** (the default) draws top-down when the tree fits and switches to left-to-right when it doesn't; **Vertical** and **Horizontal** force one or the other.
- **Collapse branches and limit generations.** Every flip has a − button to collapse its branch (it shows +N when hidden), and the Generations menu shows 1, 2, 3, 4 or all generations so huge trees can be read a level at a time.
- The PDF report now picks, per trade, whichever of three layouts (side by side, stacked, left-to-right) fits its page largest.

## What changed in 2.17
- **Trade Tree redesigned** in a neon dashboard style: hero header, summary tiles (trades, managers, assets moved, net value change, most active manager; or, on a tree, generations, later deals, net change and who's winning it), a node legend, and a toolbar with filters (all/my trades, deep trees, involving picks; by manager; by asset type), a Tree/List view switch, Horizontal/Vertical layout, zoom and full screen. A strip of trade cards switches trees in one click; the tree sits on a glowing grid canvas.
- **Most lopsided trades** uses the same look, and the **PDF report** matches it: a dark neon cover page with the summary and top-10 table, then one page per trade with its stats, original deal and tree, each tree sized to fit its page (side by side or stacked, whichever fits larger).

## What changed in 2.16
- **Trade trees show the full deals.** The top of each tree lists the original trade in full (everything each side received, valued then and now), and every later-deal bubble lists anything else that went into that deal ("with Player X, 2028 3rd"), so you can see whether a flip was straight up.
- **Sort trade trees** by generations, later deals, biggest value gain (what the better side's haul is worth today minus at the trade), most lopsided, or newest.
- **New Most lopsided trades page:** the league's top 10 trades by how far apart the two sides' trees are today, with the value split at the trade vs today. **Download PDF report** builds a printable report (the top-10 table, then each trade's full deal and tree on its own landscape page); choose "Save as PDF" in the print window.

## What changed in 2.15.2
- Fixed: wide trade trees running off the left of the page. Trees now open zoomed to fit the screen; when a trade is too wide for that (big multi-player deals), the two sides are stacked one above the other instead of shrinking past readable. "Side by side" and "Stacked" buttons switch layout, and +/− zoom from there (the tree scrolls when zoomed in).

## What changed in 2.15.1
- Fixed: long player and team names showing as "…" in trade trees. Names now wrap.

## What changed in 2.15
- **Trade trees get their own page.** "See trade tree" on any completed trade opens a family-tree diagram: the deal at the top, each side's haul branching down, and every later flip dropping a generation into the deal it went into and what came back (a pick branches into the player drafted with it). Each node shows what it's worth today or what it became; each side shows value at the trade vs today, generations, later deals and players still rostered. Zoom in and out, or show one side. Each later deal links to its own tree.
- **New Trade trees page** (under Others): every completed trade ranked by how many generations its tree has grown, with each side's haul value today. Filter to your own trades.

## What changed in 2.14
- **Rookie draft page: Out with the old.** How many players won't be back next year, how many roster spots that opens against your limit (25 here), how many picks you have, and how many cuts you'll need in the week after the draft if you make every pick. Suggests who's likely gone (NFL free agents, older players whose value has faded, players worth less than your last pick, a second defense); mark anyone Gone or Back and your choices are saved.

## What changed in 2.13
- **Lock pick seasons Sleeper won't let you trade yet** (for example, 2028 picks until next year's dues are paid). Each season on the Picks page has a Tradeable/Locked switch. Locked picks stay out of the trade finder, trade lab, this-week finder and pick equivalents, and show as "locked" in your draft capital, where they still count. By default next year's picks are tradeable, and later seasons start locked unless Sleeper already shows a trade involving them.

## What changed in 2.12.1
- The sidebar shows when rosters and pick ownership were last refreshed (they refresh every few minutes, on the refresh button, and after any trade), separately from the last full sync.

## What changed in 2.12
- **Every deal with a manager, tabbed.** Each manager page now lists every deal between you and him under All, Completed, Waiting, Rejected, Withdrawn by him and Withdrawn by you. Each tab shows: how many deals and who started them, who rejected, your average value balance at the time and today, net value gained (completed tab), typical time open, and the players he keeps asking for.
- **Refresh button** in the top bar: reloads rosters, picks, offers and trade blocks from Sleeper in a few seconds. "Sync now" in the sidebar still reloads everything.
- The "Share view on" button is gone from the top bar. Share view is still switched on and off on the Trade summary page.

## What changed in 2.11.1
- **Fixed: traded players stuck on trade blocks.** Sleeper can leave the trade-block flag on a player or pick after it's traded. Blocks now only list what the team still owns, and the trade block refreshes every few minutes with rosters and picks.

## What changed in 2.11
- **New League compare page** (under Others). Pick any league-mate, then any of their other leagues (or one of yours), and compare it with this one: settings and scoring side by side, players rostered by position, QB depth (including how many NFL starters and backups are held), and the full list of players held in one league but not the other, filterable by position.
- **Fixed: picks on the wrong side of offers.** Old offers could show picks going the wrong way once those picks changed hands in a later trade. Pick direction now comes straight from Sleeper's offer data.

## What changed in 2.10
- **Trades show up within minutes.** The 5-minute background check now refreshes rosters, pick ownership, this week's transactions and offers whenever a trade or offer changes. An open dossier updates itself, and coming back to the tab pulls current rosters and picks. A full sync is no longer needed after a trade.
- **Rookie draft page: Your draft capital.** Every pick you own in every season, its projected slot and value, where it came from, your league rank in pick value, and the picks you've traded away.
- **New Positional ranks page** (see Pages).

## What changed in 2.2

- **Your offers** (top of the Manager summary page):
  - How many offers you've sent, and how many were accepted, rejected, withdrawn or still waiting.
  - Your acceptance rate and your average ask.
  - Acceptance by size of ask: fair, modest, big or lowball.
  - Your recent offers, valued then and now.
- **Rookie draft page:**
  - **How to win this draft:** advice built from the numbers below.
  - **Next year's draft order:** projected from the playoff simulation, with the owner of each pick, the prospect at that spot on your board, and how often that slot has produced a starter.
  - **Class strength:** how the market values next year's 1st against past classes at this same point in the season.
  - **Position depth:** past classes compared with next year's.
  - **Hit rates by slot and position:** worked out from DynastyProcess's history of rookie values.
  - **Who drafts well in this league,** and every past rookie draft with what each pick became.
  - **Prospect board:** FantasyPros dynasty rookie rankings when they cover next year's class. Otherwise, paste any ranking list. You can star your guys.

## What changed in 2.24.0

- New look to match the league crest: royal purple and trophy gold, with the crest in the sidebar and gold buttons.
- **Dark and light modes.** The half-moon button in the top bar switches between Auto (follows your computer), Dark and Light.
- League art on the welcome screen, the Overview banner and each manager's page. Teams on the way up get the celebrating players; teams on the way down get the slumped ones.
- Phones and other tall screens get their own portrait background on the login screen.
- **Trade finder leans young.** Players past their position's peak (RB 24, WR 25, TE 26, QB 27) count for less and drop off fast after RB 28, WR/TE 30, QB 33. Players younger than their peak get a small boost, and selling your own older players costs you less. Choose **Ignore age**, **Favour youth** (the default) or **Strongly favour youth** in the finder. Contenders get a softer version so they can still buy proven starters.

## What changed in 2.23.0 (team version)

- Each league member sees their own team: the dashboard follows whoever is logged in to Sleeper in that Chrome.
- New **Your team** picker (Settings, and the welcome screen) to choose a league and team by username or league ID, with or without a login.
- Viewing a team that isn't your login turns off offers, alerts and waiver claims, and shows a "Viewing as" tag.
- A new Sleeper login in the same Chrome switches the dashboard over and stops waiver runs armed for the previous account.
- Password splash screen, remembered for 30 days per browser.
- Renamed to Casey's Dynasty Dashboard. It has its own extension ID, so it can sit beside a personal Waiver Vulture install.

## What changed in 2.1.1

- **Overview is about your team only.** It shows:
  - Your schedule to the playoffs: each opponent's record, last five results, scoring form, starters on bye on both sides, and your win chance.
  - A "This week" card: win chance, lineup changes, and your starters on bye or hurt.
  - Your core players going forward.
  - Other teams' players appear only as a count in a small "Trade targets" link to Rising players.
- **Playoff odds are more conservative.** Early-season scoring is pulled harder toward the league average and weekly swings are wider. The top 6 of 12 make it, and the odds across all teams add up to 6.
- **Career-phase split for every manager:** a donut on each manager's page and a bar on each manager card, with league ranks for share rising and share declining.
- **"Dealing with you" on each manager's page:**
  - A rating: easy to deal with, workable or difficult.
  - Counts of offers sent, accepted and rejected each way, and his average ask.
  - Insights, such as whether he turns down fair deals, opens with lowballs, or comes to you.
  - Every rejected or withdrawn offer, labelled with who rejected it, how it graded then and how it looks with today's values.

## What changed in 2.1

- **Grades:** a new scale based on each side's share of the combined value.
  - Within ±5% is a fair **B**.
  - **A+** and **F** are only for blowouts, where one side gets more than about twice as much.
  - The deal grade uses values from the week of the trade, via DynastyProcess's weekly history back to 2019. A second "now" grade shows hindsight.
- **Trade trees:** each trade follows what every player and pick became. That includes picks used in the draft, later trades, releases, and what the whole haul is worth today.
- **Notes:** add notes and tags to any manager, such as "Don't build deals", "Negotiates in public" or "Hard to deal with".
  - **Don't build deals** removes him from the trade finder and discounts his interest in your players.
- **Aging projections:** production is projected from each position's typical age curve, scaled by the player's level.
  - RBs peak at 24-25, WRs at 26-27, TEs at 27-28 and QBs at 28-31.
  - Elite players hold their peak longer.
  - Each projection blends this season, last season and Sleeper's projection, scored with your league's settings.

## Alerts

While Chrome is open, the extension checks every 5 minutes and sends a Chrome notification for:

- A new offer to you, with its grade.
- A new trade anywhere in the league, graded.
- New trade-block listings.

The clock icon in the top bar shows recent alerts.

## Where the data comes from

- **Sleeper public API:** rosters, results, trades, picks, drafts, projections, season stats, trending adds, and league-mates' other leagues.
- **Sleeper's private API, using your login:** offers involving you, the league trade block, and waiver adds. This API is unofficial and could change.
- **KeepTradeCut:** primary values. 1QB, with TE+ values because your league has a 0.5 TE premium.
- **FantasyCalc:** second opinion, this-season values and 30-day trends.
- **DynastyProcess:** the player ID crosswalk, and the weekly value history used to grade trades as of the week they happened.
- **FantasyPros weekly rankings:** start/sit ranks and grades, read directly or from the DynastyProcess mirror.

## Limits to know

- **Other managers' failed offers are hidden.** Sleeper shows a rejected or cancelled offer only to the two teams involved, so "who wants whom" combines several signals, and every read shows its reasons.
- **Posture and projections are models.** Aging curves describe typical careers. Injuries, depth charts and coaching changes can beat them.
- **Values at the time:** these come from DynastyProcess's weekly snapshots, which can differ a little from KeepTradeCut on that day. Trades the extension sees within a few days use KeepTradeCut directly.
- **Waiver claims need Chrome open and the computer awake** on waiver night.
