// The overnight engine. Runs once a minute (chrome.alarms) while any league
// is armed:
//   waiting  → before the league's "start checking" time
//   watching → polling for proof that waivers have processed
//   claiming → adding the highest-ranked available targets into your spots
//   done     → all spots filled, list exhausted, or the window closed

import { store, log, notify, classifyError, nextWindowStart, fmtTime, APP_NAME } from './util.js';
import * as sleeper from './sleeper.js';

export const DEFAULT_PLAN = {
  enabled: true,
  drops: [],          // player ids in drop order; "OPEN" = an open roster slot
  targets: [],        // [{name,pos,team,id,src}] in priority order
  startCheck: '00:55',
  fallbackMin: 45,
  retryMin: 10,
  giveUpHours: 4,
  run: null,
  lastRun: null,
};

// ---- platform adapters ------------------------------------------------------

const adapters = {
  sleeper: {
    async snapshot(league) {
      const r = await sleeper.processedWaiverIds(league.leagueId);
      return { ids: r.ids, via: r.via };
    },
    async detect(league, plan, run) {
      const r = await sleeper.processedWaiverIds(league.leagueId);
      const seen = new Set(run.snapshot.ids || []);
      const fresh = r.ids.filter((id) => !seen.has(id));
      if (fresh.length) return { processed: true, reason: `${fresh.length} waiver claim(s) just processed in the league` };
      return { processed: false, note: `No processed claims yet (checked via ${r.via})` };
    },
    async myRoster(league) {
      const rosters = await sleeper.rosters(league.leagueId);
      const mine = rosters.find((r) => r.roster_id === league.rosterId);
      return { mine: (mine && mine.players) || [], all: rosters };
    },
    async availability(league, ids, ctx) {
      const taken = new Set();
      for (const r of ctx.all) for (const p of r.players || []) taken.add(String(p));
      const out = {};
      for (const id of ids) out[id] = taken.has(String(id)) ? 'taken' : 'free';
      return out;
    },
    async add(league, addId, dropId) {
      const t = await sleeper.addDrop(league.leagueId, league.rosterId, addId, dropId);
      return t.transaction_id;
    },
  },
};

// ---- storage helpers ----------------------------------------------------------

async function loadCtx(uid) {
  const [plans, leagues] = await Promise.all([store.get('plans', {}), store.get('leagues', {})]);
  const plan = { ...DEFAULT_PLAN, ...(plans[uid] || {}) };
  const league = leagues[uid];
  if (!league) throw new Error('League not loaded — click "Load my leagues" first.');
  return { plan, league, adapter: adapters[league.platform] };
}

async function saveRun(uid, run, { finished = false } = {}) {
  await store.update('plans', (plans) => {
    const p = { ...DEFAULT_PLAN, ...(plans[uid] || {}) };
    if (finished) {
      p.lastRun = run;
      p.run = null;
    } else {
      p.run = run;
    }
    plans[uid] = p;
    return plans;
  }, {});
}

async function patchPlan(uid, patch) {
  await store.update('plans', (plans) => {
    plans[uid] = { ...DEFAULT_PLAN, ...(plans[uid] || {}), ...patch };
    return plans;
  }, {});
}

// ---- arming -------------------------------------------------------------------

export async function resolveTargets(uid) {
  const { plan } = await loadCtx(uid);
  return plan.targets;
}

