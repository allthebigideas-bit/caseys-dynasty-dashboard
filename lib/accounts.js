// Notes, alert history and waiver plans belong to one Sleeper account. Everyone
// in the league shares the same league ID, so these keys can't tell two members
// on one computer apart: on a switch, park the old account's copies under
// `account:<id>` and bring back the new account's (or start it empty).

export const PER_ACCOUNT = ['notes', 'briefDone', 'alerts:feed', 'alerts:seen', 'plans', 'blockExtra', 'draft:stars', 'draft:board'];

export async function swapAccount(fromId, toId, storage = chrome.storage.local) {
  if (!toId || String(fromId) === String(toId)) return;
  const mine = await storage.get(PER_ACCOUNT);
  const parked = (await storage.get(`account:${toId}`))[`account:${toId}`] || {};
  if (fromId) await storage.set({ [`account:${fromId}`]: mine });
  const back = PER_ACCOUNT.filter((k) => parked[k] !== undefined);
  await storage.remove([...PER_ACCOUNT.filter((k) => parked[k] === undefined), `account:${toId}`]);
  if (back.length) await storage.set(Object.fromEntries(back.map((k) => [k, parked[k]])));
}
