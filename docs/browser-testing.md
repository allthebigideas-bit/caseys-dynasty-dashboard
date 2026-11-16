# Testing the extension in a browser

Drives the unpacked extension with `playwright-cli` in a throwaway Chromium profile. Nothing here touches anyone's real Chrome or Sleeper account.

## 1. Launch with the extension loaded

Write a config outside the repo (paths absolute):

```json
{ "browser": { "browserName": "chromium", "userDataDir": "<scratch>/pw-profile",
  "launchOptions": { "headless": true, "channel": "chromium",
    "args": ["--disable-extensions-except=<repo>", "--load-extension=<repo>"] } } }
```

`"channel": "chromium"` is required: without it Playwright uses the old headless mode, which loads no extensions.

```bash
playwright-cli -s=cdd open --config=<scratch>/pw.json
playwright-cli -s=cdd run-code "async page => { const c = page.context(); const sw = c.serviceWorkers()[0] || await c.waitForEvent('serviceworker'); return sw.url(); }"
```

The worker URL is `chrome-extension://<id>/background.js`; the dashboard is `chrome-extension://<id>/dossier/dossier.html`. The ID stays the same for a given repo path.

Under the Claude Code sandbox, `playwright-cli` needs write access to `~/Library/Caches/ms-playwright`.

## 2. Get past the password screen

On the dashboard page, then reload:

```js
chrome.storage.local.set({ 'gate:unlockedAt': Date.now() })
```

## 3. Load a league

There is no Sleeper login in the test profile. Give it a stand-in **login** (user ID only, no token, so it can read public data but never act in Sleeper):

```js
chrome.storage.local.set({ settings: { sleeper: { userId: '<id>', displayName: '<name>' } } })
```

Look up a user ID with `curl https://api.sleeper.app/v1/user/<username>`. The dashboard then syncs that login's **own team**.

A new login clears any team picked before it, so pick another team only after the sync: **Settings → Your team**, choose the team, **Load this team**. The top bar then shows "Viewing as".

## 4. Out of reach here

Anything that needs a real token: offers, overnight claims, the account swap between two logins. Those need a person logged in to sleeper.com.