export async function arm(uid, { now = false } = {}) {
  await resolveTargets(uid);
  const { plan, league, adapter } = await loadCtx(uid);
  const targets = plan.targets.filter((t) => t.id);
  if (!targets.length) throw new Error('Add at least one target player (that matched in this league).');
  if (!plan.drops.length) throw new Error('Pick at least one drop spot (a player to drop, or "open roster slot").');

  const warnings = [];
  const unmatched = plan.targets.filter((t) => !t.id).map((t) => t.name);
  if (unmatched.length) warnings.push(`Couldn't match in this league, will skip: ${unmatched.join(', ')}`);
  if (league.continuousWaivers) warnings.push('This league looks like it uses continuous waivers — there may be no free-agent window to grab.');

  const windowStart = now ? Date.now() : nextWindowStart(plan.startCheck, plan.giveUpHours);
  if (league.platform === 'sleeper') {
    const auth = await sleeper.getAuth();
    if (!auth.token) throw new Error('No Sleeper login captured. Open sleeper.com (logged in), then try again.');
    if (league.ownerUserId && String(league.ownerUserId) !== String(auth.userId)) throw new Error(`This team belongs to a different Sleeper account than the one logged in to this browser (${auth.displayName || auth.userId}). Waiver claims only work for your own team.`);
    const needUntil = windowStart + plan.giveUpHours * 3600e3;
    if (auth.exp && auth.exp < needUntil) warnings.push(`Your Sleeper login expires ${fmtTime(auth.exp)} — before the run ends. Log out and back in on sleeper.com to refresh it.`);
  }

  let snapshot = {};
  try {
    snapshot = await adapter.snapshot(league, plan);
  } catch (e) {
    if (e.kind === 'auth') throw e;
    warnings.push(`Couldn't take the starting snapshot (${e.message}); will rely on the fallback timer.`);
  }

  const run = {
    armedAt: Date.now(),
    windowStart,
    phase: now ? 'claiming' : 'waiting',
    mode: now ? 'manual' : null,
    snapshot,
    names: Object.fromEntries(plan.targets.filter((t) => t.id).map((t) => [t.id, t.name])),
    detectedAt: now ? Date.now() : null,
    claimed: [],
    skipped: {},
    attempts: {},
    usedSpots: [],
    deadSpots: [],
    lastTick: null,
    lastMsg: now ? 'Claiming now' : `Armed — checking from ${fmtTime(windowStart)}`,
    errors: 0,
  };
  await saveRun(uid, run);
  await log('info', league.name, now ? 'Manual claim run started.' : `Armed. Will start checking ${fmtTime(windowStart)}.`);
  for (const w of warnings) await log('warn', league.name, w);
  await ensureAlarm();
  await updateKeepAwake();
  if (now) tick();
  return { run, warnings };
}

export async function disarm(uid) {
  const plans = await store.get('plans', {});
  const p = plans[uid];
  if (!p || !p.run) return;
  const leagues = await store.get('leagues', {});
  p.run.phase = 'done';
  p.run.lastMsg = 'Disarmed by you';
  p.run.finishedAt = Date.now();
  await saveRun(uid, p.run, { finished: true });
  await log('info', leagues[uid] && leagues[uid].name, 'Disarmed.');
  await updateKeepAwake();
}

// ---- the minute tick ------------------------------------------------------------

let ticking = false;

export async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const plans = await store.get('plans', {});
    const armed = Object.keys(plans).filter((uid) => plans[uid].run);
    await updateKeepAwake(armed.length > 0);
    for (const uid of armed) {
      try {
        await stepLeague(uid);
      } catch (e) {
        console.error('step failed', uid, e);
      }
    }
  } finally {
    ticking = false;
  }
}

async function stepLeague(uid) {
  const { plan, league, adapter } = await loadCtx(uid);
  const run = plan.run;
  const now = Date.now();
  run.lastTick = now;

  if (now < run.windowStart) {
    run.phase = 'waiting';
    run.lastMsg = `Waiting — checking starts ${fmtTime(run.windowStart)}`;
    return saveRun(uid, run);
  }
  if (now > run.windowStart + plan.giveUpHours * 3600e3) {
    return finish(uid, league, run, 'Window closed before all spots were filled.');
  }

  try {
    if (run.phase === 'waiting') {
      run.phase = 'watching';
      await log('info', league.name, 'Watching for waivers to clear.');
    }
    if (run.phase === 'watching') {
      const det = await adapter.detect(league, plan, run);
      if (det.processed) {
        run.phase = 'claiming';
        run.mode = 'detected';
        run.detectedAt = now;
        await log('info', league.name, `Waivers have run: ${det.reason}.`);
      } else if (now >= run.windowStart + plan.fallbackMin * 60e3) {
        run.phase = 'claiming';
        run.mode = 'fallback';
        run.detectedAt = now;
        await log('warn', league.name, `No waiver signal after ${plan.fallbackMin} min — trying adds anyway.`);
      } else {
        run.lastMsg = det.note || 'Waiting for waivers';
        run.errors = 0;
        return saveRun(uid, run);
      }
    }
    if (run.phase === 'claiming') {
      const result = await claimStep(league, plan, run, adapter, { dryRun: false });
      run.errors = 0;
      if (result.finished) return finish(uid, league, run, result.reason);
    }
    return saveRun(uid, run);
  } catch (e) {
    run.errors = (run.errors || 0) + 1;
    run.lastMsg = `Error: ${e.message}`;
    await log('error', league.name, e.message);
    if ((e.kind === 'auth' && run.errors % 15 === 1) || run.errors === 3) {
      notify(`${APP_NAME} — ${league.name}`, e.kind === 'auth' ? `Login problem: ${e.message}` : `Repeated errors: ${e.message}`);
    }
    return saveRun(uid, run);
  }
}

