// Service worker: message router, alarms, network rules,
// and the dossier's background watcher.

import { store, log, normName, bestMatch } from './lib/util.js';
import * as sleeper from './lib/sleeper.js';
import * as engine from './lib/engine.js';
import * as alerts from './lib/alerts.js';

const DOSSIER = 'dossier/dossier.html';
const WAIVERS = 'dossier/dossier.html#waivers';

// Sleeper's GraphQL endpoint expects requests to come from sleeper.com.
// This rule only touches requests this extension itself sends there.
async function installRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'origin', operation: 'set', value: 'https://sleeper.com' },
          { header: 'referer', operation: 'set', value: 'https://sleeper.com/' },
        ],
      },
      condition: {
        urlFilter: '|https://sleeper.com/graphql',
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ['xmlhttprequest', 'other'],
      },
    }],
  });
}

async function ensureWatch() {
  const a = await chrome.alarms.get('dossier-watch');
  if (!a) await chrome.alarms.create('dossier-watch', { periodInMinutes: 5, delayInMinutes: 1 });
}

// Sleeper tabs that were already open when the extension was installed or
// updated don't get the login-capture script until they reload, so add it now.
async function injectIntoOpenSleeperTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://sleeper.com/*' }).catch(() => []);
  for (const t of tabs) {
    await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content/sleeper.js'] }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await sleeper.getAuth(); // repairs a login saved with a rounded user ID
  await installRules();
  injectIntoOpenSleeperTabs();
  await engine.ensureAlarm();
  await ensureWatch();
});

chrome.runtime.onStartup.addListener(async () => {
  await engine.ensureAlarm();
  await ensureWatch();
  engine.tick();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'wv-tick') engine.tick();
  if (a.name === 'dossier-watch') alerts.check().catch((e) => console.warn('[CDD] watch', e));
});

async function openPage(path) {
  const url = chrome.runtime.getURL(path);
  const base = chrome.runtime.getURL(DOSSIER);
  const tabs = await chrome.tabs.query({ url: base + '*' }).catch(() => []);
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, path === DOSSIER ? { active: true } : { active: true, url });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

chrome.action.onClicked.addListener(() => openPage(DOSSIER));
chrome.notifications.onClicked.addListener((id) => {
  openPage(DOSSIER);
  chrome.notifications.clear(id);
});

// Notes, alert history and waiver plans belong to one Sleeper account. Everyone
// in the league shares the same league ID, so these keys can't tell two members
// on one computer apart: on a switch, park the old account's copies under
// `account:<id>` and bring back the new account's (or start it empty).
const PER_ACCOUNT = ['notes', 'briefDone', 'alerts:feed', 'alerts:seen', 'plans', 'blockExtra', 'draft:stars', 'draft:board'];

async function swapAccount(fromId, toId) {
  const mine = await chrome.storage.local.get(PER_ACCOUNT);
  const theirs = (await store.get(`account:${toId}`, null)) || {};
  await chrome.storage.local.set({ [`account:${fromId}`]: mine });
  const back = PER_ACCOUNT.filter((k) => theirs[k] !== undefined);
  await chrome.storage.local.remove([...PER_ACCOUNT.filter((k) => theirs[k] === undefined), `account:${toId}`]);
  if (back.length) await chrome.storage.local.set(Object.fromEntries(back.map((k) => [k, theirs[k]])));
}

// ---- handlers -------------------------------------------------------------------