async function finish(uid, league, run, reason) {
  run.phase = 'done';
  run.finishedAt = Date.now();
  run.lastMsg = reason;
  const got = run.claimed.map((c) => c.name).join(', ') || 'nobody';
  await log('info', league.name, `Done. ${reason} Added: ${got}.`);
  notify(`${APP_NAME} — ${league.name}`, `Done. Added: ${got}.`);
  await saveRun(uid, run, { finished: true });
  await updateKeepAwake();
}

// One pass over the target list. With dryRun, nothing is sent; the planned
// moves are returned instead.
async function claimStep(league, plan, run, adapter, { dryRun }) {
  const actions = [];
  const roster = await adapter.myRoster(league);
  const mine = new Set(roster.mine.map(String));

  // Which spots can still be used, in order.
  const spots = [];
  for (let i = 0; i < plan.drops.length; i++) {
    const d = plan.drops[i];
    if (run.usedSpots.includes(i) || run.deadSpots.includes(i)) continue;
    if (d !== 'OPEN' && !mine.has(String(d))) {
      if (dryRun) actions.push(`Skip drop spot ${dropName(league, d)} — no longer on your roster`);
      else {
        run.deadSpots.push(i);
        await log('warn', league.name, `Drop candidate ${dropName(league, d)} is no longer on your roster — that spot is skipped.`);
      }
      continue;
    }
    spots.push(i);
  }

  const remaining = plan.targets.filter((t) => t.id && !run.skipped[t.id] && !run.claimed.some((c) => c.id === t.id));
  if (!spots.length) return { finished: true, reason: 'All spots used.', actions };
  if (!remaining.length) return { finished: true, reason: 'No targets left on the list.', actions };

  const avail = await adapter.availability(league, remaining.map((t) => t.id), roster);
  const free = [...spots];

  for (const t of remaining) {
    if (!free.length) break;
    const a = avail[t.id];
    if (mine.has(String(t.id))) {
      if (dryRun) actions.push(`Skip ${t.name} — already on your roster`);
      else run.skipped[t.id] = 'already on your roster';
      continue;
    }
    if (a === 'taken') {
      if (dryRun) actions.push(`Skip ${t.name} — rostered by another team`);
      else { run.skipped[t.id] = 'rostered by another team'; await log('info', league.name, `${t.name} is gone — rostered by another team.`); }
      continue;
    }
    if (a === 'waivers') {
      const waited = noteAttempt(run, t, 'still on waivers', dryRun);
      if (waited > plan.retryMin * 60e3) {
        if (!dryRun) { run.skipped[t.id] = 'still on waivers (individual hold)'; await log('info', league.name, `${t.name} is still on waivers — moving on.`); }
        continue;
      }
      if (dryRun) actions.push(`Hold a spot for ${t.name} — still on waivers`);
      free.shift(); // hold this spot for him for now
      continue;
    }

    const spotIdx = free[0];
    const drop = plan.drops[spotIdx] === 'OPEN' ? null : plan.drops[spotIdx];
    const label = `${t.name}${drop ? ` (dropping ${dropName(league, drop)})` : ' (into an open spot)'}`;
    if (dryRun) {
      actions.push(`Add ${label}`);
      free.shift();
      continue;
    }

    try {
      const ref = await adapter.add(league, t.id, drop);
      run.claimed.push({ id: t.id, name: t.name, drop, dropName: drop ? dropName(league, drop) : null, at: Date.now(), ref });
      run.usedSpots.push(spotIdx);
      free.shift();
      await log('success', league.name, `Added ${label}.`);
      notify(`${APP_NAME} — ${league.name}`, `Added ${label}`);
    } catch (e) {
      let kind = e.kind || classifyError(e.message, e.status);
      // Sleeper can't tell us waiver status up front; an "unavailable" error
      // on a player no one has rostered most likely means "still on waivers".
      if (kind === 'taken' && a === 'free' && league.platform === 'sleeper') kind = 'waiver';
      await log(kind === 'auth' ? 'error' : 'warn', league.name, `Add ${t.name} failed (${kind}): ${e.message}`);
      if (kind === 'auth') {
        e.kind = 'auth';
        throw e;
      }
      if (kind === 'pending') {
        run.skipped[t.id] = 'became a pending waiver claim — check the app';
        notify(`${APP_NAME} — ${league.name}`, e.message);
        continue;
      }
      if (kind === 'taken') {
        run.skipped[t.id] = e.message;
        continue;
      }
      if (kind === 'rosterfull' && !drop) {
        run.deadSpots.push(spotIdx);
        free.shift();
        await log('warn', league.name, 'An "open roster slot" spot is not actually open — skipping it.');
        continue;
      }
      // waiver / other: retry this player on the next tick, up to retryMin.
      const waited = noteAttempt(run, t, e.message, false);
      if (waited > plan.retryMin * 60e3) {
        run.skipped[t.id] = e.message;
        await log('info', league.name, `Giving up on ${t.name} after ${plan.retryMin} min.`);
        continue;
      }
      free.shift(); // keep the spot for him until the retry window passes
    }
  }

  const spotsLeft = plan.drops.filter((_, i) => !run.usedSpots.includes(i) && !run.deadSpots.includes(i)).length;
  const targetsLeft = plan.targets.filter((t) => t.id && !run.skipped[t.id] && !run.claimed.some((c) => c.id === t.id)).length;
  run.lastMsg = `Claimed ${run.claimed.length}; ${spotsLeft} spot(s) and ${targetsLeft} target(s) left`;
  if (!dryRun) {
    if (!spotsLeft) return { finished: true, reason: 'All spots filled.', actions };
    if (!targetsLeft) return { finished: true, reason: 'Ran out of targets.', actions };
  }
  return { finished: false, actions };
}

function noteAttempt(run, t, msg, dryRun) {
  const now = Date.now();
  const a = run.attempts[t.id] || { first: now, n: 0 };
  if (!dryRun) {
    a.n += 1;
    a.last = msg;
    run.attempts[t.id] = a;
  }
  return now - a.first;
}

function dropName(league, id) {
  const p = (league.rosterPlayers || []).find((x) => String(x.id) === String(id));
  return p ? p.name : String(id);
}

// "What would happen if waivers had just cleared?" — no adds are sent.
export async function dryRun(uid) {
  await resolveTargets(uid);
  const { plan, league, adapter } = await loadCtx(uid);
  const run = { claimed: [], skipped: {}, attempts: {}, usedSpots: [], deadSpots: [] };
  const r = await claimStep(league, plan, run, adapter, { dryRun: true });
  const unmatched = plan.targets.filter((t) => !t.id).map((t) => `Can't find ${t.name} in this league`);
  return [...r.actions, ...unmatched];
}

// ---- background plumbing ---------------------------------------------------------

export async function ensureAlarm() {
  const a = await chrome.alarms.get('wv-tick');
  if (!a) await chrome.alarms.create('wv-tick', { periodInMinutes: 1 });
}

// Keeps the computer from going to sleep while any league is armed.
export async function updateKeepAwake(force) {
  let any = force;
  if (any === undefined) {
    const plans = await store.get('plans', {});
    any = Object.values(plans).some((p) => p.run);
  }
  try {
    if (any) chrome.power.requestKeepAwake('system');
    else chrome.power.releaseKeepAwake();
  } catch (e) {
    console.warn('power API', e);
  }
}