const handlers = {
  async sleeperToken({ token }) {
    const cur = await sleeper.getAuth();
    if (cur.token === token) return { ok: true, unchanged: true };
    const r = await sleeper.saveToken(token);
    if (!r.ok) return r;
    await log('info', 'Sleeper', `Login captured for ${r.sleeper.displayName || r.sleeper.userId}.`);
    // A different person logged in to sleeper.com in this browser: stand down any
    // waiver runs armed for the previous account's team. The dossier notices the
    // new login itself and switches to the new owner's team.
    if (cur.userId && String(cur.userId) !== String(r.sleeper.userId)) {
      const leagues = await store.get('leagues', {});
      for (const uid of Object.keys(leagues)) {
        if (String(leagues[uid].ownerUserId || cur.userId) !== String(r.sleeper.userId)) {
          await engine.disarm(uid).catch(() => {});
          delete leagues[uid];
        }
      }
      await store.set('leagues', leagues);
      await swapAccount(cur.userId, r.sleeper.userId);
      await log('info', 'Sleeper', `Switched accounts (was ${cur.displayName || cur.userId}). Waiver runs for the previous account were stopped.`);
    }
    return r;
  },

  async fpImport({ source }) {
    if (!source || !Array.isArray(source.players) || !source.players.length) return { ok: false, error: 'No players found on this page.' };
    await store.update('rankings', (r) => {
      r[source.key] = { ...source, importedAt: Date.now() };
      return r;
    }, {});
    await log('info', 'FantasyPros', `Imported ${source.players.length} players from ${source.label}.`);
    return { ok: true, count: source.players.length };
  },

  async loadLeagues({ sleeperUsername }) {
    const errors = [];
    const found = {};
    const sAuth = await sleeper.getAuth();
    if (sAuth.userId || sleeperUsername) {
      try {
        const dict = await sleeper.playersDict();
        for (const lg of await sleeper.myLeagues(sleeperUsername)) {
          lg.rosterPlayers = lg.rosterPlayers.map((id) => {
            const d = dict[id];
            return d ? { id, name: d[0], pos: d[1], team: d[2] } : { id, name: id, pos: '', team: '' };
          });
          found[lg.uid] = lg;
        }
      } catch (e) {
        errors.push(`Sleeper: ${e.message}`);
      }
    }
    if (!errors.length) await store.set('leagues', found);
    if (sleeperUsername) {
      const s = await store.get('settings', {});
      s.sleeperUsername = sleeperUsername;
      await store.set('settings', s);
    }
    return { ok: true, count: Object.keys(found).length, errors };
  },

  async leagueRostered({ uid }) {
    const leagues = await store.get('leagues', {});
    const lg = leagues[uid];
    if (!lg) throw new Error('Unknown league');
    const dict = await sleeper.playersDict();
    const rosters = await sleeper.rosters(lg.leagueId);
    const out = [];
    for (const r of rosters) for (const id of r.players || []) {
      const d = dict[id];
      if (d) out.push({ id, name: d[0], pos: d[1], team: d[2] });
    }
    return { players: out };
  },

  async resolveTarget({ target }) {
    const list = sleeper.dictToList(await sleeper.playersDict());
    return { match: bestMatch(target, list) || null };
  },

  async searchPlayers({ q }) {
    const n = normName(q);
    const list = sleeper.dictToList(await sleeper.playersDict()).filter((p) => normName(p.name).includes(n));
    list.sort((a, b) => (normName(a.name).startsWith(n) ? 0 : 1) - (normName(b.name).startsWith(n) ? 0 : 1));
    return { players: list.slice(0, 15) };
  },

  async sleeperTest({ leagueId }) {
    return sleeper.testConnection(leagueId);
  },

  async arm({ uid, now }) {
    return engine.arm(uid, { now: !!now });
  },

  async disarm({ uid }) {
    await engine.disarm(uid);
    return { ok: true };
  },

  async dryRun({ uid }) {
    return { actions: await engine.dryRun(uid) };
  },

  async clearLog() {
    await store.set('log', []);
    return { ok: true };
  },

  async watchNow() {
    return { result: await alerts.check() };
  },

  async open({ page }) {
    await openPage(page === 'waivers' ? WAIVERS : DOSSIER);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fn = handlers[msg && msg.type];
  if (!fn) return false;
  Promise.resolve()
    .then(() => fn(msg))
    .then((r) => sendResponse({ ok: true, ...r }))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});
