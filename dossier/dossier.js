import { gate, lock } from '../splash/gate.js';
import { downloadPoster, drawMockDraft, downloadCanvas, drawLedger } from './poster.js';
import { createSync, NEED_TEAM } from '../lib/sync.js';
import { networkSleeper } from '../lib/sleeper-port.js';
import { buildModel, roundName, ordinal, dateStr, fmtK, dur } from '../lib/intel.js';
import { ktcVerdict, fcAdjustment, letterGrade, gainPct } from '../lib/ktcmath.js';
import { playerValue, withKtcSource, KTC_SOURCES } from '../lib/values.js';
import { scoreLine, starterSlots, bestLineup } from '../lib/startsit.js';
import { DEFAULT_PLAN } from '../lib/engine.js';
import { fcTrades } from '../lib/fctrades.js';
import { repairBoard } from '../lib/draft.js';
import { mockDraft } from '../lib/mock.js';
import { normName, store, nextWindowStart, sleeperWaiverDay } from '../lib/util.js';
import { ownTeam } from '../lib/ownteam.js';
import { quickRefresh } from '../lib/alerts.js';
import { gqlTrades, gqlLeaguePlayers } from '../lib/sleeper.js';
import { fetchLeague, compareLeagues } from '../lib/compare.js';

const sync = createSync({ sleeper: networkSleeper, store });

// ---- state ----------------------------------------------------------------------------

const S = {
  raw: null, book: null, aux: { fpBySid: {}, proj: {}, sidToFp: {} }, dict: {}, snaps: {}, hist: null, prod: null, vhist: {},
  cfg: {}, feed: [], lastCheck: null, auth: null, notes: {}, briefDone: {}, plans: {}, wleagues: {}, log: [],
  model: null, syncing: null, error: null, buildError: null, prevSeen: 0,
  lab: { a: null, b: null, picked: new Set() },
  ui: { season: { key: 'playoffOdds', dir: -1 }, wk: { min: 0.1, pos: 'ALL' }, form: { rid: null, pos: 'ALL', sort: 'form' }, inc: { rid: 'all', from: '', to: '', status: 'all', sort: 'date', open: null }, boardEdit: false, sum: { key: 'posture', dir: -1 }, history: false, open: { managers: false, trades: true }, q: '', results: [], drawer: null, wv: { sort: 'value', pos: 'ALL', msg: '' }, rising: { pos: 'ALL', need: false, owner: 'all', sort: 'next3' }, posr: { mode: 'dyn', sort: 'avg', focus: 'RB', owner: 'all' }, cmp: { uid: null, lid: null, pos: 'ALL' }, dealTab: {}, tree: { zoom: 'fit', side: 'both', orient: 'auto', autoOrient: null, stacked: false, for: null, view: 'tree', kind: 'all', mgr: 'all', asset: 'all', sort: 'gen', depth: '0', open: {}, closed: {} }, lop: { key: 'gap', dir: -1 }, brs: { key: 'br', dir: -1 }, feedOpen: false },
  trending: null,
  pick: { q: '', leagues: null, leagueId: '', teams: null, teamUserId: '', busy: false, error: '', auto: false },
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const signPct = (x) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`);
const k = (v) => (v == null ? '—' : fmtK(Math.round(v)));
const when = (ts) => (ts ? new Date(ts).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const VALUE_POS = ['QB', 'RB', 'WR', 'TE'];
const dateY = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

// ---- icons ----------------------------------------------------------------------------

const ICONS = {
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3 3 0 0 1 0 6M21 20c0-2.6-1.6-4.8-4-5.6"/>',
  swap: '<path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  clip: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 11h6M9 15h4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  ticket: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 20.9 10H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  note: '<path d="M4 4h12l4 4v12H4z"/><path d="M16 4v4h4M8 12h8M8 16h5"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

// ---- load & build --------------------------------------------------------------------

const KEYS = ['dossier:weekly', 'blockExtra', 'ui:neutral', 'dossier:draft', 'draft:fp', 'draft:board', 'draft:stars', 'dossier:raw', 'dossier:book', 'dossier:aux', 'sleeperPlayers2', 'tradeSnaps', 'valueHistory', 'dossierSettings', 'alerts:feed', 'alerts:lastCheck', 'settings', 'dossier:hist', 'dossier:prod', 'notes', 'briefDone', 'plans', 'leagues', 'log', 'dossier:vot'];

async function load() {
  const r = await chrome.storage.local.get(KEYS);
  S.raw = r['dossier:raw'] || null;
  S.bookRaw = r['dossier:book'] || null;
  S.aux = r['dossier:aux'] || { fpBySid: {}, proj: {}, sidToFp: {} };
  S.dict = (r.sleeperPlayers2 && r.sleeperPlayers2.map) || {};
  S.snaps = r.tradeSnaps || {};
  S.vhist = r.valueHistory || {};
  S.cfg = r.dossierSettings || { username: '', leagueId: '', strategy: 'auto', lastSeen: 0 };
  S.book = withKtcSource(S.bookRaw, S.cfg.ktcSource);
  S.feed = r['alerts:feed'] || [];
  S.lastCheck = r['alerts:lastCheck'] || null;
  S.auth = (r.settings && r.settings.sleeper) || null;
  S.hist = r['dossier:hist'] || null;
  S.vot = r['dossier:vot'] || null;
  S.prod = r['dossier:prod'] || null;
  S.notes = r.notes || {};
  S.briefDone = r.briefDone || {};
  S.plans = r.plans || {};
  S.wleagues = r.leagues || {};
  S.log = r.log || [];
  S.blockExtra = r.blockExtra || [];
  S.weekly = r['dossier:weekly'] || null;
  S.draft = r['dossier:draft'] || null;
  S.ui.neutral = !!r['ui:neutral'];
  document.body.classList.toggle('neutral', S.ui.neutral);
  S.draftFp = r['draft:fp'] || null;
  S.draftBoard = r['draft:board'] ? repairBoard(r['draft:board']) : null;
  if (S.draftBoard && S.draftBoard.repaired) { delete S.draftBoard.repaired; chrome.storage.local.set({ 'draft:board': S.draftBoard }); }
  S.draftStars = r['draft:stars'] || {};
  const lid = S.raw && S.raw.league && S.raw.league.league_id;
  S.own = lid ? ((await chrome.storage.local.get(`own:${lid}`))[`own:${lid}`] || {}) : {};
  S.ownIdx = null;
}

const SEED_NOTE = {
  name: '',
  text: '',
  tags: ['avoid', 'public', 'hard'],
};

async function rebuild() {
  S.buildError = null;
  if (!S.raw || !S.book) { S.model = null; return; }
  const ctx = () => ({
    book: S.book, dict: S.dict, fpBySid: S.aux.fpBySid || {}, proj: S.aux.proj || {}, sidToFp: S.aux.sidToFp || {},
    snaps: S.snaps, valueHistory: S.vhist, hist: S.hist, vot: S.vot, prod: S.prod, managerNotes: S.notes,
    prefs: { pickLocks: S.cfg.pickLocks || {}, strategy: S.cfg.strategy, draftOrder: S.cfg.draftOrder || 'standings', shop: S.cfg.shop || null, pickDiscount: S.cfg.pickDiscount != null ? S.cfg.pickDiscount : 0.15, youthBias: S.cfg.youthBias != null ? S.cfg.youthBias : 1, lastSeen: S.prevSeen },
  });
  try {
    S.model = buildModel(S.raw, ctx());
    // One-time: seed notes (none in this copy).
    // Only for the original owner's account (a copy given to someone else starts with no notes).
    const meName = ((S.model.teams.find((x) => x.isMe) || {}).name || '').toLowerCase();
    if (!S.cfg.notesSeeded && true) S.cfg = await sync.saveSettings({ notesSeeded: true });
    if (!S.cfg.notesSeeded) {
      const t = S.model.teams.find((x) => x.name.toLowerCase() === SEED_NOTE.name);
      if (t && !S.notes[t.userId]) {
        S.notes[t.userId] = { text: SEED_NOTE.text, tags: SEED_NOTE.tags, at: Date.now(), name: t.name };
        await chrome.storage.local.set({ notes: S.notes });
        S.model = buildModel(S.raw, ctx());
      }
      S.cfg = await sync.saveSettings({ notesSeeded: true });
    }
  } catch (e) {
    console.error(e);
    S.model = null;
    S.buildError = e.message;
    return;
  }
  const m = S.model;
  if (Object.keys(m.snapUpdates).length) {
    S.snaps = { ...S.snaps, ...m.snapUpdates };
    await chrome.storage.local.set({ tradeSnaps: S.snaps });
  }
  const tiers = {};
  for (const p of m.picks) tiers[`${p.season}:${p.orig}`] = p.tier;
  await chrome.storage.local.set({ 'dossier:pickTiers': tiers });
  if (S.lab.a == null) S.lab.a = m.me;
  if (S.lab.b == null) S.lab.b = (m.teams.find((t) => !t.isMe) || {}).rid;
}

async function runSync({ deep = false, force = false } = {}) {
  if (S.syncing) return;
  S.syncing = 'Starting';
  S.error = null;
  renderProgress();
  try {
    const onStep = (s) => { S.syncing = s; renderProgress(); };
    S.raw = await sync.syncLeague({ onStep, deep });
    const v = await sync.syncValues(S.raw, { onStep, force });
    await load();
    await rebuild();
  } catch (e) {
    console.error(e);
    S.error = e.message;
  } finally {
    S.syncing = null;
    renderProgress();
    render();
  }
}

// ---- helpers -------------------------------------------------------------------------

const team = (rid) => (S.model && S.model.byRid[rid]) || null;
const tname = (rid) => (team(rid) ? team(rid).name : rid == null ? 'Free agent' : `team ${rid}`);
const tlink = (rid) => (team(rid) ? `<a href="#manager/${rid}">${esc(tname(rid))}</a>` : esc(tname(rid)));
const P = (sid) => {
  const d = S.dict[sid];
  return d ? { id: sid, name: d[0], pos: d[1], team: d[2], age: d[3], inj: d[4] } : { id: sid, name: sid, pos: '', team: '', age: null, inj: '' };
};
const pval = (sid) => (S.book ? playerValue(S.book, sid) : { v: 0 });
const initials = (s) => String(s || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

function teamAvatar(t, cls = '') {
  if (!t) return `<span class="av ${cls}">FA</span>`;
  const src = t.logo || (t.avatar ? `https://sleepercdn.com/avatars/thumbs/${esc(t.avatar)}` : '');
  const img = src ? `<img class="tlogo" src="${esc(src)}" alt="">` : '';
  return `<span class="av ${cls}" title="${esc(t.name)}">${esc(initials(t.name))}${img}</span>`;
}
function headshot(sid, cls = 'head') {
  const p = P(sid);
  const src = p.pos === 'DEF' ? `https://sleepercdn.com/images/team_logos/nfl/${String(p.team || sid).toLowerCase()}.png` : `https://sleepercdn.com/content/nfl/players/thumb/${sid}.jpg`;
  return `<span class="av ${cls}">${esc(initials(p.name))}<img src="${src}" alt="" loading="lazy"></span>`;
}
function grade(g, title = '') {
  if (!g) return '';
  const c = g[0] === 'A' ? 'g-a' : g[0] === 'B' ? 'g-b' : g === 'F' ? 'g-f' : 'g-c';
  return `<span class="grade ${c}" title="${esc(title)}">${esc(g)}</span>`;
}
function posture(t) {
  if (!t) return '';
  const p = t.posture;
  return `<span class="pill judge ${p.tone}" title="${esc(p.blurb)} (${esc(p.conf)} confidence)">${esc(p.label.charAt(0) + p.label.slice(1).toLowerCase())}</span>`;
}
function posTag(pos) { return `<span class="pos ${esc(pos)}">${esc(pos || '—')}</span>`; }
function playerLink(sid, label) { return `<button class="link" data-action="player" data-sid="${esc(sid)}">${esc(label || P(sid).name)}</button>`; }
function bar(frac, cls = '') { return `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, (frac || 0) * 100)).toFixed(1)}%"></i></div>`; }
function spark(vals, color = 'var(--violet-2)') {
  if (!vals || vals.length < 2) return '';
  const max = Math.max(...vals, 0.1), min = Math.min(...vals) * 0.85;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 86 + 2},${24 - ((v - min) / Math.max(0.1, max - min)) * 20}`).join(' ');
  return `<svg class="spark" viewBox="0 0 90 26"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
const uid = () => (S.raw ? `sleeper:${S.raw.league.league_id}` : null);
const plan = () => ({ ...DEFAULT_PLAN, ...((uid() && S.plans[uid()]) || {}) });


// ---- colour theme -----------------------------------------------------------------------------
const THEMES = ['auto', 'dark', 'light'];
function curTheme() { try { return localStorage.getItem('cdd-theme') || 'auto'; } catch { return 'auto'; } }
function themeName() { return { auto: 'Auto (follows your computer)', dark: 'Dark', light: 'Light' }[curTheme()]; }
function themeIcon() { return { auto: 'contrast', dark: 'moon', light: 'sun' }[curTheme()]; }
function applyTheme(t) {
  try { localStorage.setItem('cdd-theme', t); } catch { /* ignore */ }
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}


// Page art headers: which crop of the league art goes on which page.
const PAGE_ART = {
  valuetime: ['pa-b4', 'Winners and losers', 'Value over time'],
  ledger: ['pa-b3', 'Every move, every point of value', 'Team ledger'],
  season: ['pa-trophy', 'The race for the trophy', 'Season table'],
  summary: ['pa-b2', 'Who won the trade', 'Trade summary'],
  trades: ['pa-b1', 'Deals and offers', 'Trades'],
  managers: ['pa-b3', 'Know your rivals', 'Managers'],
  waivers: ['pa-duds', 'Overnight claims', 'Waivers', 'flip'],
  draft: ['pa-board', 'Next year starts now', 'Rookie draft', 'flip'],
  startsit: ['pa-b5', 'This week', 'Start / Sit'],
  rising: ['pa-b1', 'Coming into their prime', 'Rising players'],
  positions: ['pa-grades', 'Room by room', 'Positional ranks', 'flip'],
  demand: ['pa-b2', 'Who wants your guys', 'Demand'],
  block: ['pa-duds', 'Up for grabs', 'My trade block', 'flip'],
  picks: ['pa-board', 'Future capital', 'Picks', 'flip'],
  market: ['pa-b5', 'Risers and fallers', 'Market'],
};
function pageArt(page) {
  const a = PAGE_ART[page];
  if (!a) return '';
  return `<div class="page-art ${a[0]} ${a[3] || ''}" role="presentation"><div class="pa-txt"><div class="pa-eyebrow">${esc(a[1])}</div><div class="pa-title">${esc(a[2])}</div></div></div>`;
}

// ---- shell -----------------------------------------------------------------------------

function route() {
  const h = (location.hash || '#overview').slice(1).split('/');
  return { page: h[0] || 'overview', id: h[1] || null };
}
const PAGE_NAMES = { valuetime: 'Value over time', ledger: 'Team ledger', season: 'Season table', form: 'Roster form', block: 'My trade block', draft: 'Rookie draft', overview: 'Overview', summary: 'Trade summary', managers: 'Managers', manager: 'Managers', trades: 'Trades', demand: 'Demand', rising: 'Rising players', positions: 'Positional ranks', startsit: 'Start/Sit', waivers: 'Waivers', picks: 'Picks', compare: 'League compare', tree: 'Trade trees', lopsided: 'Most lopsided trades', branches: 'Most branching trades', market: 'Market', settings: 'Settings' };


// Sidebar league switcher: every league the login is in this season. Picking one
// loads the login's own team there; "Another league or team…" opens the picker.
function switcher(L, me) {
  const cur = L ? String(L.league_id) : String(S.cfg.leagueId || '');
  const list = S.myLeagues || [];
  const teamLine = esc(me ? `${me.teamName || me.name}${viewingAs() ? ' (viewing as)' : ''}` : 'Sync to start');
  if (!list.length) {
    return `<div class="switcher">${me ? teamAvatar(me) : '<span class="av">CD</span>'}<div><b>${esc(L ? L.name : 'No league yet')}</b><span>${teamLine}</span></div></div>`;
  }
  const opts = [...list];
  if (cur && !opts.some((l) => l.id === cur) && L) opts.unshift({ id: cur, name: L.name });
  return `<div class="switcher sel"><div class="sw-body">
    <label class="sr-only" for="sw-league">League</label>
    <select id="sw-league" data-switch="league" title="Switch league">${opts.map((l) => `<option value="${esc(l.id)}" ${l.id === cur ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
      <option value="__pick">Another league or team…</option></select>
    <span>${teamLine}</span></div></div>`;
}

async function loadMyLeagues() {
  const id = S.auth && S.auth.userId ? String(S.auth.userId) : '';
  if (!id) { S.myLeagues = null; return; }
  if (S.myLeaguesFor === id && S.myLeagues) return;
  try {
    const r = await sync.findLeagues('');
    S.myLeagues = r.leagues; S.myLeaguesFor = id;
  } catch { S.myLeagues = null; }
}

function renderSide() {
  const r = route();
  const m = S.model;
  const me = m ? team(m.me) : null;
  const L = S.raw && S.raw.league;
  const pend = m ? m.pending.filter((o) => !o.fromMe).length : 0;
  const p = S.raw ? plan() : null;
  const armed = !!(p && p.run);
  const item = (href, ic, label, on, extra = '') => `<a href="${href}" class="${on ? 'on' : ''}">${icon(ic)}<span>${esc(label)}</span>${extra}</a>`;
  const mgrSub = m && (S.ui.open.managers || r.page === 'manager') ? `<div class="sub">${[...m.teams].sort((a, b) => b.posture.score - a.posture.score).map((t) => `<a href="#manager/${t.rid}" class="${r.page === 'manager' && Number(r.id) === t.rid ? 'on' : ''}"><span class="dot" style="background:${t.posture.tone === 'buy' ? 'var(--violet)' : t.posture.tone === 'sell' ? 'var(--red)' : 'var(--faint)'}"></span>${esc(t.name)}${t.avoid ? ' ' + icon('note') : ''}</a>`).join('')}</div>` : '';
  const tradeSub = S.ui.open.trades || r.page === 'trades' || r.page === 'summary' ? `<div class="sub"><a href="#summary" class="${r.page === 'summary' ? 'on' : ''}">Trade summary</a>${[['ledger', 'League trades'], ['offers', 'My offers'], ['incoming', 'Offers to you'], ['lab', 'Trade lab'], ['finder', 'Trade finder'], ['week', 'This week']].map(([id, l]) => `<a href="#trades/${id}" class="${r.page === 'trades' && (r.id || 'ledger') === id ? 'on' : ''}">${esc(l)}${id === 'offers' && pend ? ` <span class="pill sell" style="padding:0 6px">${pend}</span>` : ''}</a>`).join('')}</div>` : '';
  $('#side').innerHTML = `
    <a class="logo big" href="#overview" title="Casey's Dynasty Dashboard"><img src="../splash/crest.png" alt="Casey's Dynasty League"></a>
    ${switcher(L, me)}
    <div class="nav-h">Main</div>
    <nav class="nav">
      ${item('#season', 'trophy', 'Season table', r.page === 'season')}
      ${item('#overview', 'home', 'Overview', r.page === 'overview')}
      ${item('#valuetime', 'chart', 'Value over time', r.page === 'valuetime' || r.page === 'ledger')}
      ${r.page === 'valuetime' || r.page === 'ledger' ? `<div class="sub"><a href="#ledger" class="${r.page === 'ledger' ? 'on' : ''}">Team ledger</a></div>` : ''}
      <a href="#managers" class="${r.page === 'managers' || r.page === 'manager' ? 'on' : ''}">${icon('users')}<span>Managers</span><span class="chev" data-action="toggleNav" data-group="managers">${icon(S.ui.open.managers || r.page === 'manager' ? 'down' : 'right')}</span></a>
      ${mgrSub}
      <a href="#summary" class="${r.page === 'trades' || r.page === 'summary' ? 'on' : ''}">${icon('swap')}<span>Trades</span>${pend ? `<span class="badge">${pend}</span>` : `<span class="chev" data-action="toggleNav" data-group="trades">${icon(S.ui.open.trades ? 'down' : 'right')}</span>`}</a>
      ${tradeSub}
      ${item('#block', 'ticket', 'My trade block', r.page === 'block')}
      ${item('#demand', 'flag', 'Demand', r.page === 'demand')}
      ${item('#form', 'chart', 'Roster form', r.page === 'form')}
      ${item('#positions', 'chart', 'Positional ranks', r.page === 'positions')}
      ${item('#rising', 'trend', 'Rising players', r.page === 'rising')}
      ${item('#draft', 'ticket', 'Rookie draft', r.page === 'draft')}
      ${item('#startsit', 'clip', 'Start/Sit', r.page === 'startsit')}
      ${item('#waivers', 'moon', 'Waivers', r.page === 'waivers', armed ? '<span class="badge" style="background:var(--violet)">on</span>' : '')}
    </nav>
    <div class="nav-h">Others</div>
    <nav class="nav">
      ${item('#picks', 'ticket', 'Picks', r.page === 'picks')}
      ${item('#tree', 'trend', 'Trade trees', r.page === 'tree' || r.page === 'lopsided' || r.page === 'branches')}
      ${item('#compare', 'users', 'League compare', r.page === 'compare')}
      ${item('#market', 'chart', 'Market', r.page === 'market')}
      ${item('#settings', 'gear', 'Settings', r.page === 'settings')}
    </nav>
    <div class="side-card">
      <ul>
        <li class="${S.auth && S.auth.token ? '' : 'off'}">${icon(S.auth && S.auth.token ? 'check' : 'x')}Offer alerts every 5 min</li>
        <li class="${armed ? '' : 'off'}">${icon(armed ? 'check' : 'x')}${armed ? `Waivers armed${(Object.values(S.plans || {}).find((x) => x && x.run) || {}).run ? ` · ${esc(when(Object.values(S.plans).find((x) => x && x.run).run.windowStart))}` : ''}` : 'Waivers not armed'}</li>
        <li>${icon('check')}${S.raw ? `Synced ${esc(when(S.raw.at))}` : 'Not synced yet'}</li>
        ${S.raw && S.raw.quickAt && S.raw.quickAt > S.raw.at ? `<li>${icon('check')}Rosters & picks ${esc(when(S.raw.quickAt))}</li>` : ''}
      </ul>
      <button class="btn primary" style="width:100%;justify-content:center" data-action="sync" ${S.syncing ? 'disabled' : ''}>${icon('sync')}Sync now</button>
    </div>`;
}

function renderTop() {
  const r = route();
  const m = S.model;
  const L = S.raw && S.raw.league;
  const pend = m ? m.pending.filter((o) => !o.fromMe).length : 0;
  const armed = !!(S.raw && plan().run);
  let crumb = PAGE_NAMES[r.page] || 'Overview';
  if (r.page === 'manager' && team(Number(r.id))) crumb = `Managers / <b>${esc(tname(Number(r.id)))}</b>`;
  else crumb = `<b>${esc(crumb)}</b>`;
  $('#top').innerHTML = `
    <button class="iconbtn" data-action="toggleSide" aria-label="Toggle sidebar">${icon('panel')}</button>
    <div class="crumbs">${esc(L ? L.name : "Casey's Dynasty Dashboard")} / ${crumb}${viewingAs() ? ` <a class="pill warn" href="#settings" title="This isn't your Sleeper login. Offers, alerts and waiver claims are off.">Viewing as ${esc(tname(S.raw.me.rosterId))}</a>` : ''}</div>
    <div class="spacer"></div>
    <div class="search">${icon('search')}<input type="text" id="q" placeholder="Search players or managers" value="${esc(S.ui.q)}" autocomplete="off">
      ${S.ui.results.length ? `<div class="results">${S.ui.results.map((x) => x.kind === 'team' ? `<a href="#manager/${x.rid}" data-action="closeSearch">${teamAvatar(team(x.rid))}<div><b>${esc(x.name)}</b><div class="muted small">Manager</div></div></a>` : `<a href="#" data-action="player" data-sid="${esc(x.sid)}">${headshot(x.sid)}<div><b>${esc(x.name)}</b><div class="muted small">${esc(x.pos)} ${esc(x.team || '')} · ${esc(x.owner)}</div></div></a>`).join('')}</div>` : ''}
    </div>
    <button class="iconbtn" data-action="toggleFeed" aria-label="Background alerts">${icon('history')}</button>
    <a class="iconbtn" href="#trades/offers" aria-label="Offers waiting">${icon('bell')}${pend ? '<span class="pip"></span>' : ''}</a>
    <button class="iconbtn" data-action="refreshNow" aria-label="Refresh rosters, picks and offers" title="Refresh rosters, picks, offers and trade blocks from Sleeper (a few seconds). Sync now in the sidebar reloads everything.">${icon('sync')}</button>
    <button class="iconbtn" data-action="cycleTheme" aria-label="Colour theme: ${themeName()}" title="Colour theme: ${themeName()}. Click to change.">${icon(themeIcon())}</button>
    <button class="toggle ${armed ? 'on' : ''}" data-action="armToggle" title="Overnight waiver claims">Waivers armed <span class="sw"></span></button>
    ${S.ui.feedOpen ? `<div class="results" style="right:22px;top:52px;position:fixed;width:360px">${teamState() && teamState() !== 'own' ? `<div style="padding:10px">${notOwnNotice('Alerts')}</div>` : S.feed.length ? S.feed.slice(0, 12).map((f) => `<div style="padding:8px"><b>${esc(f.title)}</b> <span class="faint small">${esc(when(f.at))}</span><div class="muted small">${esc(f.body)}</div></div>`).join('') : '<div class="empty" style="padding:10px">No background alerts yet. They appear here and as Chrome notifications.</div>'}</div>` : ''}`;
}

function renderProgress() {
  const el = $('#progress');
  if (!S.syncing) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="progress">${icon('sync')}<span>${esc(S.syncing)}…</span><div class="bar"><i></i></div></div>`;
}

function render() {
  renderSide();
  renderTop();
  renderDrawer();
  const view = $('#view');
  const r = route();
  if (!S.model) {
    const why = (S.error && S.error !== NEED_TEAM ? S.error : null) || S.buildError;
    view.innerHTML = `${artBanner({ mood: 'glory', eyebrow: "Casey's Dynasty League", title: S.syncing ? 'Building your league file' : 'Welcome to the dashboard', sub: S.syncing ? esc(S.syncing) + '…' : 'Every manager profiled, every trade graded, and your own team front and centre.' })}<div class="card" style="max-width:640px">
      <h3>${S.syncing ? 'Building your league file' : 'Getting started'}</h3>
      ${why ? `<div class="notice">${esc(why)}</div>` : ''}
      <p class="muted">${S.syncing ? 'Reading rosters, trades, values, rankings and stats. The first sync takes a minute or two.' : (loginId() ? 'Your Sleeper login is picked up. Sync to build your team\'s file.' : 'Log in at sleeper.com in this browser and your team loads by itself, or pick your league and team below.')}</p>
      ${S.syncing || !loginId() ? '' : `<div class="row"><button class="btn primary" data-action="sync">${icon('sync')}Sync now</button><a class="btn" href="#settings">Settings</a></div>`}
    </div>${S.syncing || r.page === 'settings' ? '' : viewPicker({ welcome: true })}${r.page === 'settings' ? viewSettings() : ''}`;
    return;
  }
  const notice = S.error ? `<div class="notice">Last sync failed: ${esc(S.error)}. Showing the previous data.</div>` : '';
  let html = '';
  try {
    switch (r.page) {
      case 'managers': html = viewManagers(); break;
      case 'summary': html = viewSummary(); break;
      case 'valuetime': html = viewValueTime(); break;
      case 'ledger': html = viewLedger(r.id); break;
      case 'season': html = viewSeason(); break;
      case 'manager': html = viewManager(Number(r.id)); break;
      case 'trades': html = viewTrades(r.id || 'ledger'); break;
      case 'demand': html = viewDemand(); break;
      case 'block': html = viewBlock(); break;
      case 'rising': html = viewRising(); break;
      case 'positions': html = viewPositions(); break;
      case 'form': html = viewForm(); break;
      case 'startsit': html = viewStartSit(); break;
      case 'waivers': html = viewWaivers(); break;
      case 'picks': html = viewPicks(); break;
      case 'compare': html = viewCompare(); break;
      case 'tree': html = viewTreePage(r.id); break;
      case 'lopsided': html = viewLopsided(); break;
      case 'branches': html = viewBranches(); break;
      case 'draft': html = viewDraft(); break;
      case 'market': html = viewMarket(); break;
      case 'settings': html = viewSettings(); break;
      default: html = viewOverview();
    }
  } catch (e) {
    console.error(e);
    html = `<div class="notice">This page hit an error: ${esc(e.message)}</div>`;
  }
  view.innerHTML = notice + pageArt(r.page) + html;
  if (r.page === 'tree' && r.id && S.ui.tree.view !== 'list') fitTree();
}

// Wide trade trees: start zoomed to fit the screen; +/− zoom from there.
function fitTree() {
  const f = S.ui.tree;
  const fts = [...document.querySelectorAll('.tcanvas .ft')];
  const wrap = document.querySelector('.tcanvas.ftwrap');
  if (!wrap || !fts.length) return;
  // The canvas fills the screen height so a fitted tree is visible all at once.
  const H = Math.max(420, window.innerHeight - 90);
  wrap.style.height = `${H}px`;
  const z = f.zoom;
  if (z !== 'fit') { fts.forEach((x) => { x.style.zoom = z; }); return; }
  fts.forEach((x) => { x.style.zoom = 1; });
  const w = Math.max(...fts.map((x) => x.scrollWidth));
  const h = fts.reduce((a, x) => a + x.scrollHeight, 0);
  const fit = Math.min(1, (wrap.clientWidth - 40) / w, (H - 90) / h);
  // Auto: try both orientations once per tree and keep the one that shows the whole tree largest.
  if (f.orient === 'auto' && !f.settled) {
    const cur = wrap.classList.contains('lrwrap') ? 'right' : 'down';
    f.tried = f.tried || {};
    f.tried[cur] = fit;
    const other = cur === 'down' ? 'right' : 'down';
    if (fit < 0.9 && f.tried[other] == null) { f.autoOrient = other; render(); return; }
    f.settled = true;
    if (f.tried[other] != null && f.tried[other] > fit + 0.01) { f.autoOrient = other; render(); return; }
  }
  const zz = Math.max(0.2, fit);
  fts.forEach((x) => { x.style.zoom = zz; });
  f.fitted = zz;
  const lab = document.querySelector('[data-action=treeZoom][data-z=fit]');
  if (lab) lab.textContent = `Fit ${Math.round(zz * 100)}%`;
}

// ---- overview -------------------------------------------------------------------------

function briefKey(b) { return `${b.kind}|${b.title}`; }


// Art banner: the winners half of the league art for teams on the way up,
// the duds half for teams on the way down.
function artBanner({ mood, eyebrow, title, sub, stats = [] }) {
  return `<div class="art-banner ${mood === 'gloom' ? 'gloom' : 'glory'}">
    <div class="art-txt"><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}
      ${stats.length ? `<div class="art-stats">${stats.map(([l, v]) => `<div><span>${esc(l)}</span><b>${v}</b></div>`).join('')}</div>` : ''}</div>
  </div>`;
}
const moodOf = (t) => (t && ((t.playoffOdds != null && t.playoffOdds >= 0.5) || ['ALL-IN', 'CONTENDER'].includes(t.posture.label)) ? 'glory' : 'gloom');

function viewOverview() {
  const m = S.model;
  const me = team(m.me);
  const pend = m.pending.filter((o) => !o.fromMe).length;
  const left = m.league.deadline && m.league.week <= m.league.deadline ? m.league.deadline - m.league.week : null;
  const myIds = new Set(team(m.me).roster.players || []);
  const items = m.brief.filter((b) => !(b.kind === 'aging' && b.sid && !myIds.has(b.sid))).slice(0, 16).map((b) => ({ ...b, done: S.briefDone[briefKey(b)] }));
  items.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
  const top = items.find((b) => !b.done);
  const href = (b) => {
    if (!b.link) return '#overview';
    const tab = b.link.tab === 'subjects' ? (b.link.id ? `manager/${b.link.id}` : 'managers') : b.link.tab;
    return `#${tab}${b.link.sub ? '/' + b.link.sub : ''}`;
  };
  const KIND = { offer: 'Offer', lineup: 'Lineup', trade: 'Trade', deadline: 'Deadline', demand: 'Demand', posture: 'Posture', block: 'Trade block', pick: 'Picks', market: 'Market', aging: 'Aging', odds: 'Outlook' };

  // week strip
  const tradesByWeek = {};
  for (const t of m.leagueTrades) tradesByWeek[t.leg] = (tradesByWeek[t.leg] || 0) + 1;
  const lastWeek = Math.max(m.league.regEnd + 3, 17);
  const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1).map((w) => `<div class="wk ${w === m.league.week ? 'now' : w < m.league.week ? 'done' : ''} ${w === m.league.deadline ? 'dl' : ''}" title="Week ${w}${w === m.league.deadline ? ', trade deadline' : ''}${tradesByWeek[w] ? `, ${tradesByWeek[w]} trade${tradesByWeek[w] > 1 ? 's' : ''}` : ''}"><span>${w > m.league.regEnd ? 'P' : 'W'}</span><span class="n">${w}</span><span class="dots">${'<i></i>'.repeat(Math.min(3, tradesByWeek[w] || 0))}</span></div>`).join('');

  const rows = items.map((b) => `<li class="${b.done ? 'isdone' : ''}">
      <span class="k">${esc(KIND[b.kind] || b.kind)}</span>
      <div class="body t-${esc(b.tone)}"><a href="${href(b)}" class="ttl">${esc(b.title)}</a><div class="sub2">${esc(b.body)}</div></div>
      <div class="side2"><span class="stack">${(b.rids || []).filter((r) => team(r)).slice(0, 3).map((r) => teamAvatar(team(r))).join('')}</span><button class="done-btn" data-action="briefDone" data-key="${esc(briefKey(b))}" aria-label="Mark handled"></button></div>
    </li>`).join('');

  // my core: my own players with the most projected production ahead
  const pjm = m.aging ? m.aging.players : {};
  const core = me.assets.filter((x) => pjm[x.id] && pjm[x.id].phase !== 'declining').map((x) => ({ ...pjm[x.id], rid: m.me })).sort((x, y) => y.next3 - x.next3).slice(0, 3);
  const pcard = (x) => `<div class="card pcard vert">
      <div class="pic p-${esc(x.pos)}"><span class="ini">${esc(initials(x.name))}</span><img src="https://sleepercdn.com/content/nfl/players/${esc(x.id)}.jpg" alt=""></div>
      <div class="body">
        <div class="row" style="justify-content:space-between;flex-wrap:nowrap"><span class="nm">${esc(x.name)}</span>${posTag(x.pos)}</div>
        <div class="facts"><span>Age ${Math.floor(x.age)}</span><span>${x.seasons[0].ppg.toFixed(1)} → ${x.seasons[2].ppg.toFixed(1)} pts/g</span><span>${esc(x.phase === 'rising' ? 'Rising' : 'At peak')}</span></div>
        <div class="foot"><div class="meter"><div class="row"><span class="muted">Prime left</span><span>${x.primeYears} yr${x.primeYears === 1 ? '' : 's'}</span></div>${bar(Math.min(1, x.primeYears / 5), 'green')}</div><button class="btn sm" data-action="player" data-sid="${esc(x.id)}">Open</button></div>
      </div></div>`;
  const tg = m.aging ? m.aging.targets.filter((x) => x.rid != null && !team(x.rid).isMe && !team(x.rid).avoid) : [];
  const tgSell = tg.filter((x) => team(x.rid).posture.tone === 'sell').length;
  const tgNeed = tg.filter((x) => x.fitsNeed).length;

  const standing = [...m.teams].sort((a, b) => b.w - a.w || b.pf - a.pf).findIndex((t) => t.isMe) + 1;
  const valRank = [...m.teams].sort((a, b) => b.totalValue - a.totalValue).findIndex((t) => t.isMe) + 1;
  const traj = me.trajectory;
  const pt = m.league.playoffTeams;
  const sched = m.schedule || [];
  const nextG = sched[0];
  const ss = m.startSit;
  const thisWin = ss && ss.opponent ? ss.opponent.winProb : nextG ? nextG.winProb : null;
  const byesAhead = sched.reduce((n, g) => n + g.myByes.length, 0);
  const swaps = ss ? ss.swaps.filter((x) => x.start).length : 0;

  const odds = me.playoffOdds;
  const hero = artBanner({
    mood: moodOf(me),
    eyebrow: `Week ${m.league.week} · ${m.league.name || (S.raw && S.raw.league.name) || ''}`,
    title: me.name,
    sub: moodOf(me) === 'glory' ? 'Trophy energy. Keep pressing.' : 'Rough patch. Time to get younger and build for the next run.',
    stats: [['Record', `${me.w}-${me.l}${me.t ? '-' + me.t : ''}`], ['Playoff odds', pct(odds)], ['Posture', esc(me.posture.label.charAt(0) + me.posture.label.slice(1).toLowerCase())], ['Offers waiting', String(pend)]],
  });
  return hero + `<div class="split">
    <div class="grid">
      <h1 class="page" style="margin:0">My league stats</h1>
      <div class="three">
        <div class="card tile hot">${icon('trophy')}<div class="num">${pct(me.playoffOdds)}</div><div class="lab">Playoff odds · ${me.w}-${me.l}, ${ordinal(standing)} of ${m.teams.length}. Top ${pt} make it.</div></div>
        <a class="card tile" href="#trades/offers">${icon('swap')}<div class="num">${pend}</div><div class="lab">Offers waiting on you</div></a>
        <div class="card tile">${icon('timer')}<div class="num">${left == null ? '—' : left}</div><div class="lab">${left == null ? 'Trade deadline passed' : `Weeks to the trade deadline (wk ${m.league.deadline})`}</div></div>
      </div>
      ${top ? `<div class="card banner"><div class="art">${icon('spark')}</div><div><b>${esc(top.title)}</b><p>${esc(top.body)}</p></div><a class="btn" href="${href(top)}">Open</a></div>` : ''}
      ${scheduleCard(m, me)}
      ${core.length ? `<div class="sec-h"><h2>My core going forward</h2><a class="more" href="#manager/${m.me}">My roster</a></div><div class="three">${core.map(pcard).join('')}</div>` : ''}
      <div class="card">
        <div class="sec-h"><h2>Intel <span class="muted" style="font-weight:400;font-size:13px">(week ${m.league.week})</span></h2><span class="muted small">Dots mark trades that week</span></div>
        <div class="weeks">${weeks}</div>
        <ul class="intel">${rows || '<li class="empty">Nothing to act on right now.</li>'}</ul>
      </div>
    </div>
    <div class="grid">
      <h1 class="page" style="margin:0">My team</h1>
      <div class="card profile">
        ${teamAvatar(me, 'lg ring')}
        <h4>${esc(me.teamName || me.name)}</h4><div class="handle">@${esc(me.name)}</div>
        <div style="margin-top:8px">${posture(me)}</div>
        <div class="stats"><div><b>${ordinal(standing)}</b><span>Standing</span></div><div><b>${me.avgPts ? me.avgPts.toFixed(1) : '—'}</b><span>Avg points</span></div><div><b>${ordinal(valRank)}</b><span>Value rank</span></div></div>
      </div>
      <div class="card"><h3>This week</h3>
        <div class="facts">
          <div><span>Win chance</span><b>${pct(thisWin)}</b>${nextG ? `<span>vs ${esc(tname(nextG.rid))}${ss && ss.opponent ? ', from this week\'s player projections' : ''}</span>` : ''}</div>
          <div><span>Lineup changes</span><b>${swaps}</b><a class="link small" href="#startsit">Start/Sit</a></div>
          <div><span>Starters on bye</span><b>${nextG ? nextG.myByes.length : 0}</b><span>${byesAhead} more byes before playoffs</span></div>
          <div><span>Starters hurt</span><b class="${m.myStarterInj.length ? 'down' : ''}">${m.myStarterInj.length}</b><span>${esc(m.myStarterInj.map((sid) => P(sid).name).slice(0, 2).join(', '))}</span></div>
        </div>
      </div>
      <div class="card"><h3>Roster value by career phase</h3>${phaseDonut(me, m)}</div>
      ${traj ? `<div class="card"><h3>Lineup outlook</h3><p class="lede">Your best lineup's projected points per week, from the aging model.</p>
        ${traj.map((v, i) => `<div class="meter" style="margin-bottom:8px"><div class="row"><span>${m.league.season + i}</span><span>${v.toFixed(1)} <span class="muted">(${ordinal(me.trajRank[i])})</span></span></div>${bar(v / Math.max(...traj, 1), i === 0 ? '' : v < traj[0] * 0.93 ? 'orange' : 'green')}</div>`).join('')}</div>` : ''}
      ${tg.length ? `<a class="card" href="#rising" style="display:block"><h3>Trade targets</h3><p class="muted" style="margin:0">${tg.length} players on other rosters are coming into their peak${tgNeed ? `, ${tgNeed} at positions you need` : ''}${tgSell ? `, ${tgSell} on rebuilding or tanking teams` : ''}.</p><span class="link small">Open Rising players</span></a>` : ''}
    </div>
  </div>`;
}

function scheduleCard(m, me) {
  const sched = m.schedule || [];
  if (!sched.length) return '';
  const res = (r) => `<span class="res r-${r}">${r}</span>`;
  const rows = sched.map((g, i) => {
    const o = team(g.rid);
    const formTxt = g.last3 == null ? '' : g.form >= 6 ? `<span class="up">Hot · ${g.last3.toFixed(0)} last 3</span>` : g.form <= -6 ? `<span class="down">Cold · ${g.last3.toFixed(0)} last 3</span>` : `<span class="muted">${g.last3.toFixed(0)} last 3</span>`;
    const byes = [g.myByes.length ? `<span class="down" title="${esc(g.myByes.map((s) => P(s).name).join(', '))}">You: ${g.myByes.length} on bye</span>` : '', g.oppByes.length ? `<span class="up" title="${esc(g.oppByes.map((s) => P(s).name).join(', '))}">Him: ${g.oppByes.length} on bye</span>` : ''].filter(Boolean).join(' · ');
    return `<tr class="${i === 0 ? 'me' : ''}">
      <td class="num">Wk ${g.week}</td>
      <td><div class="who">${teamAvatar(o)}<div>${tlink(g.rid)}<div class="meta">${esc(g.record)} · ${ordinal(g.standing)} · ${posture(o)}</div></div></div></td>
      <td style="white-space:nowrap">${g.results.map(res).join('')}</td>
      <td class="num" style="white-space:nowrap">${g.avgPts ? g.avgPts.toFixed(1) : '—'}<div class="small">${formTxt}</div></td>
      <td class="small">${byes || '<span class="faint">—</span>'}</td>
      <td style="min-width:110px"><div class="row" style="justify-content:space-between"><span>${pct(g.winProb)}</span></div>${bar(g.winProb, g.winProb >= 0.55 ? 'green' : g.winProb <= 0.45 ? 'red' : '')}</td>
    </tr>`;
  }).join('');
  const expW = sched.reduce((n, g) => n + g.winProb, 0);
  return `<div class="card"><div class="sec-h"><h2>My schedule to the playoffs</h2><span class="muted small">About ${expW.toFixed(1)} more wins expected in ${sched.length} games</span></div>
    <div class="scroll"><table class="t"><thead><tr><th>Week</th><th>Opponent</th><th>Last 5</th><th class="num">Avg pts</th><th>Byes (starters)</th><th>Win chance</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="faint small" style="margin:8px 0 0">Win chance compares both teams' scoring this season, pulled toward the league average, and their best possible lineups. It doesn't yet account for byes or injuries in future weeks.</p></div>`;
}

function phaseDonut(t, m) {
  const ph = t.phase;
  if (!ph) return '<p class="muted">Not enough data yet.</p>';
  const segs = [['Rising', ph.rising, 'var(--green)', 'green', 'rising'], ['At peak', ph.peak, 'var(--violet)', '', 'peak'], ['Declining', ph.declining, 'var(--orange)', 'orange', 'declining'], ['Draft picks', ph.picks, 'var(--faint)', 'grey', null]];
  const tot = ph.total || 1;
  let acc = 0;
  const C = 2 * Math.PI * 62;
  const ring = segs.map(([, v, color]) => {
    const f = v / tot;
    const len = Math.max(0, f * C - 6);
    const out = f > 0.01 ? `<circle cx="85" cy="85" r="62" fill="none" stroke="${color}" stroke-width="20" stroke-linecap="round" stroke-dasharray="${len} ${C}" stroke-dashoffset="${-acc * C}"/>` : '';
    acc += f;
    return out;
  }).join('');
  const n = m.teams.length;
  const who = (key) => (key && ph.who[key] ? ph.who[key].slice().sort((a, b) => pval(b).v - pval(a).v).slice(0, 3).map((sid) => P(sid).name).join(', ') : '');
  return `<div class="donut"><svg viewBox="0 0 170 170">${ring}</svg><div class="ctr"><b>${t.trueAge ? t.trueAge.toFixed(1) : '—'}</b><span>value-weighted age</span></div></div>
    <div class="grid" style="gap:10px">${segs.map(([l, v, , cls, key]) => `<div class="meter"><div class="row"><span>${l}</span><span>${pct(v / tot)} · ${k(v)}</span></div>${bar(v / tot, cls)}${key && who(key) ? `<div class="faint small">${esc(who(key))}</div>` : ''}</div>`).join('')}</div>
    <p class="muted small" style="margin:10px 0 0">${ordinal(ph.risingRank)} of ${n} in share of value still rising; ${ordinal(ph.decliningRank)} of ${n} in share declining.</p>`;
}

// ---- season table: standings, form and projections ----------------------------------------

function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function viewSeason() {
  const m = S.model;
  const st = S.ui.season;
  const pN = m.league.playoffTeams || 6;
  const n = m.teams.length;
  const regEnd = m.league.regEnd;
  const weeks = Array.from({ length: regEnd }, (_, i) => i + 1);
  const standing = Object.fromEntries([...m.teams].sort((a, b) => b.w - a.w || b.pf - a.pf).map((t, i) => [t.rid, i + 1]));
  const rows = m.teams.map((t) => {
    const games = t.w + t.l + (t.t || 0);
    const left = t.remaining ? t.remaining.length : 0;
    const projW = t.expWins != null ? t.expWins : t.w;
    const streak = (() => { const r = t.results || []; if (!r.length) return ''; const last = r[r.length - 1].res; let c = 0; for (let i = r.length - 1; i >= 0 && r[i].res === last; i--) c++; return `${last}${c}`; })();
    const avgSeed = t.seedOdds ? t.seedOdds.reduce((s2, p, i) => s2 + p * (i + 1), 0) : null;
    return { t, rid: t.rid, name: t.name, standing: standing[t.rid], record: t.w - t.l + t.pf / 1e5, pf: t.pf, pa: t.pa || 0, maxpf: t.maxPf || 0, eff: t.eff, allPlay: t.allPlay ? t.allPlay.w / Math.max(1, t.allPlay.w + t.allPlay.l + t.allPlay.t) : null, best: t.bestNow || 0, strength: t.strength, sos: t.sos, projW, projL: games + left - projW, playoffOdds: t.playoffOdds ?? -1, bye: t.byeOdds ?? -1, top: t.topSeed ?? -1, avgSeed, streak, left };
  });
  rows.sort((a, b) => { const va = a[st.key], vb = b[st.key]; return (typeof va === 'string' ? va.localeCompare(vb) : (va ?? -1e9) - (vb ?? -1e9)) * st.dir; });
  const th = (key, label, cls = 'num', title = '') => `<th class="${cls} sortable ${st.key === key ? 'on' : ''}" data-action="seasonSort" data-key="${key}" title="${esc(title)}">${label}${st.key === key ? (st.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
  const res = (t, w) => {
    const r = (t.results || []).find((x) => x.w === w);
    if (r) return `<td class="wk-r r-${r.res}" title="Week ${w}: ${r.pts.toFixed(1)}–${r.opp.toFixed(1)} vs ${esc(tname(r.oppRid))}">${r.res}</td>`;
    const up = (t.remaining || []).find((x) => x.w === w);
    if (up) { const o = team(up.rid); const p0 = o ? normCdf((t.strength - o.strength) / Math.sqrt((t.sd || 22) ** 2 + (o.sd || 22) ** 2)) : null; const pr = p0 == null ? '' : p0 >= 0.5 ? 'W' : 'L'; return `<td class="wk-r proj r-${pr}" title="Week ${w} vs ${esc(tname(up.rid))}${p0 != null ? `: projected ${pr === 'W' ? 'win' : 'loss'}, ${Math.round(p0 * 100)}% to win` : ''}">${pr || '·'}<span class="pp">${p0 != null ? Math.round(p0 * 100) : ''}</span></td>`; }
    return '<td class="wk-r">·</td>';
  };
  const oddsCell = (v) => (v < 0 ? '—' : `<div class="oddcell"><span>${pct(v)}</span>${bar(v, v >= 0.75 ? 'green' : v <= 0.25 ? 'red' : 'orange')}</div>`);
  const showCut = st.key === 'standing' || st.key === 'playoffOdds' || st.key === 'projW';
  const body = rows.map((r, i) => `<tr class="${r.t.isMe ? 'me' : ''} ${showCut && i === pN - 1 ? 'cutline' : ''}">
      <td class="num">${r.standing}</td>
      <td><div class="who">${teamAvatar(r.t)}<div>${tlink(r.rid)}<div class="meta">${esc(r.t.teamName || '')}</div></div></div></td>
      <td class="num"><b>${r.t.w}-${r.t.l}${r.t.t ? '-' + r.t.t : ''}</b><div class="small muted">${esc(r.streak)}</div></td>
      ${weeks.map((w) => res(r.t, w)).join('')}
      <td class="num grp">${Math.round(r.pf)}</td><td class="num">${Math.round(r.pa)}</td><td class="num">${Math.round(r.maxpf)}</td><td class="num">${r.eff != null ? pct(r.eff) : '—'}</td>
      <td class="num">${r.t.allPlay ? `${r.t.allPlay.w}-${r.t.allPlay.l}` : '—'}</td>
      <td class="num grp">${r.best ? r.best.toFixed(1) : '—'}<div class="small muted">${r.t.strengthRank ? ordinal(r.t.strengthRank) : ''}</div></td>
      <td class="num">${r.t.sosRank ? `${ordinal(r.t.sosRank)}` : '—'}<div class="small muted">${r.left} left</div></td>
      <td class="num grp"><b>${r.projW.toFixed(1)}-${r.projL.toFixed(1)}</b></td>
      <td class="num">${r.avgSeed ? r.avgSeed.toFixed(1) : '—'}</td>
      <td>${oddsCell(r.playoffOdds)}</td>
      ${m.teams[0].byeOdds != null ? `<td>${oddsCell(r.bye)}</td>` : ''}
      <td>${oddsCell(r.top)}</td>
    </tr>`).join('');
  return `<div class="sec-h"><h2>Season table</h2><span class="row" style="gap:10px"><button class="btn sm primary" data-action="exportSeason">${icon('download')}Export PNG</button></span></div><div class="row" style="margin:-4px 0 10px"><span class="muted small">${n} teams · top ${pN} make the playoffs${m.teams[0].byeOdds != null ? ' · top 2 get a bye' : ''} · regular season ends week ${regEnd}</span></div>
    <div class="card"><div class="scroll"><table class="t season">
      <thead>
        <tr class="grp-h"><th colspan="3"></th><th colspan="${weeks.length}">Results · faded = projected (small number = % to win)</th><th colspan="5" class="grp">Scoring</th><th colspan="2" class="grp">Strength</th><th colspan="${m.teams[0].byeOdds != null ? 5 : 4}" class="grp">Projection</th></tr>
        <tr>${th('standing', '#', 'num')}${th('name', 'Team', '')}${th('record', 'Record')}${weeks.map((w) => `<th class="num wk-h">${w}</th>`).join('')}
        ${th('pf', 'PF', 'num grp')}${th('pa', 'PA')}${th('maxpf', 'Max PF', 'num', 'Points with the best possible lineup every week')}${th('eff', 'Eff.', 'num', 'Points scored as a share of max PF: how well he sets his lineup')}${th('allPlay', 'All-play', 'num', 'Record if he played every team every week')}
        ${th('best', 'Proj. max PF/wk', 'num grp', 'Projected max PF per week: what his best healthy lineup scores today, from each player\'s points per game')}${th('sos', 'Sched.', 'num', 'Remaining schedule difficulty: 1st = toughest')}
        ${th('projW', 'Proj. record', 'num grp')}${th('avgSeed', 'Avg seed', 'num')}${th('playoffOdds', 'Playoffs', '')}${m.teams[0].byeOdds != null ? th('bye', 'Bye', '') : ''}${th('top', '#1 seed', '')}</tr>
      </thead><tbody>${body}</tbody></table></div>
      <p class="faint small" style="margin:10px 0 0">Projections run the rest of the regular season 3,000 times. Each team is assumed to start its <b>best lineup</b> from here on: strength blends the best lineup it could have started each week so far (max PF) with the best healthy lineup on its roster today, so recent trades and injuries count and lineup mistakes don't. Ties are broken by points for. The dashed line marks the playoff cut.</p></div>` + draftProjectionCard(m);
}

function draftProjectionCard(m) {
  const n = m.teams.length;
  const pN = m.league.playoffTeams || 6;
  const y = m.league.season + 1;
  const method = m.draftOrderMethod || 'standings';
  const picksY = m.picks.filter((p) => p.season === y);
  // Draft slot from final standings: worst record picks first (non-playoff teams), so slot = n + 1 - final rank.
  const rows = m.teams.map((t) => {
    const slotOdds = t.seedOdds ? t.seedOdds.map((_, k) => t.seedOdds[n - 1 - k]) : null; // slotOdds[s-1]
    const exp = slotOdds ? slotOdds.reduce((s2, p, i) => s2 + p * (i + 1), 0) : null;
    const top3 = slotOdds ? slotOdds.slice(0, 3).reduce((a, b) => a + b, 0) : null;
    const first = slotOdds ? slotOdds[0] : null;
    const r1 = picksY.find((p) => p.orig === t.rid && p.round === 1);
    const r2 = picksY.find((p) => p.orig === t.rid && p.round === 2);
    return { t, slotOdds, exp, top3, first, r1, r2, proj: r1 && r1.slot };
  }).sort((a, b) => (a.proj || 99) - (b.proj || 99));
  const ownerCell = (p) => (!p ? '<span class="faint">—</span>' : p.owner === p.orig ? `<span class="muted">own</span> <span class="faint">${k(p.v)}</span>` : `<b class="${p.owner === m.me ? 'up' : ''}">${esc(tname(p.owner))}</b> <span class="faint">${k(p.v)}</span>`);
  const dist = (so) => (so ? `<div class="slotdist">${so.map((p, i) => `<i title="Pick ${i + 1}: ${Math.round(p * 100)}%" style="height:${Math.max(2, Math.round(p * 40))}px;opacity:${p > 0.005 ? 1 : 0.25}"></i>`).join('')}</div>` : '');
  const body = rows.map((r) => `<tr class="${r.r1 && r.r1.owner === m.me ? 'me' : ''}">
      <td class="num"><b>${r.proj ? `1.${String(r.proj).padStart(2, '0')}` : '—'}</b></td>
      <td><div class="who">${teamAvatar(r.t)}${tlink(r.t.rid)}</div></td>
      <td class="num">${r.t.w}-${r.t.l}</td>
      <td class="num">${r.t.maxPfProj ? Math.round(r.t.maxPfProj) : '—'}</td>
      <td class="num">${pct(r.t.playoffOdds)}</td>
      ${method === 'standings' ? `<td class="num">${r.exp ? r.exp.toFixed(1) : '—'}</td><td class="num">${r.first != null ? pct(r.first) : '—'}</td><td class="num">${r.top3 != null ? pct(r.top3) : '—'}</td><td>${dist(r.slotOdds)}</td>` : ''}
      <td>${ownerCell(r.r1)}</td><td>${ownerCell(r.r2)}</td>
    </tr>`).join('');
  const how = method === 'standings' ? 'Order by projected final standings, worst first (from the same 3,000 simulated seasons)' : method === 'maxpf' ? 'Non-playoff teams by projected max PF, lowest first, then playoff teams by projected finish' : 'Every team by projected max PF, lowest first';
  return `<div class="card" style="margin-top:16px"><div class="sec-h"><h3 style="margin:0">${y} draft pick projections</h3><a class="link small" href="#settings">Draft order rule: change in Settings</a></div>
    <p class="lede">${esc(how)}. The 1st and 2nd columns show who owns each team's pick and its value now.</p>
    <div class="scroll"><table class="t season"><thead><tr><th class="num">Proj. pick</th><th>Original team</th><th class="num">Record</th><th class="num">Proj. max PF</th><th class="num">Playoffs</th>${method === 'standings' ? '<th class="num">Avg pick</th><th class="num">1.01 odds</th><th class="num">Top 3</th><th>Pick range</th>' : ''}<th>1st owned by</th><th>2nd owned by</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}

// ---- manager summary table ----------------------------------------------------------------

function summaryRows() {
  const m = S.model;
  const lt = {};
  for (const nt of m.leagueTrades) for (const r of nt.rids) lt[r] = (lt[r] || 0) + 1;
  const ht = {};
  for (const nt of m.histTrades) for (const r of nt.rids) ht[r] = (ht[r] || 0) + 1;
  // Net value per manager: what he received minus what he gave, at the time and today.
  const net = {};
  const addNet = (list, key) => {
    for (const nt of list) for (const r of nt.rids) {
      const x = (net[r] ||= { curThen: 0, curNow: 0, oldThen: 0, oldNow: 0, curPts: 0, oldPts: 0 });
      if (nt.pts && nt.pts[r]) x[key + 'Pts'] += nt.pts[r].net;
      const d = nt.deal && nt.deal[r], n = nt.now && nt.now[r];
      if (d) x[key + 'Then'] += d.got - d.gave;
      if (n) x[key + 'Now'] += n.got - n.gave;
    }
  };
  addNet(m.leagueTrades, 'cur');
  addNet(m.histTrades, 'old');
  return m.teams.map((t) => {
    const d = t.dealings;
    const ex = t.elsewhere;
    return {
      t, rid: t.rid, name: t.name, isMe: t.isMe,
      posture: t.posture.score, record: t.w - t.l + t.pf / 10000, odds: t.playoffOdds ?? -1, value: t.totalValue,
      hisSent: d ? d.recv + (d.done - d.doneMine) : null,
      mySent: d ? d.sent + d.doneMine : null,
      hisRej: d ? d.hisRejects : null,
      myRej: d ? d.myRejects : null,
      done: d ? d.done : null,
      ask: d && d.avgAsk != null ? d.avgAsk : null,
      resp: d ? d.hisResponse : null, myResp: d ? d.myResponse : null,
      ease: d && d.touches >= 2 ? d.ease : null,
      rising: t.phase ? t.phase.share.rising : 0, peak: t.phase ? t.phase.share.peak : 0, declining: t.phase ? t.phase.share.declining : 0, picks: t.phase ? t.phase.share.picks : 0,
      age: t.trueAge || 0,
      leagues: ex ? ex.leagues : null,
      exTrades: ex ? ex.trades : null,
      trades: lt[t.rid] || 0,
      curThen: net[t.rid] ? net[t.rid].curThen : 0, curNow: net[t.rid] ? net[t.rid].curNow : 0,
      oldThen: net[t.rid] ? net[t.rid].oldThen : 0, oldNow: net[t.rid] ? net[t.rid].oldNow : 0,
      allNow: net[t.rid] ? net[t.rid].curNow + net[t.rid].oldNow : 0,
      allThen: net[t.rid] ? net[t.rid].curThen + net[t.rid].oldThen : 0,
      allTrades: (lt[t.rid] || 0) + (ht[t.rid] || 0),
      curPts: net[t.rid] ? net[t.rid].curPts : 0, oldPts: net[t.rid] ? net[t.rid].oldPts : 0,
      allPts: net[t.rid] ? net[t.rid].curPts + net[t.rid].oldPts : 0,
      allThen: net[t.rid] ? net[t.rid].curThen + net[t.rid].oldThen : 0,
      histTrades: ht[t.rid] || 0,
    };
  });
}


// ---- value over time -------------------------------------------------------------------------

const VOT_COLORS = ['#f2b632', '#9d4dff', '#2fc66b', '#4ea1ff', '#f05a5a', '#f2a541', '#ff7ac6', '#2ec4c4', '#b9d65a', '#c08cff', '#ff9f6b', '#8fa3bf', '#e85d9c', '#6be3b8'];

function viewValueTime() {
  const m = S.model;
  const VT = m.valueTime;
  if (!VT || !VT.windows) return `<div class="card"><h3>Value over time</h3><p class="muted">${esc((S.book && S.book.status && S.book.status.vot && S.book.status.vot.error) || 'Weekly values since the rookie draft load during a sync. Click Sync now.')}</p></div>`;
  const ui = (S.ui.vot ||= { hi: null, pos: { QB: true, RB: true, WR: true, TE: true, Picks: true }, when: 'end', sort: 'end', from: 'startup', detail: null });
  const W3 = VT.windows;
  const from = W3[ui.from] ? ui.from : W3.startup ? 'startup' : W3.season ? 'season' : 'draft';
  const V = W3[from];
  const V0 = W3.draft;
  const fromSeason = from !== 'draft';
  const dstr = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const dstrY = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const startName = from === 'startup' ? 'Startup draft' : from === 'season' ? 'Season start' : 'Draft day';
  const teamsSorted = [...m.teams].sort((a, b) => V.rows[b.rid].end - V.rows[a.rid].end);
  const color = Object.fromEntries([...m.teams].sort((a, b) => a.rid - b.rid).map((t, i) => [t.rid, t.isMe ? '#f2b632' : VOT_COLORS[(i % (VOT_COLORS.length - 1)) + 1]]));
  const sgnK = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${k(Math.abs(v))}`;
  const cls = (v) => (v > 250 ? 'up' : v < -250 ? 'down' : '');

  // -- line chart, with each team's logo and name at the end of its line
  const W = 1000, H = Math.max(360, 60 + m.teams.length * 26), L = 54, R = 178, T = 16, B = 30;
  const all = Object.values(V.series).flat();
  const t0 = V.start, t1 = V.now;
  const vmax = Math.max(...all.map((p) => p.v)), vmin = Math.min(...all.map((p) => p.v));
  const padV = (vmax - vmin) * 0.06 || vmax * 0.05;
  const lo = Math.max(0, vmin - padV), hi = vmax + padV;
  const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const gy = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  const months = [];
  for (let d = new Date(t0); d.getTime() <= t1; d.setMonth(d.getMonth() + 1, 1)) months.push(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
  const grid = gy.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="vg"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" class="vt">${k(v)}</text>`).join('')
    + months.filter((ts) => ts >= t0).map((ts) => `<text x="${X(ts)}" y="${H - 8}" text-anchor="middle" class="vt">${esc(new Date(ts).getMonth() === 0 ? String(new Date(ts).getFullYear()) : new Date(ts).toLocaleDateString(undefined, { month: 'short' }))}</text>`).join('')
    + (fromSeason ? `<line x1="${X(V0.start)}" x2="${X(V0.start)}" y1="${T}" y2="${H - B}" class="vdraft"/><text x="${X(V0.start) + 4}" y="${T + 10}" class="vt">${new Date(V0.start).getFullYear()} rookie draft</text>` : '');
  const sel = (ui.sel ||= []).filter((r) => team(r));
  const strong = (t) => (sel.length ? sel.includes(t.rid) : t.isMe);
  const lines = [...m.teams].sort((a, b) => strong(a) - strong(b)).map((t) => {
    const pts = V.series[t.rid];
    const dim = sel.length > 0 && !sel.includes(t.rid);
    const st = strong(t);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.at).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
    return `<g class="vline${dim ? ' dim' : ''}" data-action="votHi" data-rid="${t.rid}"><path d="${d}" stroke="${color[t.rid]}" stroke-width="${st ? 3.5 : 2}" fill="none"/>${pts.map((p) => `<circle cx="${X(p.at).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${st ? 3.2 : 2}" fill="${color[t.rid]}"><title>${esc(t.name)} · ${esc(p.today ? 'today' : new Date(p.at).toLocaleDateString())}: ${k(p.v)}</title></circle>`).join('')}</g>`;
  }).join('');
  // End labels: logo + name, nudged apart so they never overlap.
  const ends = m.teams.map((t) => { const last = V.series[t.rid][V.series[t.rid].length - 1]; return { t, y: Y(last.v), ly: Y(last.v), x: X(last.at) }; }).sort((a, b) => a.y - b.y);
  const GAP = 24;
  const top = T + 10, bot = H - B - 4, gapN = Math.min(GAP, (bot - top) / Math.max(1, ends.length - 1));
  for (let i = 0; i < ends.length; i++) ends[i].ly = Math.max(ends[i].ly, i ? ends[i - 1].ly + gapN : top);
  for (let i = ends.length - 1; i >= 0; i--) ends[i].ly = Math.min(ends[i].ly, i < ends.length - 1 ? ends[i + 1].ly - gapN : bot);
  const lx = W - R + 22;
  const labels = ends.map(({ t, y, ly, x }) => {
    const dim = sel.length > 0 && !sel.includes(t.rid);
    const url = avatarUrl(t);
    const ini = `<circle cx="${lx + 10}" cy="${ly}" r="10" fill="${color[t.rid]}"/><text x="${lx + 10}" y="${ly + 4}" text-anchor="middle" class="vini">${esc((t.name || '?')[0].toUpperCase())}</text>`;
    const logo = ini + (url ? `<image href="${esc(url)}" x="${lx}" y="${ly - 10}" width="20" height="20" clip-path="url(#vclip)" preserveAspectRatio="xMidYMid slice"/>` : '');
    return `<g class="vend${dim ? ' dim' : ''}" data-action="votHi" data-rid="${t.rid}"><path d="M${x + 3},${y} L${lx - 6},${ly}" stroke="${color[t.rid]}" stroke-width="1.2" fill="none" opacity=".7"/><circle cx="${lx + 10}" cy="${ly}" r="11.5" fill="none" stroke="${color[t.rid]}" stroke-width="2"/>${logo}<text x="${lx + 28}" y="${ly + 4}" class="vlab${strong(t) ? ' on' : ''}">${esc(t.name.length > 13 ? t.name.slice(0, 12) + '…' : t.name)}</text></g>`;
  }).join('');
  const defs = '<defs><clipPath id="vclip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs>';
  const fromSeg = Object.keys(W3).length > 1 ? `<span class="tseg2">${[['startup', 'Since the startup draft'], ['season', 'This season'], ['draft', 'Since this year\'s rookie draft']].filter(([k2]) => W3[k2]).map(([k2, l]) => `<button class="${from === k2 ? 'on' : ''}" data-action="votFrom" data-from="${k2}" title="From ${esc(dstrY(W3[k2].start))}">${l}</button>`).join('')}</span>` : '';
  const weeklyTot = m.teams.reduce((s2, t) => s2 + (V.rows[t.rid].weeklyNow || 0), 0), endTot = m.teams.reduce((s2, t) => s2 + V.rows[t.rid].end, 0);
  const gap = endTot ? weeklyTot / endTot - 1 : 0;
  const chart = `<div class="card"><div class="sec-h"><h3 style="margin:0">Team value, week by week</h3><span class="row" style="gap:8px">${fromSeg}<button class="btn sm primary" data-action="exportVot">${icon('download')}Export PNG${sel.length ? ` · ${sel.length} team${sel.length === 1 ? '' : 's'}` : ' · league'}</button></span></div>
    <div class="row small muted" style="margin:6px 0 0;gap:8px">${sel.length ? `Showing ${sel.map((r) => esc(tname(r))).join(', ')}. <button class="link" data-action="votHi" data-rid="">Show the whole league</button>` : 'Click teams on the chart or in the table to pick them out; the export then shows just those teams.'}</div>
    <svg class="votchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Each team's value by week">${defs}${grid}${lines}${labels}</svg>
    <p class="faint small" style="margin:6px 0 0">Each week values that week's roster with that week's DynastyProcess values, put on the dashboard's scale by rank (the Nth most valuable asset that week gets the value of today's Nth most valuable asset). The last point is today's dashboard value.${V.endSource === 'book' ? '' : ' Today\'s values didn\'t load, so the last point uses the latest weekly values.'}${Math.abs(gap) > 0.04 && V.endSource === 'book' ? ` Heads up: the latest weekly values put the league ${Math.abs(Math.round(gap * 100))}% ${gap > 0 ? 'above' : 'below'} today's dashboard values, so the last step of every line includes that difference.` : ''} </p></div>`;

  // -- bridge table
  const bridgeCols = [
    ['start', startName, from === 'startup' ? 'Rosters and picks right after the league\'s startup draft' : from === 'season' ? 'Roster and picks at the start of the league season' : 'Roster and picks just after this season\'s rookie draft'],
    ['trades', 'Trades', 'Value received minus value given, each trade valued the week it happened'],
    ...(fromSeason ? [['draft', 'Rookie drafts', 'Players drafted minus the value of the picks used, the week of each draft']] : []),
    ...(m.teams.some((t) => V.rows[t.rid].newPickCount) ? [['newPicks', 'New pick year', 'After each rookie draft, the picks two drafts out start counting (the same two years of picks as today\'s values)']] : []),
    ['added', 'Waivers added', 'Players added off waivers or free agency, valued that week'],
    ['lost', 'Value lost', 'Players dropped or released, valued that week'],
    ['residual', 'Appreciation', 'What\'s left: players and picks gaining or losing value while held'],
    ['end', 'Today', 'Today\'s dynasty value, the same as the rest of the dashboard'],
    ['change', 'Change', `Today minus ${startName.toLowerCase()}`],
  ];
  const sortKey = bridgeCols.some(([key]) => key === ui.sort) ? ui.sort : 'end';
  const rows = [...m.teams].sort((a, b) => { const x = V.rows[a.rid][sortKey], y = V.rows[b.rid][sortKey]; return sortKey === 'lost' ? x - y : y - x; });
  const tot = (key) => m.teams.reduce((s2, t) => s2 + V.rows[t.rid][key], 0);
  const tc = VT.tradeCounts || { cur: {}, old: {} };
  const allOf = (rid) => (from === 'startup' ? (tc.cur[rid] || 0) + (tc.old[rid] || 0) : tc.cur[rid] || 0);
  const go = (key, rid, inner) => (rid == null ? inner : `<button class="cell-link" data-action="votDetail" data-rid="${rid}" data-kind="${key === 'added' || key === 'lost' ? 'waivers' : key === 'residual' ? 'appr' : key}" title="Show every trade or player behind this number">${inner}</button>`);
  const cell = (key, v, r, t) => {
    if (key === 'start' || key === 'end') return `<td class="num"><b>${k(v)}</b></td>`;
    const rid = t ? t.rid : null;
    if (key === 'lost') return `<td class="num ${v > 250 ? 'down' : ''}">${go(key, rid, `${v ? `−${k(v)}` : '<span class="faint">0</span>'}${r && r.lostCount ? `<div class="faint small">${r.lostCount} player${r.lostCount === 1 ? '' : 's'}</div>` : ''}`)}</td>`;
    if (key === 'added') return `<td class="num ${cls(v)}">${go(key, rid, `${v ? `+${k(v)}` : '<span class="faint">0</span>'}${r && r.addCount ? `<div class="faint small">${r.addCount} add${r.addCount === 1 ? '' : 's'}</div>` : ''}`)}</td>`;
    if (key === 'newPicks') return `<td class="num ${cls(v)}">${go('draft', rid, `${r && !r.newPickCount ? '<span class="faint">—</span>' : sgnK(v)}${r && r.newPickCount ? `<div class="faint small">${r.newPickCount} picks</div>` : ''}`)}</td>`;
    if (key === 'draft') return `<td class="num ${cls(v)}">${go(key, rid, `${r && !r.draftCount ? '<span class="faint">—</span>' : sgnK(v)}${r && r.draftCount ? `<div class="faint small">${r.draftCount} pick${r.draftCount === 1 ? '' : 's'}</div>` : ''}`)}</td>`;
    if (key === 'trades') {
      const all2 = rid != null ? allOf(rid) : 0;
      return `<td class="num ${cls(v)}">${go(key, rid, `${r && !r.tradeCount ? '<span class="faint">—</span>' : sgnK(v)}${r ? `<div class="faint small">${r.tradeCount} trade${r.tradeCount === 1 ? '' : 's'}${all2 > r.tradeCount ? ` of ${all2}` : ''}</div>` : ''}`)}</td>`;
    }
    if (key === 'residual') return `<td class="num ${cls(v)}">${go(key, rid, `<b>${sgnK(v)}</b>`)}</td>`;
    return `<td class="num ${cls(v)}"><b>${sgnK(v)}</b>${key === 'change' && r && r.start ? `<div class="faint small">${v >= 0 ? '+' : ''}${Math.round((v / r.start) * 100)}%</div>` : ''}</td>`;
  };
  const anyEarlier = m.teams.some((t) => allOf(t.rid) > V.rows[t.rid].tradeCount);
  const bridge = `<div class="card" style="margin-top:14px"><h3>Where each team's value came from</h3>
    <div class="scroll"><table class="t vot"><thead><tr><th>Team</th>${bridgeCols.map(([key, l, tip]) => `<th class="num sortable${sortKey === key ? ' on' : ''}" data-action="votSort" data-key="${key}" title="${esc(tip)}">${l}${sortKey === key ? ' ↓' : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((t) => { const r = V.rows[t.rid]; return `<tr class="${t.isMe ? 'me' : ''}${sel.includes(t.rid) ? ' hl' : ''}"><td><div class="who"><button class="vdot-btn" data-action="votHi" data-rid="${t.rid}" title="Pick out this team"><i class="vdot" style="background:${color[t.rid]}"></i></button>${teamAvatar(t)}${tlink(t.rid)}</div></td>${bridgeCols.map(([key]) => cell(key, r[key], r, t)).join('')}</tr>`; }).join('')}
      <tr class="tot"><td><b>League</b></td>${bridgeCols.map(([key]) => cell(key, tot(key))).join('')}</tr></tbody></table></div>
    <div class="faint small" style="margin:8px 0 0;display:grid;gap:4px">
      <div>${startName} + Trades${fromSeason ? ' + Rookie drafts + New pick year' : ''} + Waivers added − Value lost + Appreciation = Today. Like today's values, a team's value counts picks for the next two rookie drafts only; when a draft is done, the year after next starts counting ("New pick year").</div>
      <div><b>Trades</b> are Trade summary's "Net then" figures${from === 'startup' ? ', this season plus earlier seasons' : ' for this season'}: what each trade was worth the week it happened, with KTC's package adjustment. Click one to see each trade next to Trade summary's figures.${anyEarlier ? ` "3 of 8" means 3 of the team's 8 trades${from === 'startup' ? '' : ' this season'} fall inside this window.` : ''} Anything a traded-for player gained or lost since shows up in Appreciation.</div>
      <div><b>Waivers added</b> and <b>Value lost</b> are what players were worth the week they were added or dropped. <b>Appreciation</b> is every asset's change while the team held it. Click any of those numbers for the player-by-player list.</div>
      ${Object.keys(V.mismatch).length ? `<div>Some moves are missing from Sleeper's list for ${Object.keys(V.mismatch).map((rid) => esc(tname(Number(rid)))).join(', ')}, so their Appreciation also carries those players.</div>` : ''}
    </div></div>`;

  // -- value by position
  const POS = ['QB', 'RB', 'WR', 'TE', 'Picks'];
  const posColor = { QB: 'var(--pos-qb, #e2557a)', RB: 'var(--pos-rb, #2fc66b)', WR: 'var(--pos-wr, #4ea1ff)', TE: 'var(--pos-te, #f2a541)', Picks: 'var(--faint)' };
  const posOf = (t) => V.rows[t.rid][ui.when === 'start' ? 'startByPos' : 'endByPos'] || {};
  const on = POS.filter((p) => ui.pos[p]);
  const totalOn = (t) => on.reduce((s2, p) => s2 + (posOf(t)[p] || 0), 0);
  const byTot = [...m.teams].sort((a, b) => totalOn(b) - totalOn(a));
  const maxTot = Math.max(1, ...byTot.map(totalOn));
  const rank = (t, p) => 1 + m.teams.filter((o) => (posOf(o)[p] || 0) > (posOf(t)[p] || 0)).length;
  const bars = byTot.map((t) => `<div class="pbar-row${t.isMe ? ' me' : ''}"><div class="pbar-name">${teamAvatar(t)}<span>${esc(t.name)}</span></div><div class="pbar">${on.map((p) => { const v = posOf(t)[p] || 0; return v ? `<i style="width:${((v / maxTot) * 100).toFixed(2)}%;background:${posColor[p]}" title="${esc(t.name)} ${p}: ${k(v)}"></i>` : ''; }).join('')}</div><div class="pbar-tot">${k(totalOn(t))}</div></div>`).join('');
  const toggles = `<div class="row" style="gap:6px;flex-wrap:wrap">${POS.map((p) => `<button class="chip-t${ui.pos[p] ? ' on' : ''}" data-action="votPos" data-pos="${p}"><i style="background:${posColor[p]}"></i>${p}</button>`).join('')}
    <span style="flex:1"></span><span class="tseg2"><button class="${ui.when === 'start' ? 'on' : ''}" data-action="votWhen" data-when="start">${startName}</button><button class="${ui.when === 'end' ? 'on' : ''}" data-action="votWhen" data-when="end">Today</button></span></div>`;
  const posTable = `<div class="scroll" style="margin-top:14px"><table class="t"><thead><tr><th>Team</th>${POS.map((p) => `<th class="num">${p}</th>`).join('')}<th class="num">Total</th><th class="num">vs ${esc(startName.toLowerCase())}</th></tr></thead><tbody>
    ${byTot.map((t) => { const pv = posOf(t); const total = POS.reduce((s2, p) => s2 + (pv[p] || 0), 0); const other = V.rows[t.rid][ui.when === 'start' ? 'endByPos' : 'startByPos'] || {}; const otherTot = POS.reduce((s2, p) => s2 + (other[p] || 0), 0); const diff = ui.when === 'end' ? total - otherTot : otherTot - total;
      return `<tr class="${t.isMe ? 'me' : ''}"><td><div class="who">${teamAvatar(t)}${tlink(t.rid)}</div></td>${POS.map((p) => `<td class="num${ui.pos[p] ? '' : ' faint'}">${k(pv[p] || 0)}<div class="faint small">${ordinal(rank(t, p))}</div></td>`).join('')}<td class="num"><b>${k(total)}</b></td><td class="num ${cls(diff)}">${sgnK(diff)}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  const posCard = `<div class="sec-h" style="margin-top:22px"><h2>Value by position</h2><span class="muted small">${ui.when === 'start' ? (fromSeason ? 'Rosters at the start of the season' : 'Rosters just after the rookie draft') : 'Today'}</span></div>
    <div class="card">${toggles}<div class="pbars" style="margin-top:14px">${bars}</div>${posTable}
    <p class="faint small" style="margin:8px 0 0">Kickers and defenses aren't counted. Small numbers are each team's league rank at that position.</p></div>`;

  return `<div class="sec-h"><h2>Value over time</h2><span class="row" style="gap:10px">${ktcSourceSeg()}</span></div><div class="row" style="margin:-6px 0 12px"><span class="muted small">${from === 'startup' ? `From the startup draft (${esc(dstrY(V.start))}) to today` : from === 'season' ? `From the start of the league season (${esc(dstrY(V.start))}) to today` : `From this season's rookie draft (${esc(dstrY(V.start))}) to today`}</span></div>${chart}${bridge}${posCard}`;
}

// ---- team ledger: one team's full accounting, from Value over time -------------------------

function viewLedger(ridArg) {
  const m = S.model;
  const VT = m.valueTime;
  if (!VT || !VT.windows) return `<div class="card"><h3>Team ledger</h3><p class="muted">Weekly values load during a sync. Click Sync now.</p></div>`;
  const ui = (S.ui.vot ||= { hi: null, pos: { QB: true, RB: true, WR: true, TE: true, Picks: true }, when: 'end', sort: 'end', from: 'startup', detail: null });
  const W3 = VT.windows;
  const from = W3[ui.from] ? ui.from : W3.startup ? 'startup' : W3.season ? 'season' : 'draft';
  const V = W3[from];
  const fromSeason = from !== 'draft';
  const dstrY = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const startName = from === 'startup' ? 'Startup draft' : from === 'season' ? 'Season start' : 'Draft day';
  const sgnK = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${k(Math.abs(v))}`;
  const cls = (v) => (v > 250 ? 'up' : v < -250 ? 'down' : '');
  const rid0 = Number(ridArg) || (ui.detail && ui.detail.rid) || m.me;
  const detail = { rid: team(rid0) ? rid0 : m.me, kind: 'trades' };
  ui.detail = { rid: detail.rid, kind: (ui.detail && ui.detail.kind) || 'trades' };
  const L2 = V.ledger[detail.rid];
  const r = V.rows[detail.rid];
  const t = team(detail.rid);
    const nameOfKey = (key) => {
      if (key.startsWith('p:')) return playerLink(key.slice(2), P(key.slice(2)).name);
      const [, y, rd, orig] = key.split(':');
      return esc(`${y} ${roundName(Number(rd))} (${tname(Number(orig))})`);
    };
    const nowOf = (key) => (key.startsWith('p:') ? (pval(key.slice(2)).v || 0) : null);
    const dd = (ts) => esc(dstrY(ts));
    const tabs = [['trades', 'Trades'], ['waivers', 'Waivers'], ...(fromSeason ? [['draft', 'Rookie drafts']] : []), ['appr', 'Appreciation']];
  const totals = { trades: r.trades, waivers: r.added - r.lost, draft: r.draft + r.newPicks, appr: r.residual };
  const sections = tabs.map(([kind, label]) => {
    detail.kind = kind;
    let body = '';
    if (detail.kind === 'trades') {
      const byId = new Map([...m.leagueTrades.map((nt) => [nt.id, { nt, src: 'cur' }]), ...m.histTrades.map((nt) => [nt.id, { nt, src: 'old' }])]);
      const inWin = new Set(L2.trades.map((x) => x.id));
      const mine = [...byId.values()].filter(({ nt }) => nt.rids.includes(detail.rid)).sort((a, b) => (b.nt.created || 0) - (a.nt.created || 0));
      const netOf = (g) => (g && g[detail.rid] ? g[detail.rid].got - g[detail.rid].gave : null);
      const list = (keys) => keys.map((x) => nameOfKey(x.key)).join(', ') || '—';
      const sumBy = (src, f) => mine.filter((x) => x.src === src).reduce((a, x) => a + (f(x.nt) || 0), 0);
      const winTot = L2.trades.reduce((a, x) => a + x.net, 0);
      body = `<div class="scroll"><table class="t"><thead><tr><th>Date</th><th>Season</th><th>With</th><th>Got</th><th>Gave</th><th class="num">Net then</th><th class="num">Net now</th></tr></thead><tbody>${mine.map(({ nt, src }) => { const l = L2.trades.find((x) => x.id === nt.id); const sd = nt.sides[detail.rid]; return `<tr class="${inWin.has(nt.id) ? '' : 'faint'}"><td class="muted">${nt.created ? dd(nt.created) : '—'}</td><td class="muted small">${src === 'cur' ? 'This season' : 'Earlier'}${inWin.has(nt.id) ? '' : '<br>before this window'}</td><td>${nt.rids.filter((x) => x !== detail.rid).map((x) => esc(tname(x))).join(', ')}</td><td class="small">${l ? list(l.inn) : list([...sd.inP.map((x) => ({ key: `p:${x}` })), ...sd.inK.map((x) => ({ key: x.key }))])}</td><td class="small">${l ? list(l.out) : list([...sd.outP.map((x) => ({ key: `p:${x}` })), ...sd.outK.map((x) => ({ key: x.key }))])}</td><td class="num ${cls(netOf(nt.deal) || 0)}">${netOf(nt.deal) == null ? '—' : sgnK(netOf(nt.deal))}</td><td class="num muted">${netOf(nt.now) == null ? '—' : sgnK(netOf(nt.now))}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">No trades.</td></tr>'}
        <tr class="tot"><td colspan="5">This season: ${mine.filter((x) => x.src === 'cur').length} trades (Trade summary, "This season")</td><td class="num">${sgnK(sumBy('cur', (nt) => netOf(nt.deal)))}</td><td class="num muted">${sgnK(sumBy('cur', (nt) => netOf(nt.now)))}</td></tr>
        <tr class="tot"><td colspan="5">Earlier seasons: ${mine.filter((x) => x.src === 'old').length} trades (Trade summary, "Earlier seasons")</td><td class="num">${sgnK(sumBy('old', (nt) => netOf(nt.deal)))}</td><td class="num muted">${sgnK(sumBy('old', (nt) => netOf(nt.now)))}</td></tr>
        <tr class="tot"><td colspan="5"><b>In this window: ${L2.trades.length} trades</b> (the Trades column)</td><td class="num"><b>${sgnK(winTot)}</b></td><td class="num"><b>${sgnK(L2.trades.reduce((a, x) => { const e = byId.get(x.id); return a + ((e && netOf(e.nt.now)) || 0); }, 0))}</b></td></tr></tbody></table></div>
        ${(m.supersededTrades || []).filter((x) => x.rids.includes(detail.rid)).map((x) => `<p class="faint small" style="margin:6px 0 0">Not counted: the ${esc(dstrY(x.created))} trade with ${x.rids.filter((q) => q !== detail.rid).map((q) => esc(tname(q))).join(', ')} was made again with exactly the same players and picks on ${esc(dstrY(x.byCreated))}, so it was reversed in between; only the later one counts.</p>`).join('')}
        <p class="faint small" style="margin:8px 0 0">"Net then" is the trade valued the week it happened (Trade summary's "Net then"); that's what the Trades column adds up. "Net now" is the same assets at today's values. The gap between them is how those players and picks have moved since the trade, and it's counted in Appreciation. <button class="link" data-action="votTrades" data-rid="${detail.rid}">Open Trade summary</button></p>`;
    } else if (detail.kind === 'waivers') {
      const ev = [...L2.adds.map((x) => ({ ...x, kind: 'Added' })), ...L2.drops.map((x) => ({ ...x, kind: 'Dropped' }))].sort((a, b) => b.at - a.at);
      body = `<div class="scroll"><table class="t"><thead><tr><th>Date</th><th>Move</th><th>Player</th><th class="num">Value that week</th><th class="num">Value today</th></tr></thead><tbody>${ev.map((x) => `<tr><td class="muted">${dd(x.at)}</td><td><span class="pill ${x.kind === 'Added' ? 'good' : 'sell'}">${x.kind}</span></td><td>${nameOfKey(x.key)} ${posTag(P(x.key.slice(2)).pos)}</td><td class="num ${x.kind === 'Added' ? 'up' : 'down'}">${x.kind === 'Added' ? '+' : '−'}${k(x.v)}</td><td class="num muted">${k(nowOf(x.key) || 0)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No waiver moves in this window.</td></tr>'}
        <tr class="tot"><td colspan="3"><b>Waivers added</b> · ${L2.adds.length} adds</td><td class="num up"><b>+${k(r.added)}</b></td><td></td></tr>
        <tr class="tot"><td colspan="3"><b>Value lost</b> · ${r.lostCount} drops (including players released in trades)</td><td class="num down"><b>−${k(r.lost)}</b></td><td></td></tr></tbody></table></div>`;
    } else if (detail.kind === 'draft') {
      body = `<div class="scroll"><table class="t"><thead><tr><th>Draft</th><th>Pick used</th><th>Player taken</th><th class="num">Pick value</th><th class="num">Player value then</th><th class="num">Gain</th><th class="num">Player today</th></tr></thead><tbody>${L2.draft.sort((a, b) => a.at - b.at).map((x) => `<tr><td class="muted">${new Date(x.at).getFullYear()}</td><td>${x.pick ? nameOfKey(x.pick) : '—'}</td><td>${nameOfKey(x.key)} ${posTag(P(x.key.slice(2)).pos)}</td><td class="num">${k(x.vPick)}</td><td class="num">${k(x.v)}</td><td class="num ${cls(x.v - x.vPick)}">${sgnK(x.v - x.vPick)}</td><td class="num muted">${k(nowOf(x.key) || 0)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No rookie draft picks in this window.</td></tr>'}
        <tr class="tot"><td colspan="5"><b>Rookie drafts</b></td><td class="num"><b>${sgnK(r.draft)}</b></td><td></td></tr></tbody></table></div>
        ${L2.newPicks.length ? `<h4 style="margin:16px 0 6px">New pick year</h4><div class="scroll"><table class="t"><thead><tr><th>When it started counting</th><th>Pick</th><th class="num">Value then</th></tr></thead><tbody>${L2.newPicks.map((x) => `<tr><td class="muted">${dd(x.at)}</td><td>${nameOfKey(x.key)}</td><td class="num">${k(x.v)}</td></tr>`).join('')}<tr class="tot"><td colspan="2"><b>New pick year</b></td><td class="num"><b>${sgnK(r.newPicks)}</b></td></tr></tbody></table></div>` : ''}`;
    } else {
      const how = { start: startName.toLowerCase(), trade: 'trade', draft: 'drafted', move: 'waivers' };
      const out = { held: 'still held', trade: 'traded away', move: 'dropped', draft: 'used in draft' };
      const rowsA = [...L2.held].filter((x) => Math.abs(x.vOut - x.vIn) >= 1).sort((a, b) => (b.vOut - b.vIn) - (a.vOut - a.vIn));
      body = `<div class="scroll" style="max-height:520px"><table class="t"><thead><tr><th>Asset</th><th>Came from</th><th>Held</th><th class="num">Value in</th><th class="num">Value out / today</th><th class="num">Change</th></tr></thead><tbody>${rowsA.map((x) => `<tr><td>${nameOfKey(x.key)}${x.key.startsWith('p:') ? ` ${posTag(P(x.key.slice(2)).pos)}` : ''}</td><td class="muted small">${esc(how[x.how] || x.how)}</td><td class="muted small">${dd(x.from)} → ${x.out === 'held' ? 'today' : `${dd(x.to)}, ${esc(out[x.out] || x.out)}`}</td><td class="num">${k(x.vIn)}</td><td class="num">${k(x.vOut)}</td><td class="num ${cls(x.vOut - x.vIn)}">${sgnK(x.vOut - x.vIn)}</td></tr>`).join('')}
        <tr class="tot"><td colspan="5"><b>Players and picks</b> (${rowsA.length} that changed value)</td><td class="num"><b>${sgnK(r.assetAppr)}</b></td></tr>
        ${Math.abs(r.pkgAdj) >= 1 ? `<tr class="tot"><td colspan="5">Trade pricing: Trade summary's package adjustment and recent-trade KTC prices, compared with each player's own value</td><td class="num">${sgnK(r.pkgAdj)}</td></tr>` : ''}
        ${Math.abs(r.other) >= 1 ? `<tr class="tot"><td colspan="5">Today's dashboard total vs the sum of each asset's value (projected pick slots, players without a value)</td><td class="num">${sgnK(r.other)}</td></tr>` : ''}
        <tr class="tot"><td colspan="5"><b>Appreciation</b></td><td class="num"><b>${sgnK(r.residual)}</b></td></tr></tbody></table></div>`;
    }
    return `<div class="card ledger-sec" id="ledger-${kind}" style="margin-top:14px"><div class="sec-h"><h3 style="margin:0">${label}</h3><b class="${cls(totals[kind])}" style="font-size:18px">${sgnK(totals[kind])}</b></div>${body}</div>`;
  });

  // team chart: this team's value week by week, with the league average for scale
  const pts = V.series[detail.rid];
  const avg = pts.map((p, i) => ({ at: p.at, v: m.teams.reduce((a, tt) => a + ((V.series[tt.rid][i] || {}).v || 0), 0) / m.teams.length }));
  const CW = 1000, CH = 260, CL = 56, CR = 120, CT = 14, CB = 28;
  const vals = [...pts, ...avg].map((p) => p.v);
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals), pd = (hi0 - lo0) * 0.08 || hi0 * 0.05 || 1;
  const lo = Math.max(0, lo0 - pd), hi = hi0 + pd;
  const X = (ts) => CL + ((ts - V.start) / Math.max(1, V.now - V.start)) * (CW - CL - CR);
  const Y = (v) => CT + (1 - (v - lo) / Math.max(1, hi - lo)) * (CH - CT - CB);
  const path = (arr) => arr.map((p, i) => `${i ? 'L' : 'M'}${X(p.at).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const months = [];
  for (let d = new Date(V.start); d.getTime() <= V.now; d.setMonth(d.getMonth() + 1, 1)) months.push(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
  const every = Math.max(1, Math.ceil(months.length / 12));
  const last = pts[pts.length - 1], lastA = avg[avg.length - 1];
  const svg = `<svg class="votchart" viewBox="0 0 ${CW} ${CH}" role="img" aria-label="${esc(t.name)} value by week">
    ${[0, 0.5, 1].map((f) => { const v = lo + f * (hi - lo); return `<line x1="${CL}" x2="${CW - CR}" y1="${Y(v)}" y2="${Y(v)}" class="vg"/><text x="${CL - 8}" y="${Y(v) + 4}" text-anchor="end" class="vt">${k(v)}</text>`; }).join('')}
    ${months.filter((ts, i) => ts >= V.start && i % every === 0).map((ts) => `<text x="${X(ts)}" y="${CH - 6}" text-anchor="middle" class="vt">${esc(new Date(ts).getMonth() === 0 ? String(new Date(ts).getFullYear()) : new Date(ts).toLocaleDateString(undefined, { month: 'short' }))}</text>`).join('')}
    <path d="${path(avg)}" fill="none" stroke="var(--faint)" stroke-width="2" stroke-dasharray="6 5"/>
    <path d="${path(pts)}" fill="none" stroke="#f2b632" stroke-width="3.5"/>
    ${pts.map((p) => `<circle cx="${X(p.at).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="2.6" fill="#f2b632"><title>${esc(new Date(p.at).toLocaleDateString())}: ${k(p.v)}</title></circle>`).join('')}
    <text x="${X(last.at) + 8}" y="${Y(last.v) + 4}" class="vlab on">${k(last.v)}</text>
    <text x="${X(lastA.at) + 8}" y="${Y(lastA.v) + 4}" class="vt">League avg ${k(lastA.v)}</text></svg>`;

  const step = (label, text, c2, sub, edge) => `<div class="lstep${edge ? ' edge' : ''}"><div class="lab">${esc(label)}</div><div class="val ${c2 || ''}">${text}</div><div class="faint small">${sub || ''}</div></div>`;
  const bridgeHtml = `<div class="lbridge">${[
    step(startName, k(r.start), '', esc(dstrY(V.start)), true),
    step('Trades', sgnK(r.trades), cls(r.trades), `${r.tradeCount} trades`),
    ...(fromSeason ? [step('Rookie drafts', sgnK(r.draft), cls(r.draft), `${r.draftCount} picks`)] : []),
    ...(r.newPickCount ? [step('New pick year', sgnK(r.newPicks), cls(r.newPicks), `${r.newPickCount} picks`)] : []),
    step('Waivers added', `+${k(r.added)}`, 'up', `${r.addCount} adds`),
    step('Value lost', `−${k(r.lost)}`, 'down', `${r.lostCount} players`),
    step('Appreciation', sgnK(r.residual), cls(r.residual), 'while held'),
    step('Today', k(r.end), '', `${sgnK(r.change)}${r.start ? ` (${r.change >= 0 ? '+' : ''}${Math.round((r.change / r.start) * 100)}%)` : ''}`, true),
  ].join('')}</div>`;
  const fromSeg = Object.keys(W3).length > 1 ? `<span class="tseg2">${[['startup', 'Since the startup draft'], ['season', 'This season'], ['draft', 'Since this year\'s rookie draft']].filter(([k2]) => W3[k2]).map(([k2, l]) => `<button class="${from === k2 ? 'on' : ''}" data-action="votFrom" data-from="${k2}">${l}</button>`).join('')}</span>` : '';
  const head = `<div class="card"><div class="sec-h"><h3 style="margin:0;display:flex;align-items:center;gap:10px">${teamAvatar(t)} ${esc(t.name)}</h3>
      <span class="row" style="gap:8px;flex-wrap:wrap"><select class="sel" data-votteam="1">${m.teams.map((tt) => `<option value="${tt.rid}" ${tt.rid === detail.rid ? 'selected' : ''}>${esc(tt.name)}</option>`).join('')}</select>${fromSeg}<button class="btn sm primary" data-action="exportLedger">${icon('download')}Export ledger</button></span></div>
    ${bridgeHtml}
    ${svg}
    <div class="row small" style="gap:14px;margin-top:4px"><span><i class="vdot" style="background:#f2b632"></i> ${esc(t.name)}</span><span class="muted">- - League average</span><span style="flex:1"></span>${tabs.map(([k2, l]) => `<a class="link" href="#ledger/${detail.rid}" data-action="ledgerJump" data-kind="${k2}">${l}</a>`).join('')}</div></div>`;
  return `<div class="sec-h"><h2>Team ledger</h2><span class="row" style="gap:10px">${ktcSourceSeg()}</span></div><div class="row" style="margin:-6px 0 12px"><span class="muted small">${esc(startName)} (${esc(dstrY(V.start))}) to today · <a class="link" href="#valuetime">Value over time</a></span></div>${head}${sections.join('')}`;
}

// KTC value source switch (Crowdsourced / Crowd + Trades / Tradesourced), shared by the trade and value pages.
function ktcSourceSeg() {
  const has = !!(S.bookRaw && S.bookRaw.ktcAlts);
  const cur = has && S.cfg.ktcSource && KTC_SOURCES[S.cfg.ktcSource] ? S.cfg.ktcSource : 'crowd';
  if (!has) return `<span class="faint small" title="Click Sync now to load KTC's Tradesourced and Crowd + Trades values">KTC: Crowdsourced</span>`;
  return `<span class="tseg2" title="KeepTradeCut value source">${['crowd', 'blend', 'trade'].map((k2) => `<button class="${cur === k2 ? 'on' : ''}" data-action="ktcSource" data-src="${k2}">${KTC_SOURCES[k2]}</button>`).join('')}</span>`;
}

function viewSummary() {
  const m = S.model;
  const st = S.ui.sum;
  const rows = summaryRows();
  rows.sort((a, b) => {
    const va = a[st.key], vb = b[st.key];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * st.dir;
  });
  const th = (key, label, cls = 'num', title = '') => `<th class="${cls} sortable ${st.key === key ? 'on' : ''}" data-action="sumSort" data-key="${key}" title="${esc(title)}">${label}${st.key === key ? (st.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
  const n = (v) => (v == null ? '<span class="faint">—</span>' : v);
  const askCell = (v) => (v == null ? '<span class="faint">—</span>' : `<span class="${v >= 0.12 ? 'down' : v <= 0 ? 'up' : ''}">${signPct(v)}</span>`);
  const easeCell = (r) => {
    const d = r.t.dealings;
    if (!d) return '';
    if (r.ease == null) return '<span class="faint small">Not enough</span>';
    const tone = r.ease >= 65 ? 'good' : r.ease >= 40 ? 'warn' : 'sell';
    return `<span class="pill ${tone}" title="${r.ease}/100">${esc(d.label.replace(' to deal with', ''))}</span>`;
  };
  const faint = '<span class="faint">—</span>';
  const ptsCell = (v) => `<span class="${v > 10 ? 'up' : v < -10 ? 'down' : 'muted'}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}</span>`;
  const netCell = (v) => `<span class="${v > 250 ? 'up' : v < -250 ? 'down' : 'muted'}">${v > 0 ? '+' : v < 0 ? '−' : ''}${k(Math.abs(v))}</span>`;
  const phase = (r) => `<div class="phasebar" style="margin:0;min-width:120px"><i class="ri" style="width:${(r.rising * 100).toFixed(1)}%"></i><i class="pk" style="width:${(r.peak * 100).toFixed(1)}%"></i><i class="de" style="width:${(r.declining * 100).toFixed(1)}%"></i><i class="pi" style="width:${(r.picks * 100).toFixed(1)}%"></i></div>`;
  // Column groups, in display order. "judge" marks opinions hidden in share view.
  const me0 = (r, html) => (r.isMe ? '' : html);
  const groups = [
    { label: '', cols: [
      { h: th('name', 'Manager', ''), td: (r) => `<td><div class="who">${teamAvatar(r.t)}<div>${tlink(r.rid)}${r.t.avoid ? ' <span class="pill sell judge" style="padding:0 6px">avoid</span>' : ''}<div class="meta judge">${posture(r.t)}</div></div></div></td>` },
      { h: th('value', 'Value'), td: (r) => `<td class="num">${k(r.value)}</td>` },
    ] },
    { label: 'Trades this season', cols: [
      { h: th('trades', 'Trades', 'num grp'), td: (r) => `<td class="num grp">${r.trades}</td>` },
      { h: th('curThen', 'Net then', 'num', 'Value received minus value given, using values from the week of each trade'), td: (r) => `<td class="num">${r.trades ? netCell(r.curThen) : faint}</td>` },
      { h: th('curNow', 'Net now', 'num', "Value received minus value given, using today's values"), td: (r) => `<td class="num">${r.trades ? netCell(r.curNow) : faint}</td>` },
      { h: th('curPts', 'Pts +/−', 'num', 'Starter points scored for him by players he received, minus starter points scored for others by players he sent away'), td: (r) => `<td class="num">${r.trades ? ptsCell(r.curPts) : faint}</td>` },
    ] },
    { label: 'Earlier seasons', cols: [
      { h: th('histTrades', 'Trades', 'num grp'), td: (r) => `<td class="num grp">${r.histTrades}</td>` },
      { h: th('oldThen', 'Net then', 'num', 'Value received minus value given, using values from the week of each trade'), td: (r) => `<td class="num">${r.histTrades ? netCell(r.oldThen) : faint}</td>` },
      { h: th('oldNow', 'Net now', 'num', "Value received minus value given, using today's values"), td: (r) => `<td class="num">${r.histTrades ? netCell(r.oldNow) : faint}</td>` },
      { h: th('oldPts', 'Pts +/−', 'num', 'Starter points from traded players since each trade, through today'), td: (r) => `<td class="num">${r.histTrades ? ptsCell(r.oldPts) : faint}</td>` },
    ] },
    { label: 'All', cols: [
      { h: th('allTrades', 'Trades', 'num grp', 'All seasons'), td: (r) => `<td class="num grp">${r.allTrades}</td>` },
      { h: th('allThen', 'Net then', 'num', 'All seasons, values from the week of each trade. This is the Trades number on Value over time.'), td: (r) => `<td class="num">${r.trades + r.histTrades ? netCell(r.allThen) : faint}</td>` },
      { h: th('allNow', 'Net now', 'num', "All seasons, today's values"), td: (r) => `<td class="num"><b>${r.trades + r.histTrades ? netCell(r.allNow) : faint}</b></td>` },
      { h: th('allPts', 'Pts +/−', 'num', 'All seasons: starter points gained minus lost through trades'), td: (r) => `<td class="num"><b>${r.trades + r.histTrades ? ptsCell(r.allPts) : faint}</b></td>` },
    ] },
    { label: 'Offers with you', cols: [
      { h: th('hisSent', 'He sent', 'num grp', 'Offers he sent you, including ones you accepted'), td: (r) => `<td class="num grp">${me0(r, n(r.hisSent))}</td>` },
      { h: th('mySent', 'You sent', 'num', 'Offers you sent him, including ones he accepted'), td: (r) => `<td class="num">${me0(r, n(r.mySent))}</td>` },
      { h: th('hisRej', 'He rejected', 'num', 'Your offers he rejected'), td: (r) => `<td class="num">${me0(r, n(r.hisRej))}</td>` },
      { h: th('myRej', 'You rejected', 'num', 'His offers you rejected'), td: (r) => `<td class="num">${me0(r, n(r.myRej))}</td>` },
      { h: th('done', 'Completed', 'num', 'Trades completed between you'), td: (r) => `<td class="num">${me0(r, n(r.done))}</td>` },
      { h: th('ask', 'Avg ask', 'num', 'In offers he sent you: how much more value he asked for than he gave. Negative means his offers leaned your way.'), td: (r) => `<td class="num" title="${r.t.dealings ? `${r.t.dealings.askN} offers. Click for the list.` : ''}">${me0(r, r.ask == null ? askCell(r.ask) : `<a href="#trades/incoming" data-action="incFor" data-rid="${r.rid}">${askCell(r.ask)}</a>`)}</td>` },
      { h: th('resp', 'He answers in', 'num', 'Typical time he takes to accept or reject your offers'), td: (r) => `<td class="num">${me0(r, r.resp == null ? faint : `<span class="${r.resp > 3 * 86400e3 ? 'down' : r.resp < 6 * 3600e3 ? 'up' : ''}">${esc(dur(r.resp))}</span>`)}</td>` },
      { h: th('myResp', 'You answer in', 'num', 'Typical time you take to answer his offers'), td: (r) => `<td class="num">${me0(r, r.myResp == null ? faint : esc(dur(r.myResp)))}</td>` },
      { judge: true, h: th('ease', 'Ease', 'judge'), td: (r) => `<td class="judge">${me0(r, easeCell(r))}</td>` },
    ] },
    { label: 'Roster value by career phase', cols: [
      { h: th('declining', 'Mix', 'grp', 'Sort by share declining'), td: (r) => `<td class="grp">${phase(r)}</td>` },
      { h: th('rising', 'Rising'), td: (r) => `<td class="num">${pct(r.rising)}</td>` },
      { h: th('peak', 'Peak'), td: (r) => `<td class="num">${pct(r.peak)}</td>` },
      { h: th('declining', 'Decl.'), td: (r) => `<td class="num">${pct(r.declining)}</td>` },
      { h: th('picks', 'Picks'), td: (r) => `<td class="num">${pct(r.picks)}</td>` },
      { h: th('age', 'Age', 'num', 'Value-weighted age'), td: (r) => `<td class="num">${r.age ? r.age.toFixed(1) : '—'}</td>` },
    ] },
    { label: 'Other leagues', cols: [
      { h: th('leagues', 'Leagues', 'num grp'), td: (r) => `<td class="num grp">${me0(r, n(r.leagues))}</td>` },
      { h: th('exTrades', 'Trades'), td: (r) => `<td class="num">${me0(r, n(r.exTrades))}</td>` },
    ] },
    { label: 'This season', cols: [
      { h: th('record', 'Record', 'num grp'), td: (r) => `<td class="num grp">${r.t.w}-${r.t.l}</td>` },
      { h: th('odds', 'Playoffs'), td: (r) => `<td class="num">${pct(r.t.playoffOdds)}</td>` },
    ] },
  ];
  const neutral = S.ui.neutral;
  const visCols = (g) => g.cols.filter((c) => !(neutral && c.judge));
  const groupHead = groups.map((g) => `<th colspan="${visCols(g).length}" class="${g.label ? 'grp' : ''}">${esc(g.label)}</th>`).join('');
  const colHead = groups.map((g) => visCols(g).map((c) => c.h).join('')).join('');
  const body = rows.map((r) => `<tr class="${r.isMe ? 'me' : ''}${S.ui.sumHi === r.rid ? ' hl' : ''}"${S.ui.sumHi === r.rid ? ' id="sum-hl"' : ''}>${groups.map((g) => visCols(g).map((c) => c.td(r)).join('')).join('')}</tr>`).join('');
  // league totals
  const others = rows.filter((r) => !r.isMe);
  const tot = (key) => others.reduce((s2, r) => s2 + (r[key] || 0), 0);
  const asks = others.filter((r) => r.ask != null);
  return myOffersCard(m) + `<div class="sec-h" style="margin-top:18px"><h2>Manager summary</h2><span class="row" style="gap:10px">${ktcSourceSeg()}<button class="btn sm primary" data-action="exportSummary">${icon('download')}Export PNG</button><button class="toggle ${S.ui.neutral ? 'on' : ''}" data-action="toggleNeutral" title="Hide postures, ease ratings, avoid tags and your notes so you can show this screen to others">Share view <span class="sw"></span></button></span></div><div class="row" style="margin:-6px 0 12px"><span class="muted small">Click a column to sort. Offer columns only count offers between you and that manager: Sleeper hides other managers' offers to each other.</span></div>
  <div class="three" style="margin-bottom:16px">
    <div class="card tile">${icon('swap')}<div class="num">${tot('hisSent')} / ${tot('mySent')}</div><div class="lab">Offers to you / from you</div></div>
    <div class="card tile">${icon('x')}<div class="num">${tot('hisRej')} / ${tot('myRej')}</div><div class="lab">Your offers rejected / offers you rejected</div></div>
    <a class="card tile" href="#trades/incoming" data-action="incFor" data-rid="all">${icon('chart')}<div class="num">${(() => { const n = asks.reduce((s2, r) => s2 + (r.t.dealings.askN || 0), 0); return n ? signPct(asks.reduce((s2, r) => s2 + r.ask * (r.t.dealings.askN || 0), 0) / n) : '—'; })()}</div><div class="lab">Average ask across all ${asks.reduce((s2, r) => s2 + (r.t.dealings.askN || 0), 0)} offers sent to you, in the sender's favour (negative = offers leaned your way). Click for every offer.</div></a>
  </div>
  <div class="card"><div class="scroll"><table class="t sumt">
    <thead>
      <tr class="grp-h">${groupHead}</tr>
      <tr>${colHead}</tr>
    </thead><tbody>${body}</tbody></table></div>
    <p class="faint small" style="margin:10px 0 0">Net value is what a manager received minus what he gave across his trades in this league, in KTC-scale points (including KTC's adjustment for uneven deals). "Then" uses values from the week of each trade; "now" uses today's. Picks that have been used count as the player drafted with them. Pts +/− is starter points: what the players a manager received scored in his starting lineup after each trade, minus what the players he sent away scored in their new team's lineup (regular season, every season we have lineups for). Rising, peak and declining use each position's typical peak ages and the aging model. Other leagues come from each manager's other ${m.league.season} Sleeper leagues (rescan in Settings).</p></div>` + passedAroundCard(m);
}

function passedAround(m) {
  const all = [...m.leagueTrades, ...m.histTrades].sort((a, b) => a.created - b.created);
  const chains = {};
  const nameIn = (nt, r) => (nt.nameOf && nt.nameOf[r]) || null;
  for (const nt of all) {
    for (const r of nt.rids) for (const sid of nt.sides[r].inP) {
      const from = nt.rids.find((x) => x !== r && nt.sides[x].outP.includes(sid));
      const c = (chains[sid] ||= { sid, hops: [] });
      c.hops.push({ from, to: r, at: nt.created, fromNm: nameIn(nt, from), toNm: nameIn(nt, r), id: nt.id });
    }
  }
  const owner = {};
  for (const t of m.teams) for (const sid of t.roster.players || []) owner[sid] = t.rid;
  const out = [];
  for (const c of Object.values(chains)) {
    if (c.hops.length < 2) continue;
    // Build the path; where a trade starts from a team other than the last
    // receiver, the player moved outside trades (commissioner, waivers, drop).
    const path = [{ rid: c.hops[0].from, nm: c.hops[0].fromNm, at: null }];
    let gaps = 0;
    for (const h of c.hops) {
      const prev = path[path.length - 1];
      if (h.from !== prev.rid) {
        const mv = (m.playerMoves[c.sid] || []).filter((x) => x.at > (prev.at || 0) && x.at < h.at);
        const kind = mv.some((x) => x.type === 'commissioner') ? 'commissioner' : mv.some((x) => x.type === 'waiver' || x.type === 'free_agent') ? 'waivers' : 'outside';
        path.push({ gap: true, kind, rid: h.from, nm: h.fromNm, at: null });
        gaps++;
      }
      path.push({ rid: h.to, nm: h.toNm, at: h.at });
    }
    const teams = new Set(path.filter((p) => p.rid != null).map((p) => p.rid)).size;
    out.push({ sid: c.sid, path, trades: c.hops.length, teams, gaps, owner: owner[c.sid] ?? null, v: pval(c.sid).v });
  }
  return out.sort((a, b) => b.teams - a.teams || b.trades - a.trades || b.v - a.v).slice(0, 10);
}

function passedAroundCard(m) {
  const list = passedAround(m);
  const nmOf = (p) => (team(p.rid) ? tname(p.rid) : p.nm || tname(p.rid));
  const GAP = { commissioner: ['commissioner move', 'Moved by the commissioner, not by a trade'], waivers: ['via waivers', 'Dropped and picked up, not traded'], outside: ['moved outside a trade', 'Changed teams without a trade we can see: a commissioner edit or a trade reversal'] };
  const rows = list.map((c, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td><div class="who">${headshot(c.sid)}<div>${playerLink(c.sid)}<div class="meta">${posTag(P(c.sid).pos)} ${P(c.sid).age ? Math.floor(P(c.sid).age) : ''} · ${esc(P(c.sid).team || 'FA')}</div></div></div></td>
      <td class="num"><b>${c.teams}</b></td>
      <td class="num">${c.trades}</td>
      <td class="small path">${c.path.map((p, j) => (p.gap ? `<span class="gap" title="${esc(GAP[p.kind][1])}">⤳ ${esc(GAP[p.kind][0])}</span><span class="arrow">→</span>` : '') + `<span class="${j === c.path.length - 1 ? 'last' : ''}" title="${p.at ? esc(dateY(p.at)) : ''}">${esc(nmOf(p))}${p.at ? ` <span class="faint">${esc(new Date(p.at).toLocaleDateString([], { month: 'short', year: '2-digit' }))}</span>` : ''}</span>`).join('<span class="arrow">→</span>').replace(/<span class="arrow">→<\/span><span class="gap"/g, '<span class="gap"')}</td>
      <td>${c.owner != null ? tlink(c.owner) : '<span class="pill good">Free agent</span>'}</td>
      <td class="num">${k(c.v)}</td>
    </tr>`).join('');
  const anyGap = list.some((c) => c.gaps);
  return `<div class="card" style="margin-top:16px"><h3>Most passed-around players</h3><p class="lede">Players traded at least twice in this league, ranked by how many different teams have owned them through trades (this season and earlier). Hover a team for the trade date.${anyGap ? ' Orange notes mark a change of team that wasn\'t a trade, such as a commissioner edit, a reversed trade or a waiver pickup.' : ''}</p>
    ${rows ? `<div class="scroll"><table class="t"><thead><tr><th class="num">#</th><th>Player</th><th class="num">Teams</th><th class="num">Trades</th><th>Path</th><th>Owner now</th><th class="num">Value</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No player has been traded more than once yet.</p>'}</div>`;
}


// Why offers, alerts and waiver claims are off for the viewed team: the
// viewing-as notice, or its logged-out wording with nothing to switch back to.
function notOwnNotice(what) {
  if (teamState() === 'loggedOut') return '<p class="muted">Log in to <a class="textlink" href="https://sleeper.com" target="_blank" rel="noopener">sleeper.com</a> in this Chrome to see offers, alerts and waiver claims.</p>';
  return `<p class="muted">You're viewing <b>${esc(tname(S.raw.me.rosterId))}</b>, which isn't your Sleeper login. ${what} only work for your own team.</p><a class="btn primary" href="#settings">Switch back to your team</a>`;
}

// Why offers are missing, shown on the offer pages instead of a page of zeros.
function offersNotice() {
  if (teamState() === 'loggedOut') return `<div class="card"><h3>Offers</h3>${notOwnNotice('Offers')}</div>`;
  const g = S.raw && S.raw.gql;
  if (!g || g.ok) return '';
  const login = S.auth && S.auth.userId;
  const why = !login
    ? 'Offers need your Sleeper login. Open <b>sleeper.com</b> in this Chrome (or reload the tab if it was already open) while logged in. The dashboard picks it up and refreshes by itself.'
    : esc(g.error || 'Sleeper did not return your offers.');
  return `<div class="notice">${why} <button class="btn sm" data-action="sync" style="margin-left:8px">Sync now</button></div>`;
}


// My offers overview: a per-manager table and a weekly chart, sent vs received.
function myOffersOverview(m) {
  const mine = (m.myOffers && m.myOffers.rows) || [];
  const mineIds = new Set(mine.map((r) => String(r.id)));
  const recv = [
    ...m.offers.filter((o) => !o.fromMe).map((o) => ({ rid: o.other, status: o.status, created: o.created })),
    ...m.leagueTrades.filter((nt) => nt.rids.includes(m.me) && !mineIds.has(String(nt.id))).map((nt) => ({ rid: nt.rids.find((r) => r !== m.me), status: 'complete', created: nt.created })),
  ];
  const sent = mine.map((r) => ({ rid: r.rid, status: r.status, created: r.created }));
  if (!sent.length && !recv.length) return '';
  const per = {};
  const add = (list, side) => { for (const e of list) { const x = (per[e.rid] ||= { sent: {}, recv: {}, ns: 0, nr: 0 }); x[side][e.status] = (x[side][e.status] || 0) + 1; side === 'sent' ? x.ns++ : x.nr++; } };
  add(sent, 'sent'); add(recv, 'recv');
  const sr = Object.fromEntries(summaryRows().map((r) => [r.rid, r]));
  const rows = Object.entries(per).map(([rid, x]) => ({ rid: Number(rid), ...x })).filter((r) => team(r.rid)).sort((a, b) => (b.ns + b.nr) - (a.ns + a.nr));
  const c = (o, k2) => o[k2] || 0;
  const z = (v, cls = '') => (v ? `<span class="${cls}">${v}</span>` : '<span class="faint">0</span>');
  const tot = (side, st) => rows.reduce((a, r) => a + c(r[side], st), 0);
  const askCell = (v) => (v == null ? '<span class="faint">—</span>' : `<span class="${v >= 0.12 ? 'down' : v <= 0 ? 'up' : ''}">${signPct(v)}</span>`);
  const table = `<div class="scroll"><table class="t">
    <thead><tr class="grp-h"><th></th><th colspan="5" class="grp">Offers you sent</th><th colspan="5" class="grp">Offers he sent you</th><th class="grp"></th></tr>
    <tr><th>Manager</th>
      <th class="num grp">Sent</th><th class="num">Accepted</th><th class="num">Rejected</th><th class="num">Withdrawn</th><th class="num">Waiting</th>
      <th class="num grp">Received</th><th class="num">You accepted</th><th class="num">You rejected</th><th class="num">Withdrawn</th><th class="num">Waiting</th>
      <th class="num grp" title="How much more value he asks for than he gives, in offers he sent you">His avg ask</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td><div class="who">${teamAvatar(team(r.rid))}${tlink(r.rid)}</div></td>
      <td class="num grp"><b>${r.ns}</b></td><td class="num">${z(c(r.sent, 'complete'), 'up')}</td><td class="num">${z(c(r.sent, 'rejected'), 'down')}</td><td class="num">${z(c(r.sent, 'cancelled'))}</td><td class="num">${z(c(r.sent, 'proposed'))}</td>
      <td class="num grp"><b>${r.nr}</b></td><td class="num">${z(c(r.recv, 'complete'), 'up')}</td><td class="num">${z(c(r.recv, 'rejected'), 'down')}</td><td class="num">${z(c(r.recv, 'cancelled'))}</td><td class="num">${z(c(r.recv, 'proposed'))}</td>
      <td class="num grp">${askCell(sr[r.rid] && sr[r.rid].ask)}</td></tr>`).join('')}
      <tr class="me"><td><b>All managers</b></td>
      <td class="num grp"><b>${sent.length}</b></td><td class="num"><b>${tot('sent', 'complete')}</b></td><td class="num"><b>${tot('sent', 'rejected')}</b></td><td class="num"><b>${tot('sent', 'cancelled')}</b></td><td class="num"><b>${tot('sent', 'proposed')}</b></td>
      <td class="num grp"><b>${recv.length}</b></td><td class="num"><b>${tot('recv', 'complete')}</b></td><td class="num"><b>${tot('recv', 'rejected')}</b></td><td class="num"><b>${tot('recv', 'cancelled')}</b></td><td class="num"><b>${tot('recv', 'proposed')}</b></td><td class="grp"></td></tr>
    </tbody></table></div>`;

  // weekly chart: two stacked bars per week (sent, received), coloured by outcome
  const WEEK = 7 * 86400e3;
  const all = [...sent, ...recv];
  const monday = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const last = monday(Date.now());
  const first = Math.max(monday(Math.min(...all.map((e) => e.created))), last - 19 * WEEK);
  const weeks = [];
  for (let t = first; t <= last; t += WEEK) weeks.push(t);
  const ORDER = [['complete', 'var(--green)', 'Accepted'], ['rejected', 'var(--red)', 'Rejected'], ['cancelled', 'var(--faint)', 'Withdrawn'], ['proposed', 'var(--gold)', 'Waiting']];
  const bucket = (list, w) => { const o = {}; for (const e of list) if (monday(e.created) === w) o[e.status] = (o[e.status] || 0) + 1; return o; };
  const data = weeks.map((w) => ({ w, s: bucket(sent, w), r: bucket(recv, w) }));
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...data.map((d) => Math.max(sum(d.s), sum(d.r))));
  const VW = 1200, VH = 250, L = 34, B = 34, T = 12, plotH = VH - B - T, slot = (VW - L - 10) / weeks.length, bw = Math.min(16, slot / 2 - 3);
  const stack = (o, x, opacity) => { let y = VH - B; return ORDER.map(([st, col, lab]) => { const n = o[st] || 0; if (!n) return ''; const h = (n / max) * plotH; y -= h; return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${col}" opacity="${opacity}"><title>${lab}: ${n}</title></rect>`; }).join(''); };
  const ticks = Array.from(new Set([0, Math.ceil(max / 2), max])).map((v) => { const y = VH - B - (v / max) * plotH; return `<line x1="${L}" x2="${VW - 6}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-dasharray="3 4"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`; }).join('');
  const bars = data.map((d, i) => {
    const x0 = L + i * slot + slot / 2;
    const lab = i % Math.ceil(weeks.length / 10) === 0 ? `<text x="${x0}" y="${VH - 12}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(new Date(d.w).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</text>` : '';
    return stack(d.s, x0 - bw - 1, 1) + stack(d.r, x0 + 1, 0.55) + lab;
  }).join('');
  const chart = `<svg viewBox="0 0 ${VW} ${VH}" width="100%" role="img" aria-label="Offers per week, sent and received">${ticks}${bars}</svg>
    <div class="row" style="gap:14px;flex-wrap:wrap;margin-top:6px">${ORDER.map(([, col, lab]) => `<span class="small muted"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${col};margin-right:6px;vertical-align:-1px"></i>${lab}</span>`).join('')}
    <span class="small muted">Left bar each week: offers you sent. Right, lighter bar: offers sent to you.</span></div>`;

  const decided = tot('sent', 'complete') + tot('sent', 'rejected');
  const rDecided = tot('recv', 'complete') + tot('recv', 'rejected');
  return `<div class="sec-h"><h2>Offers at a glance</h2><span class="muted small">Every offer between you and each manager this season</span></div>
    <div class="four" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:16px">
      <div class="card tile hot">${icon('swap')}<div class="num">${sent.length}</div><div class="lab">Offers you sent</div></div>
      <div class="card tile">${icon('check')}<div class="num">${decided ? pct(tot('sent', 'complete') / decided) : '—'}</div><div class="lab">Of yours accepted (of those answered)</div></div>
      <div class="card tile">${icon('bell')}<div class="num">${recv.length}</div><div class="lab">Offers sent to you</div></div>
      <div class="card tile">${icon('check')}<div class="num">${rDecided ? pct(tot('recv', 'complete') / rDecided) : '—'}</div><div class="lab">Of theirs you accepted</div></div>
    </div>
    <div class="card" style="margin-bottom:14px"><h3>By manager</h3>${table}</div>
    <div class="card" style="margin-bottom:16px"><h3>Offers per week</h3>${chart}</div>`;
}

function myOffersCard(m) {
  const o = m.myOffers;
  if (!o) return '';
  const st = { complete: ['Accepted', 'good'], rejected: ['Rejected', 'sell'], cancelled: ['Withdrawn', 'mid'], proposed: ['Waiting', 'warn'] };
  const recent = o.rows.slice(0, 8).map((r) => `<tr><td>${esc(dateStr(r.created))}</td><td><div class="who">${teamAvatar(team(r.rid))}${tlink(r.rid)}</div></td><td><span class="pill ${(st[r.status] || ['', 'mid'])[1]}">${esc((st[r.status] || [r.status])[0])}</span></td><td class="num">${esc(dur(r.openMs))}</td><td class="num">${signPct(r.ask)}</td><td class="num">${signPct(r.now)}</td></tr>`).join('');
  const decided = o.accepted + o.rejected;
  return `${offersNotice()}<div class="sec-h"><h2>Your offers</h2><span class="muted small">Every offer you've sent in this league this season, graded from your side</span></div>
  <div class="three" style="margin-bottom:16px">
    <div class="card tile hot">${icon('swap')}<div class="num">${o.sent}</div><div class="lab">Sent · ${o.accepted} accepted · ${o.rejected} rejected · ${o.withdrawn} withdrawn · ${o.pending} waiting</div></div>
    <div class="card tile">${icon('check')}<div class="num">${decided ? pct(o.accepted / decided) : '—'}</div><div class="lab">Acceptance rate (of offers that got an answer)</div></div>
    <div class="card tile">${icon('chart')}<div class="num">${signPct(o.avgAsk)}</div><div class="lab">Your average ask, in your favour${o.avgAccepted != null ? ` · accepted ${signPct(o.avgAccepted)}` : ''}${o.avgRejected != null ? ` · rejected ${signPct(o.avgRejected)}` : ''}</div></div>
  </div>
  <div class="two" style="align-items:start">
    <div class="card"><h3>What gets accepted</h3><p class="lede">Your answered offers grouped by how much they asked for, by KTC at the time.</p>
      ${o.buckets.map((b) => `<div class="meter" style="margin-bottom:10px"><div class="row"><span>${esc(b.label)}</span><span>${b.n ? `${b.accepted} of ${b.n} accepted` : '<span class="faint">none</span>'}</span></div>${bar(b.rate || 0, b.rate >= 0.5 ? 'green' : b.rate > 0 ? 'orange' : 'red')}</div>`).join('')}
      ${o.insights.length ? `<ul class="ev" style="margin-top:12px">${o.insights.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>
    <div class="card"><h3>Recent offers you sent</h3>${recent ? `<div class="scroll"><table class="t"><thead><tr><th>Date</th><th>To</th><th>Result</th><th class="num">Open for</th><th class="num">Ask then</th><th class="num">Today</th></tr></thead><tbody>${recent}</tbody></table></div><a class="link small" href="#trades/offers">All offers with full detail</a>` : '<p class="muted">No offers sent yet.</p>'}</div>
  </div>`;
}

// ---- this week's trade finder: bye-week and injury holes ---------------------------------------

const OUT_STATUS = /^(Out|IR|PUP|Sus|Suspended|Doubtful|NA)$/i;
const REPLACEMENT = { QB: 14, RB: 8, WR: 8, TE: 6 };

function weekContext(m) {
  const week = m.league.week;
  const scoring = S.raw.league.scoring_settings || {};
  const proj = S.aux.proj || {};
  const byeTeams = new Set(Object.entries(m.teamBye || {}).filter(([, b]) => Number(b) === week).map(([tm]) => tm));
  const seasonAvg = (sid) => { const c = S.prod && S.prod.cur && S.prod.cur[sid]; return c && c[0] ? c[1] / c[0] : 0; };
  // This week's projection with your scoring; without one, his season average.
  const wkPts = (sid) => { const p = proj[sid]; const d = S.dict[sid]; const v = p && d ? scoreLine(p.stats, scoring, d[1]) : null; return v != null && (v > 0 || !seasonAvg(sid)) ? v : seasonAvg(sid); };
  const status = (sid) => {
    const d = S.dict[sid] || [];
    if (d[2] && byeTeams.has(d[2])) return 'bye';
    if (proj[sid] && proj[sid].team && !proj[sid].opp && !proj[sid].gameId) return 'bye';
    if (OUT_STATUS.test(d[4] || '')) return 'out';
    return 'ok';
  };
  // Season-normal strength: his points per game this season, else this week's projection.
  const normal = (sid) => seasonAvg(sid) || wkPts(sid);
  return { week, wkPts, status, normal, slots: starterSlots(S.raw.league.roster_positions || []) };
}

function weekHoles(m, t, ctx) {
  const players = (t.roster.players || []).filter((sid) => VALUE_POS.includes((S.dict[sid] || [])[1]));
  const holes = [];
  for (const pos of VALUE_POS) {
    const need = ctx.slots.filter((x) => x === pos).length;
    if (!need) continue;
    const all = players.filter((sid) => S.dict[sid][1] === pos);
    const usual = [...all].sort((a, b) => ctx.normal(b) - ctx.normal(a)).slice(0, need);
    const missing = usual.filter((sid) => ctx.status(sid) !== 'ok');
    const avail = all.filter((sid) => ctx.status(sid) === 'ok').sort((a, b) => ctx.wkPts(b) - ctx.wkPts(a));
    const kth = avail[need - 1];
    const kthPts = kth ? ctx.wkPts(kth) : 0;
    const usualPts = usual.length >= need ? ctx.normal(usual[need - 1]) : 0;
    // A hole = no healthy player for a starting slot, or a usual starter out this week with a real drop-off behind him.
    const drop = usualPts - kthPts;
    if (kth && !(missing.length && drop >= Math.max(3, usualPts * 0.2))) continue;
    const severity = !kth ? 3 : drop >= usualPts * 0.5 ? 2.5 : drop >= usualPts * 0.3 ? 2 : 1;
    holes.push({ pos, need, missing, fill: kth || null, fillPts: kthPts, usualPts, severity });
  }
  return holes;
}

function viewWeekFinder() {
  const m = S.model;
  const me = team(m.me);
  const ctx = weekContext(m);
  const minGain = Number(S.ui.wk.min || 0.1);
  const hasProj = Object.keys(S.aux.proj || {}).length > 0;
  // My players who play this week, outside my own best lineup this week.
  const mine = (me.roster.players || []).filter((sid) => VALUE_POS.includes((S.dict[sid] || [])[1]));
  const myLineup = new Set(bestLineup(ctx.slots, mine.filter((sid) => ctx.status(sid) === 'ok').map((sid) => ({ id: sid, pos: S.dict[sid][1] })), (pl) => ctx.wkPts(pl.id)).filter(Boolean).map((x) => (typeof x === 'object' ? x.id : x)));
  const myCands = mine.filter((sid) => ctx.status(sid) === 'ok' && (S.ui.wk.starters || !myLineup.has(sid))).map((sid) => ({ id: sid, name: P(sid).name, pos: S.dict[sid][1], age: P(sid).age, wk: ctx.wkPts(sid), v: pval(sid).v, kind: 'player', key: `p:${sid}` })).filter((a) => a.v > 0);
  const teamsOut = [];
  for (const t of m.teams) {
    if (t.isMe || t.avoid) continue;
    const holes = weekHoles(m, t, ctx);
    if (!holes.length) continue;
    const theirLineup = new Set(bestLineup(ctx.slots, (t.roster.players || []).filter((sid) => VALUE_POS.includes((S.dict[sid] || [])[1]) && ctx.status(sid) === 'ok').map((sid) => ({ id: sid, pos: S.dict[sid][1] })), (pl) => ctx.wkPts(pl.id)).filter(Boolean).map((x) => (typeof x === 'object' ? x.id : x)));
    // What he can give: players who aren't helping him this week, and picks.
    const theirs = [
      ...t.assets.filter((a) => VALUE_POS.includes(a.pos) && a.v > 0 && !theirLineup.has(a.id)).map((a) => ({ ...a, key: `p:${a.id}` })),
      ...t.tradePicks.filter((p2) => p2.v > 0).map((p2) => ({ ...p2, name: p2.label, key: `k:${p2.season}:${p2.round}:${p2.orig}` })),
    ];
    const ideas = [];
    for (const h of holes) {
      const offers = myCands.filter((a) => a.pos === h.pos && a.wk >= Math.max(h.fillPts + 2, REPLACEMENT[h.pos] * 0.8)).sort((a, b) => b.wk - a.wk).slice(0, 3);
      for (const give of offers) {
        // Find returns worth at least +minGain to you by KTC (with the uneven-deal adjustment), without going silly.
        const best = [];
        const tryGet = (get) => {
          const vd = ktcVerdict(get.map((a) => a.v), [give.v], S.book.ktcTop);
          const ratio = vd.total1 / Math.max(1, vd.total2) - 1;
          if (ratio >= minGain && ratio <= minGain + 0.25) best.push({ get, ratio, vd }); // ask enough, but stay believable
        };
        const pool = theirs.filter((a) => a.v >= give.v * 0.35).sort((a, b) => b.v - a.v).slice(0, 14);
        for (let i = 0; i < pool.length; i++) { tryGet([pool[i]]); for (let j = i + 1; j < pool.length; j++) tryGet([pool[i], pool[j]]); }
        best.sort((a, b) => a.get.length - b.get.length || a.ratio - b.ratio);
        if (best[0]) ideas.push({ hole: h, give, ...best[0] });
      }
    }
    const urgency = Math.max(...holes.map((h) => h.severity)) * (0.6 + (t.playoffOdds || 0));
    teamsOut.push({ t, holes, ideas: ideas.sort((a, b) => b.hole.severity - a.hole.severity || a.ratio - b.ratio).slice(0, 3), urgency });
  }
  teamsOut.sort((a, b) => (b.ideas.length ? 1 : 0) - (a.ideas.length ? 1 : 0) || b.urgency - a.urgency);
  const holeLine = (h) => {
    const who = h.missing.map((sid) => `${P(sid).name} (${ctx.status(sid) === 'bye' ? 'bye' : esc(S.dict[sid][4] || 'out')})`).join(', ');
    return `<li class="t-${h.severity >= 2.5 ? 'sell' : h.severity >= 2 ? 'warn' : 'mid'}"><b>${posTag(h.pos)} ${h.severity >= 3 ? 'No healthy ' + h.pos + ' to start' : h.severity >= 2.5 ? 'Big hole at ' + h.pos : 'Weak at ' + h.pos}</b>${who ? `: ${esc(who)} out this week` : ''}. ${h.fill ? `Best available: ${esc(P(h.fill).name)}, ${h.fillPts.toFixed(1)} projected${h.usualPts ? ` (his usual starter gives ${h.usualPts.toFixed(1)})` : ''}.` : ''}</li>`;
  };
  const assetMini = (a) => `<div class="asset">${a.kind === 'pick' ? '<span class="av head">PK</span>' : headshot(a.id)}<div class="nm">${a.kind === 'pick' ? `<b>${esc(a.name)}</b>` : playerLink(a.id, a.name)}<span class="meta">${a.kind === 'pick' ? 'draft pick' : `${esc(a.pos)}${a.age ? ` · ${Math.floor(a.age)}` : ''}${a.wk != null ? ` · ${a.wk.toFixed(1)} proj this week` : ''}`}</span></div><div class="vals">${k(a.v)}</div></div>`;
  const cards = teamsOut.map(({ t, holes, ideas }) => `<div class="trade">
      <div class="meta">${teamAvatar(t)}<b style="color:var(--text)">${tlink(t.rid)}</b>${posture(t)}<span>${t.w}-${t.l} · playoff odds ${pct(t.playoffOdds)}</span>${t.dealings && t.dealings.hisResponse != null ? `<span>answers in ${esc(dur(t.dealings.hisResponse))}</span>` : ''}</div>
      <ul class="tl">${holes.map(holeLine).join('')}</ul>
      ${ideas.length ? ideas.map((i) => `<div class="sides" style="margin-top:10px">
        <div class="tside"><div class="hd"><b>You give</b><span class="grades">KTC ${k(i.vd.total2)}</span></div>${assetMini(i.give)}<div class="tot"><span>Fills his ${esc(i.hole.pos)} hole: ${i.give.wk.toFixed(1)} projected vs ${i.hole.fillPts.toFixed(1)}</span></div></div>
        <div class="tside"><div class="hd"><b>You ask for</b><span class="grades">KTC ${k(i.vd.total1)} ${grade(letterGrade(i.vd.total1, i.vd.total2))}</span></div>${i.get.map(assetMini).join('')}<div class="tot"><span><b class="up">+${Math.round(i.ratio * 100)}%</b> KTC value for you${i.vd.adj1 ? ` (incl. ${k(i.vd.adj1)} adj.)` : ''}</span><button class="btn sm" data-action="weekLab" data-rid="${t.rid}" data-give="${esc(i.give.key)}" data-get="${esc(i.get.map((a) => a.key).join('|'))}">Open in trade lab</button></div></div>
      </div>`).join('') : `<p class="muted small" style="margin:8px 0 0">${myCands.some((a) => holes.some((h) => h.pos === a.pos)) ? `None of your spare ${holes.map((h) => h.pos).join('/')}s gets you +${Math.round(minGain * 100)}% from his roster.` : `You don't have a spare ${holes.map((h) => h.pos).join(' or ')} who'd start for him this week.`}</p>`}
    </div>`).join('');
  const spare = myCands.filter((a) => a.wk >= REPLACEMENT[a.pos] * 0.8).sort((a, b) => b.wk - a.wk);
  return `<div class="card"><div class="sec-h"><h3 style="margin:0">This week's trade finder (week ${ctx.week})</h3><div class="row"><label class="row small muted"><input type="checkbox" data-wk="starters" ${S.ui.wk.starters ? 'checked' : ''}> Include my own starters</label><label class="f" style="flex-direction:row;align-items:center;gap:8px">Ask for at least <select data-wk="min">${[0.05, 0.1, 0.15, 0.2, 0.25].map((v) => `<option value="${v}" ${Math.abs(minGain - v) < 0.001 ? 'selected' : ''}>+${Math.round(v * 100)}% KTC</option>`).join('')}</select></label></div></div>
    <p class="lede">Teams with a hole in this week's lineup because of byes or injuries (Out, IR, Doubtful), weakest and most motivated first: contenders with a hole will pay more. For each hole, it offers one of your players who'd start for him this week but isn't in your own best lineup, and finds what to ask for so you get at least +${Math.round(minGain * 100)}% KTC value (including KTC's adjustment). It leaves your own starters out unless you tick "Include my own starters". Managers your notes say to avoid are left out.${hasProj ? '' : ' <b>This week\'s projections haven\'t loaded; sync first.</b>'}</p>
    ${spare.length ? `<p class="small muted">Players you could offer this week: ${spare.map((a) => `${esc(a.name)} (${esc(a.pos)}, ${a.wk.toFixed(1)})`).join(', ')}</p>` : '<p class="small muted">You have no spare starters this week: everyone useful is in your own lineup.</p>'}
    ${cards || '<p class="muted">No team has a bye or injury hole this week.</p>'}</div>`;
}

// ---- roster form: points, hot/cold, snaps, usage trends ---------------------------------------

const STARTER_LINE = { QB: 12, RB: 24, WR: 30, TE: 12 };

function formIndex() {
  // Weekly position ranks across every player, once per data load.
  const W = S.weekly;
  if (!W) return null;
  if (S._formIdx && S._formIdx.at === W.at) return S._formIdx;
  const ranks = {};
  for (const [w, rows] of Object.entries(W.weeks)) {
    const byPos = {};
    for (const [sid, r] of Object.entries(rows)) { const pos = (S.dict[sid] || [])[1]; if (STARTER_LINE[pos]) (byPos[pos] ||= []).push([sid, r[0]]); }
    for (const [pos, arr] of Object.entries(byPos)) { arr.sort((a, b) => b[1] - a[1]); arr.forEach(([sid], i) => { (ranks[sid] ||= {})[w] = i + 1; }); }
  }
  S._formIdx = { at: W.at, ranks, weeks: Object.keys(W.weeks).map(Number).sort((a, b) => a - b) };
  return S._formIdx;
}

function formOf(sid) {
  const W = S.weekly, idx = formIndex();
  if (!W || !idx) return null;
  const pos = (S.dict[sid] || [])[1];
  const games = idx.weeks.filter((w) => W.weeks[w][sid]).map((w) => {
    const r = W.weeks[w][sid];
    const opp = pos === 'QB' ? (r[6] || 0) + (r[5] || 0) : (r[3] || 0) + (r[5] || 0);
    return { w, pts: r[0], snap: r[1] != null && r[2] ? r[1] / r[2] : null, opp, tgt: r[3], ra: r[5], rank: (idx.ranks[sid] || {})[w] || null };
  });
  if (!games.length) return { sid, pos, games, n: 0 };
  const avg = (arr) => { const v = arr.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const last = games.slice(-3);
  const f = {
    sid, pos, games, n: games.length,
    ptsAvg: avg(games.map((g) => g.pts)), pts3: avg(last.map((g) => g.pts)),
    snapAvg: avg(games.map((g) => g.snap)), snap3: avg(last.map((g) => g.snap)),
    oppAvg: avg(games.map((g) => g.opp)), opp3: avg(last.map((g) => g.opp)),
    starterWeeks: games.filter((g) => g.rank && g.rank <= (STARTER_LINE[pos] || 24)).length,
  };
  const pr = f.ptsAvg ? f.pts3 / f.ptsAvg - 1 : 0;
  const ds = f.snapAvg != null && f.snap3 != null ? f.snap3 - f.snapAvg : null;
  const orr = f.oppAvg ? f.opp3 / f.oppAvg - 1 : 0;
  f.heat = games.length < 3 ? 'new' : pr >= 0.2 && f.pts3 >= 6 ? 'hot' : pr <= -0.2 ? 'cold' : 'steady';
  f.heatPct = pr;
  // Trend identification from usage vs production
  const usageUp = (ds != null && ds >= 0.08) || orr >= 0.25;
  const usageDown = (ds != null && ds <= -0.08) || orr <= -0.25;
  if (games.length < 3) f.trend = { k: 'mid', t: 'Too few games to read' };
  else if (usageUp && pr >= 0.1) f.trend = { k: 'good', t: 'Breaking out: more work and more points' };
  else if (usageUp) f.trend = { k: 'good', t: 'Due for more: usage up, points haven\'t caught up' };
  else if (usageDown && pr <= -0.1) f.trend = { k: 'sell', t: 'Fading: losing work and points' };
  else if (usageDown) f.trend = { k: 'warn', t: 'Warning: usage down, points holding for now' };
  else if (pr >= 0.25) f.trend = { k: 'warn', t: 'Running hot on the same work: may cool off' };
  else if (pr <= -0.25) f.trend = { k: 'good', t: 'Unlucky: same work, fewer points; should bounce back' };
  else f.trend = { k: 'mid', t: 'Steady' };
  f.dSnap = ds; f.dOpp = orr;
  return f;
}

function viewForm() {
  const m = S.model;
  const W = S.weekly;
  const st = (S.book.status || {}).weekly;
  if (!W || !Object.keys(W.weeks || {}).length) return `<div class="card"><h3>Roster form</h3><p class="muted">${st && !st.ok ? `Weekly stats couldn't load: ${esc(st.error)}` : 'Weekly stats load on the next sync.'}</p><button class="btn primary" data-action="sync">Sync now</button></div>`;
  const f = S.ui.form;
  const rid = f.rid == null ? m.me : Number(f.rid);
  const t = team(rid);
  const idx = formIndex();
  const pct0 = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  let rows = (t.roster.players || []).filter((sid) => STARTER_LINE[(S.dict[sid] || [])[1]]).map(formOf).filter((x) => x && (f.pos === 'ALL' || x.pos === f.pos));
  const order = { hot: 0, steady: 1, new: 2, cold: 3 };
  rows.sort((a, b) => (f.sort === 'avg' ? (b.ptsAvg || 0) - (a.ptsAvg || 0) : f.sort === 'snap' ? (b.dSnap ?? -9) - (a.dSnap ?? -9) : f.sort === 'opp' ? (b.dOpp || 0) - (a.dOpp || 0) : (order[a.heat] - order[b.heat]) || (b.heatPct - a.heatPct)));
  const cell = (g, pos) => {
    if (!g) return '<td class="wk-c bye" title="Did not play">·</td>';
    const line = STARTER_LINE[pos] || 24;
    const cls = !g.rank ? '' : g.rank <= Math.ceil(line / 3) ? 'c-elite' : g.rank <= line ? 'c-start' : g.rank <= line * 1.5 ? 'c-flex' : 'c-bad';
    return `<td class="wk-c ${cls}" title="Week ${g.w}: ${g.pts} pts, ${pos}${g.rank || '—'}${g.snap != null ? `, ${Math.round(g.snap * 100)}% snaps` : ''}, ${g.opp} opportunities">${Math.round(g.pts)}</td>`;
  };
  const arrow = (d, fmt) => (d == null ? '' : `<span class="${d > 0.03 ? 'up' : d < -0.03 ? 'down' : 'muted'}">${d > 0.03 ? '▲' : d < -0.03 ? '▼' : '•'} ${fmt}</span>`);
  const heatTag = (h, p) => ({ hot: `<span class="pill sell">🔥 Hot ${signPct(p)}</span>`, cold: `<span class="pill mid">❄ Cold ${signPct(p)}</span>`, steady: '<span class="pill">Steady</span>', new: '<span class="faint small">few games</span>' })[h];
  const body = rows.map((x) => {
    const byW = Object.fromEntries(x.games.map((g) => [g.w, g]));
    return `<tr class="${t.winNowIds.includes(x.sid) ? 'me' : ''}">
      <td><div class="who">${headshot(x.sid)}<div>${playerLink(x.sid)}<div class="meta">${posTag(x.pos)} ${esc(P(x.sid).team || '')}${P(x.sid).inj ? ` <span class="down">${esc(P(x.sid).inj)}</span>` : ''}</div></div></div></td>
      <td class="num">${x.ptsAvg != null ? x.ptsAvg.toFixed(1) : '—'}</td>
      <td class="num"><b>${x.pts3 != null ? x.pts3.toFixed(1) : '—'}</b></td>
      <td>${heatTag(x.heat, x.heatPct) || ''}</td>
      ${idx.weeks.map((w) => cell(byW[w], x.pos)).join('')}
      <td class="num">${W.snaps ? `${pct0(x.snapAvg)} → <b>${pct0(x.snap3)}</b><div class="small">${arrow(x.dSnap, x.dSnap != null ? `${Math.round(Math.abs(x.dSnap) * 100)} pts` : '')}</div>` : '—'}</td>
      <td class="num">${x.oppAvg != null ? `${x.oppAvg.toFixed(1)} → <b>${x.opp3.toFixed(1)}</b><div class="small">${arrow(x.dOpp, `${Math.round(Math.abs(x.dOpp) * 100)}%`)}</div>` : '—'}</td>
      <td class="num">${x.n ? `${x.starterWeeks}/${x.n}` : '—'}</td>
      <td><span class="trend t-${x.trend ? x.trend.k : 'mid'}">${esc(x.trend ? x.trend.t : '')}</span></td>
    </tr>`;
  }).join('');
  // League-wide usage risers (rostered anywhere or free agents)
  const owner = {};
  for (const tm of m.teams) for (const sid of tm.roster.players || []) owner[sid] = tm.rid;
  const pool = new Set();
  for (const w of idx.weeks.slice(-3)) for (const sid of Object.keys(W.weeks[w])) pool.add(sid);
  const risers = [...pool].map(formOf).filter((x) => x && x.n >= 4 && (x.dSnap != null ? x.dSnap >= 0.1 : x.dOpp >= 0.35) && x.opp3 >= 4).sort((a, b) => (b.dSnap ?? b.dOpp) - (a.dSnap ?? a.dOpp)).slice(0, 12);
  const riserRows = risers.map((x) => `<tr><td><div class="who">${headshot(x.sid)}<div>${playerLink(x.sid)}<div class="meta">${posTag(x.pos)} ${esc(P(x.sid).team || '')}</div></div></div></td><td>${owner[x.sid] != null ? tlink(owner[x.sid]) : `<button class="btn sm" data-action="addTarget" data-sid="${esc(x.sid)}">Free agent · + target</button>`}</td><td class="num">${W.snaps ? `${pct0(x.snapAvg)} → <b>${pct0(x.snap3)}</b>` : '—'}</td><td class="num">${x.oppAvg.toFixed(1)} → <b>${x.opp3.toFixed(1)}</b></td><td class="num">${x.ptsAvg.toFixed(1)} → <b>${x.pts3.toFixed(1)}</b></td></tr>`).join('');
  const sel = (key, opts) => `<select data-form="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(f[key] ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return `<div class="card"><div class="sec-h"><h3 style="margin:0">Roster form</h3><div class="row">${sel('rid', m.teams.map((x) => [x.rid, x.isMe ? `${x.name} (you)` : x.name]).map(([v, l]) => [v, l]).map((o) => o)).replace(`value="${rid}"`, `value="${rid}" selected`)}${sel('pos', [['ALL', 'All positions'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']])}${sel('sort', [['form', 'Hottest first'], ['avg', 'Season average'], ['snap', 'Snap share change'], ['opp', 'Opportunity change']])}</div></div>
      <p class="lede">Points are scored with your league's settings. <b>Hot/cold</b> compares his last 3 games with his season average (±20%). Each week's box is coloured by where he finished at his position: <span class="lg c-elite">elite</span> <span class="lg c-start">starter</span> <span class="lg c-flex">flex</span> <span class="lg c-bad">below</span>. <b>Snaps</b> is his share of the team's offensive plays; <b>opportunities</b> are targets plus carries (pass attempts plus carries for QBs). Trends compare usage with production: more work usually comes before more points.${W.snaps ? '' : ' Snap counts aren\'t in Sleeper\'s data this season, so trends use opportunities only.'}</p>
      <div class="scroll"><table class="t form"><thead><tr><th>Player</th><th class="num">Avg</th><th class="num">Last 3</th><th>Form</th>${idx.weeks.map((w) => `<th class="num wk-h">W${w}</th>`).join('')}<th class="num">Snaps season → last 3</th><th class="num">Opps/g season → last 3</th><th class="num" title="Weeks he finished as a weekly starter at his position">Starter wks</th><th>Trend</th></tr></thead><tbody>${body || `<tr><td colspan="${idx.weeks.length + 8}" class="muted">No players match.</td></tr>`}</tbody></table></div>
      <p class="faint small">Highlighted rows are his best lineup. Weekly stats through week ${idx.weeks[idx.weeks.length - 1]}, from Sleeper.</p></div>
    <div class="card"><h3>Usage risers around the league</h3><p class="lede">Players whose snap share (or opportunities) jumped over the last three games, with at least 4 opportunities a game. Free agents can go straight onto your waiver list.</p>
      ${riserRows ? `<div class="scroll"><table class="t"><thead><tr><th>Player</th><th>Owner</th><th class="num">Snaps</th><th class="num">Opps/g</th><th class="num">Pts/g</th></tr></thead><tbody>${riserRows}</tbody></table></div>` : '<p class="muted">No big usage jumps right now.</p>'}</div>`;
}

// ---- my trade block: establish value fast ------------------------------------------------------

const fcCache = {};

function blockPlayers(m) {
  const me = team(m.me);
  const ids = new Set();
  const out = [];
  for (const b of me.block) if (b.kind !== 'pick' && b.id && !ids.has(b.id)) { ids.add(b.id); out.push({ sid: b.id, at: b.at, onBlock: true }); }
  for (const sid of S.blockExtra || []) if (!ids.has(sid) && (me.roster.players || []).includes(sid)) { ids.add(sid); out.push({ sid, at: null, onBlock: false }); }
  return out;
}

function realTrades(m, sid) {
  // This league (all seasons we have)
  const here = [...m.leagueTrades, ...m.histTrades].filter((nt) => nt.rids.some((r) => nt.sides[r].inP.includes(sid))).sort((a, b) => b.created - a.created).map((nt) => {
    const to = nt.rids.find((r) => nt.sides[r].inP.includes(sid));
    const from = nt.rids.find((r) => r !== to);
    const nm = (r) => (team(r) ? tname(r) : (nt.nameOf && nt.nameOf[r]) || tname(r));
    return { where: 'This league', at: nt.created, to: nm(to), from: nm(from), got: (nt.recv[from] || []).map((a) => (a.kind === 'pick' ? a.label : a.name)), with: (nt.recv[to] || []).filter((a) => a.id !== sid).map((a) => (a.kind === 'pick' ? a.label : a.name)), nt, to2: to, from2: from };
  });
  // League-mates' other leagues (from the other-league scan)
  const elsewhere = [];
  const seen = new Set();
  for (const t of m.teams) {
    const o = S.raw.others && S.raw.others[t.userId];
    if (!o || !o.leagues) continue;
    for (const lg of o.leagues) for (const tr of lg.trades || []) {
      const got = tr.in.includes(sid), gave = tr.out.includes(sid);
      if (!got && !gave) continue;
      const key = `${lg.id}|${tr.created}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pk = (arr, n) => (arr && arr.length ? arr.map((x) => { const [y, r] = x.split(':'); return `${y} ${roundName(Number(r))}`; }) : n ? [`${n} pick${n > 1 ? 's' : ''}`] : []);
      const ins = [...tr.in.map((x) => P(x).name), ...pk(tr.pin, tr.picksIn)];
      const outs = [...tr.out.map((x) => P(x).name), ...pk(tr.pout, tr.picksOut)];
      elsewhere.push({ where: `${lg.name}${lg.sf != null ? ` (${lg.sf ? 'Superflex' : '1QB'}${lg.size ? `, ${lg.size} teams` : ''}${lg.tep ? ', TE premium' : ''})` : ''}`, at: tr.created, mgr: t.name, dir: got ? 'bought' : 'sold', for: got ? outs.filter((x) => x !== P(sid).name) : ins.filter((x) => x !== P(sid).name), with: got ? ins.filter((x) => x !== P(sid).name) : outs.filter((x) => x !== P(sid).name) });
    }
  }
  elsewhere.sort((a, b) => b.at - a.at);
  return { here, elsewhere };
}

function equivalents(m, v) {
  // Picks and other teams' players worth about the same today.
  const lo = v * 0.9, hi = v * 1.1;
  const players = m.teams.filter((t) => !t.isMe).flatMap((t) => t.assets.filter((a) => VALUE_POS.includes(a.pos) && a.v >= lo && a.v <= hi).map((a) => ({ ...a, rid: t.rid }))).sort((a, b) => Math.abs(a.v - v) - Math.abs(b.v - v)).slice(0, 6);
  const y = m.league.season + 1;
  const pv = (yr, rd, tier) => { const arr = S.book.picks[`${yr} ${rd} ${tier}`] || S.book.picks[`${yr} ${rd} any`] || S.book.picks[`${yr} ${rd} mid`]; return arr ? (arr[0] != null ? arr[0] : arr[1] != null ? arr[1] * (S.book.fcToKtc || 1) : 0) : 0; };
  const singles = [];
  for (const yr of [y, y + 1].filter((x) => !(m.lockedSeasons || []).includes(x))) for (const rd of [1, 2, 3]) for (const tier of yr === y ? ['early', 'mid', 'late'] : ['mid']) { const val = pv(yr, rd, tier); if (val) singles.push({ label: `${yr} ${tier === 'mid' && yr !== y ? '' : tier + ' '}${roundName(rd)}`.replace('  ', ' '), v: val }); }
  const combos = [];
  for (const a of singles) { if (a.v >= lo && a.v <= hi) combos.push({ label: a.label, v: a.v }); for (const b of singles) if (b !== a && b.v <= a.v && a.v + b.v >= lo && a.v + b.v <= hi * 1.05) combos.push({ label: `${a.label} + ${b.label}`, v: a.v + b.v }); }
  const uniq = [...new Map(combos.map((c) => [c.label, c])).values()].sort((a, b) => Math.abs(a.v - v) - Math.abs(b.v - v)).slice(0, 4);
  return { players, picks: uniq };
}

function viewBlock() {
  const m = S.model;
  const me = team(m.me);
  const list = blockPlayers(m);
  const addOpts = me.assets.filter((a) => VALUE_POS.includes(a.pos) && !list.some((x) => x.sid === a.id)).sort((a, b) => b.v - a.v);
  const head = `<div class="sec-h"><h2>My trade block</h2><div class="row"><select id="block-add"><option value="">Add one of my players…</option>${addOpts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} (${esc(a.pos)}, ${k(a.v)})</option>`).join('')}</select><button class="btn sm" data-action="blockAdd">Add</button></div></div>
    <p class="lede" style="margin-top:-6px">Players on your Sleeper trade block${S.raw.block && !S.raw.block.ok ? ' (Sleeper\'s block couldn\'t be read, so only players you add here show)' : ''}, plus any you add here. For each: what every site says he's worth, real trades involving him, what's worth about the same, and who's interested.</p>`;
  if (!list.length) return head + '<div class="card"><p class="muted">Nothing on your block yet. Add players to your trade block in Sleeper, or add one here.</p></div>';
  const fmtL = S.book.fmt && S.book.fmt.superflex ? 'Superflex' : '1QB';
  const otherL = fmtL === 'Superflex' ? '1QB' : 'Superflex';
  return head + list.map(({ sid, at, onBlock }) => {
    const p = P(sid);
    const v = pval(sid);
    const fcK = v.fc != null ? Math.round(v.fc * (S.book.fcToKtc || 1)) : null;
    const opinions = [v.ktc, fcK].filter((x) => x != null);
    const consensus = opinions.length ? Math.round(opinions.reduce((s2, x) => s2 + x, 0) / opinions.length) : v.v;
    const spread = opinions.length === 2 ? Math.abs(opinions[0] - opinions[1]) / Math.max(1, consensus) : null;
    const pj = m.aging && m.aging.players[sid];
    const { here, elsewhere } = realTrades(m, sid);
    const eq = equivalents(m, consensus);
    const suitors = (m.demand.find((d) => d.asset.id === sid) || { suitors: [] }).suitors;
    const offers = (m.incoming || []).filter((x) => (x.nt.recv[x.rid] || []).some((a) => a.id === sid));
    const fc = fcCache[sid];
    const tradeLine = (t) => `<li><b>${esc(dateY(t.at))}</b> · ${esc(t.where)}: <b>${esc(t.to || t.mgr)}</b> ${t.dir ? esc(t.dir) : 'got'} him${t.with && t.with.length ? ` with ${esc(t.with.join(', '))}` : ''} for <b>${esc((t.got || t.for).join(', ') || 'nothing listed')}</b>${t.from ? ` from ${esc(t.from)}` : ''}</li>`;
    return `<div class="card blockcard">
      <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div class="who">${headshot(sid, 'lg')}<div><h3 style="margin:0">${playerLink(sid)}</h3><div class="meta">${posTag(p.pos)} ${esc(p.team || 'FA')} · age ${p.age ? p.age.toFixed(1) : '—'}${p.inj ? ` · <span class="down">${esc(p.inj)}</span>` : ''}${onBlock ? ` · on your Sleeper block${at ? ` since ${esc(dateY(at))}` : ''}` : ' · added here'}</div>${pj ? `<div class="meta">${esc(pj.tier)} ${esc(pj.pos)}, ${esc(pj.phase)} · ${pj.seasons.map((x) => x.ppg.toFixed(1)).join(' → ')} pts/g next 3 seasons</div>` : ''}</div></div>
        <div class="row"><button class="btn sm primary" data-action="shop" data-sid="${esc(sid)}">Find trades</button>${!onBlock ? `<button class="btn sm" data-action="blockRemove" data-sid="${esc(sid)}">Remove</button>` : ''}</div>
      </div>
      <div class="values">
        <div class="vbox hot"><span>Consensus</span><b>${k(consensus)}</b><span>${spread != null ? (spread > 0.15 ? `<span class="warn">sites disagree by ${Math.round(spread * 100)}%</span>` : 'sites agree') : 'one source'}</span></div>
        <div class="vbox"><span>KTC ${fmtL}${S.book.fmt && S.book.fmt.ktcTier ? ' TE+' : ''}</span><b>${k(v.ktc)}</b><span>${v.ktcRank ? `#${v.ktcRank} overall · ${esc(p.pos)}${v.ktcPosRank || ''}` : ''}${v.ktcTrend ? ` · ${v.ktcTrend > 0 ? '+' : ''}${v.ktcTrend} this week` : ''}</span></div>
        <div class="vbox"><span>KTC ${otherL}</span><b>${k(v.ktcOther)}</b><span>for leagues of the other format</span></div>
        <div class="vbox"><span>FantasyCalc dynasty</span><b>${k(v.fc)}</b><span>${fcK != null ? `≈ ${k(fcK)} on the KTC scale` : ''}${v.trend30 ? ` · ${v.trend30 > 0 ? '+' : ''}${v.trend30} in 30 days` : ''}</span></div>
        <div class="vbox"><span>FantasyCalc redraft</span><b>${k(v.redraft)}</b><span>this season only</span></div>
        <div class="vbox"><span>DynastyProcess</span><b>${k(v.dp)}</b><span>steeper scale; rank matters more than the number</span></div>
      </div>
      <div class="two" style="align-items:start;margin-top:12px">
        <div>
          <h4>Real trades with him</h4>
          ${here.length ? `<div class="faint small">In this league</div><ul class="tl">${here.slice(0, 6).map(tradeLine).join('')}</ul>` : '<p class="muted small">Never traded in this league.</p>'}
          ${elsewhere.length ? `<div class="faint small" style="margin-top:8px">In your league-mates' other leagues</div><ul class="tl">${elsewhere.slice(0, 8).map(tradeLine).join('')}</ul>` : '<p class="faint small">No trades of him in league-mates\' other leagues (rescan other leagues in Settings to include pick details).</p>'}
          <div style="margin-top:8px">${fc ? (fc.error ? `<p class="faint small">FantasyCalc trade database unavailable: ${esc(fc.error)}</p>` : `<div class="faint small">FantasyCalc trade database (${esc(fmtL)}, real trades from many leagues)</div><ul class="tl">${fc.trades.slice(0, 8).map((t) => { const mine = t.a.some((x) => normName(x) === normName(p.name)); const got = mine ? t.b : t.a; const w = (mine ? t.a : t.b).filter((x) => normName(x) !== normName(p.name)); return `<li>${t.date ? `<b>${esc(dateY(t.date))}</b> · ` : ''}${esc(p.name)}${w.length ? ` + ${esc(w.join(', '))}` : ''} for <b>${esc(got.join(', '))}</b></li>`; }).join('')}</ul>`) : v.fcId ? `<button class="btn sm" data-action="fcTrades" data-sid="${esc(sid)}">Load recent trades from FantasyCalc</button>` : ''}</div>
        </div>
        <div>
          <h4>Worth about the same (±10%)</h4>
          ${eq.picks.length ? `<ul class="tl">${eq.picks.map((x) => `<li>${esc(x.label)} <span class="faint">${k(x.v)}</span></li>`).join('')}</ul>` : ''}
          ${eq.players.length ? `<div class="list">${eq.players.map((a) => `<div class="it">${headshot(a.id)}<span class="nm">${playerLink(a.id, a.name)} <span class="muted small">${esc(a.pos)} ${a.age ? Math.floor(a.age) : ''} · ${esc(tname(a.rid))}</span></span><span class="muted">${k(a.v)}</span></div>`).join('')}</div>` : ''}
          <h4 style="margin-top:12px">Who's interested</h4>
          ${suitors.length ? suitors.map((x) => `<div style="margin:4px 0 8px"><div class="who">${teamAvatar(team(x.rid))}${tlink(x.rid)}</div><div>${x.why.map((w) => `<span class="chip k-${w.k}">${esc(w.text)}</span>`).join('')}</div></div>`).join('') : '<p class="muted small">No clear buyer yet.</p>'}
          ${offers.length ? `<h4 style="margin-top:12px">Offers you've had for him</h4><ul class="tl">${offers.slice(0, 6).map((x) => `<li><b>${esc(dateY(x.created))}</b> · ${esc(tname(x.rid))} offered ${esc((x.nt.recv[m.me] || []).map((a) => (a.kind === 'pick' ? a.label : a.name)).join(', ') || 'nothing')} <span class="${x.ask > 0.12 ? 'down' : x.ask < 0 ? 'up' : 'muted'}">(ask ${signPct(x.ask)})</span> · ${esc(x.status === 'complete' ? 'accepted' : x.status)}</li>`).join('')}</ul>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ---- offers sent to you ---------------------------------------------------------------------

function viewIncoming() {
  const m = S.model;
  const f = S.ui.inc;
  const day = (v) => (v ? Date.parse(v + 'T00:00:00') : null);
  const from = day(f.from), to = day(f.to) ? day(f.to) + 86400e3 : null;
  const stance = S.cfg.stanceSince ? day(S.cfg.stanceSince) : null;
  const STATUS = { complete: ['Accepted', 'good'], rejected: ['You rejected', 'sell'], cancelled: ['He withdrew', 'mid'], proposed: ['Waiting', 'warn'] };
  let rows = (m.incoming || []).filter((x) => (f.rid === 'all' || String(x.rid) === String(f.rid)) && (!from || x.created >= from) && (!to || x.created < to) && (f.status === 'all' || x.status === f.status));
  if (f.sort === 'ask') rows = [...rows].sort((a, b) => (b.ask ?? -9) - (a.ask ?? -9));
  else if (f.sort === 'askAsc') rows = [...rows].sort((a, b) => (a.ask ?? 9) - (b.ask ?? 9));
  const asks = rows.map((x) => x.ask).filter((x) => x != null).sort((a, b) => a - b);
  const mean = (arr) => (arr.length ? arr.reduce((s2, v) => s2 + v, 0) / arr.length : null);
  const median = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : null);
  const share = (pred) => (asks.length ? asks.filter(pred).length / asks.length : null);

  // weekly series (within the filter)
  const wk = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const byWeek = {};
  for (const x of rows) (byWeek[wk(x.created)] ||= []).push(x);
  const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
  let chart = '';
  if (weeks.length >= 2) {
    const first = weeks[0], last = weeks[weeks.length - 1];
    const all = [];
    for (let w = first; w <= last; w += 7 * 86400e3) all.push(wk(w + 3600e3 * 12));
    const uniq = [...new Set(all)];
    const W = 640, H = 170, L = 34, R = 46, T = 12, B = 26;
    const bw = (W - L - R) / uniq.length;
    const maxN = Math.max(...uniq.map((w) => (byWeek[w] || []).length), 1);
    const askVals = uniq.map((w) => mean((byWeek[w] || []).map((x) => x.ask).filter((v) => v != null)));
    const aMax = Math.max(0.3, ...askVals.filter((v) => v != null)), aMin = Math.min(-0.2, ...askVals.filter((v) => v != null));
    const yA = (v) => T + (1 - (v - aMin) / (aMax - aMin)) * (H - T - B);
    const bars = uniq.map((w, i) => { const n = (byWeek[w] || []).length; const h = (n / maxN) * (H - T - B); return `<rect x="${L + i * bw + bw * 0.18}" y="${H - B - h}" width="${bw * 0.64}" height="${h}" rx="3" fill="var(--line-2)"><title>Week of ${new Date(w).toLocaleDateString()}: ${n} offer${n === 1 ? '' : 's'}</title></rect>`; }).join('');
    const pts = uniq.map((w, i) => (askVals[i] == null ? null : [L + i * bw + bw / 2, yA(askVals[i]), askVals[i], w])).filter(Boolean);
    const line = pts.length > 1 ? `<polyline points="${pts.map((p) => `${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="var(--orange)" stroke-width="2"/>` : '';
    const dots = pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--orange)"><title>Week of ${new Date(p[3]).toLocaleDateString()}: average ask ${signPct(p[2])}</title></circle>`).join('');
    const zero = `<line class="gl" x1="${L}" x2="${W - R}" y1="${yA(0)}" y2="${yA(0)}"/><text x="${W - R + 4}" y="${yA(0) + 4}">0%</text><text x="${W - R + 4}" y="${yA(aMax) + 8}">${signPct(aMax)}</text>`;
    const stanceX = stance && stance >= first && stance <= last + 7 * 86400e3 ? L + ((stance - first) / (7 * 86400e3)) * bw : null;
    const labels = uniq.map((w, i) => (i % Math.ceil(uniq.length / 8) === 0 ? `<text x="${L + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${new Date(w).toLocaleDateString([], { month: 'short', day: 'numeric' })}</text>` : '')).join('');
    chart = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Offers per week and average ask">${zero}${bars}${line}${dots}${labels}<text x="${L - 6}" y="${T + 8}" text-anchor="end">${maxN}</text>${stanceX != null ? `<line x1="${stanceX}" x2="${stanceX}" y1="${T}" y2="${H - B}" stroke="var(--violet-2)" stroke-dasharray="4 3"/><text x="${stanceX + 4}" y="${T + 10}" fill="var(--violet-2)">firm stance</text>` : ''}</svg>
      <div class="row small muted"><span><i class="sw" style="background:var(--line-2)"></i>Offers per week</span><span style="color:var(--orange)">● Average ask that week</span></div></div>`;
  }

  // before / after your firmer stance
  let compare = '';
  if (stance) {
    const all = (m.incoming || []).filter((x) => f.rid === 'all' || String(x.rid) === String(f.rid));
    const seg = (arr, a, b) => {
      const span = Math.max(7, (b - a) / 86400e3);
      const ak = arr.map((x) => x.ask).filter((v) => v != null);
      return { n: arr.length, perWeek: arr.length / (span / 7), ask: mean(ak), fair: ak.length ? ak.filter((v) => v <= 0.1).length / ak.length : null, accepted: arr.filter((x) => x.status === 'complete').length };
    };
    const before = all.filter((x) => x.created < stance), after = all.filter((x) => x.created >= stance);
    const b0 = before.length ? Math.min(...before.map((x) => x.created)) : stance - 28 * 86400e3;
    const A = seg(before, b0, stance), Bq = seg(after, stance, Date.now());
    const delta = (a, b, fmt, better) => (a == null || b == null ? '' : `<span class="${(b - a) * better > 0 ? 'up' : (b - a) * better < 0 ? 'down' : 'muted'}">${b - a >= 0 ? '▲' : '▼'} ${fmt(Math.abs(b - a))}</span>`);
    compare = `<div class="card"><h3>Before and after your firmer stance (${esc(dateY(stance))})</h3>
      <div class="scroll"><table class="t"><thead><tr><th></th><th class="num">Before</th><th class="num">Since</th><th>Change</th></tr></thead><tbody>
        <tr><td>Offers to you</td><td class="num">${A.n}</td><td class="num">${Bq.n}</td><td></td></tr>
        <tr><td>Offers per week</td><td class="num">${A.perWeek.toFixed(1)}</td><td class="num">${Bq.perWeek.toFixed(1)}</td><td>${delta(A.perWeek, Bq.perWeek, (v) => v.toFixed(1), 1)}</td></tr>
        <tr><td>Average ask (his favour)</td><td class="num">${signPct(A.ask)}</td><td class="num">${signPct(Bq.ask)}</td><td>${delta(A.ask, Bq.ask, (v) => `${Math.round(v * 100)} pts`, -1)}</td></tr>
        <tr><td>Offers within +10% of fair</td><td class="num">${pct(A.fair)}</td><td class="num">${pct(Bq.fair)}</td><td>${delta(A.fair, Bq.fair, (v) => `${Math.round(v * 100)} pts`, 1)}</td></tr>
        <tr><td>Accepted by you</td><td class="num">${A.n ? `${A.accepted} (${pct(A.accepted / A.n)})` : '—'}</td><td class="num">${Bq.n ? `${Bq.accepted} (${pct(Bq.accepted / Bq.n)})` : '—'}</td><td></td></tr>
      </tbody></table></div>
      <p class="faint small">Green means better for you: more offers, lower asks, more fair offers. ${Bq.n < 5 ? 'Too few offers since then to call it yet.' : ''}</p></div>`;
  }

  const sideList = (o, r) => (o.recv[r] || []).map((a) => `<div class="mini">${a.kind === 'pick' ? '<span class="pos PK">PK</span>' : posTag(a.pos)} ${esc(a.kind === 'pick' ? a.label : a.name)} <span class="faint">${k(o.thenVals && o.thenVals[a.key] != null ? o.thenVals[a.key] : a.v)}</span></div>`).join('') || '<span class="faint">nothing</span>';
  const body = rows.map((x) => {
    const o = x.nt;
    const st = STATUS[x.status] || [x.status, 'mid'];
    const d = o.deal && o.deal[x.rid];
    const open = f.open === x.id;
    return `<tr class="${x.created >= (stance || Infinity) ? 'after' : ''}">
      <td>${esc(dateY(x.created))}</td>
      <td><div class="who">${teamAvatar(team(x.rid))}${tlink(x.rid)}</div></td>
      <td><span class="pill ${st[1]}">${esc(st[0])}</span></td>
      <td class="small">${sideList(o, x.rid)}</td>
      <td class="small">${sideList(o, m.me)}</td>
      <td class="num small">${d ? `${k(d.got)} / ${k(d.gave)}` : '—'}</td>
      <td class="num"><b class="${x.ask > 0.3 ? 'down' : x.ask > 0.12 ? 'warn' : x.ask < 0 ? 'up' : ''}">${signPct(x.ask)}</b></td>
      <td class="num">${signPct(x.askNow)}</td>
      <td class="num small">${x.openMs != null ? esc(dur(x.openMs)) : '—'}</td>
      <td><button class="ibtn" data-action="incOpen" data-id="${esc(x.id)}" title="Show the full trade card">${open ? '▾' : '▸'}</button></td>
    </tr>${open ? `<tr><td colspan="10">${tradeCard(o)}</td></tr>` : ''}`;
  }).join('');
  const mgrSel = `<select data-inc="rid"><option value="all">All managers</option>${m.teams.filter((t) => !t.isMe).map((t) => `<option value="${t.rid}" ${String(f.rid) === String(t.rid) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
  const stSel = `<select data-inc="status">${[['all', 'Any result'], ['proposed', 'Waiting'], ['rejected', 'You rejected'], ['cancelled', 'He withdrew'], ['complete', 'Accepted']].map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const sortSel = `<select data-inc="sort">${[['date', 'Newest first'], ['ask', 'Highest ask first'], ['askAsc', 'Lowest ask first']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const quick = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'All time']].map(([v, l]) => `<button class="btn sm" data-action="incRange" data-days="${v}">${l}</button>`).join('');
  return `${offersNotice()}<div class="three" style="margin-bottom:16px">
      <div class="card tile hot">${icon('swap')}<div class="num">${rows.length}</div><div class="lab">Offers to you in this view</div></div>
      <div class="card tile">${icon('chart')}<div class="num">${signPct(mean(asks))}</div><div class="lab">Average ask · median ${signPct(median(asks))}</div></div>
      <div class="card tile">${icon('flag')}<div class="num">${pct(share((v) => v > 0.3))}</div><div class="lab">Lowballs (asking over +30%) · ${pct(share((v) => v <= 0.1))} within +10% of fair</div></div>
    </div>
    <div class="card"><h3>Offers to you</h3>
      <p class="lede">Every offer another manager has sent you this season. "Ask" is how much more KTC value he'd receive than he'd give, at the time (including KTC's adjustment for uneven deals): +25% means he asked for a quarter more than he offered; negative means the offer leaned your way. Check a row against the full card (▸) if a number looks off.</p>
      <div class="row" style="margin-bottom:10px">
        <label class="f">Manager${mgrSel}</label>
        <label class="f">From<input type="date" data-inc="from" value="${esc(f.from)}"></label>
        <label class="f">To<input type="date" data-inc="to" value="${esc(f.to)}"></label>
        <label class="f">Result${stSel}</label>
        <label class="f">Sort${sortSel}</label>
        <label class="f">My firmer stance started<input type="date" data-stance value="${esc(S.cfg.stanceSince || '')}"></label>
      </div>
      <div class="row" style="margin-bottom:12px">${quick}</div>
      ${chart}
    </div>
    ${compare}
    <div class="card"><div class="scroll"><table class="t inc"><thead><tr><th>Date</th><th>From</th><th>Result</th><th>He gets</th><th>You get</th><th class="num">He gets / gives</th><th class="num">Ask then</th><th class="num">Ask now</th><th class="num">Open</th><th></th></tr></thead><tbody>${body || '<tr><td colspan="10" class="muted">No offers match these filters.</td></tr>'}</tbody></table></div></div>`;
}

// ---- rookie draft ------------------------------------------------------------------------

// Mock draft for next year's order: board talent weighed against each team's weakest rooms (lib/mock.js).
function mockFor(m, picksY, board) {
  if (!board) return {};
  const posRank = {};
  for (const t of m.teams) { const row = (m.positional.teams || {})[t.rid] || {}; posRank[t.rid] = Object.fromEntries(['QB', 'RB', 'WR', 'TE'].map((pos) => [pos, row[pos] ? row[pos].dynRank : null])); }
  const order = picksY.filter((p) => p.overall).map((p) => ({ rid: p.owner, overall: p.overall }));
  const res = mockDraft({ order, board: board.players, posRank, teams: m.teams.length });
  return Object.fromEntries(order.map((o, i) => [o.overall, res[i]]));
}
const mockWhy = (x) => (!x || !x.player ? '' : x.reason === 'bpa' ? 'Best available' : x.reason === 'need' ? `Need: ${x.needPos}${x.needRank ? ` (${ordinal(x.needRank)} in league)` : ''}` : `Fit: ${x.needPos}${x.needRank ? ` (${ordinal(x.needRank)})` : ''}`);

function draftBoard() {
  if (S.draftBoard && S.draftBoard.players && S.draftBoard.players.length) return { ...S.draftBoard, mine: true };
  if (S.draftFp && S.draftFp.players && S.draftFp.players.length) return S.draftFp;
  return null;
}

// Out with the old: who won't be back, how many spots that frees for rookies,
// and how many cuts you'll need in the week after the draft.
const RETIRE_AGE = { QB: 38, RB: 30, WR: 32, TE: 32, K: 40 };
function outWithOldCard() {
  const m = S.model;
  const me = team(m.me);
  const y = m.league.season + 1;
  const rp = (S.raw.league && S.raw.league.roster_positions) || [];
  const limit = rp.filter((x) => x !== 'IR' && x !== 'TAXI').length || 25;
  const taxi = Number(((S.raw.league || {}).settings || {}).taxi_slots || 0);
  const picks = m.picks.filter((p) => p.season === y && p.owner === m.me).sort((a, b) => a.round - b.round || (a.slot || 99) - (b.slot || 99));
  const lastPickV = picks.length ? Math.min(...picks.map((p) => p.v)) : 0;
  const marks = (S.cfg.outList && S.cfg.outList[y]) || {};
  const players = (me.roster.players || []).map((sid) => {
    const a = me.assets.find((x) => x.id === sid) || { ...P(sid), v: 0 };
    const why = [];
    if (a.pos !== 'DEF' && !a.team) why.push('free agent in the NFL');
    // Old AND fading (or very old): a 30-year-old RB still worth a lot is a trade chip, not a cut.
    if (a.age && RETIRE_AGE[a.pos] && a.age >= RETIRE_AGE[a.pos] && (a.v < 2500 || a.age >= RETIRE_AGE[a.pos] + 3)) why.push(`${Math.floor(a.age)} and fading: retirement or release risk`);
    if (VALUE_POS.includes(a.pos) && lastPickV && a.v < lastPickV) why.push(`worth less than your last pick (${k(a.v)} vs ${k(lastPickV)})`);
    if (a.pos === 'DEF' && (me.roster.players || []).filter((x) => P(x).pos === 'DEF').length > 1) why.push('second defense: easy to re-add');
    const auto = why.length > 0;
    const mark = marks[sid] || null; // 'out' | 'keep' | null (use the suggestion)
    const out = mark ? mark === 'out' : auto;
    return { ...a, id: sid, why, auto, mark, out };
  }).sort((a, b) => (b.out - a.out) || a.v - b.v);
  const now = players.length;
  const gone = players.filter((x) => x.out).length;
  const kept = now - gone;
  const open = limit + taxi - kept;
  const after = kept + picks.length;
  const cuts = Math.max(0, after - limit - taxi);
  const tone = cuts > 0 ? 'down' : open - picks.length > 0 ? 'up' : '';
  const verdict = cuts > 0
    ? `With ${picks.length} pick${picks.length === 1 ? '' : 's'} and ${open} open spot${open === 1 ? '' : 's'}, you'll need to cut ${cuts} more player${cuts === 1 ? '' : 's'} in the week after the draft (or rookies). Consider packaging late picks to move up instead of drafting players you'll cut.`
    : open > picks.length
      ? `You'll have ${open - picks.length} spot${open - picks.length === 1 ? '' : 's'} left after drafting all ${picks.length} picks: room to buy another pick or keep a stash.`
      : `Your ${picks.length} picks fit exactly into the ${open} open spots.`;
  const row = (x) => `<tr class="${x.out ? '' : 'faint-row'}"><td><div class="who">${x.pos === 'DEF' ? '' : headshot(x.id)}<div>${S.dict[x.id] ? playerLink(x.id, x.name) : esc(x.name)}<div class="meta">${posTag(x.pos)} ${esc(x.team || 'FA')}${x.age ? ` · ${Math.floor(x.age)}` : ''}${x.inj ? ` · <span class="down">${esc(x.inj)}</span>` : ''}</div></div></div></td>
    <td class="num">${x.v ? k(x.v) : '—'}</td><td class="small muted">${esc(x.why.join('; ')) || ''}</td>
    <td style="white-space:nowrap"><button class="btn sm${x.out ? ' primary' : ''}" data-action="outMark" data-sid="${esc(x.id)}" data-y="${y}" data-v="out">Gone</button> <button class="btn sm${!x.out ? ' primary' : ''}" data-action="outMark" data-sid="${esc(x.id)}" data-y="${y}" data-v="keep">Back</button>${x.mark ? ` <span class="faint small" title="Your choice; the suggestion was ${x.auto ? 'gone' : 'back'}">yours</span>` : ''}</td></tr>`;
  return `<div class="card"><div class="sec-h"><h3 style="margin:0">Out with the old</h3>${Object.keys(marks).length ? `<button class="btn sm" data-action="outReset" data-y="${y}">Back to suggestions</button>` : ''}</div>
    <p class="lede">Who won't be back next year, and whether your ${y} picks fit. Rosters must be back to ${limit}${taxi ? ` (plus ${taxi} taxi)` : ''} a week after the draft. Suggestions: NFL free agents, older players whose value has faded, players worth less than your last pick, and a second defense. Older players who still hold value are better sold than cut: they're left as Back. Mark anyone Gone or Back.</p>
    <div class="facts">
      <div><span>On your roster</span><b>${now}</b><span>incl. IR</span></div>
      <div><span>Not returning</span><b>${gone}</b><span>${players.filter((x) => x.out && !x.mark).length} suggested · ${players.filter((x) => x.out && x.mark).length} yours</span></div>
      <div><span>Open spots</span><b>${open}</b><span>of ${limit + taxi}</span></div>
      <div><span>${y} picks</span><b>${picks.length}</b><span>${picks.map((p) => (p.slot ? `${p.round}.${String(p.slot).padStart(2, '0')}` : roundName(p.round))).join(', ') || 'none'}</span></div>
      <div><span>Cuts after the draft</span><b class="${tone}">${cuts}</b><span>if you make every pick</span></div>
    </div>
    <ul class="ev" style="margin-top:10px"><li class="d-${cuts > 0 ? 'sell' : 'good'}">${esc(verdict)}</li></ul>
    <details class="tree" style="margin-top:6px"${gone ? ' open' : ''}><summary>Your roster (${gone} gone, ${kept} back)</summary>
      <div class="scroll"><table class="t"><thead><tr><th>Player</th><th class="num">Value</th><th>Why</th><th></th></tr></thead><tbody>${players.map(row).join('')}</tbody></table></div>
    </details>
  </div>`;
}

// Every pick you own, every season Sleeper knows about, plus what you've traded away.
function capitalCard() {
  const m = S.model;
  const me = team(m.me);
  const slotTxt = (p) => (p.slot ? `${p.round}.${String(p.slot).padStart(2, '0')}` : roundName(p.round));
  const owned = m.picks.filter((p) => p.owner === m.me).sort((a, b) => a.season - b.season || a.round - b.round || (a.slot || 99) - (b.slot || 99));
  const gone = m.picks.filter((p) => p.orig === m.me && p.owner !== m.me).sort((a, b) => a.season - b.season || a.round - b.round);
  const ranked = [...m.teams].sort((a, b) => b.pickValue - a.pickValue);
  const rank = ranked.findIndex((t) => t.rid === m.me) + 1;
  const bySeason = m.pickSeasons.map((y) => {
    const ps = owned.filter((p) => p.season === y);
    const counts = {};
    for (const p of ps) counts[p.round] = (counts[p.round] || 0) + 1;
    const summary = Object.keys(counts).sort((a, b) => a - b).map((r) => `${counts[r]}× ${roundName(Number(r))}`).join(' · ') || 'none';
    const lk = (m.lockedSeasons || []).includes(y);
    return `<div class="sec-h" style="margin-top:10px"><b>${y}${lk ? ' <span class="pill mid" title="Not tradeable in Sleeper yet. Unlock on the Picks page.">locked</span>' : ''}</b><span class="muted small">${ps.length} pick${ps.length === 1 ? '' : 's'}: ${summary} · ${k(sum2(ps.map((p) => p.v)))}</span></div>
      ${ps.map((p) => `<div class="asset"><span class="av head">PK</span><div class="nm"><b>${y} ${slotTxt(p)}</b><span class="meta">${p.orig === m.me ? 'own' : `via ${esc(tname(p.orig))}`}${p.slot ? ` · ${esc(p.tier)}` : ''}</span></div><div class="vals">${k(p.v)}</div></div>`).join('')}`;
  }).join('');
  return `<div class="card"><h3>Your draft capital</h3>
    <p class="lede">Every pick you own, from Sleeper's pick ownership (refreshed every few minutes, and whenever a trade goes through). Next year's slots are projected; later years are valued as mid-round picks.</p>
    <div class="facts"><div><span>Picks owned</span><b>${owned.length}</b></div><div><span>1sts, all years</span><b>${owned.filter((p) => p.round === 1).length}</b></div><div><span>Pick value</span><b>${k(me.pickValue)}</b></div><div><span>League rank</span><b>${ordinal(rank)}</b><span>of ${m.teams.length}</span></div></div>
    ${bySeason}
    ${gone.length ? `<details class="tree" style="margin-top:10px"><summary>Traded away (${gone.length})</summary>${gone.map((p) => `<div class="asset"><span class="av head">PK</span><div class="nm"><b>${p.season} ${slotTxt(p)}</b><span class="meta">now ${esc(tname(p.owner))}'s</span></div><div class="vals muted">${k(p.v)}</div></div>`).join('')}</details>` : ''}
  </div>`;
}
const sum2 = (a) => a.reduce((x, y) => x + (y || 0), 0);

function viewDraft() {
  const m = S.model;
  const me = team(m.me);
  const y = m.league.season + 1;
  const n = m.teams.length;
  const D = S.draft;
  const board = draftBoard();
  const picksY = m.picks.filter((p) => p.season === y).map((p) => ({ ...p, overall: p.slot ? (p.round - 1) * n + p.slot : null })).sort((a, b) => (a.overall || 999) - (b.overall || 999));
  const mine = picksY.filter((p) => p.owner === m.me);
  const bucketFor = (ov) => D && D.hitRates.find((h) => ov >= h.a && ov <= h.b);
  const firstMine = mine[0];
  const myBucket = firstMine && firstMine.overall ? bucketFor(firstMine.overall) : null;

  // market strength of the coming class
  const past = D ? D.market.filter((x) => !x.current) : [];
  const avgPast = past.length ? past.reduce((s2, x) => s2 + x.r1, 0) / past.length : null;
  const thisM = D ? D.market.find((x) => x.year === y) : null;
  const nextM = D ? D.market.find((x) => x.year === y + 1) : null;
  const strength = thisM && avgPast ? thisM.r1 / avgPast - 1 : null;

  // board-based depth
  const boardTop = board ? board.players.slice(0, 24) : [];
  const boardMix = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const p of boardTop) if (boardMix[p.pos] != null) boardMix[p.pos]++;
  const pastClasses = D ? Object.values(D.classes).sort((a, b) => a.year - b.year) : [];
  const avgMix = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const c of pastClasses) for (const k2 of Object.keys(avgMix)) avgMix[k2] += c.posMix[k2] / Math.max(1, pastClasses.length);

  // insights
  const tips = [];
  if (mine.length) tips.push({ dir: 'buy', text: `You own ${mine.length} ${y} pick${mine.length === 1 ? '' : 's'}: ${mine.map((p) => p.overall ? `${p.round}.${String(p.slot).padStart(2, '0')}` : roundName(p.round)).join(', ')} (projected from the playoff simulation).` });
  else tips.push({ dir: 'sell', text: `You don't own a ${y} pick right now.` });
  if (myBucket && myBucket.rate != null) tips.push({ dir: myBucket.rate >= 0.5 ? 'good' : 'mid', text: `Historically, picks ${myBucket.label} became weekly starters ${pct(myBucket.rate)} of the time (${myBucket.n} players, ${pastClasses.filter((c) => c.mature).map((c) => c.year).join(', ')} classes).` });
  if (strength != null) tips.push({ dir: strength > 0.08 ? 'buy' : strength < -0.08 ? 'sell' : 'mid', text: `The market values ${y} 1sts ${Math.abs(Math.round(strength * 100))}% ${strength >= 0 ? 'above' : 'below'} a typical class at this point of the season${strength > 0.08 ? ': a strong class, so picks are worth holding or buying early' : strength < -0.08 ? ': a weaker class, so trading picks for proven players may be the better use' : ''}.` });
  if (thisM && nextM) tips.push({ dir: 'mid', text: `${y} vs ${y + 1}: a ${y} mid 1st is worth ${Math.round((thisM.r1 / nextM.r1) * 100)}% of a ${y + 1} mid 1st right now. ${thisM.r1 > nextM.r1 * 1.1 ? `Swapping ${y + 1} picks for ${y} picks costs a premium.` : `You can often trade a ${y + 1} 1st for a ${y} 1st plus a sweetener.`}` });
  if (board) {
    const deep = Object.entries(boardMix).map(([pos, c]) => [pos, c - (avgMix[pos] || 0)]).sort((a, b) => b[1] - a[1]);
    if (deep[0][1] >= 2) tips.push({ dir: 'good', text: `${deep[0][0]} is the deep position in this class (${boardMix[deep[0][0]]} of the top 24 vs ${avgMix[deep[0][0]].toFixed(1)} in an average class). You can wait on ${deep[0][0]} and take scarcer positions first.` });
    const thin = deep[deep.length - 1];
    if (thin[1] <= -2) tips.push({ dir: 'sell', text: `${thin[0]} is thin (${boardMix[thin[0]]} of the top 24 vs ${avgMix[thin[0]].toFixed(1)} usually). If you need a ${thin[0]}, it'll cost an early pick.` });
  }
  if (me.needs.length) tips.push({ dir: 'mid', text: `Your roster needs: ${me.needs.join(', ')}. ${D && D.posHit ? me.needs.map((pos) => D.posHit[pos] && D.posHit[pos].rate != null ? `${pos}s taken in rounds 1-2 hit ${pct(D.posHit[pos].rate)}` : '').filter(Boolean).join('; ') : ''}.` });
  const sellers = picksY.filter((p) => p.round <= 2 && p.owner !== m.me && team(p.owner) && ['buy'].includes(team(p.owner).posture.tone) && !team(p.owner).avoid);
  if (sellers.length) tips.push({ dir: 'buy', text: `Contenders holding ${y} picks they may sell for win-now help: ${sellers.slice(0, 5).map((p) => `${tname(p.owner)} (${p.round}.${String(p.slot || 0).padStart(2, '0')}${team(p.owner).needs.length ? `, needs ${team(p.owner).needs.join('/')}` : ''})`).join('; ')}.` });
  const hoard = {};
  for (const p of picksY.filter((x) => x.round === 1)) hoard[p.owner] = (hoard[p.owner] || 0) + 1;
  const multi = Object.entries(hoard).filter(([, c]) => c >= 2);
  if (multi.length) tips.push({ dir: 'mid', text: `Multiple ${y} 1sts: ${multi.map(([r, c]) => `${tname(Number(r))} has ${c}`).join(', ')}.` });
  const dg = m.teams.filter((t) => t.drafting && t.drafting.n >= 4).sort((a, b) => b.drafting.avgEdge - a.drafting.avgEdge);
  if (dg.length >= 3) tips.push({ dir: 'mid', text: `Best drafters in this league so far: ${dg.slice(0, 2).map((t) => tname(t.rid)).join(', ')}. Weakest: ${dg.slice(-2).map((t) => tname(t.rid)).join(', ')}. Players drafted by weak drafters who are falling are often cheap.` });

  // draft order table
  const mock = mockFor(m, picksY, board);
  const orderRow = (p) => {
    const o = team(p.owner);
    const mk = p.overall ? mock[p.overall] : null;
    const proj = mk ? mk.player : null;
    const h = p.overall ? bucketFor(p.overall) : null;
    return `<tr class="${p.owner === m.me ? 'me' : ''}">
      <td class="num">${p.overall ? `${p.round}.${String(p.slot).padStart(2, '0')}` : roundName(p.round)}</td>
      <td><div class="who">${teamAvatar(o)}<div>${tlink(p.owner)}<div class="meta">${posture(o)}${p.orig !== p.owner ? ` via ${esc(tname(p.orig))}` : ''}</div></div></div></td>
      <td class="num">${team(p.orig) ? `${team(p.orig).w}-${team(p.orig).l}` : ''}</td>
      <td class="num">${team(p.orig) ? `${Math.round(team(p.orig).maxPf)} <span class="faint">(${Math.round(team(p.orig).maxPfProj)})</span>` : ''}</td>
      <td>${proj ? `${posTag(proj.pos)} ${esc(proj.name)}${S.draftStars[normName(proj.name)] ? ' ★' : ''}<div class="faint small">${esc(mockWhy(mk))}${mk.boardRank !== p.overall ? ` · board #${mk.boardRank}` : ''}</div>` : '<span class="faint">—</span>'}</td>
      <td class="num">${h && h.rate != null ? pct(h.rate) : '—'}</td>
      <td class="num">${k(p.v)}</td>
    </tr>`;
  };
  const r12 = picksY.filter((p) => p.round <= 2);

  // class strength chart (market)
  const mk = D ? D.market : [];
  const maxR = Math.max(...mk.map((x) => x.r1), 0.01);
  const strengthBars = mk.map((x) => `<div class="meter" style="margin-bottom:8px"><div class="row"><span>${x.year}${x.year === y ? ' <span class="pill buy" style="padding:0 6px">next draft</span>' : x.current ? ' <span class="faint small">future</span>' : ''}</span><span>${Math.round((x.r1 / (avgPast || x.r1)) * 100)}</span></div>${bar(x.r1 / maxR, x.year === y ? '' : x.current ? 'grey' : 'green')}</div>`).join('');

  // position mix chart
  const mixRow = (label, mix, total, cls = '') => {
    const t2 = total || 24;
    return `<div class="mixrow ${cls}"><span>${label}</span><div class="phasebar mix">${['QB', 'RB', 'WR', 'TE'].map((pos) => `<i class="m-${pos}" style="width:${((mix[pos] || 0) / t2 * 100).toFixed(1)}%" title="${pos} ${Math.round(mix[pos] || 0)}"></i>`).join('')}</div><span class="faint small">${['QB', 'RB', 'WR', 'TE'].map((pos) => `${pos} ${Math.round(mix[pos] || 0)}`).join(' · ')}</span></div>`;
  };

  // board list
  const myRanges = mine.filter((p) => p.overall).map((p) => p.overall);
  const boardRows = board ? board.players.slice(0, 60).map((p, i) => {
    const near = myRanges.some((ov) => Math.abs(ov - (i + 1)) <= 1);
    const star = S.draftStars[normName(p.name)];
    return `<tr class="${near ? 'me' : ''}"><td class="num">${i + 1}</td><td><b>${esc(p.name)}</b>${near ? ' <span class="pill buy" style="padding:0 6px">your range</span>' : ''}</td><td>${posTag(p.pos)}${p.posRank ? ` <span class="muted small">${esc(p.pos)}${p.posRank}</span>` : ''}</td><td>${esc(p.school || '')}</td><td class="muted">${esc(p.cls || '')}</td><td class="num muted">${esc(p.ht || '')}${p.wt ? ` · ${p.wt}` : ''}</td><td class="num muted">${p.srcRank || ''}</td><td class="num">${p.tier || ''}</td><td><button class="ibtn" data-action="star" data-name="${esc(p.name)}" title="Mark as one of your guys">${star ? '★' : '☆'}</button></td></tr>`;
  }).join('') : '';
  const st = (S.book && S.book.status) || {};

  // league draft history
  const hist = m.leagueDrafts.map((d) => `<details class="tree"${d.season === m.league.season ? ' open' : ''}><summary>${d.season} rookie draft</summary><div class="scroll"><table class="t"><thead><tr><th>Pick</th><th>Player</th><th>Drafted by</th><th class="num">Value now</th><th class="num">Value rank</th><th>vs slot</th></tr></thead><tbody>${d.picks.slice(0, 24).map((p) => `<tr class="${p.rid === m.me ? 'me' : ''}"><td class="num">${p.round}.${String(p.draft_slot || ((p.pick_no - 1) % n) + 1).padStart(2, '0')}</td><td><div class="who">${headshot(p.player_id)}${playerLink(p.player_id, p.name)} ${posTag(p.pos)}</div></td><td>${tlink(p.rid)}</td><td class="num">${k(p.v)}</td><td class="num">${p.valueRank}</td><td class="${p.edge >= 4 ? 'up' : p.edge <= -4 ? 'down' : 'muted'}">${p.edge >= 4 ? `steal (+${p.edge})` : p.edge <= -4 ? `reach (${p.edge})` : 'on par'}</td></tr>`).join('')}</tbody></table></div></details>`).join('');
  const drafters = m.teams.filter((t) => t.drafting).sort((a, b) => b.drafting.avgEdge - a.drafting.avgEdge).map((t) => `<tr class="${t.isMe ? 'me' : ''}"><td><div class="who">${teamAvatar(t)}${tlink(t.rid)}</div></td><td class="num">${t.drafting.n}</td><td class="num ${t.drafting.avgEdge > 1 ? 'up' : t.drafting.avgEdge < -1 ? 'down' : ''}">${t.drafting.avgEdge >= 0 ? '+' : ''}${t.drafting.avgEdge.toFixed(1)}</td><td class="small">${t.drafting.best ? esc(t.drafting.best.name) : ''}</td></tr>`).join('');

  return `<div class="three" style="margin-bottom:16px">
      <div class="card tile hot">${icon('ticket')}<div class="num">${mine.length ? mine.map((p) => p.overall ? `${p.round}.${String(p.slot).padStart(2, '0')}` : roundName(p.round)).join(' · ') : '—'}</div><div class="lab">Your ${y} picks (projected slots)</div></div>
      <div class="card tile">${icon('chart')}<div class="num">${strength == null ? '—' : `${strength >= 0 ? '+' : ''}${Math.round(strength * 100)}%`}</div><div class="lab">${y} class vs a typical class (market value of a mid 1st)</div></div>
      <div class="card tile">${icon('trophy')}<div class="num">${myBucket && myBucket.rate != null ? pct(myBucket.rate) : '—'}</div><div class="lab">${myBucket ? `Starter rate for picks ${myBucket.label}` : 'Starter rate at your first pick'}</div></div>
    </div>
    <div class="split">
      <div class="grid">
        ${capitalCard()}
        ${outWithOldCard()}
        <div class="card"><h3>How to win this draft</h3><ul class="ev">${tips.map((t) => `<li class="d-${t.dir}">${esc(t.text)}</li>`).join('')}</ul></div>
        <div class="card"><div class="sec-h"><h3 style="margin:0">${y} draft order, rounds 1-2</h3><button class="btn sm primary" data-action="exportMock">${icon('download')}Export mock draft</button></div><p class="lede">${m.draftOrderMethod === 'standings' ? 'Order from the playoff simulation: worst projected finish picks first.' : m.draftOrderMethod === 'maxpf' ? 'Non-playoff teams by projected max PF (lowest first: best lineup each week so far, plus the same weekly pace for the rest of the season), then playoff teams by projected finish.' : 'Every team by projected max PF, lowest first.'} Change this in Settings. "Mock pick" walks ${board ? esc(board.mine ? 'your board' : board.source) : 'a prospect board (add one below)'} in order: the first three picks take the best player available, then each team weighs the next few prospects against its weakest positions (league rank by dynasty value), so a team that's stacked at a position lets that player slide. "Starter rate" is how often that slot produced a weekly starter in past classes.</p>
          <div class="scroll"><table class="t"><thead><tr><th>Pick</th><th>Owner</th><th class="num">Record</th><th class="num">Max PF (proj.)</th><th>Mock pick</th><th class="num">Starter rate</th><th class="num">Value</th></tr></thead><tbody>${r12.map(orderRow).join('')}</tbody></table></div>
          <a class="link small" href="#picks">Every pick, ${m.pickSeasons.join(' and ')}</a></div>
        <div class="card"><div class="sec-h"><h3 style="margin:0">${y} prospect board</h3><div class="row"><span class="muted small">${board ? (board.mine ? `Your board, saved ${esc(dateStr(board.at))}` : `${esc(board.source)}`) : ''}</span><button class="btn sm" data-action="boardEdit">${board && board.mine ? 'Edit board' : 'Paste a board'}</button>${board && board.mine ? '<button class="btn sm" data-action="boardClear">Use FantasyPros</button>' : ''}</div></div>
          ${S.ui.boardEdit ? `<p class="lede">Paste any ranking, one player per line. Works with CBS Sports' prospect rankings copied straight from the page (defensive players are skipped), or simple lines like "1. Jeremiah Smith WR Ohio State". Copy it from your favourite site's ${y} rookie or devy rankings. Add "Tier 2" on a line to keep tiers.</p><textarea class="note" id="board-text" style="min-height:220px">${esc(board && board.mine ? board.players.map((p) => `${p.srcRank || p.rank} ${p.name} ${p.school || ''}${p.cls ? ` ${p.cls}` : ''} ${p.pos}${p.posRank ? ` ${p.posRank}` : ''}${p.ht ? ` ${p.ht}` : ''}${p.wt ? ` ${p.wt}` : ''}${p.tier ? ` Tier ${p.tier}` : ''}`).join('\n') : '')}</textarea><div class="row" style="margin-top:8px"><button class="btn primary sm" data-action="boardSave">Save board</button><button class="btn sm" data-action="boardEdit">Cancel</button></div>` : ''}
          ${board ? `<div class="scroll"><table class="t board"><thead><tr><th class="num">#</th><th>Prospect</th><th>Pos</th><th>School</th><th>Class</th><th class="num">Ht · Wt</th><th class="num" title="Rank on the source list, including defensive players">Source #</th><th class="num">Tier</th><th></th></tr></thead><tbody>${boardRows}</tbody></table></div>` : `<p class="muted">No ${y} board yet. ${st.prospects && !st.prospects.ok ? `FantasyPros: ${esc(st.prospects.error || '')}. ` : ''}Paste one from any rankings site to see who's likely at each of your picks.</p>`}
        </div>
      </div>
      <div class="grid">
        <div class="card"><h3>Class strength, by market value</h3><p class="lede">Value of next year's mid 1st at this point of the season, relative to the top dynasty asset. 100 = average of past classes.</p>${strengthBars || `<p class="muted">${esc((st.draft && st.draft.error) || 'Loads on the next sync.')}</p>`}</div>
        <div class="card"><h3>Position depth</h3><p class="lede">Top 24 rookies by position. Past classes use dynasty values right after the NFL draft.</p>
          ${pastClasses.map((c) => mixRow(String(c.year), c.posMix, 24)).join('')}
          ${pastClasses.length ? mixRow('Average', avgMix, 24, 'avg') : ''}
          ${board ? mixRow(`${y} board`, boardMix, Math.max(1, boardTop.length), 'next') : `<p class="faint small">Add a ${y} board to compare this class.</p>`}
          <div class="row small muted" style="margin-top:8px">${['QB', 'RB', 'WR', 'TE'].map((pos) => `<span><i class="sw m-${pos}"></i>${pos}</span>`).join('')}</div></div>
        <div class="card"><h3>What each slot has produced</h3><p class="lede">Classes with at least two seasons in the league. A hit is a top-12 QB, top-24 RB, top-30 WR or top-12 TE by dynasty value today.</p>
          ${D ? `<div class="scroll"><table class="t"><thead><tr><th>Slot</th><th class="num">Hit rate</th><th class="num">n</th><th>Best outcomes</th></tr></thead><tbody>${D.hitRates.map((h) => `<tr class="${myBucket && h.label === myBucket.label ? 'me' : ''}"><td>${esc(h.label)}</td><td class="num">${h.rate == null ? '—' : pct(h.rate)}</td><td class="num">${h.n}</td><td class="small">${esc(h.best.join(', '))}</td></tr>`).join('')}</tbody></table></div>
          <div class="facts" style="margin-top:12px">${['QB', 'RB', 'WR', 'TE'].map((pos) => { const h = D.posHit[pos]; const hits = h.hits ?? Math.round((h.rate || 0) * h.n); return `<div><span>${pos} in rounds 1-2</span><b>${h.rate == null ? '—' : pct(h.rate)}</b><span>${hits} of ${h.n} hit</span></div>`; }).join('')}</div>
          ${(() => { const mat = pastClasses.filter((c) => c.mature); const tot = ['QB', 'RB', 'WR', 'TE'].reduce((s2, pos) => s2 + D.posHit[pos].n, 0); const te = D.posHit.TE; return `<p class="faint small" style="margin:10px 0 0">Rounds 1-2 are the top ${2 * n} rookies in each class by dynasty value just after the NFL draft. Across the ${mat.length} classes with two seasons in the league (${mat.map((c) => c.year).join(', ')}), that's ${tot} players. The percentage is how many at each position became hits (same top-12/24/30/12 definition as above). For example, ${te.n} of the ${tot} were tight ends and ${te.hits ?? Math.round((te.rate || 0) * te.n)} of those ${te.n} hit. Small samples like that swing a lot with one player.</p>`; })()}` : '<p class="muted">Loads on the next sync.</p>'}</div>
        ${drafters ? `<div class="card"><h3>Who drafts well here</h3><p class="lede">Average places gained between draft slot and current value rank in this league's rookie drafts.</p><div class="scroll"><table class="t"><thead><tr><th>Manager</th><th class="num">Picks</th><th class="num">vs slot</th><th>Best pick</th></tr></thead><tbody>${drafters}</tbody></table></div></div>` : ''}
        ${hist ? `<div class="card"><h3>This league's rookie drafts</h3>${hist}</div>` : ''}
      </div>
    </div>`;
}

// ---- managers --------------------------------------------------------------------------

function viewManagers() {
  const m = S.model;
  const order = [...m.teams].sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0) || b.posture.score - a.posture.score);
  return `<div class="sec-h"><h2>Managers</h2><span class="row"><span class="muted small">Strongest buyers first. Open a manager for the evidence and your notes.</span><a class="btn sm" href="#summary">${icon('chart')}Summary table</a></span></div>
  <div class="mgrs">${order.map((t) => {
    const asked = Object.entries(t.asked || {}).sort((a, b) => b[1].length - a[1].length).slice(0, 2).map(([sid, arr]) => `${P(sid).name}${arr.length > 1 ? ` (${arr.length}×)` : ''}`);
    return `<a class="card mgr ${t.isMe ? 'me' : ''}" href="#manager/${t.rid}">
      <div class="top2">${teamAvatar(t)}<div style="min-width:0"><div class="nm">${esc(t.name)}${t.isMe ? ' <span class="muted small">(you)</span>' : ''}</div><div class="muted small">${esc(t.teamName)}</div></div>${posture(t)}</div>
      <dl>
        <dt>Record</dt><dd>${t.w}-${t.l} · ${Math.round(t.pf)} pts</dd>
        <dt>Playoff odds</dt><dd>${pct(t.playoffOdds)}</dd>
        <dt>Dynasty value</dt><dd>${k(t.totalValue)}</dd>
        <dt>True age</dt><dd>${t.trueAge ? t.trueAge.toFixed(1) : '—'}</dd>
        <dt>Needs</dt><dd>${t.needs.length ? esc(t.needs.join(', ')) : '—'}</dd>
        ${!t.isMe && asked.length ? `<dt>Asked you for</dt><dd style="color:var(--bad-t)">${esc(asked.join(', '))}</dd>` : ''}
      </dl>
      ${t.phase ? `<div class="phasebar" title="Rising ${pct(t.phase.share.rising)}, at peak ${pct(t.phase.share.peak)}, declining ${pct(t.phase.share.declining)}, picks ${pct(t.phase.share.picks)}"><i class="ri" style="width:${(t.phase.share.rising * 100).toFixed(1)}%"></i><i class="pk" style="width:${(t.phase.share.peak * 100).toFixed(1)}%"></i><i class="de" style="width:${(t.phase.share.declining * 100).toFixed(1)}%"></i><i class="pi" style="width:${(t.phase.share.picks * 100).toFixed(1)}%"></i></div><div class="legend"><span><i style="background:var(--green)"></i>Rising ${pct(t.phase.share.rising)}</span><span><i style="background:var(--violet)"></i>Peak ${pct(t.phase.share.peak)}</span><span><i style="background:var(--orange)"></i>Declining ${pct(t.phase.share.declining)}</span><span><i style="background:var(--faint)"></i>Picks ${pct(t.phase.share.picks)}</span></div>` : ''}
      ${!t.isMe ? withYouBox(t, m) : ''}
      ${t.note && t.note.text ? `<div class="notebox judge ${t.avoid ? 'avoid' : ''}">${esc(t.note.text.length > 110 ? t.note.text.slice(0, 110) + '…' : t.note.text)}</div>` : ''}
    </a>`;
  }).join('')}</div>`;
}

function withYouBox(t, m) {
  const d = t.dealings || {};
  const done = [...m.leagueTrades, ...m.histTrades].filter((nt) => nt.rids.length === 2 && nt.rids.includes(m.me) && nt.rids.includes(t.rid));
  const sumOf = (key) => done.reduce((s2, nt) => s2 + (nt[key] && nt[key][m.me] ? nt[key][m.me].got - nt[key][m.me].gave : 0), 0);
  const thenNet = done.length ? sumOf('deal') : null, nowNet = done.length ? sumOf('now') : null;
  const avgThen = done.length ? thenNet / done.length : null, avgNow = done.length ? nowNet / done.length : null;
  const nv = (v) => (v == null ? '<span class="faint">—</span>' : `<span class="${v > 250 ? 'up' : v < -250 ? 'down' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${k(Math.abs(v))}</span>`);
  const hisSent = (d.recv || 0) + ((d.done || 0) - (d.doneMine || 0));
  const mySent = (d.sent || 0) + (d.doneMine || 0);
  return `<div class="withyou">
    <div class="wy-h"><span>With you</span>${d.label && d.touches ? `<b class="judge">${esc(d.label)}</b>` : ''}</div>
    <dl>
      <dt>Offers</dt><dd>${hisSent} from him · ${mySent} from you</dd>
      <dt>Rejected</dt><dd>${d.hisRejects || 0} of yours · ${d.myRejects || 0} of his</dd>
      <dt>His avg ask</dt><dd>${d.avgAsk == null ? '<span class="faint">—</span>' : `<span class="${d.avgAsk > 0.12 ? 'down' : d.avgAsk < 0 ? 'up' : ''}">${signPct(d.avgAsk)}</span> <span class="faint">(${d.askN || 0})</span>`}</dd>
      <dt>Completed</dt><dd>${done.length}${done.length ? ` trade${done.length === 1 ? '' : 's'}` : ''}</dd>
      ${done.length ? `<dt>Avg per trade, for you</dt><dd>then ${nv(avgThen)} · now ${nv(avgNow)}</dd><dt>Total for you</dt><dd>then ${nv(thenNet)} · now ${nv(nowNet)}</dd>` : ''}
    </dl></div>`;
}

const TAGS = [['avoid', "Don't build deals"], ['public', 'Negotiates in public'], ['hard', 'Hard to deal with'], ['fair', 'Trades fair'], ['fast', 'Responds fast'], ['slow', 'Slow to respond'], ['buyer', 'Always buying'], ['seller', 'Always selling']];

function dealNotes(t, m) {
  const notes = [];
  if (t.avoid) notes.push('Your note says not to build deals for him. The trade finder skips him and his interest in your players is discounted.');
  const vets = t.assets.filter((a) => a.age >= 26 && a.redraft >= 2500).slice(0, 3).map((a) => a.name);
  if (t.posture.tone === 'sell') notes.push(`He's selling. Target his veterans${vets.length ? ` (${vets.join(', ')})` : ''}; pay in picks and players 24 and under.`);
  if (t.posture.tone === 'buy') notes.push(`He's buying. Offer proven starters${t.needs.length ? ` at ${t.needs.join('/')}` : ''} and ask for picks or young players back.`);
  const asked = Object.entries(t.asked || {}).sort((a, b) => b[1].length - a[1].length)[0];
  if (asked) notes.push(`He has asked about ${P(asked[0]).name} ${asked[1].length}×. That's leverage: ask above KTC (${k(pval(asked[0]).v)}).`);
  const offered = Object.entries(t.offeredUp || {}).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
  if (offered.length) notes.push(`He has been willing to move ${offered.map(([sid, arr]) => `${P(sid).name}${arr.length > 1 ? ` (${arr.length}×)` : ''}`).join(', ')}.`);
  const ex = t.elsewhere;
  if (ex && ex.crushes.length) notes.push(`He rosters ${ex.crushes.slice(0, 2).map((c) => `${c.name} in ${c.count} of ${c.of} leagues`).join(' and ')}, so he likely overvalues them.`);
  if (ex && ex.trades >= 5) {
    if (ex.picksOut > ex.picksIn * 1.5) notes.push(`In his other leagues he trades picks away far more than he gets them (${ex.picksOut} out, ${ex.picksIn} in).`);
    else if (ex.picksIn > ex.picksOut * 1.5) notes.push(`In his other leagues he collects picks (${ex.picksIn} in, ${ex.picksOut} out). Lead with picks when you buy from him.`);
  }
  const his = m.leagueTrades.concat(m.histTrades).filter((nt) => nt.deal && nt.rids.includes(t.rid));
  if (his.length >= 3) {
    const avgG = his.reduce((s, nt) => s + (nt.deal[t.rid] ? nt.deal[t.rid].gain : 0), 0) / his.length;
    notes.push(`His ${his.length} trades in this league average ${signPct(avgG)} of the value at the time — ${avgG > 0.05 ? 'he usually wins trades' : avgG < -0.05 ? 'he tends to give value away' : 'he trades fair'}.`);
  }
  return notes;
}

function viewManager(rid) {
  const m = S.model;
  const t = team(rid);
  if (!t) return '<div class="empty">No such manager.</div>';
  const p = t.posture;
  const valRank = [...m.teams].sort((a, b) => b.totalValue - a.totalValue).findIndex((x) => x.rid === t.rid) + 1;
  const nowRank = [...m.teams].sort((a, b) => b.winNow - a.winNow).findIndex((x) => x.rid === t.rid) + 1;
  const ex = t.elsewhere;
  const trades = m.leagueTrades.filter((nt) => nt.rids.includes(t.rid));
  const hist = m.histTrades.filter((nt) => nt.rids.includes(t.rid));
  const note = S.notes[t.userId] || { text: '', tags: [] };
  const pj = m.aging ? m.aging.players : {};
  const wants = (t.wants || []).map((w) => `<tr><td><div class="who">${headshot(w.asset.id)}${playerLink(w.asset.id)}</div></td><td class="num">${w.score}</td><td>${w.why.map((y) => `<span class="chip k-${y.k}">${esc(y.text)}</span>`).join('')}</td></tr>`).join('');
  const roster = t.assets.map((a) => {
    const pp = pj[a.id];
    return `<tr class="${t.winNowIds.includes(a.id) ? 'me' : ''}">
      <td><div class="who">${headshot(a.id)}<div>${playerLink(a.id)}<div class="meta">${posTag(a.pos)} ${a.age ? Math.floor(a.age) : ''} ${a.inj ? `<span class="down">${esc(a.inj)}</span>` : ''}</div></div></div></td>
      <td class="num">${a.v ? k(a.v) : '—'}</td><td class="num">${a.redraft ? k(a.redraft) : '—'}</td>
      <td class="num">${pp ? pp.seasons[0].ppg.toFixed(1) : '—'}</td><td>${pp ? spark(pp.seasons.map((s) => s.ppg), pp.phase === 'declining' ? 'var(--orange)' : 'var(--green)') : ''}</td>
      <td class="num ${a.trend30 > 0 ? 'up' : a.trend30 < 0 ? 'down' : ''}">${a.trend30 ? (a.trend30 > 0 ? '+' : '') + a.trend30 : ''}</td></tr>`;
  }).join('');
  return `<div class="art-banner slim ${moodOf(t) === 'gloom' ? 'gloom' : 'glory'}" aria-hidden="true"></div>
    <div class="card" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
      ${teamAvatar(t, 'lg ring')}
      <div style="flex:1;min-width:220px"><div class="muted small">${t.isMe ? 'Your team' : 'Manager'}</div><h1 class="page" style="font-size:22px;margin:2px 0">${esc(t.name)}</h1><div class="muted">${esc(t.teamName)}</div>
        <div class="row" style="margin-top:8px">${posture(t)}<span class="muted small judge">${esc(p.conf)} confidence, ${p.score}/100 on the contend scale</span>${t.avoid ? '<span class="pill sell judge">You: avoid deals</span>' : ''}</div></div>
      <div class="facts" style="flex:2;min-width:320px">
        <div><span>Record</span><b>${t.w}-${t.l}${t.t ? '-' + t.t : ''}</b></div>
        <div><span>Points for</span><b>${Math.round(t.pf)}</b></div>
        <div><span>Playoff odds</span><b>${pct(t.playoffOdds)}</b></div>
        <div><span>Dynasty value</span><b>${k(t.totalValue)}</b> <span>${ordinal(valRank)} of ${m.teams.length}</span></div>
        <div><span>Win-now lineup</span><b>${ordinal(nowRank)}</b></div>
        <div><span>True age</span><b>${t.trueAge ? t.trueAge.toFixed(1) : '—'}</b></div>
      </div>
    </div>
    <div class="two" style="margin-top:16px;align-items:start">
      <div>
        <div class="card judge"><h3>Why we read him as ${esc(p.label.toLowerCase())}</h3><ul class="ev">${p.evidence.map((e) => `<li class="d-${e.dir}">${esc(e.text)}</li>`).join('')}</ul></div>
        ${!t.isMe ? `<div class="card judge"><h3>How to deal with him</h3><ul class="ev">${dealNotes(t, m).map((n) => `<li>${esc(n)}</li>`).join('') || '<li>Nothing notable yet.</li>'}</ul></div>` : ''}
        ${!t.isMe ? `<div class="card"><h3>What he wants from you</h3>${wants ? `<div class="scroll"><table class="t"><thead><tr><th>Your player</th><th class="num">Heat</th><th>Why</th></tr></thead><tbody>${wants}</tbody></table></div>` : '<p class="muted">No strong signals yet.</p>'}</div>` : ''}
        ${!t.isMe ? dealingsCard(t) : ''}
        <div class="card"><h3>Trades</h3>${trades.length ? trades.map((nt) => tradeCard(nt)).join('') : '<p class="muted">No trades this season.</p>'}${hist.length ? `<h3 style="margin-top:14px">Earlier seasons</h3>${hist.map((nt) => tradeCard(nt)).join('')}` : ''}</div>
      </div>
      <div>
        ${!t.isMe ? `<div class="card judge"><h3>${icon('note')} Your notes on ${esc(t.name)}</h3>
          <textarea class="note" id="note-text" data-uid="${esc(t.userId)}" placeholder="What you know about how he trades, what he said in the group chat…">${esc(note.text)}</textarea>
          <div class="tags">${TAGS.map(([id, l]) => `<button class="tag ${id} ${(note.tags || []).includes(id) ? 'on' : ''}" data-action="noteTag" data-uid="${esc(t.userId)}" data-tag="${id}">${esc(l)}</button>`).join('')}</div>
          <div class="row" style="margin-top:10px"><button class="btn sm primary" data-action="saveNote" data-uid="${esc(t.userId)}">Save note</button><span class="muted small" id="note-status">${note.at ? `Saved ${esc(when(note.at))}` : ''}</span></div>
        </div>` : ''}
        ${!t.isMe && t.cuffs && (t.cuffs.theyHoldMine.length || t.cuffs.iHoldTheirs.length) ? `<div class="card"><h3>Handcuffs</h3><p class="lede">Running backs who back up a starter on the other roster. Handcuffs are cheap insurance, and owners usually pay a little extra for their own.</p>
          ${t.cuffs.theyHoldMine.map((c) => `<div class="asset">${headshot(c.cuff)}<div class="nm"><b>He has your cuff: ${playerLink(c.cuff)}</b><span class="meta">backs up your ${esc(P(c.starter).name)} (${esc(P(c.starter).team)}) · ask for him in any deal</span></div><div class="vals">${k(pval(c.cuff).v)}</div></div>`).join('')}
          ${t.cuffs.iHoldTheirs.map((c) => `<div class="asset">${headshot(c.cuff)}<div class="nm"><b>You have his cuff: ${playerLink(c.cuff)}</b><span class="meta">backs up his ${esc(P(c.starter).name)} (${esc(P(c.starter).team)}) · a natural sweetener</span></div><div class="vals">${k(pval(c.cuff).v)}</div></div>`).join('')}</div>` : ''}
        <div class="card"><h3>Roster value by career phase</h3>${phaseDonut(t, m)}</div>
        <div class="card"><h3>Needs and surplus</h3><div class="grid" style="gap:10px">${VALUE_POS.map((pos) => {
          const rnk = t.posRank[pos];
          const sur = t.surplus.find((s) => s.pos === pos);
          return `<div class="meter"><div class="row"><span>${posTag(pos)} ${t.needs.includes(pos) ? '<span class="down">Need</span>' : sur ? '<span class="up">Surplus</span>' : ''}</span><span>${ordinal(rnk)} of ${m.teams.length}</span></div>${bar(1 - (rnk - 1) / Math.max(1, m.teams.length - 1), t.needs.includes(pos) ? 'red' : sur ? 'green' : '')}${sur ? `<div class="muted small">${esc(sur.players.map((sid) => P(sid).name).join(', '))}</div>` : ''}</div>`;
        }).join('')}</div></div>
        ${t.block.length ? `<div class="card"><h3>On his trade block</h3>${t.block.map((b) => `<div class="asset">${b.kind === 'pick' ? '<span class="av head">PK</span>' : headshot(b.id)}<div class="nm"><b>${esc(b.name || b.label)}</b><span class="meta">${b.at ? `listed ${esc(dateStr(b.at))}` : ''}</span></div><div class="vals">${k(b.v)}</div></div>`).join('')}</div>` : ''}
        ${!t.isMe ? `<div class="card"><h3>His other leagues</h3>${ex ? `
          <p class="muted">${ex.leagues ? `${ex.leagues} other league${ex.leagues === 1 ? '' : 's'} this season (${ex.dynasty} dynasty), ${ex.trades} trade${ex.trades === 1 ? '' : 's'} there.` : 'No other Sleeper leagues this season.'}</p>
          ${ex.crushes.length ? `<h3 style="font-size:13px">Players he keeps rostering</h3>${ex.crushes.map((c) => `<div class="asset">${headshot(c.id)}<div class="nm">${playerLink(c.id)}<span class="meta">${c.count} of ${c.of} leagues</span></div><div class="vals">${k(c.v)}</div></div>`).join('')}` : ''}
          ${ex.trades && (ex.ageIn || Object.keys(ex.posIn).length) ? `<ul class="ev" style="margin-top:10px"><li>Draft picks: ${ex.picksIn} acquired, ${ex.picksOut} traded away</li>${ex.ageIn ? `<li>Average age of players he trades for: ${ex.ageIn.toFixed(1)}; trades away: ${ex.ageOut ? ex.ageOut.toFixed(1) : '—'}</li>` : ''}${Object.keys(ex.posIn).length ? `<li>Positions he buys: ${Object.entries(ex.posIn).sort((a, b) => b[1] - a[1]).map(([pp, n]) => `${pp} ${n}`).join(', ')}</li>` : ''}</ul>` : ''}
          <p class="faint small">Scanned ${esc(when(ex.at))}. Retired and teamless players are left out.</p>` : '<p class="muted">Not scanned yet. Use Settings, then "Rescan other leagues".</p>'}</div>` : ''}
        <div class="card"><h3>Roster</h3><p class="lede">Highlighted: his best lineup this season. Trend line: projected points per game over the next three seasons.</p>
          <div class="scroll"><table class="t"><thead><tr><th>Player</th><th class="num">Value</th><th class="num">Redraft</th><th class="num">Pts/g</th><th>Next 3 yrs</th><th class="num">FC 30d</th></tr></thead><tbody>${roster}</tbody></table></div>
          ${t.picks.length ? `<h3 style="margin-top:12px">Picks</h3>${t.picks.map((pk) => `<div class="asset"><span class="av head">PK</span><div class="nm"><b>${esc(pk.label)}</b></div><div class="vals">${k(pk.v)}</div></div>`).join('')}` : ''}
        </div>
      </div>
    </div>`;
}

// ---- trades ----------------------------------------------------------------------------

function assetRow(a, nt) {
  const thenV = nt.then && nt.thenVals ? nt.thenVals[a.key] : null;
  if (a.kind === 'pick') {
    return `<div class="asset"><span class="av head" style="color:var(--accent-t)">PK</span><div class="nm"><b>${esc(a.label)}</b><span class="meta">${a.became ? `became ${esc(a.becameName || P(a.became).name)}` : Number(a.season) > S.model.league.season ? 'future pick' : ''}</span></div><div class="vals">${thenV != null ? `<span class="then">${k(thenV)} →</span> ` : ''}${k(a.v)}</div></div>`;
  }
  return `<div class="asset">${headshot(a.id)}<div class="nm">${playerLink(a.id, a.name)}<span class="meta">${esc(a.pos)}${a.age ? ` · ${Math.floor(a.age)}` : ''}${a.team ? ` · ${esc(a.team)}` : ''}</span></div><div class="vals">${thenV != null ? `<span class="then">${k(thenV)} →</span> ` : ''}${k(a.v)}</div></div>`;
}

function treeNodes(nodes) {
  if (!nodes || !nodes.length) return '';
  return `<ul class="tr">${nodes.map((n) => {
    const itemName = (x) => (x.kind === 'pick' ? `${x.season} ${roundName(x.round)}${x.no ? ` (${x.no})` : ''}` : `${P(x.sid).name}${x.draftedWith ? ` (drafted ${x.draftedWith})` : ''}`);
    const name = n.kind === 'package' ? '' : itemName(n);
    const st = {
      kept: 'still on roster', traded: `traded ${n.at ? dateY(n.at) : ''} to ${(n.partner || []).map(tname).join(', ')}`,
      released: `released ${n.at ? dateY(n.at) : ''}`, drafted: `used in the ${n.season} rookie draft`, owned: 'pick still owned', gone: 'no longer on roster',
      unknown: `used in the ${n.season} draft, but the pick couldn't be matched to a player`, stop: '',
    }[n.status] || '';
    const tag = (x) => (x.kind === 'pick' ? '<span class="pos PK">PK</span>' : posTag(P(x.sid).pos));
    const label = (x) => (x.kind === 'player' ? playerLink(x.sid, itemName(x)) : esc(itemName(x)));
    const head = n.kind === 'package'
      ? `<span class="pkg">${n.items.map((x) => `${tag(x)} ${label(x)}`).join('<span class="plus">+</span>')}</span><span class="st">${esc(st.replace('traded', 'traded together'))}</span>`
      : `${tag(n)}<span>${label(n)}</span><span class="st">${esc(st)}</span>`;
    return `<li><div class="tnode">${head}<span class="v">${k(n.total)}</span></div>${n.children.length && n.status === 'traded' ? `<div class="faint small tfor">for</div>` : ''}${treeNodes(n.children)}</li>`;
  }).join('')}</ul>`;
}

// Plain-language "then vs today" for two-team trades.
function tradeExplain(nt, nm) {
  if (!nt.then || !nt.now || nt.then === nt.now || nt.rids.length !== 2) return '';
  const [A, B] = nt.rids;
  const tA = nt.then[A], nA = nt.now[A];
  const shareThen = tA.got / Math.max(1, tA.got + tA.gave), shareNow = nA.got / Math.max(1, nA.got + nA.gave);
  const lead = (sh, rid, other) => (Math.abs(sh - 0.5) < 0.025 ? 'it was even' : `${esc(nm(sh > 0.5 ? rid : other))} got ${Math.round(Math.max(sh, 1 - sh) * 100)}% of the value`);
  const moves = [];
  for (const rid of nt.rids) for (const a of nt.recv[rid] || []) {
    const th = nt.thenVals ? nt.thenVals[a.key] : null;
    if (th == null || !th) continue;
    const ch = a.v / th - 1;
    if (Math.abs(ch) >= 0.1) moves.push({ name: a.kind === 'pick' ? a.label : a.name, th, now: a.v, ch });
  }
  moves.sort((x, y) => Math.abs(y.ch) - Math.abs(x.ch));
  const adjThen = tA.adj ? A : nt.then[B].adj ? B : null, adjNow = nA.adj ? A : nt.now[B].adj ? B : null;
  const adjNote = adjThen != null && adjNow != null && adjThen !== adjNow ? ` KTC's bonus for receiving the best player in the deal has moved from ${esc(nm(adjThen))}'s side (${k(nt.then[adjThen].adj)}) to ${esc(nm(adjNow))}'s (${k(nt.now[adjNow].adj)}), which swings the grades more than the raw values do.` : '';
  return `<div class="explain"><b>At the trade</b> ${lead(shareThen, A, B)}. <b>Today</b> ${lead(shareNow, A, B)}.${moves.length ? ` Since then: ${moves.slice(0, 3).map((x) => `${esc(x.name)} ${k(x.th)} → ${k(x.now)} (${x.ch > 0 ? '+' : ''}${Math.round(x.ch * 100)}%)`).join(', ')}.` : ' Player values have barely moved.'}${adjNote}</div>`;
}

function tradeCard(nt) {
  const m = S.model;
  const deal = nt.deal;
  const nm = (r) => (team(r) ? tname(r) : (nt.nameOf && nt.nameOf[r]) || tname(r));
  const thenSrc = nt.then ? nt.thenSrc : null;
  // values at the time for each asset, when graded from a snapshot
  const totals = nt.rids.map((r) => (deal && deal[r] ? deal[r].got : 0));
  const sumT = totals.reduce((a, b) => a + b, 0) || 1;
  const split = nt.rids.length <= 3 ? `<div class="splitbar">${totals.map((v) => `<i style="width:${(v / sumT * 100).toFixed(1)}%"></i>`).join('')}</div>
    <div class="splitlab">${nt.rids.map((r, i) => `<span>${esc(nm(r))} ${Math.round(totals[i] / sumT * 100)}%</span>`).join('')}</div>` : '';
  const sides = nt.rids.map((r) => {
    const g = deal ? deal[r] : null;
    const n = nt.now ? nt.now[r] : null;
    const items = nt.recv[r] || [];
    const s = nt.sides[r];
    const tr = nt.tree ? nt.tree[r] : null;
    return `<div class="tside">
      <div class="hd">${teamAvatar(team(r))}<b>${team(r) ? `<a href="#manager/${r}">${esc(nm(r))}</a>` : esc(nm(r))}</b> <span class="muted small">gets</span>
        <span class="grades">${g ? `<span class="gl">${nt.then ? 'at trade' : 'grade'}</span>${grade(g.grade, nt.then ? 'Grade with values at the time of the trade' : 'Grade with today\'s values')}` : ''}${nt.then && n && nt.then !== nt.now ? `<span class="gl">today</span>${grade(n.grade, 'Grade with today\'s values (hindsight)')}` : ''}</span></div>
      ${items.length ? items.map((a) => assetRow(a, nt)).join('') : nt.unparsedPicks && nt.unparsedPicks.length ? `<div class="down small">Draft picks we couldn't read: ${esc(nt.unparsedPicks.join(' | '))}. Please send this line to fix the parser.</div>` : '<div class="muted small">nothing</div>'}${s.faabIn ? `<div class="muted small">+ $${s.faabIn} FAAB</div>` : ''}
      <div class="tot"><span>${g ? `${nt.then ? 'At trade' : 'Value'} <b>${k(g.got)}</b>${g.adj ? ` incl. ${k(g.adj)} KTC adj.` : ''}` : ''}</span><span>${n && nt.then && nt.then !== nt.now ? `Today <b>${k(n.got)}</b>${n.adj ? ` incl. ${k(n.adj)} adj.` : ''}` : ''}${tr && tr.branches ? ` · tree <b>${k(tr.total)}</b>` : ''}</span></div>
      ${nt.pts && nt.pts[r] && (nt.pts[r].gained || nt.pts[r].lost) ? `<div class="small" style="margin-top:4px"><span class="muted">Starter points since:</span> <span class="up">+${nt.pts[r].gained}</span> from players received, <span class="down">−${nt.pts[r].lost}</span> by players sent away · net <b class="${nt.pts[r].net > 0 ? 'up' : nt.pts[r].net < 0 ? 'down' : ''}">${nt.pts[r].net > 0 ? '+' : ''}${nt.pts[r].net}</b></div>` : ''}
    </div>`;
  }).join('');
  const hasTree = nt.tree && nt.rids.some((r) => nt.tree[r] && nt.tree[r].branches);
  const verdict = deal ? (deal.fair ? 'Fair deal' : `Edge: ${nm(nt.winnerThen !== undefined ? nt.winnerThen : nt.winner)}`) : 'Not enough value data';
  return `<div class="trade" id="tx-${esc(nt.id)}">
    <div class="meta"><span>${esc(dateStr(nt.created))}${nt.season && nt.season !== m.league.season ? ` ${nt.season}` : ''}</span>${nt.leg ? `<span>Week ${nt.leg}</span>` : ''}${nt.src === 'offer' ? `<span>${nt.fromMe ? 'You proposed' : `${esc(nm(nt.other))} proposed`}</span><span class="pill ${nt.status === 'proposed' ? 'warn' : 'mid'}">${esc(nt.status)}</span>` : ''}${nt.openMs != null ? `<span class="resp" title="Time from proposal to ${nt.status === 'proposed' ? 'now' : 'answer'}${nt.status === 'complete' ? ' (includes any league review period)' : ''}">${icon('timer')}${nt.status === 'proposed' ? 'open' : nt.status === 'complete' ? 'accepted after' : nt.status === 'cancelled' ? 'withdrawn after' : 'answered after'} ${esc(dur(nt.openMs))}</span>` : ''}<span class="pill ${deal && deal.fair ? 'mid' : 'buy'}">${esc(verdict)}</span>${thenSrc ? `<span class="faint">At-trade values: ${esc(thenSrc)}. Today: KeepTradeCut now.</span>` : '<span class="faint">Graded with today\'s values</span>'}</div>
    ${nt.rejectedBy || nt.withdrawnBy ? `<div class="rej ${nt.hindsight ? 't-' + nt.hindsight.tone : ''}"><b>${nt.rejectedBy === 'them' ? `${esc(nm(nt.other))} rejected your offer` : nt.rejectedBy === 'me' ? `You rejected ${esc(nm(nt.other))}'s offer` : nt.withdrawnBy === 'me' ? 'You withdrew this offer' : `${esc(nm(nt.other))} withdrew this offer`}.</b> For you: ${signPct(nt.myThen)} at the time, ${signPct(nt.myNow)} today. ${nt.hindsight ? esc(nt.hindsight.text) : ''}</div>` : ''}
    ${split}
    <div class="sides">${sides}</div>
    ${tradeExplain(nt, nm)}
    ${nt.tree && nt.status !== 'proposed' && nt.src !== 'offer' ? (() => { const ts = treeStats(nt); return `<div class="treelink"><a class="btn sm" href="#tree/${esc(nt.id)}">${icon('trend')} See trade tree</a><span class="faint small">${ts.g ? `${ts.g} generation${ts.g === 1 ? '' : 's'} · ${ts.later} later deal${ts.later === 1 ? '' : 's'}` : 'nothing flipped yet'}</span></div>`; })() : ''}
  </div>`;
}

// Every deal between you and this manager, tabbed by outcome, with stats per tab.
function dealTabs(t) {
  const m = S.model;
  const d = t.dealings;
  const done = [...m.leagueTrades].filter((nt) => nt.rids.length === 2 && nt.rids.includes(m.me) && nt.rids.includes(t.rid))
    .map((nt) => ({ ...nt, fromMe: nt.fromMe != null ? nt.fromMe : String(nt.creator) === String(S.raw.me.userId), myThen: nt.deal && nt.deal[m.me] ? nt.deal[m.me].gain : null, myNow: nt.now && nt.now[m.me] ? nt.now[m.me].gain : null }));
  const offers = d.offers;
  const groups = [
    ['all', 'All', [...done, ...offers]],
    ['done', 'Completed', done],
    ['pending', 'Waiting', offers.filter((o) => o.status === 'proposed')],
    ['rej', 'Rejected', offers.filter((o) => o.rejectedBy)],
    ['wthem', 'Withdrawn by him', offers.filter((o) => o.withdrawnBy === 'them')],
    ['wme', 'Withdrawn by you', offers.filter((o) => o.withdrawnBy === 'me')],
  ].filter(([id, , l]) => id === 'all' || l.length);
  const cur = groups.find((g) => g[0] === (S.ui.dealTab[t.rid] || 'all')) || groups[0];
  const list = [...cur[2]].sort((a, b) => b.created - a.created);
  if (!groups[0][2].length) return '';

  // stats for the selected tab
  const vals = (key) => list.map((o) => o[key]).filter((x) => x != null);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const med = (a) => { if (!a.length) return null; const z = [...a].sort((x, y) => x - y); return z[Math.floor(z.length / 2)]; };
  const fromMe = list.filter((o) => o.fromMe).length;
  const then = mean(vals('myThen')), now = mean(vals('myNow'));
  const open = med(list.map((o) => o.openMs).filter((x) => x != null && x > 0));
  const gotNow = list.reduce((s2, o) => s2 + (o.now && o.now[m.me] ? o.now[m.me].got : 0), 0);
  const gaveNow = list.reduce((s2, o) => s2 + (o.now && o.now[m.me] ? o.now[m.me].gave : 0), 0);
  const asked = {};
  for (const o of list) for (const a of (o.recv && o.recv[t.rid]) || []) if (a.kind !== 'pick') asked[a.id] = (asked[a.id] || 0) + 1;
  const topAsk = Object.entries(asked).sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= 2).slice(0, 3);
  const rejHim = list.filter((o) => o.rejectedBy === 'them').length, rejMe = list.filter((o) => o.rejectedBy === 'me').length;
  const facts = [
    `<div><span>Deals</span><b>${list.length}</b><span>${fromMe} from you · ${list.length - fromMe} from him</span></div>`,
    cur[0] === 'rej' || cur[0] === 'all' ? `<div><span>Rejected</span><b>${list.filter((o) => o.rejectedBy).length}</b><span>${rejHim} by him · ${rejMe} by you</span></div>` : '',
    `<div><span>Your side at the time</span><b class="${then > 0.05 ? 'up' : then < -0.05 ? 'down' : ''}">${then == null ? '—' : signPct(then)}</b><span>average value balance</span></div>`,
    `<div><span>Your side today</span><b class="${now > 0.05 ? 'up' : now < -0.05 ? 'down' : ''}">${now == null ? '—' : signPct(now)}</b><span>same deals at today's values</span></div>`,
    cur[0] === 'done' ? `<div><span>Net value to you today</span><b class="${gotNow - gaveNow >= 0 ? 'up' : 'down'}">${gotNow - gaveNow >= 0 ? '+' : ''}${k(gotNow - gaveNow)}</b><span>got ${k(gotNow)} · gave ${k(gaveNow)}</span></div>` : '',
    `<div><span>Typical time open</span><b>${open == null ? '—' : esc(dur(open))}</b><span>median</span></div>`,
  ].join('');
  const tabs = groups.map(([id, l, arr]) => `<button class="btn sm${id === cur[0] ? ' primary' : ''}" data-action="dealTab" data-rid="${t.rid}" data-tab="${id}">${esc(l)} <span class="faint">${arr.length}</span></button>`).join('');
  return `<h3 style="margin-top:14px">Every deal with ${esc(t.name)}</h3>
    <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">${tabs}</div>
    <div class="facts">${facts}</div>
    ${topAsk.length ? `<p class="small muted" style="margin-top:8px">He keeps asking for: ${topAsk.map(([sid, n]) => `${esc(P(sid).name)} (${n}×)`).join(', ')}.</p>` : ''}
    <p class="faint small" style="margin-top:8px">Value balance is your share of the deal's value by KTC (with the uneven-deal adjustment): +10% means you'd get 10% more than you give.</p>
    ${list.length ? list.map((o) => tradeCard(o)).join('') : '<p class="muted">None.</p>'}`;
}

function dealingsCard(t) {
  const m = S.model;
  const d = t.dealings;
  if (!d) return '';
  const tone = d.label === 'Easy to deal with' ? 'green' : d.label === 'Difficult' ? 'red' : d.label === 'Workable' ? 'orange' : 'grey';
  return `<div class="card"><h3>Dealing with you</h3>
    <div class="judge"><div class="row" style="justify-content:space-between"><b>${esc(d.label)}</b><span class="muted small">${d.touches ? `${d.ease}/100` : ''}</span></div>${d.touches ? bar(d.ease / 100, tone) : ''}</div>
    <div class="facts" style="margin-top:12px">
      <div><span>You sent</span><b>${d.sent + d.doneMine}</b><span>${d.doneMine} accepted, ${d.hisRejects} rejected</span></div>
      <div><span>He sent</span><b>${d.recv + d.done - d.doneMine}</b><span>${d.done - d.doneMine} accepted, ${d.myRejects} you rejected</span></div>
      <div><span>Withdrawn</span><b>${d.withdrawn}</b></div>
      <div><span>His average ask</span><b>${d.avgAsk == null ? '—' : signPct(d.avgAsk)}</b><span>in his own offers</span></div>
      <div><span>He answers your offers in</span><b>${dur(d.hisResponse)}</b><span>typical (median)${d.waitingMs ? ` · one waiting ${esc(dur(d.waitingMs))}` : ''}</span></div>
      <div><span>You answer his in</span><b>${dur(d.myResponse)}</b><span>typical (median)</span></div>
    </div>
    ${d.insights.length ? `<ul class="ev judge" style="margin-top:12px">${d.insights.map((x) => `<li class="d-${x.dir}">${esc(x.text)}</li>`).join('')}</ul>` : '<p class="muted">No offers between you yet. Sleeper only shows offers that involve you.</p>'}
    ${dealTabs(t)}
  </div>`;
}

function viewTrades(sub) {
  const m = S.model;
  const subs = [['ledger', 'League trades'], ['offers', `My offers${m.pending.length ? ` (${m.pending.length})` : ''}`], ['incoming', 'Offers to you'], ['lab', 'Trade lab'], ['finder', 'Trade finder'], ['week', 'This week']];
  const nav = `<nav class="subtabs">${subs.map(([id, l]) => `<a href="#trades/${id}" class="${id === sub ? 'on' : ''}">${esc(l)}</a>`).join('')}</nav>`;
  const scaleNote = '<p class="lede">Grades use each side\'s share of the combined value, with KTC\'s value adjustment for uneven deals. Within ±5% is a fair B. A+ and F are for blowouts (one side getting more than twice as much). "At trade" grades use values from the week of the trade (KTC itself for trades under 10 days old); "today" is hindsight with today\'s KTC values. KTC adds a bonus to the side that receives the best single player, so when two players swap places in value the grades can flip.</p>';
  if (sub === 'offers') {
    const note = S.raw.gql && !S.raw.gql.ok ? `<div class="notice">${esc(S.raw.gql.error || 'Offers could not be read.')}</div>` : '';
    return nav + offersNotice() + myOffersOverview(m) + `<div class="card"><h3>Every offer</h3>${scaleNote}${m.offers.length ? m.offers.map(tradeCard).join('') : '<p class="muted">No offers on record.</p>'}</div>`;
  }
  if (sub === 'lab') return nav + viewLab();
  if (sub === 'incoming') return nav + viewIncoming();
  if (sub === 'week') return nav + viewWeekFinder();
  if (sub === 'finder') {
    const o = m.finderOpts || {};
    const me = team(m.me);
    const shopOpts = me.assets.filter((a) => VALUE_POS.includes(a.pos) && a.v >= 500).sort((a, b) => b.v - a.v);
    const assetLine = (a, mineSide) => {
      const pv = a.kind === 'pick' ? Math.round(a.v * (1 - o.pickDiscount)) : null;
      return a.kind === 'pick'
        ? `<div class="asset"><span class="av head">PK</span><div class="nm"><b>${esc(a.label || a.name)}</b>${pv != null ? `<span class="meta">KTC ${k(a.v)} · to you ${k(pv)}</span>` : ''}</div><div class="vals">${k(a.v)}</div></div>`
        : `<div class="asset">${headshot(a.id)}<div class="nm">${playerLink(a.id)}<span class="meta">${esc(a.pos)} · ${a.age ? Math.floor(a.age) : ''}${!mineSide && a.pos === 'QB' && o.oneQB && !me.needs.includes('QB') ? ' · QB you don\'t need' : ''}</span></div><div class="vals">${k(a.v)}</div></div>`;
    };
    const stratSel = `<select data-finder="strategy">${[['auto', `Automatic (${m.myStrategy})`], ['rebuild', 'Rebuild: picks and youth'], ['contend', 'Contend: proven starters']].map(([v, l]) => `<option value="${v}" ${(S.cfg.strategy || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const shopSel = `<select data-finder="shop"><option value="">Any of my players</option>${shopOpts.map((a) => `<option value="${esc(a.id)}" ${o.shop === a.id ? 'selected' : ''}>${esc(a.name)} (${esc(a.pos)}, ${k(a.v)})</option>`).join('')}</select>`;
    const discSel = `<select data-finder="pickDiscount">${[0, 0.1, 0.15, 0.2, 0.25, 0.3].map((v) => `<option value="${v}" ${Math.abs(o.pickDiscount - v) < 0.001 ? 'selected' : ''}>${v ? `${Math.round(v * 100)}% below KTC` : 'Same as KTC'}</option>`).join('')}</select>`;
    return nav + `<div class="card"><h3>Trade finder</h3>
      <p class="lede">Each package has to pass two tests: <b>KTC calls it fair</b> (so he might accept), and <b>it's good for you by your own valuation</b>. Your valuation: draft picks count ${Math.round(o.pickDiscount * 100)}% below KTC${o.oneQB ? ', a QB you don\'t need counts about half (1QB league)' : ''}${o.strategy === 'rebuild' ? ', older players count 25% less, and returns lean toward picks and players under each position\'s age cutoff' : ', and returns lean toward players who\'d start for you'}, and positions you need (${esc(me.needs.join(', ') || 'none')}) count 10% more.</p>
      <div class="row" style="margin-bottom:12px">
        <label class="f">Shop a player${shopSel}</label>
        <label class="f">Strategy${stratSel}</label>
        <label class="f">Value picks at${discSel}</label>
        <label class="f">Age${`<select data-finder="youthBias">${[[0, 'Ignore age'], [1, 'Favour youth'], [1.6, 'Strongly favour youth']].map(([v, l]) => `<option value="${v}" ${Math.abs((o.youthBias ?? 1) - v) < 0.01 ? 'selected' : ''}>${l}</option>`).join('')}</select>`}</label>
      </div>
      ${(o.youthBias ?? 1) > 0 ? '<p class="muted small" style="margin:-4px 0 12px">Leaning young: players past their position\'s peak (RB 24, WR 25, TE 26, QB 27) count for less to you and fall off fast after RB 28, WR/TE 30, QB 33; players younger than their peak get a small boost. Selling your own older players costs you less.</p>' : ''}
      ${m.finderSkipped.length ? `<div class="notice info judge">Skipped because of your notes: ${m.finderSkipped.map(tlink).join(', ')}.</div>` : ''}
      ${m.finder.length ? m.finder.map((f) => `<div class="trade"><div class="meta">${teamAvatar(team(f.rid))}<b style="color:var(--text)">${tlink(f.rid)}</b>${posture(team(f.rid))}${team(f.rid).needs.length ? `<span>needs ${esc(team(f.rid).needs.join(', '))}</span>` : ''}</div>
        ${f.ideas.map((i) => `<div class="sides" style="margin-bottom:10px">
          <div class="tside"><div class="hd"><b>You give</b><span class="grades" title="Includes KTC's adjustment for the side giving fewer, better pieces">KTC ${k(i.theirs)} with adj.</span></div>${i.give.map((a) => assetLine(a, true)).join('')}<div class="tot"><span>To you: ${k(i.myCost)}</span></div></div>
          <div class="tside"><div class="hd"><b>You get</b><span class="grades" title="Includes KTC's adjustment for the side giving fewer, better pieces">KTC ${k(i.mine)} with adj. ${grade(letterGrade(i.mine, i.theirs))}</span></div>${i.get.map((a) => assetLine(a, false)).join('')}<div class="tot"><span>To you: ${k(i.myGet)} · <b class="up">${signPct(i.myGain)}</b> by your valuation</span><span>KTC ${signPct(i.ktcGain)}${i.fair ? ' · fair' : ''}</span></div></div>
        </div>${i.cuffNotes && i.cuffNotes.length ? `<div class="cuffnote">🔗 ${esc(i.cuffNotes.join(' · '))}</div>` : ''}`).join('')}</div>`).join('') : `<p class="muted">No packages pass both tests right now.${o.shop ? ' Try adding a lower pick discount, or a different player.' : ''}</p>`}</div>`;
  }
  const list = S.ui.history ? m.leagueTrades.concat(m.histTrades) : m.leagueTrades;
  return nav + `<div class="card"><div class="sec-h"><h3 style="margin:0">Every league trade, graded</h3><button class="link" data-action="toggleHistory">${S.ui.history ? 'Hide earlier seasons' : `Show earlier seasons (${m.histTrades.length})`}</button></div>${scaleNote}${list.length ? list.map(tradeCard).join('') : '<p class="muted">No trades yet.</p>'}</div>`;
}

function labAssets(rid) {
  const t = team(rid);
  if (!t) return [];
  return [...t.assets.filter((a) => a.v > 0).map((a) => ({ ...a, key: `p:${a.id}` })), ...t.tradePicks.map((p) => ({ ...p, key: `k:${p.season}:${p.round}:${p.orig}`, name: p.label }))];
}
function fcValue(a) {
  if (a.kind === 'pick') {
    const arr = S.book.picks[`${a.season} ${a.round} ${a.tier}`] || S.book.picks[`${a.season} ${a.round} any`] || S.book.picks[`${a.season} ${a.round} mid`];
    return arr && arr[1] != null ? arr[1] : 0;
  }
  return a.fc || 0;
}
function labSummary(m, A, B, sentA, sentB) {
  // sentA = what A gives (B receives); sentB = what B gives (A receives)
  const vd = ktcVerdict(sentB.map((a) => a.v), sentA.map((a) => a.v), S.book.ktcTop);
  const fa = sentB.map(fcValue), fb = sentA.map(fcValue);
  const [fa1, fb1] = fcAdjustment(fa, fb);
  const fcA = fa.reduce((s2, v) => s2 + v, 0) + fa1, fcB = fb.reduce((s2, v) => s2 + v, 0) + fb1;
  return { vd, fcA, fcB, fa1, fb1 };
}

function labNotes(m, rid, gets, gives) {
  const t = team(rid);
  const pj = m.aging ? m.aging.players : {};
  const notes = [];
  const needHit = gets.filter((a) => a.kind !== 'pick' && t.needs.includes(a.pos));
  if (needHit.length) notes.push({ dir: 'good', text: `Fills a need: ${needHit.map((a) => `${a.name} (${a.pos})`).join(', ')}` });
  const thins = gives.filter((a) => a.kind !== 'pick' && t.winNowIds.includes(a.id));
  if (thins.length) notes.push({ dir: 'sell', text: `Gives up ${thins.length === 1 ? 'a starter' : `${thins.length} starters`}: ${thins.map((a) => a.name).join(', ')}` });
  const oneQB = !S.book.fmt || !S.book.fmt.superflex;
  const qbs = gets.filter((a) => a.pos === 'QB');
  if (oneQB && qbs.length && !t.needs.includes('QB')) notes.push({ dir: 'mid', text: `${qbs.map((a) => a.name).join(', ')} would likely sit behind his current QB (1QB league)` });
  const old = gets.filter((a) => a.kind !== 'pick' && pj[a.id] && pj[a.id].phase === 'declining');
  if (old.length) notes.push({ dir: t.posture.tone === 'sell' ? 'sell' : 'mid', text: `Past their peak: ${old.map((a) => a.name).join(', ')}${t.posture.tone === 'sell' ? ' (an odd fit for a rebuilding team)' : ''}` });
  const young = gets.filter((a) => a.kind !== 'pick' && pj[a.id] && pj[a.id].phase === 'rising');
  if (young.length) notes.push({ dir: 'good', text: `Still rising: ${young.map((a) => a.name).join(', ')}` });
  const picks = gets.filter((a) => a.kind === 'pick');
  if (picks.length) notes.push({ dir: t.posture.tone === 'sell' ? 'good' : 'mid', text: `${picks.length} pick${picks.length > 1 ? 's' : ''}${t.posture.tone === 'buy' ? ' (contenders usually value picks less)' : t.posture.tone === 'sell' ? ' (what a rebuild wants)' : ''}` });
  const cuff = gets.filter((a) => a.kind !== 'pick' && (t.roster.players || []).some((sid) => m.teams && P(sid).pos === 'RB' && P(a.id).pos === 'RB' && P(sid).team && P(sid).team === P(a.id).team && pval(sid).v > pval(a.id).v));
  if (cuff.length) notes.push({ dir: 'good', text: `Handcuff for his own RB: ${cuff.map((a) => a.name).join(', ')}` });
  return notes;
}

function viewLab() {
  const m = S.model;
  const A = S.lab.a, B = S.lab.b;
  const opt = (sel) => m.teams.map((t) => `<option value="${t.rid}" ${t.rid === sel ? 'selected' : ''}>${esc(t.name)}${t.isMe ? ' (you)' : ''}</option>`).join('');
  const list = (rid, side) => labAssets(rid).map((a) => `<label class="it" data-labname="${esc(normName(`${a.name} ${a.pos || ''}`))}"><input type="checkbox" data-lab="${esc(a.key)}" ${S.lab.picked.has(a.key) ? 'checked' : ''}>${a.kind === 'pick' ? '<span class="av head">PK</span>' : headshot(a.id)}<span class="nm">${esc(a.name)} <span class="muted small">${a.kind === 'pick' ? '' : `${esc(a.pos)} ${a.age ? Math.floor(a.age) : ''}`}</span></span><span class="muted">${k(a.v)}</span></label>`).join('');
  const sentA = labAssets(A).filter((a) => S.lab.picked.has(a.key));
  const sentB = labAssets(B).filter((a) => S.lab.picked.has(a.key));

  const assetLine = (a) => `<div class="asset">${a.kind === 'pick' ? '<span class="av head" style="color:var(--accent-t)">PK</span>' : headshot(a.id)}<div class="nm">${a.kind === 'pick' ? `<b>${esc(a.name)}</b>` : playerLink(a.id, a.name)}<span class="meta">${a.kind === 'pick' ? 'draft pick' : `${esc(a.pos)}${a.age ? ` · ${Math.floor(a.age)}` : ''}${a.team ? ` · ${esc(a.team)}` : ''}`} · FC ${k(fcValue(a))}</span></div><div class="vals">${k(a.v)}</div><button class="ibtn" data-action="labRemove" data-key="${esc(a.key)}" title="Remove from the deal">✕</button></div>`;

  let deal;
  if (!sentA.length && !sentB.length) {
    deal = '<div class="empty">Tick players or picks below to build a deal. What each team gives appears on the other team\'s side here.</div>';
  } else {
    const { vd, fcA, fcB } = sentA.length && sentB.length ? labSummary(m, A, B, sentA, sentB) : { vd: null };
    const rawA = sentB.reduce((s2, a) => s2 + a.v, 0), rawB = sentA.reduce((s2, a) => s2 + a.v, 0);
    const totA = vd ? vd.total1 : rawA, totB = vd ? vd.total2 : rawB;
    const sumT = totA + totB || 1;
    const side = (rid, gets, gives, tot, raw, adj, fcTot, me) => {
      const g = vd ? letterGrade(tot, me === 'A' ? totB : totA) : '';
      const notes = labNotes(m, rid, gets, gives);
      return `<div class="tside">
        <div class="hd">${teamAvatar(team(rid))}<b>${esc(tname(rid))}</b> <span class="muted small">receives</span><span class="grades">${g ? grade(g) : ''}</span></div>
        ${gets.length ? gets.map(assetLine).join('') : '<div class="empty" style="padding:10px">Nothing yet</div>'}
        <div class="tot"><span>Players and picks <b>${k(raw)}</b>${adj ? ` + KTC adj. <b>${k(adj)}</b>` : ''}</span><span>KTC total <b>${k(tot)}</b>${vd ? ` · FC ${k(fcTot)}` : ''}</span></div>
        ${notes.length ? `<ul class="tl" style="margin-top:8px">${notes.map((n) => `<li class="t-${n.dir}">${esc(n.text)}</li>`).join('')}</ul>` : ''}
      </div>`;
    };
    // Balancing suggestions: what the side that's ahead could add.
    let balance = '';
    if (vd && !vd.fair) {
      const gap = Math.abs(vd.total1 - vd.total2);
      const ahead = vd.total1 > vd.total2 ? A : B; // team receiving more
      const pool = labAssets(ahead).filter((a) => !S.lab.picked.has(a.key) && a.v > 0);
      const close = pool.map((a) => ({ a, d: Math.abs(a.v - gap) })).sort((x, y) => x.d - y.d).slice(0, 4).map((x) => x.a);
      if (close.length) balance = `<div class="balance"><span class="muted small">To even it up, ${esc(tname(ahead))} could add about ${k(gap)}:</span> ${close.map((a) => `<button class="chip" data-action="labAdd" data-key="${esc(a.key)}">+ ${esc(a.name)} <span class="faint">${k(a.v)}</span></button>`).join('')}</div>`;
    }
    const verdict = vd ? `<p class="verdict"><b>${vd.fair ? 'KTC calls it fair.' : `${esc(tname(vd.total1 > vd.total2 ? A : B))} comes out ahead by ${k(Math.abs(vd.total1 - vd.total2))}: he gets ${Math.round((Math.max(vd.total1, vd.total2) / Math.max(1, Math.min(vd.total1, vd.total2)) - 1) * 100)}% more value than he gives.`}</b> <span class="muted">FantasyCalc: ${k(fcA)} vs ${k(fcB)}, ${signPct(gainPct(fcA, fcB))} for ${esc(tname(A))}${Math.sign(gainPct(fcA, fcB)) !== Math.sign(vd.total1 - vd.total2) && Math.abs(gainPct(fcA, fcB)) > 0.03 ? ' — the two sites disagree on who wins' : ''}.</span></p>` : '<p class="muted">Add something to both sides to grade it.</p>';
    deal = `${vd ? `<div class="splitbar"><i style="width:${(totA / sumT * 100).toFixed(1)}%"></i><i style="width:${(totB / sumT * 100).toFixed(1)}%"></i></div><div class="splitlab"><span>${esc(tname(A))} ${Math.round(totA / sumT * 100)}%</span><span>${esc(tname(B))} ${Math.round(totB / sumT * 100)}%</span></div>` : ''}
      <div class="sides">${side(A, sentB, sentA, totA, rawA, vd ? vd.adj1 : 0, fcA, 'A')}${side(B, sentA, sentB, totB, rawB, vd ? vd.adj2 : 0, fcB, 'B')}</div>
      ${verdict}${balance}
      <div class="row" style="margin-top:10px"><button class="btn sm" data-action="labCopy">Copy as text</button><button class="btn sm" data-action="labSwap">Swap sides</button><button class="btn sm" data-action="labClear">Clear</button></div>`;
  }

  return `<div class="card lab-deal"><div class="sec-h"><h3 style="margin:0">Trade lab</h3><span class="muted small">KTC ${S.book.fmt && S.book.fmt.superflex ? 'Superflex' : '1QB'}${S.book.fmt && S.book.fmt.ktcTier ? ', TE+' : ''}, with KTC's adjustment for uneven deals</span></div>${deal}</div>
    <div class="two" style="margin-top:16px;align-items:start">
      ${[['a', A], ['b', B]].map(([key, rid]) => `<div class="card"><label class="f">${key === 'a' ? 'Team A' : 'Team B'} <select data-labteam="${key}">${opt(rid)}</select></label>
        <input type="search" class="labq" data-labfilter="${key}" placeholder="Filter by name or position" style="margin:8px 0">
        <p class="muted small" style="margin:0 0 6px">Tick what ${esc(tname(rid))} gives</p><div class="list" id="lablist-${key}">${list(rid, key)}</div></div>`).join('')}
    </div>`;
}

// ---- demand -----------------------------------------------------------------------------

function viewDemand() {
  const m = S.model;
  const rows = m.demand.map((d) => `<tr>
      <td style="width:30%"><div class="who">${headshot(d.asset.id)}<div>${playerLink(d.asset.id)}<div class="meta">${posTag(d.asset.pos)} ${d.asset.age ? Math.floor(d.asset.age) : ''} · ${k(d.asset.v)}</div></div></div></td>
      <td>${d.suitors.length ? d.suitors.map((s) => `<div style="display:grid;grid-template-columns:200px 1fr;gap:10px;align-items:start;margin:4px 0 10px"><div class="who">${teamAvatar(team(s.rid))}<div>${tlink(s.rid)}<div style="width:110px;margin-top:4px">${bar(Math.min(1, s.score / 8), team(s.rid).avoid ? 'grey' : s.why.some((w) => w.k === 'asked') ? 'red' : '')}</div></div></div><div>${s.why.map((w) => `<span class="chip k-${w.k}">${esc(w.text)}</span>`).join('')}</div></div>`).join('') : '<span class="muted">No clear buyer</span>'}</td>
    </tr>`).join('');
  return `<div class="card"><h3>Who wants your players</h3><p class="lede">Your most valuable players and anyone who has asked about them. The bar is "heat": direct offers, positional need, whether he'd start, the manager's posture, players he keeps rostering elsewhere and recent trades. Red means he asked you directly; grey means your notes say to avoid him.</p>
    <div class="scroll"><table class="t"><thead><tr><th>Your player</th><th>Likely buyers</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// ---- rising players (aging) -------------------------------------------------------------

function trajectoryChart(m) {
  const me = team(m.me);
  if (!me.trajectory) return '';
  const seasons = me.trajectory.map((_, i) => m.league.season + i);
  const lg = seasons.map((_, i) => {
    const arr = m.teams.map((t) => t.trajectory[i]).sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  });
  const best = seasons.map((_, i) => Math.max(...m.teams.map((t) => t.trajectory[i])));
  const all = [...me.trajectory, ...lg, ...best];
  const max = Math.max(...all) * 1.05, min = Math.min(...all) * 0.9;
  const W = 520, H = 200, L = 40, R = 16, T = 14, B = 26;
  const x = (i) => L + (i / (seasons.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const line = (arr, color, dash = '') => `<polyline points="${arr.map((v, i) => `${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>${arr.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${color}"/>`).join('')}`;
  const ticks = [min, (min + max) / 2, max].map((v) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Projected lineup points per week by season">${ticks}${seasons.map((s, i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${s}</text>`).join('')}${line(best, 'var(--faint)', '4 4')}${line(lg, 'var(--muted)', '2 4')}${line(me.trajectory, 'var(--violet-2)')}</svg>
    <div class="row small muted"><span style="color:var(--violet-2)">● You</span><span>● League median</span><span>● Best team</span></div></div>`;
}

function viewRising() {
  const m = S.model;
  if (!m.aging) return `<div class="card"><h3>Rising players</h3><p class="muted">Season stats haven't loaded yet. Sync to build the aging model.</p></div>`;
  const me = team(m.me);
  const f = S.ui.rising;
  let list = m.aging.targets.filter((x) => (f.pos === 'ALL' || x.pos === f.pos) && (!f.need || x.fitsNeed) && (f.owner === 'all' || (f.owner === 'fa' ? x.rid == null : f.owner === 'sellers' ? x.rid != null && team(x.rid).posture.tone === 'sell' : x.rid != null)));
  list = [...list].sort((a, b) => (f.sort === 'bargain' ? b.bargain - a.bargain : f.sort === 'age' ? a.age - b.age : b.next3 - a.next3));
  const row = (x) => `<tr>
    <td><div class="who">${headshot(x.id)}<div>${playerLink(x.id, x.name)}<div class="meta">${posTag(x.pos)} ${esc(x.team)} · ${Math.floor(x.age)} · ${esc(x.tier)}</div></div></div></td>
    <td>${x.rid != null ? `<div class="who">${teamAvatar(team(x.rid))}<div>${tlink(x.rid)}<div class="meta">${posture(team(x.rid))}${team(x.rid).avoid ? ' <span class="pill sell">avoid</span>' : ''}</div></div></div>` : '<span class="pill good">Free agent</span>'}</td>
    <td class="num">${x.seasons[0].ppg.toFixed(1)}</td><td class="num">${x.seasons[1].ppg.toFixed(1)}</td><td class="num">${x.seasons[2].ppg.toFixed(1)}</td>
    <td>${spark(x.seasons.map((s) => s.ppg), 'var(--green)')}</td>
    <td class="num">${x.primeYears}</td><td class="num">${k(x.v)}</td><td class="num">${Math.round(x.bargain)}</td>
    <td>${x.rid != null && !team(x.rid).isMe ? `<button class="btn sm" data-action="toLab" data-rid="${x.rid}" data-sid="${esc(x.id)}">Lab</button>` : x.rid == null ? `<button class="btn sm" data-action="addTarget" data-sid="${esc(x.id)}">Waiver target</button>` : ''}</td>
  </tr>`;
  const sell = m.aging.sell.map((p) => `<div class="asset">${headshot(p.id)}<div class="nm">${playerLink(p.id, p.name)}<span class="meta">${esc(p.pos)} · ${Math.floor(p.age)} · ${esc(p.tier)}</span></div><div>${spark(p.seasons.map((s) => s.ppg), 'var(--orange)')}</div><div class="vals">${p.seasons[0].ppg.toFixed(1)} → ${p.seasons[2].ppg.toFixed(1)}<br><span class="muted">${k(p.v)}</span></div></div>`).join('');
  const sel = (key, opts) => `<select data-rising="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(f[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const traj = me.trajectory;
  const drop = traj ? traj[2] / traj[0] - 1 : 0;
  return `<div class="split">
    <div class="grid">
      <div class="card"><h3>Coming into their peak</h3>
        <p class="lede">Players at or below their position's peak age who already produce like weekly starters, projected three seasons forward. "Per 1k" is projected points over the next three seasons per 1,000 of dynasty value: higher means cheaper production.</p>
        <div class="row" style="margin-bottom:10px">${sel('pos', [['ALL', 'All positions'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']])}${sel('owner', [['all', 'Any owner'], ['rostered', 'On rosters'], ['sellers', 'On selling teams'], ['fa', 'Free agents']])}${sel('sort', [['next3', 'Most projected points'], ['bargain', 'Best value per point'], ['age', 'Youngest']])}<label class="row small muted"><input type="checkbox" data-rising="need" ${f.need ? 'checked' : ''}> Only my needs (${esc(me.needs.join(', ') || 'none')})</label></div>
        <div class="scroll"><table class="t"><thead><tr><th>Player</th><th>Owner</th><th class="num">Pts/g ${m.league.season}</th><th class="num">${m.league.season + 1}</th><th class="num">${m.league.season + 2}</th><th>Trend</th><th class="num">Prime yrs</th><th class="num">Value</th><th class="num">Per 1k</th><th></th></tr></thead><tbody>${list.map(row).join('') || '<tr><td colspan="10" class="muted">No players match these filters.</td></tr>'}</tbody></table></div>
      </div>
      <div class="card"><h3>How the projection works</h3><ul class="ev">
        <li>Baseline: points per game this season, last season and Sleeper's season projection, scored with your league's settings and blended by games played.</li>
        <li>Level: rank at his position sets a tier (elite, starter, flex, depth). Elite players hold their peak longer; depth players fall off faster.</li>
        <li>Aging: typical position curves. RBs peak at 24-25 and drop fast after 27; WRs peak 26-27; TEs 27-28; QBs 28-31.</li>
        <li>Young players' growth is scaled by how much the market already values them, so a 21-year-old backup isn't projected as a star.</li>
      </ul></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Your lineup over the next seasons</h3>${trajectoryChart(m)}
        ${traj ? `<p class="${drop <= -0.06 ? 'warn' : 'muted'}" style="margin:8px 0 0">${drop <= -0.06 ? `Your best lineup projects ${Math.round(-drop * 100)}% lower by ${m.league.season + 2} (${ordinal(me.trajRank[0])} now, ${ordinal(me.trajRank[2])} then).` : `Your lineup holds up: ${ordinal(me.trajRank[0])} now, ${ordinal(me.trajRank[2])} in ${m.league.season + 2}.`}</p>` : ''}
      </div>
      <div class="card"><h3>Sell before the drop</h3><p class="lede">Your players past their peak who still carry real value.</p>${sell || '<p class="muted">None of your valuable players are clearly declining.</p>'}</div>
    </div>
  </div>`;
}

// ---- start/sit -----------------------------------------------------------------------------

function viewStartSit() {
  const m = S.model;
  const ss = m.startSit;
  if (!ss) return `<div class="card"><p class="muted">Start/sit isn't available right now. ${esc(m.notes.join(' '))}</p></div>`;
  const Pp = ss.players;
  const cell = (id) => {
    const p = id && Pp[id];
    if (!p) return '<span class="muted">empty</span>';
    return `<div class="who">${headshot(id)}<div><b>${esc(p.name)}</b><div class="meta">${esc(p.team)}${p.inj ? ` <span class="down">${esc(p.inj)}</span>` : ''}${p.locked ? ' · locked' : ''}</div></div></div>`;
  };
  const fpStatus = S.book.status && S.book.status.fp;
  const rows = ss.slots.map((slot, i) => {
    const cur = ss.current[i], rec = ss.recommended[i];
    const p = rec && Pp[rec];
    return `<tr class="${cur !== rec ? 'me' : ''}"><td><span class="pos">${esc(slot)}</span></td><td>${cell(cur)}</td><td>${cell(rec)}</td><td class="num">${p ? p.pts.toFixed(1) : '—'}</td><td>${p && p.posRank ? esc(p.posRank) : '—'}</td><td>${p && p.grade ? grade(p.grade) : ''}</td><td class="muted">${p ? esc(p.opp) : ''}</td></tr>`;
  }).join('');
  const bench = ss.bench.filter((p) => p.pts > 0).slice(0, 10).map((p) => `<tr><td>${cell(p.id)}</td><td class="num">${p.pts.toFixed(1)}</td><td>${esc(p.posRank || '—')}</td><td>${p.grade ? grade(p.grade) : ''}</td><td class="muted">${esc(p.opp)}</td></tr>`).join('');
  const swaps = ss.swaps.filter((s) => s.start);
  const opp = ss.opponent;
  return `<div class="three" style="margin-bottom:16px">
      <div class="card tile hot">${icon('clip')}<div class="num">${ss.bestPts}</div><div class="lab">Best lineup, projected (current ${ss.currentPts})</div></div>
      <div class="card tile">${icon('trophy')}<div class="num">${opp ? pct(opp.winProb) : '—'}</div><div class="lab">${opp ? `Win chance vs ${esc(tname(opp.rid))} (${opp.projected})` : 'No opponent found'}</div></div>
      <div class="card tile">${icon('swap')}<div class="num">${swaps.length}</div><div class="lab">Changes recommended</div></div>
    </div>
    <div class="split">
      <div class="card"><h3>Week ${ss.week} lineup</h3>
        ${swaps.length ? swaps.map((s) => `<div class="asset">${headshot(s.start.id)}<div class="nm"><b>Start ${esc(s.start.name)}</b><span class="meta">${s.start.pts.toFixed(1)} pts${s.start.posRank ? ` · ${esc(s.start.posRank)}` : ''}${s.start.grade ? ` · ${esc(s.start.grade)}` : ''}</span></div>${s.sit ? `<div class="vals muted">over ${esc(s.sit.name)} (${s.sit.pts.toFixed(1)})</div>` : ''}</div>`).join('') : '<p class="muted">Your lineup already matches the projections.</p>'}
        ${ss.flags.length ? `<ul class="ev" style="margin:10px 0">${ss.flags.map((f) => `<li class="${f.kind === 'q' ? '' : 'd-sell'}">${esc(f.text)}</li>`).join('')}</ul>` : ''}
        <div class="scroll"><table class="t"><thead><tr><th>Slot</th><th>Now</th><th>Recommended</th><th class="num">Proj</th><th>FP rank</th><th>Grade</th><th>Matchup</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
      <div class="grid">
        <div class="card"><h3>Bench</h3><div class="scroll"><table class="t"><thead><tr><th>Player</th><th class="num">Proj</th><th>Rank</th><th>Grade</th><th>Matchup</th></tr></thead><tbody>${bench || '<tr><td colspan="5" class="muted">No projected points on your bench.</td></tr>'}</tbody></table></div></div>
        <div class="card muted small">Projections blend Sleeper's projections, scored with your league's settings (including the TE bonus), with FantasyPros' consensus points. Ranks and grades: ${esc(fpStatus && fpStatus.ok ? fpStatus.source : 'FantasyPros unavailable')}. Questionable players are docked slightly, doubtful ones heavily.</div>
      </div>
    </div>`;
}

// ---- waivers (overnight claimer) -------------------------------------------------------------

function freeAgents() {
  const rostered = new Set(S.raw.rosters.flatMap((r) => r.players || []));
  const slots = S.raw.league.roster_positions || [];
  const posOk = new Set(['QB', 'RB', 'WR', 'TE', ...(slots.includes('K') ? ['K'] : []), ...(slots.includes('DEF') ? ['DEF'] : [])]);
  const scoring = S.raw.league.scoring_settings || {};
  const pj = S.model.aging ? S.model.aging.players : {};
  const out = [];
  for (const [sid, d] of Object.entries(S.dict)) {
    if (rostered.has(sid) || d[6] === 0 || !posOk.has(d[1]) || (!d[2] && d[1] !== 'DEF')) continue;
    const v = pval(sid).v;
    const pr = S.aux.proj && S.aux.proj[sid];
    const wk = pr ? scoreLine(pr.stats, scoring, d[1]) : null;
    const fp = S.aux.fpBySid && S.aux.fpBySid[sid];
    const season = S.prod && S.prod.proj && S.prod.proj[sid] ? S.prod.proj[sid][1] / Math.max(1, S.prod.proj[sid][0]) : null;
    if (!v && !wk && !fp && !season && !(S.trending && S.trending[sid])) continue;
    out.push({ id: sid, name: d[0], pos: d[1], team: d[2], age: d[3], v, wk: wk || 0, fpRank: fp ? fp.ecr : null, posRank: fp ? fp.posRank : '', season: season || 0, trend: S.trending ? S.trending[sid] || 0 : 0, rising: pj[sid] ? pj[sid].next3 : 0 });
  }
  return out;
}

function viewWaivers() {
  const u = uid();
  const lg = u && S.wleagues[u];
  const m = S.model;
  // The plan and league record belong to your own team, so don't offer the
  // viewed team's roster as drop spots.
  if (teamState() && teamState() !== 'own') return `<div class="card"><h3>Overnight waiver claims</h3>${notOwnNotice('Waiver claims')}</div>`;
  if (!lg) return `<div class="card"><h3>Overnight waiver claims</h3><p class="muted">Sync once so the claimer knows your roster.</p><button class="btn primary" data-action="sync">Sync now</button></div>`;
  const p = plan();
  const run = p.run;
  const locked = !!run;
  const me = team(m.me);
  const s = S.raw.league.settings || {};
  const wv = S.ui.wv;
  const byId = Object.fromEntries(me.assets.map((a) => [a.id, a]));
  const drops = p.drops.map((d, i) => `<li><span class="nm">${d === 'OPEN' ? '<i>Open roster slot</i>' : byId[d] ? `${posTag(byId[d].pos)} ${esc(byId[d].name)}` : `<span class="down">not on roster</span> ${esc(P(d).name)}`}</span>
      <button class="ibtn" data-action="moveDrop" data-i="${i}" data-dir="-1" ${locked ? 'disabled' : ''}>↑</button><button class="ibtn" data-action="moveDrop" data-i="${i}" data-dir="1" ${locked ? 'disabled' : ''}>↓</button><button class="ibtn" data-action="removeDrop" data-i="${i}" ${locked ? 'disabled' : ''}>✕</button></li>`).join('');
  const targets = p.targets.map((t, i) => `<li><span class="nm">${posTag(t.pos)} ${esc(t.name)} <span class="muted small">${esc(t.team || '')}${t.src ? ` · ${esc(t.src)}` : ''}</span></span>${t.id ? '' : '<span class="pill sell">not found</span>'}
      <button class="ibtn" data-action="moveTarget" data-i="${i}" data-dir="-1" ${locked ? 'disabled' : ''}>↑</button><button class="ibtn" data-action="moveTarget" data-i="${i}" data-dir="1" ${locked ? 'disabled' : ''}>↓</button><button class="ibtn" data-action="removeTarget" data-i="${i}" ${locked ? 'disabled' : ''}>✕</button></li>`).join('');
  const chosen = new Set(p.drops.map(String));
  const rosterList = me.assets.filter((a) => !chosen.has(a.id)).sort((a, b) => a.v - b.v).map((a) => `<div class="it">${headshot(a.id)}<span class="nm">${esc(a.name)} <span class="muted small">${esc(a.pos)} · ${k(a.v)}</span></span><button class="ibtn" data-action="addDrop" data-sid="${esc(a.id)}" ${locked ? 'disabled' : ''}>+ drop</button></div>`).join('');
  const tset = new Set(p.targets.map((t) => t.id));
  let fa = freeAgents().filter((x) => wv.pos === 'ALL' || x.pos === wv.pos);
  const sorters = { value: (a, b) => b.v - a.v, week: (a, b) => b.wk - a.wk, season: (a, b) => b.season - a.season, fp: (a, b) => (a.fpRank ?? 999) - (b.fpRank ?? 999), trend: (a, b) => b.trend - a.trend, rising: (a, b) => b.rising - a.rising };
  fa.sort(sorters[wv.sort] || sorters.value);
  fa = fa.slice(0, 50);
  const faRows = fa.map((x) => `<tr><td><div class="who">${headshot(x.id)}<div>${playerLink(x.id, x.name)}<div class="meta">${posTag(x.pos)} ${esc(x.team || '')}${x.age ? ` · ${Math.floor(x.age)}` : ''}</div></div></div></td>
      <td class="num">${x.v ? k(x.v) : '—'}</td><td class="num">${x.wk ? x.wk.toFixed(1) : '—'}</td><td class="num">${x.season ? x.season.toFixed(1) : '—'}</td><td>${esc(x.posRank || '—')}</td><td class="num">${S.trending ? x.trend || '' : ''}</td>
      <td><button class="btn sm" data-action="addTarget" data-sid="${esc(x.id)}" ${tset.has(x.id) || locked ? 'disabled' : ''}>${tset.has(x.id) ? 'Added' : '+ Target'}</button></td></tr>`).join('');
  const phase = run ? { waiting: 'Armed — waiting', watching: 'Watching for waivers', claiming: 'Claiming', done: 'Done' }[run.phase] || run.phase : 'Not armed';
  const logs = S.log.filter((l) => l.league === lg.name || l.league === 'Sleeper').slice(-60).reverse();
  const wDay = sleeperWaiverDay(s);
  const nextStart = nextWindowStart((plan() || {}).startCheck, (plan() || {}).giveUpHours || 4, Date.now(), wDay);
  const sortSel = `<select data-wv="sort">${[['value', 'Dynasty value'], ['week', 'This week projection'], ['season', 'Season pts/game'], ['fp', 'FantasyPros rank'], ['trend', 'Trending adds'], ['rising', 'Rising (3-yr projection)']].map(([v, l]) => `<option value="${v}" ${wv.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const posSel = `<select data-wv="pos">${['ALL', 'QB', 'RB', 'WR', 'TE', 'DEF', 'K'].map((v) => `<option ${wv.pos === v ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  return `
    <div class="card banner"><div class="art">${icon('moon')}</div><div><b>Overnight waiver claims</b><p>When waivers clear in ${esc(lg.name)} (${esc(lg.waiverType || 'waivers')}, ${wDay == null ? 'daily' : `early ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wDay]} morning`}), the vulture adds your top available targets into your drop spots. Leave Chrome open and the computer awake.${run ? '' : ` <b>Next run if armed now: ${esc(when(nextStart))}.</b>`}</p></div>
      <div class="row" style="margin-left:auto"><span class="pill ${run ? 'buy' : 'mid'}">${esc(phase)}</span>${locked ? `<button class="btn danger" data-action="disarm">Disarm</button>` : `<button class="btn primary" data-action="arm">Arm for next waivers</button>`}</div></div>
    ${wv.msg ? `<div class="notice info" style="margin-top:14px">${esc(wv.msg)}</div>` : ''}
    ${run ? `<div class="card" style="margin-top:16px"><h3>Status</h3><p>${esc(run.lastMsg || '')}</p><p class="muted small">${run.windowStart ? `${run.windowStart > Date.now() ? 'Checking starts' : 'Window opened'} ${esc(when(run.windowStart))}` : ''}${run.lastTick ? ` · last check ${esc(when(run.lastTick))}` : ''}</p>${runReasons(run, p)}${(run.claimed || []).map((c) => `<div class="asset">${headshot(c.id)}<div class="nm"><b>Added ${esc(c.name)}</b><span class="meta">${c.dropName ? `dropped ${esc(c.dropName)} · ` : ''}${esc(when(c.at))}</span></div></div>`).join('')}</div>` : p.lastRun ? `<div class="card" style="margin-top:16px"><h3>Last run</h3><p class="muted">${esc(p.lastRun.lastMsg || '')} ${esc(when(p.lastRun.finishedAt))}</p>${(p.lastRun.claimed || []).map((c) => `<div class="asset">${headshot(c.id)}<div class="nm"><b>Added ${esc(c.name)}</b><span class="meta">${c.dropName ? `dropped ${esc(c.dropName)}` : ''}</span></div></div>`).join('')}</div>` : ''}
    <div class="two" style="margin-top:16px;align-items:start">
      <div class="card"><h3>Drop spots</h3><p class="lede">One spot per player you'd add. Spot 1 is used first.</p>
        ${drops ? `<ol class="pick">${drops}</ol>` : '<p class="muted">No spots yet. Pick who you would drop.</p>'}
        <div class="row" style="margin-bottom:10px"><button class="btn sm" data-action="addOpen" ${locked ? 'disabled' : ''}>+ Open roster slot</button></div>
        <div class="list">${rosterList}</div>
      </div>
      <div class="card"><h3>Targets, in priority order</h3>
        ${targets ? `<ol class="pick">${targets}</ol>` : '<p class="muted">No targets yet. Add from the available players below.</p>'}
        <div class="row" style="margin-top:8px">
          <label class="f">Start checking at<input type="time" data-timing="startCheck" value="${esc(p.startCheck)}" ${locked ? 'disabled' : ''}></label>
          <label class="f">Try anyway after (min)<input type="number" data-timing="fallbackMin" value="${esc(p.fallbackMin)}" ${locked ? 'disabled' : ''}></label>
          <label class="f">Retry a player (min)<input type="number" data-timing="retryMin" value="${esc(p.retryMin)}" ${locked ? 'disabled' : ''}></label>
          <label class="f">Give up after (hrs)<input type="number" data-timing="giveUpHours" value="${esc(p.giveUpHours)}" ${locked ? 'disabled' : ''}></label>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn" data-action="dryRun">Dry run</button><button class="btn" data-action="claimNow" ${locked ? 'disabled' : ''}>Claim now</button></div>
        ${S.ui.dry ? `<ul class="ev" style="margin-top:12px">${S.ui.dry.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>
    <div class="card"><div class="sec-h"><h3 style="margin:0">Available players</h3><div class="row">${posSel}${sortSel}${S.trending ? '' : '<button class="btn sm" data-action="loadTrending">Load trending adds</button>'}</div></div>
      <div class="scroll"><table class="t"><thead><tr><th>Player</th><th class="num">Value</th><th class="num">This week</th><th class="num">Season pts/g</th><th>FP rank</th><th class="num">Adds 24h</th><th></th></tr></thead><tbody>${faRows || '<tr><td colspan="7" class="muted">No available players found.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h3>Activity</h3><div class="log">${logs.map((l) => `<div class="${esc(l.level)}"><span class="muted">${esc(when(l.ts))}</span><span>${esc(l.msg)}</span></div>`).join('') || '<p class="muted">Nothing yet.</p>'}</div></div>`;
}

// Why each target hasn't been added yet, from the claimer's own notes.
function runReasons(run, p) {
  const rows = [];
  for (const t of p.targets) {
    if (!t.id || (run.claimed || []).some((c) => c.id === t.id)) continue;
    const sk = run.skipped && run.skipped[t.id];
    const at = run.attempts && run.attempts[t.id];
    if (!sk && !at) continue;
    rows.push(`<li><b>${esc(t.name)}</b>: ${esc(sk ? `skipped — ${sk}` : `${at.n} attempt${at.n === 1 ? '' : 's'}, last reply: ${at.last}`)}${!sk && at ? ` <span class="faint">(keeps retrying for ${p.retryMin} min)</span>` : ''}</li>`);
  }
  const hint = rows.some((r) => /waiver/i.test(r)) ? '<p class="muted small">Sleeper is treating this player as on waivers, not a free agent. Players dropped recently, or whose game has started this week, stay on waivers until your league processes them. "Claim now" can only add free agents; for a player on waivers, put in a claim in the Sleeper app, or arm the vulture for the next waiver run.</p>' : '';
  return rows.length ? `<ul class="tl">${rows.join('')}</ul>${hint}` : '';
}

async function savePlan(fn) {
  const u = uid();
  const cur = (await chrome.storage.local.get('plans')).plans || {};
  const p = { ...DEFAULT_PLAN, ...(cur[u] || {}) };
  p.drops = [...p.drops];
  p.targets = p.targets.map((t) => ({ ...t }));
  if (fn(p) === false) return;
  cur[u] = p;
  S.plans = cur;
  await chrome.storage.local.set({ plans: cur });
}

// ---- positional ranks ------------------------------------------------------------------

function viewPositions() {
  const m = S.model;
  const PZ = m.positional;
  if (!PZ) return '<div class="card"><h3>Positional ranks</h3><p class="muted">Sync to build positional ranks.</p></div>';
  const f = S.ui.posr;
  const mode = f.mode === 'season' ? 'season' : 'dyn';
  const other = mode === 'dyn' ? 'season' : 'dyn';
  const n = m.teams.length;
  const R = (rid) => PZ.teams[rid];
  const rankCls = (r) => (r <= 3 ? 'up' : r >= n - 2 ? 'down' : '');
  const shown = (c) => (mode === 'dyn' ? k(c.dyn) : `${c.season.toFixed(1)}`);

  // sorting
  const rows = [...m.teams].sort((a, b) => {
    if (f.sort === 'avg') return R(a.rid)[mode + 'Avg'] - R(b.rid)[mode + 'Avg'];
    return R(a.rid)[f.sort][mode + 'Rank'] - R(b.rid)[f.sort][mode + 'Rank'];
  });
  const th = (key, label) => `<th class="num sortable${f.sort === key ? ' on' : ''}" data-action="posSort" data-k="${key}" style="cursor:pointer">${label}${f.sort === key ? ' ▾' : ''}</th>`;
  const cell = (t, pos) => {
    const c = R(t.rid)[pos];
    const r = c[mode + 'Rank'], r2 = c[other + 'Rank'];
    const names = c.top.slice(0, 2).map((id) => esc(P(id).name.split(' ').slice(-1)[0])).join(', ');
    return `<td class="num" style="white-space:nowrap"><b class="${rankCls(r)}" style="font-size:15px">${ordinal(r)}</b> <span class="faint small">${shown(c)}</span>
      <div class="meta" style="max-width:150px;margin-left:auto;overflow:hidden;text-overflow:ellipsis" title="${esc(c.top.map((id) => P(id).name).join(', '))}">${names || '—'}</div>
      ${Math.abs(r - r2) >= 4 ? `<div class="meta"><span class="${r2 < r ? 'up' : 'down'}">${ordinal(r2)} ${mode === 'dyn' ? 'this season' : 'long-term'}</span></div>` : ''}</td>`;
  };
  const table = `<div class="scroll"><table class="t"><thead><tr><th>Team</th>${PZ.order.map((pos) => th(pos, pos)).join('')}${th('avg', 'Avg rank')}</tr></thead><tbody>
    ${rows.map((t) => `<tr class="${t.isMe ? 'me' : ''}"><td><div class="who">${teamAvatar(t)}<div>${tlink(t.rid)}<div class="meta">${t.w}-${t.l}</div></div></div></td>${PZ.order.map((pos) => cell(t, pos)).join('')}<td class="num"><b>${R(t.rid)[mode + 'Avg'].toFixed(1)}</b></td></tr>`).join('')}
  </tbody></table></div>`;

  // your read
  const me = R(m.me);
  const tips = [];
  const byDyn = [...PZ.order].sort((a, b) => me[a].dynRank - me[b].dynRank);
  const bySea = [...PZ.order].sort((a, b) => me[a].seasonRank - me[b].seasonRank);
  tips.push({ dir: 'good', text: `Strongest long-term: ${byDyn[0]} (${ordinal(me[byDyn[0]].dynRank)}). Strongest this season: ${bySea[0]} (${ordinal(me[bySea[0]].seasonRank)}).` });
  tips.push({ dir: 'sell', text: `Weakest long-term: ${byDyn[3]} (${ordinal(me[byDyn[3]].dynRank)}). Weakest this season: ${bySea[3]} (${ordinal(me[bySea[3]].seasonRank)}).` });
  for (const pos of PZ.order) {
    const d = me[pos].dynRank, s2 = me[pos].seasonRank;
    if (s2 - d >= 4) tips.push({ dir: 'mid', text: `${pos}: ${ordinal(d)} long-term but ${ordinal(s2)} this season. The value is there; it's young or hurt. Hold unless you're chasing this year.` });
    if (d - s2 >= 4) tips.push({ dir: 'buy', text: `${pos}: ${ordinal(s2)} this season but ${ordinal(d)} long-term. That room is producing on borrowed time (average age ${me[pos].age ? me[pos].age.toFixed(1) : '—'}); sell before the value goes.` });
  }
  // trade partners: teams deep where you're thin, and thin where you're deep
  const weak = byDyn[3], strong = byDyn[0];
  const partners = m.teams.filter((t) => !t.isMe && !t.avoid && R(t.rid)[weak].dynRank <= 4 && R(t.rid)[strong].dynRank >= n - 4)
    .sort((a, b) => R(a.rid)[weak].dynRank - R(b.rid)[weak].dynRank).slice(0, 3);
  if (partners.length) tips.push({ dir: 'buy', text: `Natural trade partners: ${partners.map((t) => `${t.name} (${weak} ${ordinal(R(t.rid)[weak].dynRank)}, ${strong} ${ordinal(R(t.rid)[strong].dynRank)})`).join('; ')}. They're deep where you're thin and thin where you're deep.` });

  // position room list
  const fp = PZ.order.includes(f.focus) ? f.focus : 'RB';
  let list = PZ.players[fp];
  if (f.owner === 'me') list = list.filter((x) => x.rid === m.me);
  else if (f.owner === 'others') list = list.filter((x) => x.rid !== m.me);
  const tabs = PZ.order.map((pos) => `<button class="btn sm${pos === fp ? ' primary' : ''}" data-action="posFocus" data-pos="${pos}">${pos}</button>`).join('');
  const sel = (key, opts) => `<select data-posr="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(f[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const prow = (x) => `<tr class="${x.rid === m.me ? 'me' : ''}"><td class="num">${fp}${x.vRank}</td>
    <td><div class="who">${headshot(x.id)}<div>${playerLink(x.id, x.name)}<div class="meta">${esc(x.team || 'FA')}${x.age ? ` · ${Math.floor(x.age)}` : ''}${x.inj ? ` · <span class="down">${esc(x.inj)}</span>` : ''}</div></div></div></td>
    <td>${tlink(x.rid)}</td><td class="num">${k(x.v)}</td><td class="num">${x.ppg ? x.ppg.toFixed(1) : '—'}</td><td class="num">${x.pRank ? `${fp}${x.pRank}` : '—'}</td></tr>`;

  return `<div class="split">
    <div class="grid">
      <div class="card"><div class="sec-h"><h3 style="margin:0">Every team, by position</h3><div class="row">${sel('mode', [['dyn', 'Dynasty value'], ['season', 'This season (pts/g)']])}</div></div>
        <p class="lede">${mode === 'dyn'
          ? `Rank by the dynasty value (KTC) of each team's top ${PZ.order.map((pos) => `${PZ.depth[pos]} ${pos}`).join(', ')}: the starters plus the next man up.`
          : `Rank by points per game of the healthy players who'd start now: ${PZ.order.map((pos) => `${PZ.startN[pos]} ${pos}`).join(', ')} (flex counted as an extra RB and WR).`}
          Click a column to sort. A note under a rank means the ${mode === 'dyn' ? 'season' : 'long-term'} rank is 4+ spots different.</p>
        ${table}</div>
      <div class="card"><div class="sec-h"><h3 style="margin:0">${fp} rankings, every rostered player</h3><div class="row">${tabs}${sel('owner', [['all', 'All teams'], ['me', 'Mine'], ['others', 'Other teams']])}</div></div>
        <p class="lede">League rank at the position by dynasty value, with this season's points per game and rank.</p>
        <div class="scroll" style="max-height:640px"><table class="t"><thead><tr><th class="num">Rank</th><th>Player</th><th>Owner</th><th class="num">Value</th><th class="num">Pts/g</th><th class="num">Pts rank</th></tr></thead><tbody>${list.map(prow).join('') || '<tr><td colspan="6" class="muted">Nobody.</td></tr>'}</tbody></table></div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Your rooms</h3>
        <div class="facts">${PZ.order.map((pos) => `<div><span>${pos}</span><b class="${rankCls(me[pos].dynRank)}">${ordinal(me[pos].dynRank)}</b><span>${ordinal(me[pos].seasonRank)} this season</span></div>`).join('')}</div>
        <ul class="ev" style="margin-top:12px">${tips.map((t) => `<li class="d-${t.dir}">${esc(t.text)}</li>`).join('')}</ul></div>
    </div>
  </div>`;
}

// ---- league compare ------------------------------------------------------------------------

const CMP = {}; // league id → { loading, data, error }

function cmpSources() {
  const m = S.model;
  const others = (S.raw && S.raw.others) || {};
  const src = [];
  const mine = ((S.raw && S.raw.leagues) || []).filter((l) => String(l.id) !== String(m.league.id));
  if (mine.length) src.push({ uid: 'me', name: 'You', leagues: mine.map((l) => ({ id: l.id, name: l.name })) });
  const added = (S.cfg.cmpExtra || []).filter((l) => String(l.id) !== String(m.league.id));
  if (added.length) src.push({ uid: 'added', name: 'Leagues you added', leagues: added });
  for (const t of m.teams) {
    if (t.isMe) continue;
    const o = others[t.userId];
    if (o && o.leagues && o.leagues.length) src.push({ uid: t.userId, name: t.name, leagues: o.leagues.map((l) => ({ id: l.id, name: l.name, size: l.size, sf: l.sf, tep: l.tep })) });
  }
  return src;
}

function viewCompare() {
  const m = S.model;
  const f = S.ui.cmp;
  const src = cmpSources();
  const addBox = `<div class="row cmp-add" style="gap:8px;margin-top:10px;align-items:end">
    <label class="f" style="flex:1;max-width:340px">Add a league by its Sleeper league ID<input type="text" id="cmp-add" inputmode="numeric" placeholder="e.g. 1263631358337503232" value="${esc(f.addId || '')}"></label>
    <button class="btn sm primary" data-action="cmpAdd">${f.adding ? 'Adding…' : 'Add league'}</button>
    ${f.uid === 'added' && f.lid ? '<button class="btn sm" data-action="cmpRemove">Remove this league</button>' : ''}</div>
    ${f.addErr ? `<p class="down small" style="margin:6px 0 0">${esc(f.addErr)}</p>` : ''}
    <p class="faint small" style="margin:6px 0 0">The ID is the long number in the league's address: sleeper.com/leagues/<b>ID</b>/…</p>`;
  if (!src.length) return `<div class="card"><h3>League compare</h3><p class="muted">No other leagues found yet. League-mates' other leagues load during a sync (refreshed once a day), or add any league yourself.</p>${addBox}</div>`;
  if (!f.uid || !src.find((x) => x.uid === f.uid)) f.uid = (src.find((x) => x.uid !== 'me') || src[0]).uid;
  const who = src.find((x) => x.uid === f.uid);
  if (!f.lid || !who.leagues.find((l) => String(l.id) === String(f.lid))) f.lid = who.leagues[0].id;
  const sel = (key, opts) => `<select data-cmp="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(f[key]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const picker = `<div class="card"><div class="sec-h"><h3 style="margin:0">Compare ${esc(m.league.name)} with</h3>
    <div class="row">${sel('uid', src.map((x) => [x.uid, `${x.name} (${x.leagues.length} other league${x.leagues.length === 1 ? '' : 's'})`]))}
    ${sel('lid', who.leagues.map((l) => [l.id, `${l.name.trim()}${l.size ? ` · ${l.size} teams` : ''}${l.sf ? ' · SF' : ''}${l.tep ? ' · TE+' : ''}`]))}
    <button class="btn sm" data-action="cmpReload" title="Fetch this league again">${icon('sync')}</button></div></div>
    ${addBox}
    <p class="lede" style="margin:8px 0 0">Pulls the other league's settings and rosters live from Sleeper. Player values are from your league's value settings, so they're a guide to who matters, not the other league's market.</p></div>`;

  const c = CMP[f.lid];
  if (!c) {
    CMP[f.lid] = { loading: true };
    fetchLeague(f.lid).then((d) => { CMP[f.lid] = { data: d }; }).catch((e) => { CMP[f.lid] = { error: e.message }; }).then(() => { if (route().page === 'compare') render(); });
    return picker + '<div class="card"><p class="muted">Loading that league from Sleeper…</p></div>';
  }
  if (c.loading) return picker + '<div class="card"><p class="muted">Loading that league from Sleeper…</p></div>';
  if (c.error) return picker + `<div class="card"><p class="down">Couldn't load that league: ${esc(c.error)}</p></div>`;

  const ours = { league: S.raw.league, rosters: S.raw.rosters };
  const X = compareLeagues(ours, c.data, S.dict, (sid) => pval(sid).v || 0);
  const A = X.a.s.name.trim(), B = X.b.s.name.trim();
  const dcls = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : 'faint');
  const sgn = (d) => (d > 0 ? `+${d}` : String(d));

  // settings
  const srow = (label, va, vb) => `<tr class="${String(va) !== String(vb) ? 'me' : ''}"><td>${label}</td><td>${esc(String(va))}</td><td>${esc(String(vb))}</td></tr>`;
  const scRows = X.scoreKeys.filter(([k2]) => X.a.s.scoring[k2] || X.b.s.scoring[k2]).map(([k2, l]) => srow(l, X.a.s.scoring[k2], X.b.s.scoring[k2])).join('');
  const settings = `<div class="card"><h3>Settings</h3><p class="lede">Highlighted rows differ.</p><div class="scroll"><table class="t"><thead><tr><th></th><th>${esc(A)}</th><th>${esc(B)}</th></tr></thead><tbody>
    ${srow('Teams', X.a.s.teams, X.b.s.teams)}
    ${srow('Starting lineup', X.a.s.startersTxt, X.b.s.startersTxt)}
    ${srow('Bench', X.a.s.bench, X.b.s.bench)}
    ${srow('Taxi', X.a.s.taxi, X.b.s.taxi)}
    ${srow('IR', X.a.s.ir, X.b.s.ir)}
    ${srow('Spots per team (incl. taxi and IR)', X.a.s.total + X.a.s.taxi + X.a.s.ir, X.b.s.total + X.b.s.taxi + X.b.s.ir)}
    ${srow('Superflex', X.a.s.sf ? 'Yes' : 'No', X.b.s.sf ? 'Yes' : 'No')}
    ${scRows}</tbody></table></div></div>`;

  // counts
  const range = (arr) => (arr.length ? `${Math.min(...arr)}–${Math.max(...arr)}` : '—');
  const counts = `<div class="card"><h3>Players rostered</h3><div class="scroll"><table class="t"><thead><tr><th>Position</th><th class="num">${esc(A)}</th><th class="num">${esc(B)}</th><th class="num">Difference</th><th class="num">Per team</th></tr></thead><tbody>
    <tr><td><b>Total</b></td><td class="num"><b>${X.a.total}</b></td><td class="num"><b>${X.b.total}</b></td><td class="num ${dcls(X.a.total - X.b.total)}">${sgn(X.a.total - X.b.total)}</td><td class="num">${(X.a.total / X.a.s.teams).toFixed(1)} vs ${(X.b.total / X.b.s.teams).toFixed(1)}</td></tr>
    ${X.positions.map((p) => `<tr><td>${p.pos === 'Other' ? 'Other (IDP etc.)' : posTag(p.pos)}</td><td class="num">${p.a}</td><td class="num">${p.b}</td><td class="num ${dcls(p.diff)}">${sgn(p.diff)}</td><td class="num">${p.aPer.toFixed(1)} vs ${p.bPer.toFixed(1)}</td></tr>`).join('')}
    <tr><td>On IR</td><td class="num">${X.a.ir}</td><td class="num">${X.b.ir}</td><td class="num ${dcls(X.a.ir - X.b.ir)}">${sgn(X.a.ir - X.b.ir)}</td><td></td></tr>
    <tr><td>On taxi</td><td class="num">${X.a.taxi}</td><td class="num">${X.b.taxi}</td><td class="num ${dcls(X.a.taxi - X.b.taxi)}">${sgn(X.a.taxi - X.b.taxi)}</td><td></td></tr>
    <tr><td>Roster size range</td><td class="num">${range(X.a.perTeam)}</td><td class="num">${range(X.b.perTeam)}</td><td></td><td></td></tr>
    <tr><td>Held in both leagues</td><td class="num" colspan="2" style="text-align:center">${X.shared}</td><td></td><td></td></tr>
  </tbody></table></div></div>`;

  // QBs
  const qrow = (label, a, b) => `<tr><td>${label}</td><td class="num">${a}</td><td class="num">${b}</td></tr>`;
  const free = (q) => (q.freeStarters.length ? q.freeStarters.map((x) => `${esc(x.name)} (${esc(x.team)})`).join(', ') : 'none');
  const qbs = `<div class="card"><h3>QB depth</h3><div class="scroll"><table class="t"><thead><tr><th></th><th class="num">${esc(A)}</th><th class="num">${esc(B)}</th></tr></thead><tbody>
    ${qrow('QB starting slots', X.a.qb.slots, X.b.qb.slots)}
    ${qrow('QBs rostered', X.a.qb.held, X.b.qb.held)}
    ${qrow('Per team', X.a.qb.perTeam.toFixed(2), X.b.qb.perTeam.toFixed(2))}
    ${qrow('NFL starting QBs rostered', X.a.qb.startersHeld, X.b.qb.startersHeld)}
    ${qrow('NFL backups rostered', X.a.qb.backupsHeld, X.b.qb.backupsHeld)}
  </tbody></table></div>
  <p class="small muted" style="margin-top:8px">NFL starters on waivers in ${esc(A)}: ${free(X.a.qb)}.<br>In ${esc(B)}: ${free(X.b.qb)}.</p></div>`;

  // only-in lists
  const posF = f.pos;
  const pos = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'].filter((p2) => p2 === 'ALL' || X.onlyA.some((x) => x.pos === p2) || X.onlyB.some((x) => x.pos === p2));
  const tabs = pos.map((p2) => `<button class="btn sm${p2 === posF ? ' primary' : ''}" data-action="cmpPos" data-pos="${p2}">${p2 === 'ALL' ? 'All' : p2}</button>`).join('');
  const filt = (l) => l.filter((x) => posF === 'ALL' || x.pos === posF);
  const plist = (l) => {
    const rows = filt(l);
    if (!rows.length) return '<p class="muted">None.</p>';
    return `<div class="scroll"><table class="t"><thead><tr><th>Player</th><th class="num">Age</th><th class="num">Value</th></tr></thead><tbody>${rows.map((x) => `<tr><td><div class="who">${x.pos === 'DEF' ? '' : headshot(x.id)}<div>${S.dict[x.id] ? playerLink(x.id, x.name) : esc(x.name)}<div class="meta">${posTag(x.pos)} ${esc(x.team || 'FA')}${x.inj ? ` · <span class="down">${esc(x.inj)}</span>` : ''}</div></div></div></td><td class="num">${x.age ? Math.floor(x.age) : ''}</td><td class="num">${x.v ? k(x.v) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  };
  const cnt = (l) => { const c2 = {}; for (const x of l) c2[x.pos] = (c2[x.pos] || 0) + 1; return Object.entries(c2).map(([p2, n2]) => `${p2} ${n2}`).join(' · '); };
  const lists = `<div class="card"><div class="sec-h"><h3 style="margin:0">Held in one league but not the other</h3><div class="row">${tabs}</div></div>
    <div class="two" style="align-items:start;margin-top:10px">
      <div><h3>Only in ${esc(A)} <span class="faint">(${filt(X.onlyA).length})</span></h3><p class="small muted">${cnt(X.onlyA)}</p>${plist(X.onlyA)}</div>
      <div><h3>Only in ${esc(B)} <span class="faint">(${filt(X.onlyB).length})</span></h3><p class="small muted">${cnt(X.onlyB)}</p>${plist(X.onlyB)}</div>
    </div></div>`;

  return `${picker}
    <div class="grid" style="margin-top:16px">
      <div class="two" style="align-items:start">
        <div class="card"><h3>What's different</h3><ul class="ev">${X.notes.map((t) => `<li class="d-mid">${esc(t)}</li>`).join('')}</ul></div>
        ${qbs}
      </div>
      <div class="two" style="align-items:start">${counts}${settings}</div>
      ${lists}
    </div>`;
}

// ---- trade trees ---------------------------------------------------------------------------

function allTreeTrades() {
  const m = S.model;
  const seen = new Set();
  return [...m.leagueTrades, ...(m.histTrades || [])].filter((nt) => nt.tree && !seen.has(nt.id) && seen.add(nt.id));
}
const treeNm = (nt, r) => (team(r) ? tname(r) : (nt.nameOf && nt.nameOf[r]) || tname(r));
const treeStats = (nt) => {
  const g = Math.max(0, ...nt.rids.map((r) => (nt.tree[r] && nt.tree[r].generations) || 0));
  const later = nt.rids.reduce((a, r) => a + ((nt.tree[r] && nt.tree[r].laterTrades) || 0), 0);
  return { g, later };
};

// What a side got, valued at the trade. Only real historical values count: when the trade has no
// values from its own time, "then" would just be today's values again, so it's unknown (null).
const treeThen = (nt, r) => (nt.then && nt.then[r] ? nt.then[r].got : null);
const treeThenAdj = (nt, r) => (nt.then && nt.then[r] ? nt.then[r].adj || 0 : 0);
const adjNote = (adj) => (adj ? ` (incl. ${adj > 0 ? '+' : '−'}${k(Math.abs(adj))} KTC package adj.)` : '');

// How much a trade's tree moved for each side: value at the trade vs what it's worth today.
function treeGain(nt) {
  const per = nt.rids.map((r) => {
    const then = treeThen(nt, r);
    const now = nt.tree[r] ? nt.tree[r].total : 0;
    return { r, then, now, gain: then != null ? now - then : null };
  });
  const best = per.filter((x) => x.gain != null).sort((x, y) => y.gain - x.gain)[0] || null;
  const tot = per.reduce((s2, x) => s2 + x.now, 0);
  const sorted = [...per].sort((x, y) => y.now - x.now);
  const gap = sorted.length > 1 ? sorted[0].now - sorted[1].now : 0;
  return { per, best, gap, share: tot ? sorted[0].now / tot : 0.5, winner: sorted[0] ? sorted[0].r : null, loser: sorted[1] ? sorted[1].r : null };
}

const TREE_SORTS = [['gen', 'Generations'], ['later', 'Later deals'], ['gain', 'Biggest value gain'], ['gap', 'Most lopsided'], ['new', 'Newest']];
function sortTrees(list, key) {
  const by = {
    gen: (a, b) => b.g - a.g || b.later - a.later,
    later: (a, b) => b.later - a.later || b.g - a.g,
    gain: (a, b) => ((b.gain.best && b.gain.best.gain) || -1e9) - ((a.gain.best && a.gain.best.gain) || -1e9),
    gap: (a, b) => b.gain.gap - a.gain.gap,
    new: (a, b) => b.nt.created - a.nt.created,
  }[key] || ((a, b) => b.g - a.g);
  return [...list].sort((a, b) => by(a, b) || b.nt.created - a.nt.created);
}

// The full original deal: what each side sent, valued then and now.
function treeDealSummary(nt) {
  const item = (a) => `<li>${a.kind === 'pick' ? '<span class="pos PK">PK</span>' : posTag(a.pos)} ${a.kind === 'pick' ? esc(a.label) : (S.dict[a.id] ? playerLink(a.id, a.name) : esc(a.name))} <span class="faint">${nt.thenVals && nt.thenVals[a.key] != null ? `${k(nt.thenVals[a.key])} → ` : ''}${k(a.v)}</span></li>`;
  // Each side's KTC calculator total: the plain sum plus KTC's package adjustment (fewer, better pieces).
  const totals = (r) => {
    const t0 = nt.then && nt.then[r] ? nt.then[r] : null, n0 = nt.now && nt.now[r] ? nt.now[r] : null;
    if (!n0) return '';
    const adjLine = (t0 && t0.adj) || n0.adj ? `<li class="fadj"><span class="pos PK" style="opacity:0">·</span> KTC package adj. <span class="faint">${t0 ? `${t0.adj ? '+' + k(t0.adj) : '0'} → ` : ''}${n0.adj ? '+' + k(n0.adj) : '0'}</span></li>` : '';
    return `${adjLine}<li class="ftot">Total <b>${t0 ? `${k(t0.got)} → ` : ''}${k(n0.got)}</b></li>`;
  };
  return `<div class="fdealsum">${nt.rids.map((r) => `<div><div class="small muted dsh">${tmini(nt, r)} ${esc(treeNm(nt, r))} received</div><ul>${(nt.recv[r] || []).map(item).join('') || '<li class="muted">nothing</li>'}${totals(r)}</ul></div>`).join('<div class="fx">⇄</div>')}</div>`;
}

// The family-tree diagram for one trade.
// opts: { orient: 'down' | 'right', stack, sides, print, depth (generations shown, 0 = all), open, closed }
function treeDiagram(nt, opts = {}) {
  const sides = opts.sides || nt.rids;
  const lr = opts.orient === 'right';
  const maxDepth = Number(opts.depth) || 0;
  const open = opts.open || {}, closed = opts.closed || {};
  const itemName = (x) => (x.kind === 'pick' ? `${x.season} ${roundName(x.round)}${x.no ? ` (${x.no})` : ''}` : P(x.sid).name);
  const tag = (x) => (x.kind === 'pick' ? '<span class="pos PK">PK</span>' : posTag(P(x.sid).pos));
  const statusTxt = (n) => ({
    kept: 'On the roster today', released: `Released ${n.at ? dateY(n.at) : ''}`, gone: 'No longer on the roster',
    owned: 'Pick still owned', drafted: `Spent in the ${n.season} draft`, unknown: `Spent in the ${n.season} draft (player not matched)`, traded: '',
  }[n.status] || '');
  const countBoxes = (arr) => (arr || []).reduce((a, c) => a + (c.kind === 'package' ? c.items.length : 1) + countBoxes(c.children), 0);
  const toggle = (path, n, hidden) => {
    if (opts.print || !n.children || !n.children.length) return '';
    return hidden
      ? `<button class="ftog" data-action="treeOpen" data-path="${esc(path)}" title="Show this branch">+${countBoxes(n.children)}</button>`
      : `<button class="ftog" data-action="treeClose" data-path="${esc(path)}" title="Collapse this branch">−</button>`;
  };
  const box = (x, n, tg = '') => {
    const pic = x.kind === 'player' ? headshot(x.sid) : '<span class="av head" style="color:var(--accent-t)">PK</span>';
    const name = x.kind === 'player' ? playerLink(x.sid, itemName(x)) : esc(itemName(x));
    return `<div class="fbox st-${n.status}">${pic}<div class="fb"><div class="fn">${tag(x)} ${name}</div>${x.draftedWith ? `<div class="fs">Drafted ${esc(x.draftedWith)}</div>` : ''}${statusTxt(n) ? `<div class="fs">${esc(statusTxt(n))}</div>` : ''}${n.pts ? `<div class="fs fpts" title="Starting-lineup points he scored for this team while on the roster">${Math.round(n.pts * 10) / 10} pts · ${n.starts} start${n.starts === 1 ? '' : 's'}</div>` : ''}<div class="fv">${n.status === 'traded' || n.status === 'drafted' ? `became <b>${k(n.total)}</b>` : n.status === 'kept' || n.status === 'owned' ? `worth <b>${k(n.total)}</b>` : '<b>0</b>'}</div></div>${tg}</div>`;
  };
  const also = (n) => (n.alsoSent && n.alsoSent.length && opts.withText ? `<span class="fs fwith">with ${n.alsoSent.map((x) => esc(itemName(x))).join(', ')}</span>` : '');
  // Assets this team added to a later deal from outside the tree: drawn faded beside the tree's own.
  const extraBox = (x) => {
    const pic = x.kind === 'player' ? headshot(x.sid) : '<span class="av head" style="color:var(--accent-t)">PK</span>';
    const name = x.kind === 'player' ? playerLink(x.sid, itemName(x)) : esc(itemName(x));
    return `<div class="fbox st-extra" title="Not from this trade: added to the deal by the same team"><span class="xtag">+</span>${pic}<div class="fb"><div class="fn">${tag(x)} ${name}</div><div class="fs">Added in this deal</div></div></div>`;
  };
  const withExtras = (inner, n) => (!opts.withText && n.alsoSent && n.alsoSent.length ? `<div class="fpkg wx">${inner}${n.alsoSent.map(extraBox).join('')}</div>` : inner);
  const dealBox = (n, tg = '') => `<div class="fdeal"><span>⇄ Traded ${n.kind === 'package' ? 'together ' : ''}to ${(n.partner || []).map((r) => tnameLogo(nt, r)).join(', ')}</span>${also(n)}<span class="fs">${n.at ? esc(dateY(n.at)) : ''}${n.via && !opts.print ? ` · <a href="#tree/${esc(n.via)}">that trade's tree</a>` : ''}</span><span class="fs">got back ${k(n.fullTotal != null ? n.fullTotal : n.total)} today</span>${n.share != null && n.share < 0.995 ? `<span class="fs fcredit" title="Split by value on the day of this trade (${esc(n.valSrc || '')}): the tree's assets were worth ${k(n.sentThen)} of the ${k(n.sentAll)} sent.">tree's share ${Math.round(n.share * 100)}% → credited <b>${k(n.total)}</b></span>` : ''}${tg}</div>`;
  // A branch is hidden when it's beyond the generation limit (unless opened) or collapsed.
  const isHidden = (path, gen) => !!closed[path] || (maxDepth && gen >= maxDepth && !open[path]);
  const kidsIdx = (arr, idx, path) => `<ul>${idx.map((i) => node(arr[i], 0, `${path}.${i}`)).join('')}</ul>`;
  const kids = (arr, gen, path) => (arr && arr.length ? `<ul>${arr.map((c, i) => node(c, gen, `${path}.${i}`)).join('')}</ul>` : '');
  function node(n, gen, path) {
    const flips = n.status === 'traded' || n.status === 'drafted' || n.kind === 'package';
    const g2 = gen + (flips ? 1 : 0);
    const hidden = flips && n.children && n.children.length ? isHidden(path, gen + 1) : false;
    const tg = toggle(path, n, hidden);
    const rest = hidden ? '' : kids(n.children, g2, path);
    if (n.kind === 'package') {
      const items = `<div class="fpkg${!opts.withText && n.alsoSent && n.alsoSent.length ? ' wx' : ''}">${n.items.map((x) => box(x, { ...x, status: 'traded', total: 0 }).replace('became <b>0</b>', 'packaged')).join('')}${!opts.withText && n.alsoSent ? n.alsoSent.map(extraBox).join('') : ''}</div>`;
      return lr ? `<li><div class="fgrp">${items}${dealBox(n, tg)}</div>${rest}</li>` : `<li>${items}<ul><li>${dealBox(n, tg)}${rest}</li></ul></li>`;
    }
    if (n.status === 'traded') return lr ? `<li><div class="fgrp">${withExtras(box(n, n), n)}${dealBox(n, tg)}</div>${rest}</li>` : `<li>${withExtras(box(n, n), n)}<ul><li>${dealBox(n, tg)}${rest}</li></ul></li>`;
    return `<li>${box(n, n, n.status === 'drafted' ? tg : '')}${rest}</li>`;
  }
  const sideCol = (r) => {
    const tr = nt.tree[r];
    const then = treeThen(nt, r);
    const tAdj = treeThenAdj(nt, r);
    return `<li><div class="fteam">${teamAvatar(team(r))}<div><b>${esc(treeNm(nt, r))}</b> got
      <div class="fs">${then != null ? `<span title="KTC calculator value of what this side got, at the trade${esc(adjNote(tAdj))}">${k(then)} at the trade</span> → ` : ''}<b class="${then != null && tr.total >= then ? 'up' : then != null ? 'down' : ''}" title="KTC calculator value of this side's tree today${esc(adjNote(tr.adj || 0))}">${k(tr.total)}</b> today · ${tr.generations} gen · ${tr.laterTrades} later deal${tr.laterTrades === 1 ? '' : 's'} · ${tr.playersNow} still rostered${tr.pts ? ` · <b>${tr.pts.toLocaleString()}</b> starter pts` : ''}</div>${opts.part ? `<div class="fs fpart">${esc(opts.part)}</div>` : ''}</div></div>${opts.only ? kidsIdx(tr.nodes, opts.only, `s${r}`) : kids(tr.nodes, 0, `s${r}`)}</li>`;
  };
  if (lr) return `<div class="ft lr"><ul>${sides.map(sideCol).join('')}</ul></div>`;
  if (opts.stack && sides.length > 1) return sides.map((r) => `<div class="ft" style="margin-bottom:28px"><ul>${sideCol(r)}</ul></div>`).join('');
  return `<div class="ft"><ul><li><div class="froot">${esc(dateY(nt.created))}${nt.leg ? ` · week ${nt.leg}` : ''}<div class="fs">${esc(nt.rids.map((r) => treeNm(nt, r)).join(' ⇄ '))}</div></div><ul>${sides.map(sideCol).join('')}</ul></li></ul></div>`;
}

function treeLead(nt) {
  const ranked = [...nt.rids].sort((a, b) => nt.tree[b].total - nt.tree[a].total);
  return ranked.length > 1 ? `${treeNm(nt, ranked[0])}'s side of the tree is worth ${k(nt.tree[ranked[0]].total)} today, ${k(nt.tree[ranked[0]].total - nt.tree[ranked[1]].total)} more than ${treeNm(nt, ranked[1])}'s.` : '';
}

// The math behind a tree, in three steps: (1) each later deal's split, (2) every asset the tree
// touched with its value today and the starter points it scored while on the roster, each carried
// back to the original trade by the product of shares on its path, (3) the per-side totals.
function attributionTables(nt, opts = {}) {
  const pickName = (x) => `${x.season} ${roundName(Number(x.round))}${x.no ? ` (${x.no})` : ''}`;
  const nmOf = (x) => (x.kind === 'pick' || x.round != null ? pickName(x) : P(x.sid).name);
  const keyName = (key) => {
    if (key.startsWith('p:')) return P(key.slice(2)).name;
    const [, y, r, o] = key.split(':');
    return `${y} ${roundName(Number(r))} (${tname(Number(o))})`;
  };
  const pct = (x) => `${Math.round(x * 100)}%`;
  const pf = (x) => (Math.round((x || 0) * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const isPick = (x) => x.kind === 'pick' || x.round != null;
  const tagOf = (x) => (isPick(x) ? '<span class="pos PK">PK</span>' : posTag(P(x.sid).pos));
  const deals = [], rows = [];
  // chain: the deals on the path so far [{deal, share}]; factor = product of their shares.
  const walk = (rid, nodes, chain, path) => {
    const factor = chain.reduce((a, c) => a * c.share, 1);
    for (const n of nodes || []) {
      if (n.status === 'traded' || n.kind === 'package') {
        const label = n.kind === 'package' ? n.items.map(nmOf).join(' + ') : nmOf(n);
        const share = n.share != null ? n.share : 1;
        deals.push({ rid, at: n.at, partner: n.partner || [], label, parts: n.parts, share, full: n.fullTotal != null ? n.fullTotal : n.total, credited: n.total, src: n.valSrc, via: n.via });
        const no = deals.length;
        // The flipped asset(s) themselves: they scored points before going out in deal `no`.
        for (const it of n.kind === 'package' ? n.items : [n]) {
          rows.push({ rid, x: it, path, chain, factor, flipped: no, from: it.from != null ? it.from : n.from, to: n.at, pts: it.pts || 0, starts: it.starts || 0, value: null });
        }
        walk(rid, n.children, [...chain, { deal: no, share }], [...path, { label, deal: no, share }]);
      } else if (n.status === 'drafted') {
        walk(rid, n.children, chain, [...path, { label: nmOf(n), drafted: true }]);
      } else {
        rows.push({ rid, x: n, path, chain, factor, from: n.from, to: n.status === 'released' ? n.at : null, pts: n.pts || 0, starts: n.starts || 0, value: n.total || 0 });
      }
    }
  };
  for (const r of nt.rids) walk(r, nt.tree[r].nodes, [], []);
  for (const x of rows) { x.attrV = x.value == null ? null : x.value * x.factor; x.attrP = x.pts * x.factor; }

  const statusTxt = (x) => (x.flipped ? `Traded away in D${x.flipped}` : ({ kept: 'On the roster', owned: 'Pick still owned', released: 'Released', gone: 'No longer on the roster', unknown: 'Pick used (player not matched)' }[x.x.status] || x.x.status));
  const chainTxt = (c) => (!c.length ? '100%' : c.length === 1 ? pct(c[0].share) : `${c.map((d) => pct(d.share)).join(' × ')} = <b>${pct(c.reduce((a, d) => a * d.share, 1))}</b>`);
  const heldTxt = (x) => {
    if (isPick(x.x)) return '<span class="faint">—</span>';
    const end = x.to ? dateY(x.to) : x.x.status === 'kept' ? 'now' : '?';
    return `${x.from ? esc(dateY(x.from)) : '?'} → ${esc(end)}<div class="meta">${x.starts} start${x.starts === 1 ? '' : 's'}</div>`;
  };

  // Step 1: the later deals and how each one was split.
  const dealRows = deals.map((d, i) => {
    const tr = d.parts ? d.parts.tree : [], ex = d.parts ? d.parts.extra : [];
    const list = (arr) => arr.map((x) => `${esc(keyName(x.key))} <span class="faint">${k(x.v)}</span>`).join('<br>') || '<span class="faint">—</span>';
    const tv = tr.reduce((a, x) => a + x.v, 0), ev = ex.reduce((a, x) => a + x.v, 0);
    return `<tr><td class="num"><span class="dno">D${i + 1}</span></td><td class="nowrap">${d.at ? esc(dateY(d.at)) : '—'}</td><td>${tnameLogo(nt, d.rid)}</td><td>${d.partner.map((r) => tnameLogo(nt, r)).join(' ')}</td>
      <td>${list(tr)}${tr.length > 1 ? `<div class="msum">= ${k(tv)}</div>` : ''}</td><td>${list(ex)}${ex.length > 1 ? `<div class="msum">= ${k(ev)}</div>` : ''}</td>
      <td class="num"><b class="pshare">${pct(d.share)}</b><div class="meta">${ex.length ? `${k(tv)} ÷ ${k(tv + ev)}` : 'nothing added'}</div></td><td class="num">${k(d.full)}</td><td class="num"><b>${k(d.credited)}</b><div class="meta">${ex.length ? `${k(d.full)} × ${pct(d.share)}` : ''}</div></td></tr>`;
  });

  // Step 2: every asset, with value and points carried back by the share chain.
  const pathHtml = (path, x) => [...path.map((p2) => `${esc(p2.label)} <span class="parrow">${p2.drafted ? '→ drafted' : `→ <span class="dno">D${p2.deal}</span>${p2.share < 0.995 ? ` <b class="pshare">${pct(p2.share)}</b>` : ''}`} →</span>`), `<b>${esc(nmOf(x))}</b>`].join(' ');
  const sideTot = (r) => {
    const rs = rows.filter((x) => x.rid === r);
    return { v: rs.reduce((a, x) => a + (x.attrV || 0), 0), p: rs.reduce((a, x) => a + x.attrP, 0), rawP: rs.reduce((a, x) => a + x.pts, 0), rs };
  };
  // Value today = credited assets (raw) + KTC package adjustment, the same calculator the trade was graded with.
  const sideNow = (r) => { const tr = nt.tree[r] || {}; const adj = tr.adj || 0; const raw = sideTot(r).v; return { raw, adj, total: raw + adj }; };
  const sideRows = (r) => {
    const { p, rs } = sideTot(r);
    const { raw, adj, total: v } = sideNow(r);
    const then = treeThen(nt, r), thenAdj = treeThenAdj(nt, r);
    const body = rs.map((x) => {
      const dead = !x.flipped && !x.value && !x.pts;
      return `<tr class="${dead ? 'faint-row' : ''}${x.flipped ? ' mflip' : ''}"><td>${tagOf(x.x)} ${esc(nmOf(x.x))}<div class="meta">${esc(statusTxt(x))}</div></td>
      <td class="small">${x.path.length ? pathHtml(x.path, x.x) : '<span class="faint">in the original trade</span>'}</td>
      <td class="small nowrap">${heldTxt(x)}</td>
      <td class="num">${x.pts ? pf(x.pts) : '<span class="faint">0</span>'}</td>
      <td class="num">${x.flipped ? `<span class="faint">→ D${x.flipped}</span>` : k(x.value)}</td>
      <td class="num small">× ${chainTxt(x.chain)}</td>
      <td class="num">${x.flipped ? '<span class="faint" title="Its value carries on through what came back in that deal">via D' + x.flipped + '</span>' : `<b>${k(x.attrV)}</b>`}</td>
      <td class="num"><b>${x.attrP ? pf(x.attrP) : '<span class="faint">0</span>'}</b></td></tr>`;
    });
    const head = (cont) => `<tr class="mside"><td colspan="8">${tnameLogo(nt, r)} <span class="faint">got</span> ${(nt.recv[r] || []).map((a) => esc(a.kind === 'pick' ? a.label : a.name)).join(', ')}${cont ? ' <span class="faint">(continued)</span>' : ''}</td></tr>`;
    const totalRows = `<tr class="msub"><td colspan="6">${esc(treeNm(nt, r))}: credited assets (plain sum)</td><td class="num">${k(raw)}</td><td class="num"><b>${pf(p)}</b></td></tr>
      <tr class="msub"><td colspan="6">+ KTC package adjustment <span class="faint">(KTC's calculator credits the side with fewer, better pieces; ${adj ? 'this side gets it' : 'the other side gets it, or neither'})</span></td><td class="num">${adj ? `+${k(adj)}` : '0'}</td><td></td></tr>
      <tr class="mtotal"><td colspan="6">= ${esc(treeNm(nt, r))}'s side worth today${then != null ? ` · at the trade ${k(then)}${thenAdj ? ` <span class="faint">(${k(then - thenAdj)} + ${k(thenAdj)} adj.)</span>` : ''} · change <b class="${v - then >= 0 ? 'up' : 'down'}">${sk(Math.round(v - then))}</b>` : ' · <span class="faint">no values from the time of the trade</span>'}</td><td class="num"><b>${k(v)}</b></td><td class="num"><b>${pf(p)}</b></td></tr>`;
    return { head, body, total: totalRows };
  };

  // Plain-English summary per side, and one worked example.
  const summary = nt.rids.map((r) => {
    const { p } = sideTot(r);
    const { raw, adj, total: v } = sideNow(r);
    const then = treeThen(nt, r), thenAdj = treeThenAdj(nt, r);
    return `<div class="msumcard">${tnameLogo(nt, r)}
      <div class="mline"><span>Worth at the trade</span><b>${then != null ? k(then) : '—'}</b>${thenAdj ? `<em class="faint">incl. ${k(thenAdj)} adj.</em>` : ''}</div>
      <div class="mline"><span>Worth today</span><b>${k(v)}</b>${adj ? `<em class="faint">incl. ${k(adj)} adj.</em>` : ''}${then != null ? `<em class="${v - then >= 0 ? 'up' : 'down'}">${sk(Math.round(v - then))}</em>` : ''}</div>
      <div class="mline"><span>Starter points banked</span><b>${pf(p)}</b></div></div>`;
  }).join('');
  const ex = [...rows].filter((x) => x.value && x.chain.length).sort((a, b) => a.factor - b.factor || b.attrV - a.attrV)[0]
    || [...rows].filter((x) => x.value || x.pts).sort((a, b) => (b.attrV || 0) - (a.attrV || 0))[0];
  let example = '';
  if (ex) {
    const nm = esc(nmOf(ex.x)), who = esc(treeNm(nt, ex.rid));
    const him = isPick(ex.x) ? 'it' : 'him', He = isPick(ex.x) ? 'It' : 'He';
    const via = ex.chain.length ? `${nm} came through ${ex.chain.map((c) => `D${c.deal} (the tree supplied ${pct(c.share)} of what ${who} sent)`).join(' then ')}, so the tree owns ${ex.chain.length > 1 ? `${ex.chain.map((c) => pct(c.share)).join(' × ')} = ` : ''}<b>${pct(ex.factor)}</b> of ${him}.` : `${nm} came straight from the original trade, so the tree owns 100% of ${him}.`;
    const val = ex.value ? ` ${He}'s worth ${k(ex.value)} today → credited <b>${k(ex.attrV)}</b>.` : '';
    const pts = ex.pts ? ` ${He} started for ${who} ${ex.starts} time${ex.starts === 1 ? '' : 's'} and scored ${pf(ex.pts)} points → credited <b>${pf(ex.attrP)}</b>.` : '';
    example = `<div class="mexample"><b>Example:</b> ${via}${val}${pts}</div>`;
  }
  const src = deals.find((d) => d.src) ? deals.find((d) => d.src).src : 'KTC / DynastyProcess values at the time';

  const intro = `<div class="hd"><b>Attribution math</b><span class="faint small">how this tree's value and points are worked out</span></div>
    <div class="msums">${summary}</div>
    <ol class="msteps small">
      <li><b>Split each later deal.</b> When a team flips something from this tree, it often adds other assets. The tree's share of that deal = what the tree's assets were worth that day ÷ everything the team sent (${esc(src)}).</li>
      <li><b>Carry each asset back.</b> Every asset is multiplied by the shares of all the deals on its path. Its value today and the <b>starter points it scored while on the roster</b> both use that same multiplier. Points scored <i>before</i> an asset was flipped count at its own share (the deal hadn't happened yet).</li>
      <li><b>Add it up, then use KTC's calculator.</b> The credited assets are summed, then KTC's package adjustment is added for the side holding fewer, better pieces (a star is worth more than the same value spread over many picks). The trade's "at the trade" values were graded the same way, so the two are comparable. Released players are worth 0 today but keep the points they scored. Only starting-lineup points count, not bench points.</li>
    </ol>
    ${example}`;
  const dealTable = (rowsHtml, cont) => `<h3 class="mh"><span class="dno">1</span> Later deals${cont ? ' <span class="faint">(continued)</span>' : ''}</h3><div class="scroll"><table class="t tlist tmt"><thead><tr><th class="num">Deal</th><th>Date</th><th>Team</th><th>Traded to</th><th>From the tree (value then)</th><th>Added from outside (value then)</th><th class="num">Tree's share</th><th class="num">Got back (today)</th><th class="num">Credited to tree</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  const noDeals = `<h3 class="mh"><span class="dno">1</span> Later deals</h3><p class="muted small">Nothing from this trade has been flipped yet, so every asset counts at 100%.</p>`;
  const assetTable = (rowsHtml, cont) => `<h3 class="mh"><span class="dno">2</span> Every asset: value today and points on the roster${cont ? ' <span class="faint">(continued)</span>' : ''}</h3>
    <div class="scroll"><table class="t tlist tmt"><thead><tr><th>Asset</th><th>How it got there</th><th>On the roster</th><th class="num">Starter pts</th><th class="num">Value today</th><th class="num">× Tree's share</th><th class="num">= Credited value</th><th class="num">= Credited pts</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  const sides = nt.rids.map((r) => ({ r, ...sideRows(r) }));
  // Print: hand back the pieces so the report can paginate long tables.
  if (opts.parts) return { intro, dealTable, assetTable, noDeals, dealRows, sides };
  return `<div class="tdeal tmath">${intro}
    ${dealRows.length ? dealTable(dealRows.join(''), false) : noDeals}
    ${assetTable(sides.map((x) => x.head(false) + x.body.join('') + x.total).join(''), false)}</div>`;
}

// Each side of a trade tree: value on the day, credited value today, and starter points banked.
function treeSides(nt) {
  return nt.rids.map((r) => ({ r, then: treeThen(nt, r), now: nt.tree[r] ? nt.tree[r].total : 0, pts: nt.tree[r] ? nt.tree[r].pts || 0 : 0 }));
}
const pts1 = (x) => (Math.round((x || 0) * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
// Sort a ranking by one column (dir -1 = high first), nulls last.
function rankBy(list, key, dir) {
  return [...list].sort((a, b) => {
    const va = a[key], vb = b[key];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * dir || b.nt.created - a.nt.created;
  });
}
const rankTh = (st, action, key, label, title = '', extra = '') => `<th class="num sortable ${st.key === key ? 'on' : ''}" data-action="${action}" data-key="${key}" title="${esc(title)}"${extra}>${label}${st.key === key ? (st.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;

// Small donut showing one side's share (green) against the other's (red), with the % in the middle.
function splitDonut(pct, title = '') {
  if (pct == null) return '<span class="faint">—</span>';
  const r = 14, c = 2 * Math.PI * r, on = Math.max(0, Math.min(100, pct)) / 100 * c;
  return `<svg class="sdonut" viewBox="0 0 36 36" width="40" height="40" role="img" aria-label="${pct}% / ${100 - pct}%"><title>${esc(title || `${pct}% / ${100 - pct}%`)}</title>
    <circle cx="18" cy="18" r="${r}" class="dn-off"/><circle cx="18" cy="18" r="${r}" class="dn-on" stroke-dasharray="${on.toFixed(2)} ${(c - on).toFixed(2)}" transform="rotate(-90 18 18)"/>
    <text x="18" y="18" class="dn-t">${pct}%</text></svg>`;
}

// League top 10 most lopsided trades. The ranking column decides both which ten make the list and
// which side counts as "ahead": value columns judge by value today, point columns by starter points.
const LOP_KEYS = { gap: 'Value gap today', ptsGap: 'Points gap', swing: 'Swing since the trade', ptsTot: 'Total starter points', g: 'Generations', created: 'Date' };
function lopsidedList(st = S.ui.lop) {
  const byPts = st.key === 'ptsGap' || st.key === 'ptsTot';
  const rows = allTreeTrades().filter((nt) => nt.rids.length === 2).map((nt) => {
    const sides = treeSides(nt);
    const [a, b] = [...sides].sort((x, y) => (byPts ? y.pts - x.pts || y.now - x.now : y.now - x.now || y.pts - x.pts));
    const tot = a.now + b.now;
    const swing = a.then != null && b.then != null ? (a.now - b.now) - (a.then - b.then) : null;
    return { nt, ...treeStats(nt), gain: treeGain(nt), a, b, gap: a.now - b.now, ptsGap: Math.round((a.pts - b.pts) * 10) / 10, ptsTot: Math.round((a.pts + b.pts) * 10) / 10, swing, share: tot ? a.now / tot : 0.5, created: nt.created };
  }).filter((x) => (byPts ? x.ptsGap > 0 || (st.key === 'ptsTot' && x.ptsTot > 0) : x.gap > 0 || st.key === 'created' || st.key === 'g'));
  return rankBy(rows, st.key, st.dir).slice(0, 10);
}

// ---- trade tree dashboard (neon) -------------------------------------------------------------

const TREE_ICON = '<svg viewBox="0 0 24 24" class="i"><circle cx="12" cy="5" r="2.6"/><circle cx="5.5" cy="18" r="2.6"/><circle cx="18.5" cy="18" r="2.6"/><path d="M12 7.6v3.4M12 11l-5 4.6M12 11l5 4.6"/></svg>';
const SWAP_SVG = '<svg viewBox="0 0 24 24" class="i"><path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/></svg>';

function treeFiltered() {
  const f = S.ui.tree;
  const m = S.model;
  return allTreeTrades().filter((nt) => {
    if (f.kind === 'mine' && !nt.rids.includes(m.me)) return false;
    if (f.kind === 'deep' && !(treeStats(nt).g >= 1)) return false;
    if (f.kind === 'picks' && !nt.rids.some((r) => (nt.recv[r] || []).some((a) => a.kind === 'pick'))) return false;
    if (f.mgr && f.mgr !== 'all' && !nt.rids.includes(Number(f.mgr))) return false;
    if (f.asset && f.asset !== 'all') {
      const has = nt.rids.some((r) => (nt.recv[r] || []).some((a) => (f.asset === 'PK' ? a.kind === 'pick' : a.pos === f.asset)));
      if (!has) return false;
    }
    return true;
  });
}

function heroCard(eyebrow, title, sub, ico = '') {
  return `<div class="thero"><div class="ico${ico ? ' logos' : ''}">${ico || TREE_ICON}</div><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="glow"></div></div>`;
}
function sumCard(tiles, extra = '') {
  return `<div class="tsum"><div class="hd">${icon('chart')}<b>Summary</b></div><div class="tiles">${tiles.map((t) => `<div><span>${esc(t.label)}</span><b class="${t.cls || ''}">${t.value}</b>${t.sub ? `<em>${t.sub}</em>` : ''}</div>`).join('')}${extra}</div></div>`;
}
function legendCard() {
  const row = (cls, ic, t, d) => `<div class="lrow"><span class="lic ${cls}">${ic}</span><div><b>${t}</b><span>${d}</span></div></div>`;
  return `<div class="tleg"><div class="hd">${TREE_ICON}<b>Node legend</b></div>
    ${row('mgr', icon('users'), 'Manager node', 'The team that received the haul')}
    ${row('ply', icon('users'), 'Player node', 'Green edge: still on the roster')}
    ${row('pk', 'PK', 'Pick node', 'Orange: pick spent · blue: still owned')}
    ${row('trd', '⇢', 'Completed trade', 'Where an asset was flipped, and what else went with it')}</div>`;
}
// Small team logo for tables, chips and tree bubbles (history teams without a current roster get initials).
const tmini = (nt, r) => (team(r) ? teamAvatar(team(r), 'xs') : `<span class="av xs">${esc(initials(treeNm(nt, r)))}</span>`);
const tnameLogo = (nt, r, cls = '') => `<span class="tnl">${tmini(nt, r)}<b class="${cls}">${esc(treeNm(nt, r))}</b></span>`;
const sk = (v) => `${v >= 0 ? '+' : '−'}${k(Math.abs(v))}`;
function netChange(list) {
  let then = 0, now = 0;
  for (const nt of list) for (const r of nt.rids) { const t0 = treeThen(nt, r); if (t0 != null) { then += t0; now += nt.tree[r].total; } }
  return now - then;
}
function mostActive(list) {
  const c = {};
  for (const nt of list) for (const r of nt.rids) c[r] = (c[r] || 0) + 1;
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return top ? { rid: Number(top[0]), n: top[1] } : null;
}

function viewTreePage(id) {
  const m = S.model;
  const f = S.ui.tree;
  const L = S.raw.league || {};
  const list = treeFiltered();
  const rows = sortTrees(list.map((nt) => ({ nt, ...treeStats(nt), gain: treeGain(nt) })), f.sort || 'gen');
  const nt = id ? allTreeTrades().find((x) => String(x.id) === String(id)) : null;
  if (id && !nt) return `<div class="card"><h3>Trade tree</h3><p class="muted">That trade isn't in the synced history. <a href="#tree">See all trade trees</a>.</p></div>`;
  if (nt && f.for !== id) { f.for = id; f.stacked = false; f.autoOrient = null; f.tried = null; f.settled = false; f.zoom = 'fit'; f.view = 'tree'; f.open = {}; f.closed = {}; }
  const view = f.view === 'list' ? 'list' : 'tree';

  // header: hero + summary + legend
  let tiles, extra = '';
  if (nt && view === 'tree') {
    const st = treeStats(nt), g = treeGain(nt);
    const net = netChange([nt]);
    tiles = [
      { label: 'Generations', value: st.g },
      { label: 'Later deals', value: st.later },
      { label: 'Assets in the deal', value: nt.rids.reduce((a, r) => a + (nt.recv[r] || []).length, 0) },
      { label: 'Net value change', value: sk(net), cls: net >= 0 ? 'up' : 'down' },
    ];
    if (g.winner != null) extra = `<div class="who2"><span>Winning the tree</span><div>${teamAvatar(team(g.winner))}<div><b>${esc(treeNm(nt, g.winner))}</b><em>${Math.round(g.share * 100)}% of the value today</em></div></div></div>`;
  } else {
    const mgrs = new Set(list.flatMap((x) => x.rids));
    const net = netChange(list);
    const act = mostActive(list);
    tiles = [
      { label: 'Total trades', value: list.length },
      { label: 'Managers involved', value: mgrs.size },
      { label: 'Assets moved', value: list.reduce((a, x) => a + x.rids.reduce((b, r) => b + (x.recv[r] || []).length, 0), 0) },
      { label: 'Net value change', value: sk(net), cls: net >= 0 ? 'up' : 'down' },
    ];
    if (act) extra = `<div class="who2"><span>Most active manager</span><div>${teamAvatar(team(act.rid))}<div><b>${esc(tname(act.rid))}</b><em>${act.n} trade${act.n === 1 ? '' : 's'}</em></div></div></div>`;
  }
  const head = `<div class="ttop">${heroCard(nt && view === 'tree' ? `${L.name || 'Your league'} · ${dateY(nt.created)}` : L.name || 'Your league', 'Trade Tree', nt && view === 'tree' ? `${nt.rids.map((r) => treeNm(nt, r)).join(' ⇄ ')}. ${treeLead(nt)}` : 'Trace the full history and ripple effect of trades in your league.', nt && view === 'tree' ? nt.rids.slice(0, 2).map((r) => tmini(nt, r)).join('') : '')}${sumCard(tiles, extra)}${legendCard()}</div>`;

  // toolbar
  const sel = (key, opts) => `<select class="tsel" data-treef="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(f[key] || 'all') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const orient = f.orient === 'auto' ? (f.autoOrient || 'down') : f.orient;
  const stack = false; // both sides always in one diagram on screen
  const tool = `<div class="ttool">
    ${sel('kind', [['all', 'All trades'], ['mine', 'My trades'], ['deep', 'With later generations'], ['picks', 'Involving picks']])}
    ${sel('mgr', [['all', 'All managers'], ...m.teams.map((t) => [String(t.rid), t.name])])}
    ${sel('asset', [['all', 'All assets'], ['QB', 'QBs'], ['RB', 'RBs'], ['WR', 'WRs'], ['TE', 'TEs'], ['PK', 'Picks']])}
    <span class="tlab">View:</span><div class="seg"><button class="${view === 'tree' ? 'on' : ''}" data-action="treeView" data-v="tree">${TREE_ICON} Tree</button><button class="${view === 'list' ? 'on' : ''}" data-action="treeView" data-v="list">${icon('chart')} List</button></div>
    <span style="flex:1"></span>
    ${view === 'list' ? sel('sort', TREE_SORTS.map(([v, l]) => [v, `Sort: ${l}`])) : `${sel('depth', [['0', 'All generations'], ['1', '1 generation'], ['2', '2 generations'], ['3', '3 generations'], ['4', '4 generations']])}<span class="tlab">Layout:</span><div class="seg"><button class="${f.orient === 'auto' ? 'on' : ''}" data-action="treeOrient" data-v="auto" title="Top-down when it fits, left-to-right when it doesn't">Auto${f.orient === 'auto' ? ` · ${orient === 'right' ? '→' : '↓'}` : ''}</button><button class="${f.orient === 'down' ? 'on' : ''}" data-action="treeOrient" data-v="down" title="Top-down family tree">Vertical</button><button class="${f.orient === 'right' ? 'on' : ''}" data-action="treeOrient" data-v="right" title="Left-to-right: each generation is a column, flips stack down the page (best for deep trees)">Horizontal</button></div>
    <div class="seg zoom"><button data-action="treeZoom" data-z="out" title="Zoom out">−</button><button data-action="treeZoom" data-z="fit" title="Fit to screen">${f.zoom === 'fit' ? 'Fit' : `${Math.round(f.zoom * 100)}%`}</button><button data-action="treeZoom" data-z="in" title="Zoom in">+</button></div>
    <button class="tbtn" data-action="treeFull" title="Full screen">⛶</button>`}
    <a class="tbtn" href="#lopsided" title="League top 10 most lopsided trades">Most lopsided ›</a><a class="tbtn" href="#branches" title="League top 10 trade trees with the most branches">Most branches ›</a>
  </div>`;

  // trade strip (quick switch)
  const strip = view === 'tree' && rows.length ? `<div class="tstrip">${rows.slice(0, 40).map((x) => `<a class="tchip${nt && x.nt.id === nt.id ? ' on' : ''}" href="#tree/${esc(x.nt.id)}"><span>${esc(dateY(x.nt.created))}</span><b class="chipteams">${x.nt.rids.map((r) => `${tmini(x.nt, r)}${esc(treeNm(x.nt, r))}`).join('<i>⇄</i>')}</b><em>${x.g} gen · ${x.later} later</em></a>`).join('')}</div>` : '';

  // canvas
  let canvas;
  if (view === 'list') {
    const row = ({ nt: t, g, later, gain }) => `<tr><td class="nowrap">${esc(dateY(t.created))}</td>
      <td>${t.rids.map((r) => tnameLogo(t, r)).join(' <span class="faint">⇄</span> ')}<div class="meta">${t.rids.map((r) => `${esc(treeNm(t, r))} got ${(t.recv[r] || []).map((a) => esc(a.kind === 'pick' ? a.label : a.name)).slice(0, 3).join(', ')}${(t.recv[r] || []).length > 3 ? '…' : ''}`).join(' · ')}</div></td>
      <td class="num"><b>${g}</b></td><td class="num">${later}</td>
      <td class="num">${gain.best && gain.best.gain != null ? `<span class="${gain.best.gain >= 0 ? 'up' : 'down'}">${sk(gain.best.gain)}</span><div class="meta">${esc(treeNm(t, gain.best.r))}</div>` : '—'}</td>
      <td class="num">${t.rids.map((r) => `${esc(treeNm(t, r).slice(0, 12))} ${k(t.tree[r].total)}`).join('<br>')}</td>
      <td><a class="tbtn sm" href="#tree/${esc(t.id)}" data-action="treeView" data-v="tree">${TREE_ICON} Tree</a></td></tr>`;
    canvas = `<div class="tcanvas tlw"><table class="t tlist"><thead><tr><th>Date</th><th>Trade</th><th class="num">Generations</th><th class="num">Later deals</th><th class="num">Value gain</th><th class="num">Hauls today</th><th></th></tr></thead><tbody>${rows.map(row).join('') || '<tr><td colspan="7" class="muted">No trades match these filters.</td></tr>'}</tbody></table></div>`;
  } else if (!nt) {
    const first = rows[0];
    canvas = `<div class="tcanvas"><div class="tempty"><div class="ico">${TREE_ICON}</div><h2>Trade Tree</h2><p>A visual map of how trades connect managers, players and picks over time.</p>${first ? `<a class="tcta" href="#tree/${esc(first.nt.id)}">${TREE_ICON} Explore trade tree</a>` : '<p class="muted">No completed trades match these filters.</p>'}</div></div>`;
  } else {
    const sides = f.side !== 'both' && nt.rids.includes(Number(f.side)) ? [Number(f.side)] : nt.rids;
    const sideBtns = [['both', 'Both sides'], ...nt.rids.map((r) => [String(r), treeNm(nt, r)])].map(([v, l]) => `<button class="${String(f.side) === v || (v === 'both' && sides.length > 1) ? 'on' : ''}" data-action="treeSide" data-side="${esc(v)}">${esc(l)}</button>`).join('');
    canvas = `<div class="tdeal"><div class="hd"><b>The original trade</b><span class="faint small">values at the trade → today</span><span style="flex:1"></span><div class="seg">${sideBtns}</div></div>${treeDealSummary(nt)}</div>
      <div class="tcanvas ftwrap${orient === 'right' ? ' lrwrap' : ''}">${treeDiagram(nt, { stack, sides, orient, depth: f.depth, open: f.open, closed: f.closed })}</div>
      ${attributionTables(nt)}`;
  }
  return `${head}${tool}${strip}${canvas}`;
}

// Trade trees with the most branches: how many times the deal's assets were flipped (both sides).
function countBoxes(nodes) { return (nodes || []).reduce((a, c) => a + (c.kind === 'package' ? c.items.length : 1) + countBoxes(c.children), 0); }
const BR_KEYS = { br: 'Branches', g: 'Generations', later: 'Later deals', boxes: 'Assets in tree', worth: 'Worth today', then: 'Worth at the trade', growth: 'Growth since the trade', pts: 'Starter points', created: 'Date' };
function branchesList(st = S.ui.brs) {
  const rows = allTreeTrades().map((nt) => {
    const sides = treeSides(nt);
    const then = sides.every((x) => x.then != null) ? sides.reduce((a, x) => a + x.then, 0) : null;
    const worth = sides.reduce((a, x) => a + x.now, 0);
    return { nt, ...treeStats(nt), gain: treeGain(nt), sides,
      br: nt.rids.reduce((a, r) => a + (nt.tree[r].branches || 0), 0),
      boxes: nt.rids.reduce((a, r) => a + countBoxes(nt.tree[r].nodes), 0),
      worth, then, growth: then != null ? worth - then : null,
      pts: Math.round(sides.reduce((a, x) => a + x.pts, 0) * 10) / 10, created: nt.created };
  }).filter((x) => x.br > 0);
  // Ties on the chosen column fall back to the usual branch order.
  const base = [...rows].sort((a, b) => b.br - a.br || b.g - a.g || b.later - a.later || b.worth - a.worth);
  return (st.key === 'br' && st.dir < 0 ? base : rankBy(base, st.key, st.dir)).slice(0, 10);
}

function viewBranches() {
  const top = branchesList();
  const L = S.raw.league || {};
  const best = top[0];
  const tiles = [
    { label: 'Trees ranked', value: top.length },
    { label: 'Most branches', value: best ? best.br : 0, cls: 'up' },
    { label: 'Deepest', value: top.length ? Math.max(...top.map((x) => x.g)) : 0, sub: 'generations' },
    { label: 'Later deals', value: top.reduce((a, x) => a + x.later, 0), sub: 'across these trees' },
  ];
  const extra = best ? `<div class="who2"><span>Biggest tree</span><div>${tmini(best.nt, best.nt.rids[0])}<div><b>${esc(best.nt.rids.map((r) => treeNm(best.nt, r)).join(' ⇄ '))}</b><em>${best.br} branches · ${esc(dateY(best.nt.created))}</em></div></div></div>` : '';
  const st = S.ui.brs;
  const th = (key, label, title = '', extra = '') => rankTh(st, 'brSort', key, label, title, extra);
  const sideCells = (x, r) => {
    const sd = x.sides.find((y) => y.r === r);
    return `<td class="num bl">${sd.then != null ? k(sd.then) : '<span class="faint">—</span>'}</td><td class="num"><b class="${sd.then != null ? (sd.now >= sd.then ? 'up' : 'down') : ''}">${k(sd.now)}</b></td><td class="num">${pts1(sd.pts)}</td>`;
  };
  const row = (x, i) => {
    const [ra, rb] = x.nt.rids;
    const two = x.nt.rids.length === 2;
    return `<tr><td class="num"><span class="rank">${i + 1}</span></td><td class="nowrap">${esc(dateY(x.nt.created))}</td>
    <td>${x.nt.rids.map((r) => tnameLogo(x.nt, r)).join(' <span class="faint">⇄</span> ')}<div class="meta">${x.nt.rids.map((r) => `${esc(treeNm(x.nt, r))} got ${(x.nt.recv[r] || []).map((a) => esc(a.kind === 'pick' ? a.label : a.name)).slice(0, 3).join(', ')}${(x.nt.recv[r] || []).length > 3 ? '…' : ''}`).join(' · ')}</div></td>
    <td class="num bl"><b>${x.br}</b></td><td class="num">${x.g}</td><td class="num">${x.later}</td><td class="num">${x.boxes}</td>
    ${two ? `${sideCells(x, ra)}${sideCells(x, rb)}` : `<td colspan="6" class="bl small muted">${x.nt.rids.length}-team trade: ${x.sides.map((sd) => `${esc(treeNm(x.nt, sd.r))} ${sd.then != null ? `${k(sd.then)} → ` : ''}${k(sd.now)} · ${pts1(sd.pts)} pts`).join('<br>')}</td>`}
    <td class="num bl">${x.then != null ? k(x.then) : '—'}</td><td class="num"><b>${k(x.worth)}</b></td><td class="num">${x.growth != null ? `<span class="${x.growth >= 0 ? 'up' : 'down'}">${sk(x.growth)}</span>` : '—'}</td><td class="num"><b>${pts1(x.pts)}</b></td>
    <td><a class="tbtn sm" href="#tree/${esc(x.nt.id)}">${TREE_ICON} Tree</a></td></tr>`;
  };
  return `<div class="ttop">${heroCard(L.name || 'Your league', 'Most Branching Trades', 'The ten trades whose players and picks have been flipped the most times since — the league\'s biggest trade trees.')}${sumCard(tiles, extra)}${legendCard()}</div>
    <div class="ttool"><a class="tbtn" href="#tree">${TREE_ICON} All trade trees</a><a class="tbtn" href="#lopsided">Most lopsided ›</a><span style="flex:1"></span><span class="tlab">Top 10 by <b>${esc(BR_KEYS[st.key] || st.key)}</b>. Click any column to re-rank. Branches = times an asset from the deal was flipped (traded on, or a pick spent), both sides counted.</span><button class="tcta sm" data-action="treePdf" data-kind="branches">${icon('note')} Download PDF report</button><button class="tbtn" data-action="treeJpg" data-kind="branches" title="A cover image plus one tall image per trade (tree + full accounting), zipped">JPGs (.zip)</button></div>
    <div class="tcanvas tlw scroll"><table class="t tlist trank"><thead>
      <tr class="grp"><th colspan="3"></th><th colspan="4" class="bl">Tree</th><th colspan="3" class="bl">Side 1</th><th colspan="3" class="bl">Side 2</th><th colspan="4" class="bl">Whole trade</th><th></th></tr>
      <tr><th class="num">#</th>${th('created', 'Date', '', ' style="text-align:left"')}<th>Trade</th>${th('br', 'Branches', 'Times an asset from the deal was flipped', ' data-bl="1"')}${th('g', 'Gens')}${th('later', 'Later deals')}${th('boxes', 'Assets')}
      <th class="num bl">At trade</th><th class="num">Today</th><th class="num" title="Starting-lineup points credited to this side's tree">Pts</th>
      <th class="num bl">At trade</th><th class="num">Today</th><th class="num" title="Starting-lineup points credited to this side's tree">Pts</th>
      ${th('then', 'At trade', 'Both sides together, valued on the day', ' data-bl="1"')}${th('worth', 'Today', 'Both trees together, credited value today')}${th('growth', 'Growth', 'Today minus at the trade')}${th('pts', 'Pts', 'Starter points both trees have banked')}<th></th></tr></thead>
      <tbody>${top.map(row).join('') || '<tr><td colspan="18" class="muted">No trade has been flipped on yet.</td></tr>'}</tbody></table></div>
    <p class="small faint" style="margin-top:6px">Side 1 / Side 2 follow the order the trade lists the teams. "Pts" = starting-lineup points each side's tree has banked, credited the same way as value (see a tree's Attribution math).</p>`;
}

function viewLopsided() {
  const st = S.ui.lop;
  const byPts = st.key === 'ptsGap' || st.key === 'ptsTot';
  const top = lopsidedList(st);
  const L = S.raw.league || {};
  const biggest = top[0];
  const flips = top.filter((x) => x.swing != null && x.a.then != null && x.b.then != null && x.a.then < x.b.then).length;
  // Trades where the value winner and the points winner are different teams.
  const split = top.filter((x) => x.a.pts !== x.b.pts && x.a.now !== x.b.now && (x.a.now > x.b.now) !== (x.a.pts > x.b.pts)).length;
  const tiles = [
    { label: 'Trades ranked', value: top.length, sub: `by ${LOP_KEYS[st.key] ? LOP_KEYS[st.key].toLowerCase() : st.key}` },
    byPts ? { label: 'Biggest points gap', value: biggest ? pts1(biggest.ptsGap) : '—', cls: 'up' } : { label: 'Biggest gap', value: biggest ? k(biggest.gap) : '—', cls: 'up' },
    { label: 'Flipped in hindsight', value: flips, sub: 'lost on the day, ahead today' },
    { label: 'Value ≠ points winner', value: split, sub: 'one side has the value, the other the points' },
  ];
  const w = biggest ? biggest.a.r : null;
  const extra = biggest ? `<div class="who2"><span>Biggest winner</span><div>${teamAvatar(team(w))}<div><b>${esc(treeNm(biggest.nt, w))}</b><em>${byPts ? `+${pts1(biggest.ptsGap)} pts` : `+${k(biggest.gap)}`} on ${esc(dateY(biggest.nt.created))}</em></div></div></div>` : '';
  const th = (key, label, title = '', extra2 = '') => rankTh(st, 'lopSort', key, label, title, extra2);
  const got = (nt, r) => (nt.recv[r] || []).map((y) => esc(y.kind === 'pick' ? y.label : y.name)).join(', ');
  const side = (sd, cls) => `<td class="num">${sd.then != null ? k(sd.then) : '<span class="faint">—</span>'}</td><td class="num"><b class="${cls}">${k(sd.now)}</b>${sd.then != null ? `<div class="meta ${sd.now >= sd.then ? 'up' : 'down'}">${sk(sd.now - sd.then)}</div>` : ''}</td><td class="num">${pts1(sd.pts)}</td>`;
  const row = (x, i) => {
    const { nt, a, b } = x;
    const thenPct = a.then != null && b.then != null ? Math.round(a.then / ((a.then + b.then) || 1) * 100) : null;
    const nowPct = Math.round(x.share * 100);
    const ptsDiff = x.ptsGap;
    return `<tr><td class="num"><span class="rank">${i + 1}</span></td><td class="nowrap">${esc(dateY(nt.created))}</td>
      <td class="bl lside">${tnameLogo(nt, a.r, 'up')}<div class="meta">got ${got(nt, a.r)}</div></td>${side(a, 'up')}
      <td class="bl lside">${tnameLogo(nt, b.r, 'down')}<div class="meta">got ${got(nt, b.r)}</div></td>${side(b, 'down')}
      <td class="num bl dncell">${splitDonut(thenPct, thenPct != null ? `At the trade: ${treeNm(nt, a.r)} ${thenPct}% · ${treeNm(nt, b.r)} ${100 - thenPct}%` : '')}</td>
      <td class="num dncell">${splitDonut(nowPct, `Today: ${treeNm(nt, a.r)} ${nowPct}% · ${treeNm(nt, b.r)} ${100 - nowPct}%`)}</td>
      <td class="num"><b class="${x.gap >= 0 ? '' : 'down'}">${x.gap >= 0 ? k(x.gap) : sk(x.gap)}</b></td>
      <td class="num">${x.swing != null ? `<span class="${x.swing >= 0 ? 'up' : 'down'}">${sk(x.swing)}</span>` : '—'}</td>
      <td class="num"><b class="${ptsDiff > 0 ? '' : ptsDiff < 0 ? 'down' : 'faint'}">${ptsDiff >= 0 ? pts1(ptsDiff) : `−${pts1(-ptsDiff)}`}</b></td>
      <td class="num">${x.g}</td>
      <td><a class="tbtn sm" href="#tree/${esc(nt.id)}">${TREE_ICON} Tree</a></td></tr>`;
  };
  return `<div class="ttop">${heroCard(L.name || 'Your league', 'Most Lopsided Trades', byPts ? 'The ten trades where one side\'s haul has put far more points in its starting lineup than the other\'s.' : 'The ten trades whose two sides have grown furthest apart, counting everything each haul turned into.')}${sumCard(tiles, extra)}${legendCard()}</div>
    <div class="ttool"><a class="tbtn" href="#tree">${TREE_ICON} All trade trees</a><a class="tbtn" href="#branches">Most branches ›</a>
      <span class="tlab">Rank by:</span><div class="seg"><button class="${!byPts && st.key === 'gap' ? 'on' : ''}" data-action="lopSort" data-key="gap" data-dir="-1">Value gap</button><button class="${st.key === 'ptsGap' ? 'on' : ''}" data-action="lopSort" data-key="ptsGap" data-dir="-1">Points gap</button></div>
      <span style="flex:1"></span><span class="tlab">${byPts ? '"Ahead" = more starter points.' : '"Ahead" = more value today.'} Click any column to re-rank.</span><button class="tcta sm" data-action="treePdf" data-kind="lopsided">${icon('note')} Download PDF report</button><button class="tbtn" data-action="treeJpg" data-kind="lopsided" title="A cover image plus one tall image per trade (tree + full accounting), zipped">JPGs (.zip)</button></div>
    <div class="tcanvas tlw scroll"><table class="t tlist trank"><thead>
      <tr class="grp"><th colspan="2"></th><th colspan="4" class="bl">Side ahead</th><th colspan="4" class="bl">Other side</th><th colspan="7" class="bl">Comparison</th></tr>
      <tr><th class="num">#</th>${th('created', 'Date', '', ' style="text-align:left"')}
      <th class="bl">Team · got</th><th class="num">At trade</th><th class="num">Today</th><th class="num" title="Starting-lineup points credited to this side's tree">Pts</th>
      <th class="bl">Team · got</th><th class="num">At trade</th><th class="num">Today</th><th class="num" title="Starting-lineup points credited to this side's tree">Pts</th>
      <th class="num bl" title="Side ahead's share of the value on the day">Split then</th><th class="num" title="Side ahead's share of the value today">Split today</th>
      ${th('gap', 'Value gap', 'Side ahead minus other side, value today')}${th('swing', 'Swing', 'How much the gap moved since the trade: today\'s gap minus the gap on the day')}${th('ptsGap', 'Pts gap', 'Side ahead minus other side, starter points')}${th('g', 'Gens')}<th></th></tr></thead>
      <tbody>${top.map(row).join('') || '<tr><td colspan="17" class="muted">No completed two-team trades yet.</td></tr>'}</tbody></table></div>
    <p class="small faint" style="margin-top:6px">Pts = starting-lineup points each side's tree has banked, credited the same way as value (see a tree's Attribution math). A negative gap means the side ahead on ${byPts ? 'points trails on value' : 'value trails on points'}.</p>`;
}

// PDF report: same neon look, printed (Chrome → Save as PDF).
function printTreeReport(kind = 'lopsided', mode = 'pdf') {
  const isBr = kind === 'branches';
  const top = isBr ? branchesList() : lopsidedList();
  const L = S.raw.league || {};
  const date = new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
  // Cover: hero, summary, and a one-line-per-trade top-10 table that always fits the page.
  const lop = isBr ? viewBranches() : viewLopsided();
  const heroSum = lop.slice(0, lop.indexOf('<div class="ttool">'));
  // Cover table: the same expanded, ranked table as the page, with the last column showing each trade's page.
  const tStart = lop.indexOf('<div class="tcanvas tlw scroll">');
  const tEnd = lop.indexOf('</table></div>', tStart) + '</table></div>'.length;
  const lastTh = '<th></th></tr></thead>';
  let table = tStart >= 0 ? lop.slice(tStart, tEnd) : '';
  const li = table.lastIndexOf(lastTh);
  if (li >= 0) table = `${table.slice(0, li)}<th class="num">Page</th></tr></thead>${table.slice(li + lastTh.length)}`;
  table = table.replace('class="tcanvas tlw scroll"', 'class="tcanvas tlw pr-covtable"');
  const st = isBr ? S.ui.brs : S.ui.lop;
  const rankedBy = (isBr ? BR_KEYS : LOP_KEYS)[st.key] || st.key;
  const cover = `<section class="pr-page pr-cover">${heroSum}
    ${table}
    <p class="pr-foot">${esc(L.name || '')} · generated ${esc(date)} · top 10 ranked by ${esc(rankedBy.toLowerCase())}${st.dir > 0 ? ' (lowest first)' : ''} · values from KeepTradeCut · pts = starting-lineup points credited to each side's tree · ${isBr ? 'branches = times an asset from the deal was flipped' : '"ahead" = ' + (st.key === 'ptsGap' || st.key === 'ptsTot' ? 'more starter points' : 'more value today')} · each trade's tree is followed by its full accounting</p></section>`;

  let host = document.getElementById('print');
  if (!host) { host = document.createElement('div'); host.id = 'print'; document.body.appendChild(host); }
  host.innerHTML = cover;
  // Lay out off-screen at landscape-letter size (1056×816 CSS px) to measure.
  host.style.cssText = 'display:block;position:absolute;left:-30000px;top:0;width:1056px;';
  const PAGE_H = 816, CONTENT_W = 1056 - 90, MIN_Z = 0.62;
  const measure = (html) => {
    const d = document.createElement('div');
    d.className = 'tcanvas ftwrap pr-tree';
    d.innerHTML = html;
    host.appendChild(d);
    const fts = [...d.querySelectorAll('.ft')];
    const r = { w: Math.max(...fts.map((f) => f.scrollWidth)), h: d.scrollHeight };
    d.remove();
    return r;
  };
  const fitZ = (m, availH) => Math.min(1, (CONTENT_W - 30) / m.w, availH / m.h);
  // Shrink the cover table if the expanded columns or ten rows don't fit the page.
  {
    const cov = host.querySelector('.pr-cover');
    const tw = cov && cov.querySelector('.pr-covtable');
    if (tw) {
      cov.style.width = `${CONTENT_W}px`;
      const tbl = tw.querySelector('table');
      const over = cov.scrollHeight - (PAGE_H - 70);
      const zH = over > 0 ? (tw.scrollHeight - over) / tw.scrollHeight : 1;
      const zW = tbl && tbl.scrollWidth > CONTENT_W ? CONTENT_W / tbl.scrollWidth : 1;
      const z = Math.max(0.5, Math.min(1, zH, zW));
      if (z < 1) tw.style.zoom = z;
      cov.style.width = '';
    }
  }
  // Full accounting pages: the attribution ledger, split across pages without clipping.
  const measureMath = (html) => {
    const d = document.createElement('div');
    d.className = 'tdeal tmath pr-math';
    d.style.width = `${CONTENT_W}px`;
    d.innerHTML = html;
    host.appendChild(d);
    const h = d.scrollHeight;
    d.remove();
    return h;
  };
  const mathPages = (nt, avail) => {
    const M = attributionTables(nt, { parts: true });
    const items = [{ t: 'b', html: M.intro }];
    if (M.dealRows.length) M.dealRows.forEach((h) => items.push({ t: 'd', html: h }));
    else items.push({ t: 'b', html: M.noDeals });
    for (const sd of M.sides) {
      items.push({ t: 'a', html: sd.head(false), r: sd.r, head: true });
      sd.body.forEach((h) => items.push({ t: 'a', html: h, r: sd.r }));
      items.push({ t: 'a', html: sd.total, r: sd.r });
    }
    const headOf = (r) => M.sides.find((x) => x.r === r).head(true);
    // Consecutive deal rows go in one deals table, asset rows in one asset table; a table that
    // already started on an earlier page is marked "continued".
    const compose = (list, seen) => {
      let out = '';
      for (let i = 0; i < list.length;) {
        const it = list[i];
        if (it.t === 'b') { out += it.html; i++; continue; }
        let j = i;
        while (j < list.length && list[j].t === it.t) j++;
        const rows = list.slice(i, j).map((x) => x.html).join('');
        out += it.t === 'd' ? M.dealTable(rows, seen.has('d')) : M.assetTable(rows, seen.has('a'));
        i = j;
      }
      return out;
    };
    const pages = [];
    let cur = [], seen = new Set(), startSeen = new Set();
    const flush = () => { pages.push({ list: cur, seen: startSeen }); cur.forEach((x) => seen.add(x.t)); startSeen = new Set(seen); };
    for (const it of items) {
      if (!cur.length || measureMath(compose([...cur, it], startSeen)) <= avail) { cur.push(it); continue; }
      // Don't leave a side's header row alone at the bottom of a page.
      const carry = cur.length > 1 && cur[cur.length - 1].head ? cur.pop() : null;
      flush();
      cur = carry ? [carry, it] : it.t === 'a' && !it.head ? [{ t: 'a', html: headOf(it.r), r: it.r, head: true }, it] : [it];
    }
    if (cur.length) flush();
    return pages.map((pg) => {
      const html = compose(pg.list, pg.seen);
      const h = measureMath(html);
      return { html, z: h > avail ? Math.max(0.4, avail / h) : 1 };
    });
  };

  top.forEach((x, i) => {
    const nt = x.nt, g = x.gain;
    const tiles = isBr ? [
      { label: 'Branches', value: x.br, cls: 'up' },
      { label: 'Generations', value: x.g },
      { label: 'Later deals', value: x.later },
      { label: 'Worth today', value: k(x.worth) },
      { label: 'Starter pts', value: pts1(x.pts) },
    ] : [
      { label: 'Gap today', value: k(x.gap), cls: 'up' },
      { label: 'Split today', value: `${Math.round(x.share * 100)}% / ${100 - Math.round(x.share * 100)}%` },
      { label: 'Pts gap', value: pts1(x.ptsGap) },
      { label: 'Generations', value: x.g },
      { label: 'Later deals', value: x.later },
    ];
    const header = (cont, tag = 'continued') => `<div class="thero small"><div class="ico"><span class="rankbig">#${i + 1}</span></div><div><div class="eyebrow">${esc(L.name || '')} · traded ${esc(dateY(nt.created))}${cont ? ` · ${tag}` : ''}</div><h1 class="h1logos">${nt.rids.map((r) => `${tmini(nt, r)}${esc(treeNm(nt, r))}`).join('<i>⇄</i>')}</h1>${cont ? '' : `<p>${esc(treeLead(nt))}</p>`}</div>${cont ? '' : `<div class="prstats">${tiles.map((t) => `<div><span>${esc(t.label)}</span><b class="${t.cls || ''}">${t.value}</b></div>`).join('')}</div>`}<div class="glow"></div></div>`;
    const deal = `<div class="tdeal"><div class="hd"><b>The original trade</b><span class="faint small">values at the trade → today</span></div>${treeDealSummary(nt)}</div>`;
    // How much height the tree gets on the first page vs a continuation page.
    const sec = document.createElement('section');
    sec.className = 'pr-page pr-trade';
    sec.innerHTML = header(false) + deal;
    host.appendChild(sec);
    const firstAvail = PAGE_H - 38 - sec.scrollHeight - 50;
    sec.innerHTML = header(true);
    const contAvail = PAGE_H - 38 - sec.scrollHeight - 50;
    sec.remove();

    // 1) The whole tree on the first page, in whichever layout fits largest.
    const whole = [{ stack: true }, { stack: false }, { orient: 'right' }].map((o) => { const html = treeDiagram(nt, { ...o, print: true, withText: true }); const m = measure(html); return { html, z: fitZ(m, firstAvail) }; }).sort((a, b) => b.z - a.z)[0];
    const pages = [];
    if (whole.z >= MIN_Z) {
      pages.push({ cont: false, trees: [{ html: whole.html, z: whole.z }] });
    } else {
      // 2) Too big: split into chunks of each side's top-level branches (left-to-right layout),
      //    packed onto pages at a readable size.
      const chunks = [];
      for (const r of nt.rids) {
        const nodes = nt.tree[r].nodes;
        if (!nodes.length) { chunks.push({ r, idx: [] }); continue; }
        let cur = [];
        const tryHtml = (idx) => treeDiagram(nt, { orient: 'right', print: true, withText: true, sides: [r], only: idx });
        for (let j = 0; j < nodes.length; j++) {
          const next = [...cur, j];
          const m = measure(tryHtml(next));
          if (cur.length && fitZ(m, contAvail) < 0.8) { chunks.push({ r, idx: cur }); cur = [j]; } else cur = next;
        }
        if (cur.length) chunks.push({ r, idx: cur });
      }
      // Count each side's parts so they can be labelled "part 1 of 2".
      const parts = {};
      chunks.forEach((c) => { parts[c.r] = (parts[c.r] || 0) + 1; });
      const seen = {};
      let page = { cont: false, trees: [], used: 0 };
      chunks.forEach((c) => {
        seen[c.r] = (seen[c.r] || 0) + 1;
        const part = parts[c.r] > 1 ? `part ${seen[c.r]} of ${parts[c.r]}` : '';
        const html = treeDiagram(nt, { orient: 'right', print: true, withText: true, sides: [c.r], only: c.idx, part });
        const m = measure(html);
        const wFit = Math.min(1, (CONTENT_W - 30) / m.w);
        const pageAvail = () => (page.cont ? contAvail : firstAvail);
        // Fits in what's left of this page at a readable size? Otherwise start a new page.
        const zHere = Math.min(wFit, (pageAvail() - page.used) / m.h);
        if (page.trees.length && zHere < Math.min(MIN_Z, wFit)) { pages.push(page); page = { cont: true, trees: [], used: 0 }; }
        // Always fit the page (never clipped): shrink below the readable floor only for a single huge branch.
        const z = Math.max(0.3, Math.min(wFit, (pageAvail() - page.used) / m.h));
        page.trees.push({ html, z });
        page.used += m.h * z + 16;
      });
      if (page.trees.length) pages.push(page);
    }
    pages.forEach((pg, pi) => {
      const el = document.createElement('section');
      el.className = 'pr-page pr-trade';
      el.innerHTML = (pg.cont ? header(true) : header(false) + deal) + pg.trees.map((t) => `<div class="tcanvas ftwrap pr-tree"><div class="prz" style="zoom:${t.z}">${t.html}</div></div>`).join('');
      if (pi > 0 && !pg.cont) el.classList.add('cont');
      host.appendChild(el);
    });
    // Then the full accounting for this trade.
    const hs = document.createElement('section');
    hs.className = 'pr-page pr-trade';
    hs.innerHTML = header(true, 'full accounting');
    host.appendChild(hs);
    const mathAvail = PAGE_H - 38 - hs.scrollHeight - 50;
    hs.remove();
    const mp = mathPages(nt, mathAvail);
    mp.forEach((pg, pi) => {
      const el = document.createElement('section');
      el.className = 'pr-page pr-trade pr-mathpage';
      el.innerHTML = `${header(true, `full accounting${mp.length > 1 ? ` ${pi + 1}/${mp.length}` : ''}`)}<div class="tdeal tmath pr-math"${pg.z < 1 ? ` style="zoom:${pg.z}"` : ''}>${pg.html}</div>`;
      host.appendChild(el);
    });
  });
  // Page numbers on the cover table now that pages are known.
  const secs = [...host.querySelectorAll('section.pr-trade')];
  let n = 1;
  const firstPage = {};
  secs.forEach((sec) => { n++; const h = sec.querySelector('.rankbig').textContent; if (!firstPage[h]) firstPage[h] = n; });
  host.querySelectorAll('.pr-cover tbody tr').forEach((tr, i) => { const c = tr.lastElementChild; if (c) c.textContent = `p.${firstPage['#' + (i + 1)] || ''}`; });
  host.style.cssText = '';
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); host.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // Team logos: wait for them to load (or fail) before opening the print window.
  const imgs = [...host.querySelectorAll('img.tlogo')];
  imgs.forEach((im) => { im.addEventListener('error', () => im.classList.add('broken')); });
  Promise.race([
    Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise((res) => { im.addEventListener('load', res); im.addEventListener('error', res); })))),
    new Promise((res) => setTimeout(res, 4000)),
  ]).then(() => setTimeout(() => window.print(), 80));
}

// The report as JPGs in a zip: a full-size cover, then ONE tall image per trade (header, original
// trade, the whole tree and its full accounting). Not tied to letter pages, so nothing is shrunk
// to fit or split. Pages are built with the print styles injected, then each is drawn as a JPG.
let jpgBusy = false;
const IMG_PAD = 48;
async function exportReportJpgs(kind) {
  if (jpgBusy) return;
  jpgBusy = true;
  const toast = document.createElement('div');
  toast.className = 'jpgtoast';
  toast.textContent = 'Building images…';
  document.body.appendChild(toast);
  const shot = await import('../lib/pageshot.js');
  const style = document.createElement('style');
  style.id = 'img-print-css';
  style.textContent = shot.collectPrintCss();
  document.head.appendChild(style);
  let host = document.getElementById('print');
  if (!host) { host = document.createElement('div'); host.id = 'print'; document.body.appendChild(host); }
  host.innerHTML = '';
  host.style.cssText = 'display:block;position:absolute;left:-30000px;top:0;';
  const L = S.raw.league || {};
  const slug = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const zipName = `${slug(L.name) || 'league'}-${kind === 'branches' ? 'most-branches' : 'most-lopsided'}-${new Date().toISOString().slice(0, 10)}.zip`;
  try {
    buildImageReport(host, kind);
    await shot.embeddedFontCss();
    const n = await shot.downloadPagesAsZip(host, zipName, (sec) => sec.dataset.name, {
      selector: 'section.img-page', scale: 1.5,
      sizeOf: (sec) => ({ w: sec.offsetWidth, h: Math.ceil(sec.scrollHeight) }),
      onProgress: (d, t) => { toast.textContent = d < t ? `Rendering image ${d + 1} of ${t}…` : 'Zipping…'; },
    });
    toast.textContent = `Downloaded ${n} JPGs (${zipName})`;
  } catch (e) {
    toast.textContent = `Couldn't make the JPGs: ${e && e.message ? e.message : e}`;
    toast.classList.add('err');
  } finally {
    host.innerHTML = '';
    host.style.cssText = '';
    style.remove();
    jpgBusy = false;
    setTimeout(() => toast.remove(), 6000);
  }
}

function buildImageReport(host, kind) {
  const isBr = kind === 'branches';
  const top = isBr ? branchesList() : lopsidedList();
  const L = S.raw.league || {};
  const date = new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
  const pad = (n) => String(n).padStart(2, '0');
  const st = isBr ? S.ui.brs : S.ui.lop;
  const rankedBy = ((isBr ? BR_KEYS : LOP_KEYS)[st.key] || st.key).toLowerCase();
  const foot = `${esc(L.name || '')} · generated ${esc(date)} · values from KeepTradeCut, compared with KTC's trade calculator · pts = starting-lineup points credited to each side's tree`;

  // Cover: the page's own hero, summary and ranked table, at full size.
  const lop = isBr ? viewBranches() : viewLopsided();
  const heroSum = lop.slice(0, lop.indexOf('<div class="ttool">'));
  const tStart = lop.indexOf('<div class="tcanvas tlw scroll">');
  const tEnd = lop.indexOf('</table></div>', tStart) + '</table></div>'.length;
  const table = tStart >= 0 ? lop.slice(tStart, tEnd).replace('class="tcanvas tlw scroll"', 'class="tcanvas tlw img-table"') : '';
  const cover = document.createElement('section');
  cover.className = 'img-page img-cover';
  cover.dataset.name = '00-cover';
  cover.style.width = '1900px';
  cover.innerHTML = `${heroSum}<div class="img-rank">Top 10 ranked by <b>${esc(rankedBy)}</b>${st.dir > 0 ? ' (lowest first)' : ''}</div>${table}<p class="img-foot">${foot}</p>`;
  host.appendChild(cover);
  // Drop the "Tree" button column (links mean nothing in an image); shrink the group row's last span to match.
  const tbl = cover.querySelector('table.trank');
  if (tbl) {
    for (const tr of tbl.querySelectorAll('tr')) {
      const last = tr.lastElementChild;
      if (!last) continue;
      if (tr.classList.contains('grp')) { const cs = Number(last.getAttribute('colspan') || 1); if (cs > 1) last.setAttribute('colspan', cs - 1); else last.remove(); }
      else if (Number(last.getAttribute('colspan') || 1) === 1) last.remove();
    }
  }

  // One tall image per trade.
  const measure = (html, w) => {
    const d = document.createElement('div');
    d.className = 'tcanvas ftwrap pr-tree';
    d.style.width = `${w}px`;
    d.innerHTML = html;
    host.appendChild(d);
    const fts = [...d.querySelectorAll('.ft')];
    const r = { w: Math.max(...fts.map((f) => f.scrollWidth)), h: d.scrollHeight };
    d.remove();
    return r;
  };
  top.forEach((x, i) => {
    const nt = x.nt;
    const tiles = isBr ? [
      { label: 'Branches', value: x.br, cls: 'up' }, { label: 'Generations', value: x.g }, { label: 'Later deals', value: x.later },
      { label: 'Worth today', value: k(x.worth) }, { label: 'Starter pts', value: pts1(x.pts) },
    ] : [
      { label: 'Value gap', value: k(x.gap), cls: 'up' }, { label: 'Split today', value: `${Math.round(x.share * 100)}% / ${100 - Math.round(x.share * 100)}%` },
      { label: 'Pts gap', value: pts1(x.ptsGap) }, { label: 'Generations', value: x.g }, { label: 'Later deals', value: x.later },
    ];
    const header = `<div class="thero small"><div class="ico"><span class="rankbig">#${i + 1}</span></div><div><div class="eyebrow">${esc(L.name || '')} · traded ${esc(dateY(nt.created))}</div><h1 class="h1logos">${nt.rids.map((r) => `${tmini(nt, r)}${esc(treeNm(nt, r))}`).join('<i>⇄</i>')}</h1><p>${esc(treeLead(nt))}</p></div><div class="prstats">${tiles.map((t) => `<div><span>${esc(t.label)}</span><b class="${t.cls || ''}">${t.value}</b></div>`).join('')}</div><div class="glow"></div></div>`;
    const deal = `<div class="tdeal"><div class="hd"><b>The original trade</b><span class="faint small">values at the trade → today</span></div>${treeDealSummary(nt)}</div>`;
    // Pick the tree layout that shows it largest; let wide trees widen the image (1600–2600px) rather than shrink.
    const opts = [{ stack: true }, { stack: false }, { orient: 'right' }].map((o) => {
      const html = treeDiagram(nt, { ...o, print: true, withText: true });
      const m = measure(html, 4000);
      const width = Math.max(1600, Math.min(2600, m.w + 2 * IMG_PAD + 40));
      return { html, width, z: Math.min(1, (width - 2 * IMG_PAD - 40) / m.w) };
    }).sort((a, b) => b.z - a.z || a.width - b.width);
    const best = opts[0];
    const sec = document.createElement('section');
    sec.className = 'img-page img-trade';
    sec.dataset.name = `${pad(i + 1)}-trade${pad(i + 1)}`;
    sec.style.width = `${best.width}px`;
    sec.innerHTML = `${header}${deal}
      <h2 class="img-h">The tree</h2><div class="tcanvas ftwrap pr-tree img-tree"><div class="prz"${best.z < 1 ? ` style="zoom:${best.z.toFixed(3)}"` : ''}>${best.html}</div></div>
      <h2 class="img-h">Full accounting</h2>${attributionTables(nt)}
      <p class="img-foot">${foot}</p>`;
    host.appendChild(sec);
  });
}

// ---- picks & market -----------------------------------------------------------------------

function viewPicks() {
  const m = S.model;
  const rounds = m.league.rounds;
  const byOrig = [...m.teams].sort((a, b) => {
    const pa = m.picks.find((p) => p.orig === a.rid && p.slot), pb = m.picks.find((p) => p.orig === b.rid && p.slot);
    return (pa ? pa.slot : 99) - (pb ? pb.slot : 99);
  });
  const lockBtn = (y) => { const on = (m.lockedSeasons || []).includes(y); return `<button class="toggle ${on ? '' : 'on'}" data-action="pickLock" data-season="${y}" title="${on ? 'Locked: left out of the trade finder, trade lab and pick equivalents. Click once Sleeper lets you trade them.' : 'Tradeable in Sleeper. Click to lock if Sleeper won\'t let you trade these yet.'}">${on ? 'Locked' : 'Tradeable'} <span class="sw"></span></button>`; };
  return `<p class="lede">Sleeper only lets you trade picks for seasons it has opened (for example, after next year's dues are paid). Lock a season to keep its picks out of the trade finder, trade lab and pick equivalents. Locked picks still count toward each team's draft capital.</p>` + m.pickSeasons.map((y) => `<div class="card"><div class="sec-h"><h3 style="margin:0">${y} rookie draft${(m.lockedSeasons || []).includes(y) ? ' <span class="pill mid">locked</span>' : ''}</h3>${lockBtn(y)}</div>
    <p class="lede">${y === m.league.season + 1 ? 'Sorted by projected slot (worst team first) from the playoff simulation. Red names own a pick that isn\'t theirs.' : 'Too far out to project; valued as mid-round picks.'}</p>
    <div class="scroll"><table class="t"><thead><tr><th>Original team</th>${y === m.league.season + 1 ? '<th>Proj. slot</th>' : ''}${Array.from({ length: rounds }, (_, i) => `<th>${roundName(i + 1)}</th>`).join('')}</tr></thead><tbody>
    ${byOrig.map((t) => {
      const row = Array.from({ length: rounds }, (_, i) => {
        const p = m.picks.find((x) => x.season === y && x.round === i + 1 && x.orig === t.rid);
        if (!p) return '<td>—</td>';
        return `<td>${p.owner !== p.orig ? `<span class="down">${esc(tname(p.owner))}</span>` : '<span class="faint">own</span>'} <b>${k(p.v)}</b></td>`;
      }).join('');
      const pk = m.picks.find((x) => x.season === y && x.orig === t.rid) || {};
      return `<tr class="${t.isMe ? 'me' : ''}"><td><div class="who">${teamAvatar(t)}${tlink(t.rid)}</div></td>${y === m.league.season + 1 ? `<td>${pk.slot ? `${pk.slot} <span class="muted">(${esc(pk.tier)})</span>` : '—'}</td>` : ''}${row}</tr>`;
    }).join('')}</tbody></table></div></div>`).join('');
}

function viewMarket() {
  const m = S.model;
  const line = (a) => `<tr class="${a.rid === m.me ? 'me' : ''}"><td><div class="who">${headshot(a.id)}<div>${playerLink(a.id, a.name)}<div class="meta">${posTag(a.pos)} ${a.age ? Math.floor(a.age) : ''} · ${k(a.v)}</div></div></div></td><td>${tlink(a.rid)}</td><td class="num ${a.pct30 > 0 ? 'up' : 'down'}">${signPct(a.pct30)}</td><td class="num">${a.d7 != null ? (a.d7 > 0 ? '+' : '') + a.d7 : '—'}</td></tr>`;
  const head = '<thead><tr><th>Player</th><th>Owner</th><th class="num">30 days</th><th class="num">KTC 7 days</th></tr></thead>';
  return `<div class="two" style="align-items:start">
    <div class="card"><h3>Rising</h3><p class="lede">Rostered players whose FantasyCalc value moved most in 30 days. KTC 7-day moves fill in after a week of syncs.</p><div class="scroll"><table class="t">${head}<tbody>${m.market.risers.map(line).join('')}</tbody></table></div></div>
    <div class="card"><h3>Falling</h3><div class="scroll"><table class="t">${head}<tbody>${m.market.fallers.map(line).join('')}</tbody></table></div></div>
    <div class="card"><h3>Sell high</h3>${m.market.sellHigh.map((a) => `<div class="asset">${headshot(a.id)}<div class="nm">${playerLink(a.id, a.name)}<span class="meta">up ${signPct(a.pct30)} in 30 days at ${Math.floor(a.age)}</span></div><div class="vals">${k(a.v)}</div></div>`).join('') || '<p class="muted">None of your older players are spiking.</p>'}</div>
    <div class="card"><h3>Buy low</h3>${m.market.buyLow.map((a) => `<div class="asset">${headshot(a.id)}<div class="nm">${playerLink(a.id, a.name)}<span class="meta">${esc(tname(a.rid))} · down ${signPct(a.pct30)}${a.sellerTone === 'sell' ? ' · owner selling' : ''}</span></div><div class="vals">${k(a.v)}</div></div>`).join('') || '<p class="muted">No young players are sliding.</p>'}</div>
  </div>`;
}



// ---- PNG posters ------------------------------------------------------------------------------
const POSTER = { good: '#5fe39a', bad: '#ff8a8a', muted: '#8f7bb6' };
const avatarUrl = (t) => (t && (t.logo || (t.avatar ? `https://sleepercdn.com/avatars/thumbs/${t.avatar}` : ''))) || '';
const sgn = (v, f) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${f(Math.abs(v))}`;
const netC = (v, has = true) => (!has ? { text: '—', color: POSTER.muted } : { text: sgn(v, k), color: v > 250 ? POSTER.good : v < -250 ? POSTER.bad : '#c4b3e6' });
const ptsC = (v, has = true) => (!has ? { text: '—', color: POSTER.muted } : { text: sgn(Math.round(v), (x) => String(x)), color: v > 10 ? POSTER.good : v < -10 ? POSTER.bad : '#c4b3e6' });
const leagueName = () => (S.raw && S.raw.league && S.raw.league.name) || "Casey's Dynasty League";
const srcTag = () => (S.bookRaw && S.bookRaw.ktcAlts ? ` · KTC ${KTC_SOURCES[S.cfg.ktcSource] || KTC_SOURCES.crowd}` : '');
const fileStamp = () => `${(S.model && S.model.league.season) || ''}-wk${(S.model && S.model.league.week) || ''}`;

function tradeSummaryPoster() {
  const m = S.model;
  const rows = summaryRows().sort((a, b) => b.allNow - a.allNow);
  const has = (r) => r.trades + r.histTrades > 0;
  const traded = rows.filter(has);
  const best = traded[0], worst = traded[traded.length - 1];
  const mostPts = [...traded].sort((a, b) => b.allPts - a.allPts)[0];
  const busiest = [...rows].sort((a, b) => (b.trades + b.histTrades) - (a.trades + a.histTrades))[0];
  const awards = [
    best && { label: 'Best trader', name: best.name, avatar: avatarUrl(best.t), stat: `${sgn(best.allNow, k)} net value now` },
    mostPts && { label: 'Most points from trades', name: mostPts.name, avatar: avatarUrl(mostPts.t), stat: `${sgn(Math.round(mostPts.allPts), String)} starter points` },
    busiest && { label: 'Busiest dealer', name: busiest.name, avatar: avatarUrl(busiest.t), stat: `${busiest.trades + busiest.histTrades} trades` },
    worst && worst !== best && { label: 'Fleeced', gloom: true, name: worst.name, avatar: avatarUrl(worst.t), stat: `${sgn(worst.allNow, k)} net value now` },
  ].filter(Boolean);
  return {
    banner: 2,
    file: `caseys-trade-summary-${fileStamp()}.png`,
    title: 'Trade summary', eyebrow: leagueName(),
    subtitle: `Who won the trades · week ${m.league.week}, ${m.league.season}${srcTag()}`,
    awards,
    groups: [
      { label: '', cols: [{ key: '#', label: '#', w: 70, align: 'center' }, { key: 'name', label: 'Manager', align: 'left' }] },
      { label: 'This season', cols: [
        { key: 'trades', label: 'Trades', w: 80 },
        { key: 'curNow', label: 'Net value now', sub: 'KTC, today', w: 150 },
        { key: 'curPts', label: 'Points +/−', sub: 'starter pts', w: 125 },
      ] },
      { label: 'Earlier seasons', cols: [
        { key: 'histTrades', label: 'Trades', w: 80 },
        { key: 'oldNow', label: 'Net value now', sub: 'KTC, today', w: 150 },
        { key: 'oldPts', label: 'Points +/−', sub: 'starter pts', w: 125 },
      ] },
      { label: 'All time', hero: true, cols: [
        { key: 'allNow', label: 'Net value now', sub: 'received − given, KTC today', w: 200, hero: true },
        { key: 'allPts', label: 'Points gained', sub: 'starter pts from trades', w: 180, hero: true },
      ] },
      { label: 'Roster', cols: [{ key: 'value', label: 'Team value', sub: 'KTC', w: 120 }] },
    ],
    rows: rows.map((r) => ({
      name: r.name, sub: r.t.teamName && r.t.teamName.toLowerCase() !== r.name.toLowerCase() ? r.t.teamName : '', avatar: avatarUrl(r.t), isMe: r.isMe,
      cells: {
        trades: { text: String(r.trades) }, curNow: netC(r.curNow, r.trades > 0), curPts: ptsC(r.curPts, r.trades > 0),
        histTrades: { text: String(r.histTrades) }, oldNow: netC(r.oldNow, r.histTrades > 0), oldPts: ptsC(r.oldPts, r.histTrades > 0),
        allNow: { ...netC(r.allNow, has(r)), bold: true }, allPts: { ...ptsC(r.allPts, has(r)), bold: true },
        value: { text: k(r.value), color: '#e9dcff' },
      },
    })),
    notes: [
      'Net value now: everything a manager received minus everything he gave, at today\'s KeepTradeCut values (used picks count as the player drafted).',
      'Points +/−: starter points scored for him by players he got, minus starter points scored for others by players he sent away.',
    ],
    footLabel: worst && worst !== best ? { title: 'Rough trading', text: `${worst.name}: ${sgn(worst.allNow, k)} in value given away` } : null,
  };
}

function seasonPoster() {
  const m = S.model;
  const pN = m.league.playoffTeams || 6;
  const regEnd = m.league.regEnd;
  const weeks = Array.from({ length: regEnd }, (_, i) => i + 1);
  const hasBye = m.teams[0].byeOdds != null;
  const standing = Object.fromEntries([...m.teams].sort((a, b) => b.w - a.w || b.pf - a.pf).map((t, i) => [t.rid, i + 1]));
  // Same order as the table on screen when it's sorted by finish; otherwise standings.
  const key = ['playoffOdds', 'projW'].includes(S.ui.season.key) && S.ui.season.dir < 0 ? S.ui.season.key : 'standing';
  const projWOf = (t) => (t.expWins != null ? t.expWins : t.w);
  const sorted = [...m.teams].sort((a, b) => key === 'playoffOdds' ? (b.playoffOdds ?? -1) - (a.playoffOdds ?? -1) || standing[a.rid] - standing[b.rid] : key === 'projW' ? projWOf(b) - projWOf(a) : standing[a.rid] - standing[b.rid]);
  const streak = (t) => { const r = t.results || []; if (!r.length) return ''; const last = r[r.length - 1].res; let c = 0; for (let i = r.length - 1; i >= 0 && r[i].res === last; i--) c++; return `${last}${c}`; };
  const oddsC = (v, hero) => (v == null || v < 0 ? { text: '—', color: POSTER.muted } : { text: pct(v), bar: v, color: v >= 0.75 ? '#2fc66b' : v <= 0.25 ? '#f05a5a' : hero ? '#f2b632' : '#f2a541' });
  const weekCell = (t, w) => {
    const r = (t.results || []).find((x) => x.w === w);
    if (r) return { wl: r.res };
    const up = (t.remaining || []).find((x) => x.w === w);
    if (!up) return { wl: '' };
    const o = team(up.rid);
    const p0 = o ? normCdf((t.strength - o.strength) / Math.sqrt((t.sd || 22) ** 2 + (o.sd || 22) ** 2)) : null;
    return { wl: p0 == null ? '' : p0 >= 0.5 ? 'W' : 'L', proj: true, p: p0 == null ? null : Math.round(p0 * 100) };
  };
  const byTop = [...m.teams].filter((t) => t.seedOdds).sort((a, b) => b.seedOdds[0] - a.seedOdds[0])[0];
  const pfLead = [...m.teams].sort((a, b) => b.pf - a.pf)[0];
  const unlucky = [...m.teams].sort((a, b) => (b.pa || 0) - (a.pa || 0))[0];
  const last = [...m.teams].sort((a, b) => standing[b.rid] - standing[a.rid])[0];
  const awards = [
    byTop && { label: 'Top seed favourite', name: byTop.name, avatar: avatarUrl(byTop), stat: `${pct(byTop.seedOdds[0])} to finish 1st` },
    pfLead && { label: 'Points leader', name: pfLead.name, avatar: avatarUrl(pfLead), stat: `${Math.round(pfLead.pf)} points for` },
    unlucky && { label: 'Toughest luck', name: unlucky.name, avatar: avatarUrl(unlucky), stat: `${Math.round(unlucky.pa || 0)} points against` },
    last && { label: 'Lottery watch', gloom: true, name: last.name, avatar: avatarUrl(last), stat: `${last.w}-${last.l} · ${pct(last.playoffOdds)} playoff odds` },
  ].filter(Boolean);
  const wkW = 44;
  return {
    width: 2800,
    file: `caseys-season-table-${fileStamp()}.png`,
    title: 'Season table', eyebrow: leagueName(),
    subtitle: `${m.teams.length} teams · top ${pN} make the playoffs${hasBye ? ' · top 2 get a bye' : ''} · regular season ends week ${regEnd}`,
    awards,
    groups: [
      { label: '', cols: [{ key: '#', label: '#', w: 62, align: 'center' }, { key: 'name', label: 'Team', align: 'left' }, { key: 'rec', label: 'Record', sub: 'streak', w: 104 }] },
      { label: 'Results by week', cols: weeks.map((w) => ({ key: `w${w}`, label: String(w), w: wkW, align: 'center' })) },
      { label: 'Scoring', cols: [
        { key: 'pf', label: 'PF', sub: 'points for', w: 92 }, { key: 'pa', label: 'PA', sub: 'against', w: 92 },
        { key: 'maxpf', label: 'Max PF', sub: 'best lineup', w: 104 }, { key: 'eff', label: 'Eff.', sub: 'of max', w: 78 },
        { key: 'ap', label: 'All-play', sub: 'vs everyone', w: 108 },
      ] },
      { label: 'Strength', cols: [
        { key: 'best', label: 'Proj. max PF/wk', sub: 'and rank', w: 150 },
        { key: 'sos', label: 'Sched.', sub: '1st = hardest', w: 112 },
      ] },
      { label: 'Projection', hero: true, cols: [
        { key: 'proj', label: 'Proj. record', sub: 'rest of season', w: 140, hero: true },
        { key: 'seed', label: 'Avg seed', w: 92 },
        { key: 'odds', label: 'Playoffs', sub: 'chance', w: 180, hero: true },
        ...(hasBye ? [{ key: 'bye', label: 'Bye', sub: 'top 2', w: 150 }] : []),
        { key: 'top', label: '#1 seed', sub: 'chance', w: 150 },
      ] },
    ],
    rows: sorted.map((t, i) => {
      const games = t.w + t.l + (t.t || 0), left = t.remaining ? t.remaining.length : 0;
      const projW = projWOf(t);
      const sk = streak(t);
      const avgSeed = t.seedOdds ? t.seedOdds.reduce((s2, p0, j) => s2 + p0 * (j + 1), 0) : null;
      const cells = {
        rec: { text: `${t.w}-${t.l}${t.t ? '-' + t.t : ''}`, bold: true, sub: sk || ' ', subColor: sk.startsWith('W') ? POSTER.good : sk.startsWith('L') ? POSTER.bad : POSTER.muted },
        pf: { text: String(Math.round(t.pf)) }, pa: { text: String(Math.round(t.pa || 0)), color: '#c4b3e6' },
        maxpf: { text: t.maxPf ? String(Math.round(t.maxPf)) : '—', color: '#c4b3e6' },
        eff: { text: t.eff != null ? pct(t.eff) : '—', color: '#c4b3e6' },
        ap: { text: t.allPlay ? `${t.allPlay.w}-${t.allPlay.l}` : '—', color: '#c4b3e6' },
        best: { text: t.bestNow ? t.bestNow.toFixed(1) : '—', sub: t.strengthRank ? ordinal(t.strengthRank) : '' },
        sos: { text: t.sosRank ? ordinal(t.sosRank) : '—', sub: `${left} left` },
        proj: { text: `${projW.toFixed(1)}-${(games + left - projW).toFixed(1)}`, bold: true },
        seed: { text: avgSeed ? avgSeed.toFixed(1) : '—' },
        odds: oddsC(t.playoffOdds, true), bye: oddsC(t.byeOdds), top: oddsC(t.seedOdds ? t.seedOdds[0] : null),
      };
      for (const w of weeks) cells[`w${w}`] = weekCell(t, w);
      return {
        rank: standing[t.rid], name: t.name, sub: t.teamName && t.teamName.toLowerCase() !== t.name.toLowerCase() ? t.teamName : '', avatar: avatarUrl(t), isMe: t.isMe,
        cutAfter: i === pN - 1 && i < sorted.length - 1, cells,
      };
    }),
    notes: [
      'Results: solid squares are played games; faded squares are projected, with the small number showing the % chance to win.',
      'Projections run the rest of the regular season 3,000 times, with every team starting its best lineup: strength blends the best lineup it could have started each week (max PF) with its best healthy lineup today.',
      'Eff.: points scored as a share of max PF. All-play: the record a team would have if it played every other team every week. Sched.: remaining schedule difficulty, 1st = toughest.',
    ],
    footLabel: last ? { title: 'Draft lottery watch', text: `${last.name} (${last.w}-${last.l})` } : null,
  };
}


function mockDraftPoster() {
  const m = S.model;
  const y = m.league.season + 1;
  const n = m.teams.length;
  const board = draftBoard();
  const picksY = m.picks.filter((p) => p.season === y).map((p) => ({ ...p, overall: p.slot ? (p.round - 1) * n + p.slot : null })).sort((a, b) => (a.overall || 999) - (b.overall || 999));
  const rounds = [...new Set(picksY.map((p) => p.round))].sort((a, b) => a - b);
  const mock = mockFor(m, picksY, board);
  const method = m.draftOrderMethod === 'standings' ? 'Order: projected finish, worst picks first' : m.draftOrderMethod === 'maxpf' ? 'Order: non-playoff teams by projected max PF, then playoff teams' : 'Order: projected max PF, lowest first';
  return {
    banner: 4,
    file: `${String(m.league.name || 'league').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${y}-mock-draft.png`,
    eyebrow: `${m.league.name} · ${y} rookie draft`,
    title: `${y} Mock Draft`,
    subtitle: `${method} · as of ${new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`,
    rounds: rounds.map((r) => ({
      label: `Round ${r}`,
      picks: picksY.filter((p) => p.round === r).map((p) => {
        const mk = p.overall ? mock[p.overall] : null;
        const proj = mk ? mk.player : null;
        return {
          pick: p.overall ? `${p.round}.${String(p.slot).padStart(2, '0')}` : roundName(p.round),
          owner: tname(p.owner), avatar: avatarUrl(team(p.owner)), isMe: p.owner === m.me,
          via: p.orig !== p.owner ? tname(p.orig) : '',
          player: proj ? { name: proj.name, pos: proj.pos, school: proj.school || '' } : null,
          why: mk && mk.reason !== 'bpa' ? `${mk.reason === 'need' ? 'Need' : 'Fit'} ${mk.needPos}${mk.needRank ? ` · ${ordinal(mk.needRank)}` : ''}` : '',
        };
      }),
    })),
    notes: [
      board ? `Prospects come from ${board.mine ? 'your own board' : board.source}. Picks 1-3 take the best available; after that each team weighs the next few prospects against its weakest rooms ("Need RB · 11th" = 11th-best RB room in the league).` : `No ${y} prospect board yet, so picks show "Best available". Add a board on the Rookie draft page.`,
      'Slots are projected from the playoff simulation and change week to week until the season ends.',
    ],
  };
}

async function exportMock(el) {
  if (!S.model) return;
  const label = el ? el.innerHTML : '';
  if (el) { el.disabled = true; el.textContent = 'Drawing…'; }
  try { const spec = mockDraftPoster(); await downloadCanvas(await drawMockDraft(spec), spec.file); } catch (e) { console.error(e); S.error = `Couldn't make the image: ${e.message}`; render(); }
  finally { if (el) { el.disabled = false; el.innerHTML = label; } }
}

function valueTimePoster() {
  const m = S.model;
  const VT = m.valueTime;
  const ui = S.ui.vot || {};
  const W3 = VT.windows;
  const from = W3[ui.from] ? ui.from : W3.startup ? 'startup' : W3.season ? 'season' : 'draft';
  const V = W3[from];
  const sel = (ui.sel || []).filter((r) => team(r));
  const shown = sel.length ? m.teams.filter((t) => sel.includes(t.rid)) : m.teams;
  const color = Object.fromEntries([...m.teams].sort((a, b) => a.rid - b.rid).map((t, i) => [t.rid, t.isMe ? '#f2b632' : VOT_COLORS[(i % (VOT_COLORS.length - 1)) + 1]]));
  const startName = from === 'startup' ? 'Startup draft' : from === 'season' ? 'Season start' : 'Rookie draft';
  const dY = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const sg = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${k(Math.abs(v))}`;
  const tone = (v) => (v > 250 ? '#5fe39a' : v < -250 ? '#ff8a8a' : '#c4b3e6');
  const R = (t) => V.rows[t.rid];
  const sk = ['start', 'trades', 'draft', 'added', 'lost', 'residual', 'end', 'change'].includes(ui.sort) && (ui.sort !== 'draft' || from !== 'draft') ? ui.sort : 'end';
  const rows = [...shown].sort((a, b) => (sk === 'lost' ? R(a)[sk] - R(b)[sk] : R(b)[sk] - R(a)[sk]));
  const by = (f) => [...shown].sort((a, b) => f(R(b)) - f(R(a)));
  const awards = shown.length >= 4 ? [
    { label: 'Biggest climb', t: by((r) => r.change)[0], stat: (r) => `${sg(r.change)} (${r.start ? Math.round((r.change / r.start) * 100) : 0}%)` },
    { label: 'Best trader', t: by((r) => r.trades)[0], stat: (r) => `${sg(r.trades)} from ${r.tradeCount} trades` },
    { label: 'Waiver hawk', t: by((r) => r.added - r.lost)[0], stat: (r) => `${sg(r.added - r.lost)} net on waivers` },
    { label: 'Biggest slide', gloom: true, t: by((r) => -r.change)[0], stat: (r) => `${sg(r.change)} (${r.start ? Math.round((r.change / r.start) * 100) : 0}%)` },
  ].map((a) => ({ label: a.label, gloom: a.gloom, name: a.t.name, avatar: avatarUrl(a.t), stat: a.stat(R(a.t)) })) : [];
  const fromSeason = from !== 'draft';
  return {
    banner: 4,
    file: `caseys-value-over-time-${sel.length ? shown.map((t) => t.name).join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) : 'league'}-${fileStamp()}.png`,
    title: 'Value over time', eyebrow: leagueName(),
    subtitle: `${sel.length ? shown.map((t) => t.name).join(' · ') : 'Every team'} · ${dY(V.start)} to today${srcTag()}`,
    awards,
    chart: {
      title: `Team value, week by week (${startName.toLowerCase()} to today)`,
      series: shown.map((t) => ({ name: t.name, color: color[t.rid], avatar: avatarUrl(t), strong: sel.length ? true : t.isMe, points: V.series[t.rid] })),
      marks: fromSeason ? [{ at: W3.draft.start, label: `${new Date(W3.draft.start).getFullYear()} rookie draft` }] : [],
    },
    groups: [
      { label: '', cols: [{ key: '#', label: '#', w: 70, align: 'center' }, { key: 'name', label: 'Team', align: 'left' }] },
      { label: 'Start', cols: [{ key: 'start', label: startName, sub: dY(V.start), w: 150 }] },
      { label: 'What changed', cols: [
        { key: 'trades', label: 'Trades', sub: 'net then', w: 135 },
        ...(fromSeason ? [{ key: 'draft', label: 'Rookie drafts', sub: 'players − picks', w: 140 }] : []),
        ...(shown.some((t) => R(t).newPickCount) ? [{ key: 'newPicks', label: 'New pick yr', sub: 'joins at draft', w: 135 }] : []),
        { key: 'added', label: 'Waivers added', sub: 'value that week', w: 150 },
        { key: 'lost', label: 'Value lost', sub: 'drops, that week', w: 150 },
        { key: 'residual', label: 'Appreciation', sub: 'while held', w: 150 },
      ] },
      { label: 'Today', hero: true, cols: [
        { key: 'end', label: 'Value today', sub: 'dashboard value', w: 160, hero: true },
        { key: 'change', label: 'Change', sub: `vs ${startName.toLowerCase()}`, w: 220, hero: true },
      ] },
    ],
    rows: rows.map((t) => {
      const r = R(t);
      return {
        name: t.name, sub: t.teamName && t.teamName.toLowerCase() !== t.name.toLowerCase() ? t.teamName : '', avatar: avatarUrl(t), isMe: t.isMe,
        cells: {
          start: { text: k(r.start), color: '#e9dcff' },
          trades: { text: r.tradeCount ? sg(r.trades) : '—', color: r.tradeCount ? tone(r.trades) : '#8f7bb6' },
          draft: { text: r.draftCount ? sg(r.draft) : '—', color: r.draftCount ? tone(r.draft) : '#8f7bb6' },
          newPicks: { text: r.newPickCount ? sg(r.newPicks) : '—', color: r.newPickCount ? tone(r.newPicks) : '#8f7bb6' },
          added: { text: r.added ? `+${k(r.added)}` : '0', color: r.added ? '#5fe39a' : '#8f7bb6' },
          lost: { text: r.lost ? `−${k(r.lost)}` : '0', color: r.lost ? '#ff8a8a' : '#8f7bb6' },
          residual: { text: sg(r.residual), color: tone(r.residual) },
          end: { text: k(r.end), bold: true },
          change: { text: `${sg(r.change)}${r.start ? ` (${r.change >= 0 ? '+' : ''}${Math.round((r.change / r.start) * 100)}%)` : ''}`, color: tone(r.change), bold: true },
        },
      };
    }).concat([(() => {
      const T = (key) => shown.reduce((a, t) => a + R(t)[key], 0);
      const st = T('start'), ch = T('change');
      return { total: true, name: sel.length ? `Total, ${shown.length} teams` : 'League', cells: {
        start: { text: k(st), color: '#e9dcff', bold: true },
        trades: { text: sg(T('trades')), color: tone(T('trades')), bold: true },
        draft: { text: sg(T('draft')), color: tone(T('draft')), bold: true },
        newPicks: { text: sg(T('newPicks')), color: tone(T('newPicks')), bold: true },
        added: { text: `+${k(T('added'))}`, color: '#5fe39a', bold: true },
        lost: { text: `−${k(T('lost'))}`, color: '#ff8a8a', bold: true },
        residual: { text: sg(T('residual')), color: tone(T('residual')), bold: true },
        end: { text: k(T('end')), bold: true },
        change: { text: `${sg(ch)}${st ? ` (${ch >= 0 ? '+' : ''}${Math.round((ch / st) * 100)}%)` : ''}`, color: tone(ch), bold: true },
      } };
    })()]),
    notes: [
      `${startName} + Trades${fromSeason ? ' + Rookie drafts + New pick year' : ''} + Waivers added − Value lost + Appreciation = Value today. Picks count for the next two drafts, as in today's values.`,
      'Trades are Trade summary\'s "Net then" figures. Waivers and drops are valued the week they happened; Appreciation is how every asset moved while the team held it.',
      'Weekly values: DynastyProcess, put on the dashboard\'s scale by rank. Today: the dashboard\'s KTC/FantasyCalc blend.',
    ],
  };
}

function ledgerPoster(rid) {
  const m = S.model;
  const VT = m.valueTime;
  const ui = S.ui.vot || {};
  const W3 = VT.windows;
  const from = W3[ui.from] ? ui.from : W3.startup ? 'startup' : W3.season ? 'season' : 'draft';
  const V = W3[from];
  const t = team(rid);
  const r = V.rows[rid];
  const L2 = V.ledger[rid];
  const fromSeason = from !== 'draft';
  const startName = from === 'startup' ? 'Startup draft' : from === 'season' ? 'Season start' : 'Rookie draft';
  const dY = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const sg = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${k(Math.abs(v))}`;
  const GOOD = '#5fe39a', BAD = '#ff8a8a', MUT = '#c4b3e6', FNT = '#8f7bb6';
  const tone = (v) => (v > 250 ? GOOD : v < -250 ? BAD : MUT);
  const nm = (key) => {
    if (key.startsWith('p:')) { const p = P(key.slice(2)); return `${p.name}${p.pos ? ` (${p.pos})` : ''}`; }
    const [, y, rd, orig] = key.split(':');
    return `${y} ${roundName(Number(rd))} (${tname(Number(orig))})`;
  };
  const nowOf = (key) => (key.startsWith('p:') ? pval(key.slice(2)).v || 0 : 0);
  // trades
  const byId = new Map([...m.leagueTrades.map((nt) => [nt.id, { nt, src: 'cur' }]), ...m.histTrades.map((nt) => [nt.id, { nt, src: 'old' }])]);
  const netOf = (g) => (g && g[rid] ? g[rid].got - g[rid].gave : null);
  const tradeRows = L2.trades.slice().sort((a, b) => a.at - b.at).map((x) => {
    const nt = byId.get(x.id) ? byId.get(x.id).nt : null;
    const nn = nt ? netOf(nt.now) : null;
    return { cells: [{ text: dY(x.at), color: MUT }, { text: nt ? nt.rids.filter((q) => q !== rid).map((q) => tname(q)).join(', ') : '' }, { text: x.inn.map((a) => nm(a.key)).join(', ') || '—' }, { text: x.out.map((a) => nm(a.key)).join(', ') || '—', color: MUT }, { text: sg(x.net), color: tone(x.net), bold: true }, { text: nn == null ? '—' : sg(nn), color: FNT }] };
  });
  const sections = [{
    title: 'Trades', sub: `${L2.trades.length} trades · Trade summary "Net then"`, total: { text: sg(r.trades), color: tone(r.trades) }, split: false,
    cols: [{ label: 'Date', w: 1.1, align: 'left' }, { label: 'With', w: 1.3, align: 'left' }, { label: 'Got', w: 4, align: 'left' }, { label: 'Gave', w: 4, align: 'left' }, { label: 'Net then', w: 1 }, { label: 'Net now', w: 1 }],
    rows: tradeRows,
  }];
  if (fromSeason) sections.push({
    title: 'Rookie drafts', sub: `${L2.draft.length} picks · player value minus pick value, the week of the draft`, total: { text: sg(r.draft), color: tone(r.draft) }, split: false,
    cols: [{ label: 'Draft', w: 0.7, align: 'left' }, { label: 'Pick used', w: 2.4, align: 'left' }, { label: 'Player taken', w: 2.6, align: 'left' }, { label: 'Pick value', w: 1 }, { label: 'Player then', w: 1 }, { label: 'Gain', w: 1 }, { label: 'Player today', w: 1 }],
    rows: L2.draft.slice().sort((a, b) => a.at - b.at).map((x) => ({ cells: [{ text: String(new Date(x.at).getFullYear()), color: MUT }, { text: x.pick ? nm(x.pick) : '—', color: MUT }, { text: nm(x.key) }, { text: k(x.vPick) }, { text: k(x.v) }, { text: sg(x.v - x.vPick), color: tone(x.v - x.vPick), bold: true }, { text: k(nowOf(x.key)), color: FNT }] })),
  });
  const ev = [...L2.adds.map((x) => ({ ...x, add: true })), ...L2.drops.map((x) => ({ ...x, add: false }))].sort((a, b) => a.at - b.at);
  sections.push({
    title: 'Waivers', sub: `${L2.adds.length} adds, ${L2.drops.length} drops · valued the week of the move`, total: { text: sg(r.added - r.lost), color: tone(r.added - r.lost) },
    cols: [{ label: 'Date', w: 1.2, align: 'left' }, { label: 'Move', w: 0.8, align: 'left' }, { label: 'Player', w: 2.6, align: 'left' }, { label: 'That week', w: 1 }, { label: 'Today', w: 0.9 }],
    rows: ev.map((x) => ({ cells: [{ text: dY(x.at), color: MUT }, { text: x.add ? 'Added' : 'Dropped', color: x.add ? GOOD : BAD, bold: true }, { text: nm(x.key) }, { text: `${x.add ? '+' : '−'}${k(x.v)}`, color: x.add ? GOOD : BAD }, { text: k(nowOf(x.key)), color: FNT }] })),
    foot: [{ label: 'Waivers added', text: `+${k(r.added)}`, color: GOOD }, { label: 'Value lost (drops, and players released in trades)', text: `−${k(r.lost)}`, color: BAD }],
  });
  const how = { start: startName.toLowerCase(), trade: 'trade', draft: 'drafted', move: 'waivers' };
  const out = { held: 'today', trade: 'traded', move: 'dropped', draft: 'used' };
  const appr = L2.held.filter((x) => Math.abs(x.vOut - x.vIn) >= 1).sort((a, b) => (b.vOut - b.vIn) - (a.vOut - a.vIn));
  const foot = [{ label: `Players and picks (${appr.length} that changed value)`, text: sg(r.assetAppr), color: tone(r.assetAppr) }];
  if (Math.abs(r.pkgAdj) >= 1) foot.push({ label: 'Trade pricing (package adjustment vs each player\'s own value)', text: sg(r.pkgAdj), color: tone(r.pkgAdj) });
  if (Math.abs(r.other) >= 1) foot.push({ label: 'Dashboard total vs sum of assets (projected pick slots, unvalued players)', text: sg(r.other), color: tone(r.other) });
  foot.push({ label: 'Appreciation', text: sg(r.residual), color: tone(r.residual), bold: true });
  sections.push({
    title: 'Appreciation', sub: 'every asset\'s change while the team held it', total: { text: sg(r.residual), color: tone(r.residual) },
    cols: [{ label: 'Asset', w: 2.6, align: 'left' }, { label: 'From', w: 1, align: 'left' }, { label: 'Until', w: 1.1, align: 'left' }, { label: 'In', w: 0.8 }, { label: 'Out', w: 0.8 }, { label: 'Change', w: 0.9 }],
    rows: appr.map((x) => ({ cells: [{ text: nm(x.key) }, { text: how[x.how] || x.how, color: FNT }, { text: x.out === 'held' ? 'today' : `${out[x.out] || x.out} ${new Date(x.to).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}`, color: FNT }, { text: k(x.vIn), color: MUT }, { text: k(x.vOut), color: MUT }, { text: sg(x.vOut - x.vIn), color: tone(x.vOut - x.vIn), bold: true }] })),
    foot,
  });
  const bridge = [
    { label: startName, text: k(r.start), sub: dY(V.start) },
    { label: 'Trades', text: sg(r.trades), color: tone(r.trades), sub: `${r.tradeCount} trades` },
    ...(fromSeason ? [{ label: 'Rookie drafts', text: sg(r.draft), color: tone(r.draft), sub: `${r.draftCount} picks` }] : []),
    ...(r.newPickCount ? [{ label: 'New pick year', text: sg(r.newPicks), color: tone(r.newPicks), sub: `${r.newPickCount} picks` }] : []),
    { label: 'Waivers added', text: `+${k(r.added)}`, color: GOOD, sub: `${r.addCount} adds` },
    { label: 'Value lost', text: `−${k(r.lost)}`, color: BAD, sub: `${r.lostCount} players` },
    { label: 'Appreciation', text: sg(r.residual), color: tone(r.residual), sub: 'while held' },
    { label: 'Today', text: k(r.end), sub: `${sg(r.change)}${r.start ? ` (${r.change >= 0 ? '+' : ''}${Math.round((r.change / r.start) * 100)}%)` : ''}` },
  ];
  return {
    banner: 3,
    file: `caseys-ledger-${String(t.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${fileStamp()}.png`,
    title: 'Team ledger', eyebrow: leagueName(),
    subtitle: `${t.name} · ${dY(V.start)} to today${srcTag()}`,
    team: { name: t.name, avatar: avatarUrl(t) },
    chart: {
      title: `${t.name}: value week by week, with the league average`,
      series: [
        { name: 'League avg', color: '#8f7bb6', faint: true, points: V.series[rid].map((p, i) => ({ at: p.at, v: m.teams.reduce((a, tt) => a + ((V.series[tt.rid][i] || {}).v || 0), 0) / m.teams.length })) },
        { name: t.name, color: '#f2b632', avatar: avatarUrl(t), strong: true, points: V.series[rid] },
      ],
      marks: fromSeason ? [{ at: W3.draft.start, label: `${new Date(W3.draft.start).getFullYear()} rookie draft` }] : [],
    },
    bridge, sections,
    notes: [
      `${startName} + Trades${fromSeason ? ' + Rookie drafts' : ''} + Waivers added − Value lost + Appreciation = Today.`,
      'Weekly values: DynastyProcess, put on the dashboard\'s scale by rank. Today: the dashboard\'s KTC/FantasyCalc blend. Trades: Trade summary\'s figures.',
    ],
  };
}

async function exportLedger(el) {
  if (!S.model || !S.ui.vot || !S.ui.vot.detail) return;
  const label = el ? el.innerHTML : '';
  if (el) { el.disabled = true; el.textContent = 'Drawing…'; }
  try { const spec = ledgerPoster(S.ui.vot.detail.rid); await downloadCanvas(await drawLedger(spec), spec.file); } catch (e) { console.error(e); S.error = `Couldn't make the image: ${e.message}`; render(); }
  finally { if (el) { el.disabled = false; el.innerHTML = label; } }
}

async function exportPoster(el, build) {
  if (!S.model) return;
  const label = el ? el.innerHTML : '';
  if (el) { el.disabled = true; el.textContent = 'Drawing…'; }
  try { await downloadPoster(build()); } catch (e) { console.error(e); S.error = `Couldn't make the image: ${e.message}`; render(); }
  finally { if (el) { el.disabled = false; el.innerHTML = label; } }
}

// ---- your team picker -----------------------------------------------------------------------

const loginId = () => (S.auth && S.auth.userId ? String(S.auth.userId) : '');
// The own-team gate for the viewed team: 'own', 'viewingAs' or 'loggedOut' (null before the first sync).
const teamState = (auth = S.auth) => (S.raw && S.raw.me ? ownTeam({ rosters: S.raw.rosters, rosterId: S.raw.me.rosterId }, auth) : null);
const viewingAs = () => teamState() === 'viewingAs';

function viewPicker({ welcome = false } = {}) {
  const P2 = S.pick;
  const me = loginId();
  // Logged in and nothing loaded yet: list the login's leagues straight away.
  if (!P2.auto && !P2.leagues && !P2.busy) { P2.auto = true; if (me) setTimeout(() => actions.pickFind(null, ''), 0); }
  const curLeague = S.raw ? String(S.raw.league.league_id) : String(S.cfg.leagueId || '');
  const curTeam = S.raw ? String(S.raw.me.userId) : String(S.cfg.teamUserId || me || '');
  const status = me
    ? `Logged in to Sleeper as <b style="color:var(--text)">${esc(S.auth.displayName || me)}</b>. Your own team loads automatically; pick another team only to look around.`
    : 'Not logged in to Sleeper in this browser. Open <b style="color:var(--text)">sleeper.com</b> and log in and your team loads by itself, or find your league below.';
  return `<div class="card" ${welcome ? 'style="max-width:640px;margin-top:14px"' : ''}><h3>Your team</h3>
    <p class="muted">${status}</p>
    ${viewingAs() ? `<div class="notice info">Viewing <b>${esc(tname(S.raw.me.rosterId))}</b>, which isn't your Sleeper login. Offers, alerts and waiver claims are off while you do.</div>` : ''}
    <div class="row" style="gap:8px;align-items:end">
      <label class="f" style="flex:1">Sleeper username or league ID${me ? ' (leave blank for your own leagues)' : ''}<input type="text" id="pick-q" value="${esc(P2.q)}" placeholder="${me ? 'Blank = my leagues' : 'e.g. your Sleeper username'}"></label>
      <button class="btn" data-action="pickFind">${P2.busy ? 'Looking…' : 'Find leagues'}</button>
    </div>
    ${P2.error ? `<div class="notice" style="margin-top:10px">${esc(P2.error)}</div>` : ''}
    ${P2.leagues ? `<div class="grid" style="gap:12px;margin-top:12px">
      <label class="f">League<select data-pick="league"><option value="">Choose a league…</option>${P2.leagues.map((l) => `<option value="${esc(l.id)}" ${String(P2.leagueId || curLeague) === l.id ? 'selected' : ''}>${esc(l.name)}${l.type === 2 ? ' (dynasty)' : ''}${l.size ? ` · ${l.size} teams` : ''}</option>`).join('')}</select></label>
      ${P2.teams ? `<label class="f">Team<select data-pick="team">${P2.teams.map((t) => `<option value="${esc(t.userId)}" ${String(P2.teamUserId || curTeam) === t.userId ? 'selected' : ''}>${esc(t.name)}${t.user && t.user !== t.name ? ` (${esc(t.user)})` : ''}${t.userId === me ? ' · you, logged in' : ''}</option>`).join('')}</select></label>` : ''}
    </div>` : ''}
    <div class="row" style="margin-top:14px">
      ${P2.teams ? `<button class="btn primary" data-action="pickSave">${icon('sync')}Load this team</button>` : ''}
      ${me && (S.cfg.teamUserId && S.cfg.teamUserId !== me) ? '<button class="btn" data-action="pickReset">Back to my own team</button>' : ''}
    </div>
  </div>`;
}

// ---- settings ---------------------------------------------------------------------------------

function viewSettings() {
  const st = (S.book && S.book.status) || {};
  const src = (label, s, extra = '') => `<tr><td>${label}</td><td>${s ? (s.ok ? `<span class="pill good">OK</span>${s.stale ? ' <span class="muted small">cached</span>' : ''}` : '<span class="pill sell">Unavailable</span>') : '—'}</td><td class="small muted">${s && s.at ? esc(when(s.at)) : ''}${s && s.error ? ` ${esc(s.error)}` : ''}${extra}</td></tr>`;
  const leagues = (S.raw && S.raw.leagues) || [];
  const auth = S.auth;
  return `${viewPicker()}<div class="two" style="align-items:start;margin-top:14px">
    <div class="card"><h3>Settings</h3>
      <p class="muted">${auth && auth.token ? `Sleeper login: <b style="color:var(--text)">${esc(auth.displayName || auth.userId)}</b>${auth.exp ? `, good until ${esc(new Date(auth.exp).toLocaleDateString())}` : ''}.` : 'No Sleeper login yet. Open sleeper.com in this browser while logged in; the extension picks it up. Without it you still get everything except offers, the trade block and waiver claims.'}</p>
      <div class="grid" style="gap:12px">
        <label class="f">Sleeper username (only needed without a login)<input type="text" id="cfg-username" value="${esc(S.cfg.username || '')}"></label>
        <label class="f">How your league sets rookie draft order<select id="cfg-draftorder">${[['standings', 'Standings: worst projected finish picks first'], ['maxpf', 'Max PF for non-playoff teams, then playoff teams by finish'], ['maxpf_all', 'Max PF for every team']].map(([v, l]) => `<option value="${v}" ${(S.cfg.draftOrder || 'standings') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">Your strategy for the trade finder<select id="cfg-strategy">${[['auto', 'Automatic (from your posture)'], ['contend', 'Contend: buy starters'], ['rebuild', 'Rebuild: buy youth and picks']].map(([v, l]) => `<option value="${v}" ${S.cfg.strategy === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="row" style="margin-top:14px"><button class="btn primary" data-action="saveSettings">Save and sync</button><button class="btn" data-action="fullSync">Refresh all values</button><button class="btn" data-action="deepScan">Rescan other leagues</button><button class="btn" data-action="watchNow">Check for offers now</button><button class="btn" data-action="lockGate">Lock dashboard</button></div>
      <p class="muted small">While Chrome is open the extension checks for new offers, league trades and trade-block listings every 5 minutes and sends a Chrome notification for each.</p>
    </div>
    <div class="card"><h3>Data sources</h3><table class="t"><tbody>
      ${src('KeepTradeCut values', st.ktc, st.ktc && st.ktc.n ? `, ${st.ktc.n} players and picks` : '')}
      ${src('FantasyCalc values', st.fc)}
      ${st.dp ? src('DynastyProcess values (fallback)', st.dp) : ''}
      ${src('Values at the time of each trade', st.hist, st.hist && st.hist.ok ? `, ${st.hist.weeks} weekly snapshots` : '')}
      ${src('Weekly values since the rookie draft', st.vot, st.vot && st.vot.ok ? `, ${st.vot.weeks} weekly snapshots` : '')}
      ${src('Season stats (aging model)', st.prod)}
      ${src('Weekly stats (roster form)', st.weekly, st.weekly && st.weekly.ok ? `, ${st.weekly.weeks} weeks${st.weekly.snaps ? ', with snap counts' : ', no snap counts'}` : '')}
      ${src('Past rookie classes and hit rates', st.draft, st.draft && st.draft.ok ? `, ${st.draft.classes} classes` : '')}
      ${src('Next year\'s prospect rankings', st.prospects, st.prospects && st.prospects.ok ? `, ${st.prospects.n} prospects` : '. Paste your own board on the Rookie draft page.')}
      ${src('FantasyPros weekly ranks', st.fp, st.fp && st.fp.ok ? `, ${esc(st.fp.source)}` : '')}
      ${src('Sleeper projections', st.proj)}
      ${src('Player ID crosswalk', st.crosswalk)}
      <tr><td>Offers (Sleeper login)</td><td>${S.raw && S.raw.gql && S.raw.gql.ok ? '<span class="pill good">OK</span>' : '<span class="pill sell">Unavailable</span>'}</td><td class="small muted">${esc((S.raw && S.raw.gql && S.raw.gql.error) || '')}</td></tr>
      <tr><td>Trade block</td><td>${S.raw && S.raw.block && S.raw.block.ok ? '<span class="pill good">OK</span>' : '<span class="pill sell">Unavailable</span>'}</td><td class="small muted">${esc((S.raw && S.raw.block && S.raw.block.error) || '')}</td></tr>
    </tbody></table>
    <p class="muted small">Main value source: ${esc(S.book ? S.book.primary : '—')}${S.book && S.book.fmt ? ` · ${S.book.fmt.superflex ? 'Superflex' : '1QB'}, ${['no TE premium', 'TE+ (KTC values for +0.5 per TE catch)', 'TE++ (+1.0)', 'TE+++ (+1.5)'][S.book.fmt.ktcTier || 0]}` : ''}. If KeepTradeCut is unavailable, open keeptradecut.com once in this Chrome and sync again; FantasyCalc fills in meanwhile.</p></div>
  </div>`;
}


// ---- player card: market and stats ------------------------------------------------------------

// How widely a player is rostered across the leagues the league-mate scan has
// seen (dynasty leagues counted separately). Built once per load.
function ownership(sid) {
  if (!S.ownIdx) {
    const fresh = Object.values(S.own || {}).filter((l) => l && Date.now() - (l.at || 0) < 7 * 86400e3);
    const idx = { all: fresh.length, dyn: fresh.filter((l) => l.type === 2).length, cnt: {}, dcnt: {} };
    for (const l of fresh) for (const id of new Set(l.ids || [])) { idx.cnt[id] = (idx.cnt[id] || 0) + 1; if (l.type === 2) idx.dcnt[id] = (idx.dcnt[id] || 0) + 1; }
    S.ownIdx = idx;
  }
  const x = S.ownIdx;
  return { all: x.all, dyn: x.dyn, n: x.cnt[sid] || 0, nd: x.dcnt[sid] || 0 };
}

// Sleeper-wide adds and drops (trending), 24 hours and 7 days, fetched when a
// card first opens and kept for 30 minutes.
async function loadTrend() {
  if (S.trend && Date.now() - S.trend.at < 30 * 60e3) return;
  if (S.trendBusy) return;
  S.trendBusy = true;
  const get = async (kind, hrs) => {
    const r = await fetch(`https://api.sleeper.app/v1/players/nfl/trending/${kind}?lookback_hours=${hrs}&limit=500`);
    if (!r.ok) throw new Error(`Sleeper ${r.status}`);
    return Object.fromEntries(((await r.json()) || []).map((x) => [x.player_id, x.count]));
  };
  try {
    const [a24, d24, a7, d7] = await Promise.all([get('add', 24), get('drop', 24), get('add', 168), get('drop', 168)]);
    S.trend = { at: Date.now(), a24, d24, a7, d7 };
  } catch (e) {
    S.trend = { at: Date.now(), error: e.message, a24: {}, d24: {}, a7: {}, d7: {} };
  }
  S.trendBusy = false;
  if (S.ui.drawer) renderDrawer();
}

// This league's adds, drops and waiver claims involving the player.
function leagueMoves(sid) {
  const out = [];
  for (const t of (S.raw && S.raw.txns) || []) {
    if (t.status !== 'complete' || t.type === 'trade') continue;
    const add = t.adds && t.adds[sid] != null ? t.adds[sid] : null;
    const drop = t.drops && t.drops[sid] != null ? t.drops[sid] : null;
    if (add == null && drop == null) continue;
    const bid = t.settings && t.settings.waiver_bid;
    out.push({ at: t.created, add, drop, how: t.type === 'waiver' ? `waiver${bid != null ? ` ($${bid})` : ''}` : 'free agent' });
  }
  return out.sort((a, b) => b.at - a.at);
}

function marketCard(sid) {
  const o = ownership(sid);
  const T = S.trend;
  const fmtN = (n) => (n ? n.toLocaleString() : '0');
  const ownTile = (label, n, of) => `<div><span>${label}</span><b>${of ? pct(n / of) : '—'}</b><span class="faint small">${of ? `${n} of ${of} leagues` : 'Settings → Rescan other leagues'}</span></div>`;
  const moves = leagueMoves(sid).slice(0, 6);
  return `<div class="card" style="margin-top:14px"><h3>Market</h3>
    <div class="facts">${ownTile('Rostered, dynasty', o.nd, o.dyn)}${ownTile('Rostered, all', o.n, o.all)}</div>
    <p class="faint small" style="margin:6px 0 10px">Across the Sleeper leagues your league-mates play in this season (refreshed daily).</p>
    ${!T ? '<p class="muted small">Loading Sleeper adds and drops…</p>' : T.error ? `<p class="muted small">Sleeper adds and drops unavailable: ${esc(T.error)}</p>` : `
      <table class="t"><thead><tr><th>All of Sleeper</th><th class="num">Adds</th><th class="num">Drops</th><th class="num">Net</th></tr></thead><tbody>
        ${[['Last 24 hours', T.a24, T.d24], ['Last 7 days', T.a7, T.d7]].map(([l, a, d]) => { const net = (a[sid] || 0) - (d[sid] || 0); return `<tr><td>${l}</td><td class="num up">${fmtN(a[sid])}</td><td class="num down">${fmtN(d[sid])}</td><td class="num ${net > 0 ? 'up' : net < 0 ? 'down' : ''}"><b>${net > 0 ? '+' : ''}${net.toLocaleString()}</b></td></tr>`; }).join('')}
      </tbody></table><p class="faint small" style="margin:6px 0 0">Sleeper only reports its most-added and most-dropped players; 0 means he isn't among them.</p>`}
    ${moves.length ? `<h4 style="margin:14px 0 6px;font-size:13px">In this league</h4>${moves.map((x) => `<div class="row small" style="justify-content:space-between;padding:3px 0"><span>${x.add != null ? `<span class="up">Added</span> by ${esc(tname(x.add))}` : `<span class="down">Dropped</span> by ${esc(tname(x.drop))}`}${x.add != null && x.drop != null && x.add !== x.drop ? `, dropped by ${esc(tname(x.drop))}` : ''} <span class="faint">· ${esc(x.how)}</span></span><span class="faint">${esc(dateStr(x.at))}</span></div>`).join('')}` : ''}
  </div>`;
}

function statsCard(sid, pos) {
  const W = S.weekly;
  if (!W || !W.weeks) return '';
  const wk = Object.keys(W.weeks).map(Number).sort((a, b) => a - b);
  const rows = wk.map((w) => ({ w, r: W.weeks[w][sid] || null }));
  const played = rows.filter((x) => x.r);
  if (!played.length) return `<div class="card" style="margin-top:14px"><h3>${W.season} season</h3><p class="muted">No games played yet this season.</p></div>`;
  const sum = (i) => played.reduce((s2, x) => s2 + (Number(x.r[i]) || 0), 0);
  const has = (i) => played.some((x) => x.r[i] != null);
  const g = played.length, pts = sum(0);
  const snapPct = has(1) && has(2) ? sum(1) / Math.max(1, sum(2)) : null;
  const line = [];
  if (pos === 'QB') {
    if (has(15)) line.push(['Comp/Att', `${sum(15)}/${sum(6)}`]);
    if (has(9)) line.push(['Pass yds', Math.round(sum(9)).toLocaleString()]);
    if (has(10)) line.push(['Pass TD', sum(10)]);
    if (has(14)) line.push(['INT', sum(14)]);
    line.push(['Rush yds', Math.round(sum(11))]);
  } else {
    if (pos !== 'RB' || has(3)) line.push(['Targets', sum(3)], ['Catches', sum(4)]);
    if (has(12)) line.push(['Rec yds', Math.round(sum(12))]);
    if (pos === 'RB' || sum(5) > 3) line.push(['Carries', sum(5)]);
    if (has(11) && (pos === 'RB' || sum(11) > 20)) line.push(['Rush yds', Math.round(sum(11))]);
  }
  if (has(13)) line.push(['TD', sum(13)]);
  if (snapPct != null) line.push(['Snap share', pct(snapPct)]);
  const max = Math.max(1, ...played.map((x) => x.r[0]));
  const avg = pts / g;
  const bars = rows.map(({ w, r }) => `<div class="wkbar" title="Week ${w}: ${r ? `${r[0]} pts` : 'did not play'}"><i style="height:${r ? Math.max(3, (r[0] / max) * 100) : 0}%" class="${!r ? '' : r[0] >= avg ? 'hi' : 'lo'}"></i><span>${w}</span></div>`).join('');
  return `<div class="card" style="margin-top:14px"><h3>${W.season} season</h3>
    <div class="facts"><div><span>Games</span><b>${g}</b></div><div><span>Points</span><b>${pts.toFixed(1)}</b></div><div><span>Per game</span><b>${avg.toFixed(1)}</b></div></div>
    <div class="statline">${line.map(([l, v]) => `<div><span>${l}</span><b>${v}</b></div>`).join('')}</div>
    <div class="wkbars" role="img" aria-label="League-scored points by week">${bars}</div>
    <p class="faint small" style="margin:4px 0 0">Points in this league's scoring, by week. Gold: at or above his average.</p></div>`;
}

// ---- player drawer ---------------------------------------------------------------------------

function renderDrawer() {
  const el = $('#drawer');
  const sid = S.ui.drawer;
  if (!sid || !S.model) { el.innerHTML = ''; return; }
  const m = S.model;
  const p = P(sid);
  const v = pval(sid);
  const owner = m.teams.find((t) => (t.roster.players || []).includes(sid));
  const pj = m.aging && m.aging.players[sid];
  const fp = S.aux.fpBySid && S.aux.fpBySid[sid];
  const trades = m.leagueTrades.concat(m.histTrades).filter((nt) => nt.rids.some((r) => nt.sides[r].inP.includes(sid)));
  loadTrend();
  el.innerHTML = `<div class="drawer-bg" data-action="closeDrawer"></div><aside class="drawer" role="dialog" aria-label="${esc(p.name)}">
    <button class="iconbtn close" data-action="closeDrawer" aria-label="Close">${icon('x')}</button>
    <div style="text-align:center">${headshot(sid, 'lg ring')}<h2 style="margin:10px 0 2px;font-size:19px">${esc(p.name)}</h2><div class="muted">${esc(p.pos)} · ${esc(p.team || 'FA')}${p.age ? ` · age ${p.age.toFixed(1)}` : ''}${p.inj ? ` · <span class="down">${esc(p.inj)}</span>` : ''}</div>
      <div style="margin-top:8px">${owner ? `${teamAvatar(owner)} ${tlink(owner.rid)}` : '<span class="pill good">Free agent</span>'}</div></div>
    <div class="facts" style="margin-top:16px"><div><span>Dynasty value</span><b>${k(v.v)}</b></div><div><span>KTC</span><b>${k(v.ktc)}</b></div><div><span>FantasyCalc</span><b>${k(v.fc)}</b></div><div><span>Redraft</span><b>${k(v.redraft)}</b></div></div>
    ${fp ? `<p class="muted" style="margin-top:12px">This week: ${esc(fp.posRank || '')} ${fp.grade ? grade(fp.grade) : ''} ${esc(fp.opp || '')}</p>` : ''}
    ${statsCard(sid, p.pos)}
    ${marketCard(sid)}
    ${pj ? `<div class="card" style="margin-top:14px"><h3>Projection</h3><p class="lede">${esc(pj.tier)} ${esc(pj.pos)} (${ordinal(pj.posRank)} by points per game), ${esc(pj.phase)}${pj.primeYears ? `, ${pj.primeYears} prime year${pj.primeYears === 1 ? '' : 's'} left` : ''}.</p>
      ${pj.seasons.map((s) => `<div class="meter" style="margin-bottom:8px"><div class="row"><span>${s.season}${s.age ? ` (age ${Math.floor(s.age)})` : ''}</span><span>${s.ppg.toFixed(1)} pts/g</span></div>${bar(s.ppg / Math.max(...pj.seasons.map((x) => x.ppg), 1), pj.phase === 'declining' ? 'orange' : 'green')}</div>`).join('')}
      <p class="faint small">Based on ${esc(pj.parts.map((x) => `${x.src}${x.gp ? ` (${x.gp} g)` : ''}`).join(', '))}.</p></div>` : ''}
    <div class="row" style="margin-top:12px">${owner && owner.isMe ? `<button class="btn primary" data-action="shop" data-sid="${esc(sid)}">Find trades for him</button>` : ''}${!owner ? `<button class="btn primary" data-action="addTarget" data-sid="${esc(sid)}">Add as waiver target</button>` : !owner.isMe ? `<button class="btn primary" data-action="toLab" data-rid="${owner.rid}" data-sid="${esc(sid)}">Open in trade lab</button>` : ''}</div>
    ${trades.length ? `<div class="card" style="margin-top:14px"><h3>Traded in this league</h3>${trades.map((nt) => { const r = nt.rids.find((x) => nt.sides[x].inP.includes(sid)); return `<div class="asset"><div class="nm"><b>${esc(dateStr(nt.created))}${nt.season !== m.league.season ? ' ' + nt.season : ''}</b><span class="meta">to ${esc(tname(r))}</span></div>${nt.deal && nt.deal[r] ? grade(nt.deal[r].grade) : ''}</div>`; }).join('')}</div>` : ''}
  </aside>`;
}

// ---- search ------------------------------------------------------------------------------------

function runSearch(q) {
  S.ui.q = q;
  const n = normName(q);
  if (n.length < 2 || !S.model) { S.ui.results = []; renderTop(); focusSearch(); return; }
  const owners = {};
  for (const t of S.model.teams) for (const sid of t.roster.players || []) owners[sid] = t.name;
  const teams = S.model.teams.filter((t) => normName(`${t.name} ${t.teamName}`).includes(n)).map((t) => ({ kind: 'team', rid: t.rid, name: t.name }));
  const players = [];
  for (const [sid, d] of Object.entries(S.dict)) {
    if (d[6] === 0 || !['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(d[1])) continue;
    if (!normName(d[0]).includes(n)) continue;
    players.push({ kind: 'player', sid, name: d[0], pos: d[1], team: d[2], owner: owners[sid] || 'Free agent', v: pval(sid).v });
  }
  players.sort((a, b) => (normName(b.name).startsWith(n) ? 1 : 0) - (normName(a.name).startsWith(n) ? 1 : 0) || b.v - a.v);
  S.ui.results = [...teams, ...players.slice(0, 10)];
  renderTop();
  focusSearch();
}
function focusSearch() {
  const el = $('#q');
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

// ---- actions -----------------------------------------------------------------------------------

function move(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return true;
}

async function addWaiverTarget(sid) {
  const d = S.dict[sid];
  if (!d) return;
  await savePlan((p) => {
    if (p.targets.some((t) => t.id === sid)) return false;
    p.targets.push({ name: d[0], pos: d[1], team: d[2], id: sid, src: 'dossier' });
  });
  S.ui.wv.msg = `${d[0]} added to your waiver targets.`;
}

async function pickLeague(leagueId, preferUser = null) {
  const P2 = S.pick;
  P2.leagueId = String(leagueId || '');
  P2.teams = null; P2.teamUserId = '';
  if (!P2.leagueId) return;
  P2.teams = await sync.leagueTeams(P2.leagueId);
  const ids = P2.teams.map((t) => t.userId);
  const want = [S.raw && String(S.raw.league.league_id) === P2.leagueId ? String(S.raw.me.userId) : null, loginId(), preferUser && String(preferUser), S.cfg.teamUserId].find((x) => x && ids.includes(x));
  P2.teamUserId = want || ids[0] || '';
}

const actions = {
  async outMark(el) {
    const y = el.dataset.y, sid = el.dataset.sid, v = el.dataset.v;
    const all = { ...(S.cfg.outList || {}) };
    all[y] = { ...(all[y] || {}), [sid]: v };
    S.cfg = await sync.saveSettings({ outList: all });
    render();
  },
  async outReset(el) {
    const all = { ...(S.cfg.outList || {}) };
    delete all[el.dataset.y];
    S.cfg = await sync.saveSettings({ outList: all });
    render();
  },
  async pickLock(el) {
    const y = Number(el.dataset.season);
    const locked = (S.model.lockedSeasons || []).includes(y);
    S.cfg = await sync.saveSettings({ pickLocks: { ...(S.cfg.pickLocks || {}), [y]: !locked } });
    await rebuild();
    render();
  },
  treeZoom(el) { const z = S.ui.tree.zoom === 'fit' ? (S.ui.tree.fitted || 1) : S.ui.tree.zoom; S.ui.tree.zoom = el.dataset.z === 'in' ? Math.min(1.6, z + 0.1) : el.dataset.z === 'out' ? Math.max(0.2, z - 0.1) : 'fit'; render(); },
  treePdf(el) { printTreeReport(el.dataset.kind || 'lopsided'); },
  treeJpg(el) { exportReportJpgs(el.dataset.kind || 'lopsided'); },
  treeView(el, e) { S.ui.tree.view = el.dataset.v; if (el.tagName !== 'A') render(); },
  treeFull() { const c = document.querySelector('.tcanvas'); if (c && c.requestFullscreen) c.requestFullscreen(); },
  treeOrient(el) { const f = S.ui.tree; f.orient = el.dataset.v; f.autoOrient = null; f.tried = null; f.settled = false; f.stacked = false; f.zoom = 'fit'; render(); },
  treeOpen(el) { const f = S.ui.tree; delete f.closed[el.dataset.path]; f.open[el.dataset.path] = true; render(); },
  treeClose(el) { const f = S.ui.tree; f.closed[el.dataset.path] = true; delete f.open[el.dataset.path]; render(); },
  treeSide(el) { S.ui.tree.side = el.dataset.side; render(); },
  dealTab(el) { S.ui.dealTab[el.dataset.rid] = el.dataset.tab; render(); },
  cmpPos(el) { S.ui.cmp.pos = el.dataset.pos; render(); },
  cmpReload() { const id = S.ui.cmp.lid; if (id) delete CMP[id]; render(); },
  async cmpAdd() {
    const f = S.ui.cmp;
    const raw = (($('#cmp-add') || {}).value || '').trim();
    const id = (raw.match(/\d{10,}/) || [])[0];
    f.addId = raw; f.addErr = '';
    if (!id) { f.addErr = 'Paste a Sleeper league ID (the long number), or the league\'s address.'; return render(); }
    if (S.raw && String(S.raw.league.league_id) === id) { f.addErr = "That's this league."; return render(); }
    f.adding = true; render();
    try {
      const d = await fetchLeague(id);
      if (!d.league || !d.league.league_id) throw new Error('Sleeper has no league with that ID.');
      CMP[id] = { data: d };
      const row = { id, name: (d.league.name || 'League').trim(), size: d.league.total_rosters };
      const list = (S.cfg.cmpExtra || []).filter((l) => String(l.id) !== id);
      S.cfg = await sync.saveSettings({ cmpExtra: [...list, row] });
      f.uid = 'added'; f.lid = id; f.addId = '';
    } catch (e) {
      f.addErr = `Couldn't add it: ${e.message}`;
    }
    f.adding = false;
    render();
  },
  async cmpRemove() {
    const f = S.ui.cmp;
    S.cfg = await sync.saveSettings({ cmpExtra: (S.cfg.cmpExtra || []).filter((l) => String(l.id) !== String(f.lid)) });
    f.uid = null; f.lid = null;
    render();
  },
  posSort(el) { S.ui.posr.sort = el.dataset.k; render(); },
  posFocus(el) { S.ui.posr.focus = el.dataset.pos; render(); },
  sync: () => runSync(),
  fullSync: () => runSync({ force: true }),
  deepScan: () => runSync({ deep: true }),
  toggleSide() { $('#app').classList.toggle('collapsed'); },
  toggleNav(el, e) { e.preventDefault(); e.stopPropagation(); S.ui.open[el.dataset.group] = !S.ui.open[el.dataset.group]; renderSide(); },
  toggleFeed() { S.ui.feedOpen = !S.ui.feedOpen; renderTop(); },
  closeSearch() { S.ui.q = ''; S.ui.results = []; },
  player(el) { S.ui.drawer = el.dataset.sid; S.ui.results = []; S.ui.q = ''; renderTop(); renderDrawer(); },
  closeDrawer() { S.ui.drawer = null; renderDrawer(); },
  lopSort(el) { const key = el.dataset.key; const st = S.ui.lop; if (el.dataset.dir) { st.key = key; st.dir = Number(el.dataset.dir); } else if (st.key === key) st.dir = -st.dir; else { st.key = key; st.dir = -1; } render(); },
  brSort(el) { const key = el.dataset.key; const st = S.ui.brs; if (st.key === key) st.dir = -st.dir; else { st.key = key; st.dir = -1; } render(); },
  sumSort(el) { const key = el.dataset.key; const st = S.ui.sum; if (st.key === key) st.dir = -st.dir; else { st.key = key; st.dir = key === 'name' ? 1 : -1; } render(); },
  boardEdit() { S.ui.boardEdit = !S.ui.boardEdit; render(); },
  async boardSave() {
    const players = (await import('../lib/draft.js')).parseBoard(($('#board-text') || {}).value || '');
    if (!players.length) { S.error = 'No players found. Each line needs a name and a position (QB, RB, WR or TE).'; render(); return; }
    S.draftBoard = { source: 'Your board', at: Date.now(), players };
    S.ui.boardEdit = false;
    await chrome.storage.local.set({ 'draft:board': S.draftBoard });
    S.error = null;
    render();
  },
  async boardClear() { S.draftBoard = null; await chrome.storage.local.remove('draft:board'); render(); },
  async star(el) { const key = normName(el.dataset.name); if (S.draftStars[key]) delete S.draftStars[key]; else S.draftStars[key] = Date.now(); await chrome.storage.local.set({ 'draft:stars': S.draftStars }); render(); },
  async refreshNow() {
    if (S.syncing || !S.raw) return;
    S.syncing = 'Refreshing rosters, picks and offers';
    renderProgress();
    try {
      const lid = S.raw.league.league_id;
      // Offers belong to the login, so only the own team fetches them; viewing as
      // someone else keeps the offers data and its "not your team" error.
      const own = teamState() === 'own';
      const [trades, lp] = await Promise.all([own ? gqlTrades(lid, 80).catch(() => null) : null, gqlLeaguePlayers(lid).catch(() => null)]);
      S.raw = await quickRefresh(S.raw, trades, lp ? lp.filter((p) => p.settings && p.settings.otb) : null);
      await rebuild();
    } catch (e) {
      console.error(e);
      S.error = e.message;
    } finally {
      S.syncing = null;
      renderProgress();
      render();
    }
  },
  cycleTheme() { applyTheme(THEMES[(THEMES.indexOf(curTheme()) + 1) % THEMES.length]); renderTop(); },
  async toggleNeutral() { S.ui.neutral = !S.ui.neutral; document.body.classList.toggle('neutral', S.ui.neutral); await chrome.storage.local.set({ 'ui:neutral': S.ui.neutral }); render(); },
  async shop(el) { S.cfg = await sync.saveSettings({ shop: el.dataset.sid }); S.ui.drawer = null; await rebuild(); location.hash = '#trades/finder'; render(); },
  incFor(el) { S.ui.inc.rid = el.dataset.rid || 'all'; },
  incOpen(el) { S.ui.inc.open = S.ui.inc.open === el.dataset.id ? null : el.dataset.id; render(); },
  incRange(el) {
    const d = el.dataset.days;
    const iso = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
    S.ui.inc.to = '';
    S.ui.inc.from = d === 'all' ? '' : iso(Date.now() - Number(d) * 86400e3);
    render();
  },
  async blockAdd() {
    const sid = ($('#block-add') || {}).value;
    if (!sid) return;
    S.blockExtra = [...new Set([...(S.blockExtra || []), sid])];
    await chrome.storage.local.set({ blockExtra: S.blockExtra });
    render();
  },
  async blockRemove(el) { S.blockExtra = (S.blockExtra || []).filter((x) => x !== el.dataset.sid); await chrome.storage.local.set({ blockExtra: S.blockExtra }); render(); },
  async fcTrades(el) {
    el.disabled = true;
    el.textContent = 'Loading…';
    const sid = el.dataset.sid;
    const v = pval(sid);
    try {
      fcCache[sid] = await fcTrades(v.fcId, { qbs: S.book.fmt && S.book.fmt.superflex ? 2 : 1, teams: S.model.teams.length });
    } catch (e) {
      fcCache[sid] = { error: e.message };
    }
    render();
  },
  weekLab(el) {
    S.lab.a = S.model.me; S.lab.b = Number(el.dataset.rid);
    S.lab.picked = new Set([el.dataset.give, ...el.dataset.get.split('|')]);
    location.hash = '#trades/lab';
    render();
  },
  seasonSort(el) { const key = el.dataset.key; const st = S.ui.season; if (st.key === key) st.dir = -st.dir; else { st.key = key; st.dir = ['name', 'standing', 'avgSeed', 'pa', 'sos'].includes(key) ? 1 : -1; } render(); },
  toggleHistory() { S.ui.history = !S.ui.history; render(); },
  labClear() { S.lab.picked.clear(); render(); },
  labRemove(el) { S.lab.picked.delete(el.dataset.key); render(); },
  labAdd(el) { S.lab.picked.add(el.dataset.key); render(); },
  labSwap() { [S.lab.a, S.lab.b] = [S.lab.b, S.lab.a]; render(); },
  async labCopy(el) {
    const m = S.model;
    const A = S.lab.a, B = S.lab.b;
    const sentA = labAssets(A).filter((a) => S.lab.picked.has(a.key));
    const sentB = labAssets(B).filter((a) => S.lab.picked.has(a.key));
    const line = (a) => `${a.name}${a.kind === 'pick' ? '' : ` (${a.pos})`}`;
    let txt = `${tname(A)} gets: ${sentB.map(line).join(', ') || 'nothing'}\n${tname(B)} gets: ${sentA.map(line).join(', ') || 'nothing'}`;
    if (sentA.length && sentB.length) {
      const { vd } = labSummary(m, A, B, sentA, sentB);
      txt += `\nKTC: ${tname(A)} ${Math.round(vd.total1)} vs ${tname(B)} ${Math.round(vd.total2)}${vd.fair ? ' (fair)' : ''}`;
    }
    try { await navigator.clipboard.writeText(txt); el.textContent = 'Copied'; } catch { el.textContent = 'Copy failed'; }
  },
  toLab(el) {
    S.lab.a = S.model.me; S.lab.b = Number(el.dataset.rid);
    S.lab.picked = new Set([`p:${el.dataset.sid}`]);
    S.ui.drawer = null;
    location.hash = '#trades/lab';
    render();
  },
  async briefDone(el) {
    const key = el.dataset.key;
    if (S.briefDone[key]) delete S.briefDone[key]; else S.briefDone[key] = Date.now();
    for (const [kk, ts] of Object.entries(S.briefDone)) if (Date.now() - ts > 7 * 86400e3) delete S.briefDone[kk];
    await chrome.storage.local.set({ briefDone: S.briefDone });
    render();
  },
  async noteTag(el) {
    const u = el.dataset.uid;
    const n = S.notes[u] || { text: '', tags: [] };
    const text = ($('#note-text') || {}).value ?? n.text;
    const tags = new Set(n.tags || []);
    if (tags.has(el.dataset.tag)) tags.delete(el.dataset.tag); else tags.add(el.dataset.tag);
    S.notes[u] = { ...n, text, tags: [...tags], at: Date.now(), name: tname(S.model.teams.find((t) => t.userId === u)?.rid) };
    await chrome.storage.local.set({ notes: S.notes });
    await rebuild();
    render();
  },
  async saveNote(el) {
    const u = el.dataset.uid;
    const n = S.notes[u] || { text: '', tags: [] };
    S.notes[u] = { ...n, text: ($('#note-text') || {}).value || '', at: Date.now(), name: tname(S.model.teams.find((t) => t.userId === u)?.rid) };
    await chrome.storage.local.set({ notes: S.notes });
    await rebuild();
    render();
  },
  async watchNow(el) {
    el.disabled = true;
    const r = await chrome.runtime.sendMessage({ type: 'watchNow' });
    const res = await chrome.storage.local.get(['alerts:feed', 'alerts:lastCheck']);
    S.feed = res['alerts:feed'] || [];
    S.lastCheck = res['alerts:lastCheck'] || null;
    el.disabled = false;
    el.textContent = r && r.ok && r.result && !r.result.error && !r.result.skipped ? 'Checked' : `Couldn't check: ${(r && r.result && (r.result.error || r.result.skipped)) || (r && r.error) || 'unknown'}`;
  },
  async pickFind(el, q) {
    const P2 = S.pick;
    P2.q = typeof q === 'string' ? q : (($('#pick-q') || {}).value || '').trim();
    P2.busy = true; P2.error = ''; P2.leagues = null; P2.teams = null; P2.leagueId = ''; P2.teamUserId = '';
    render();
    try {
      const r = await sync.findLeagues(P2.q);
      P2.leagues = r.leagues;
      const cur = String((S.raw && S.raw.league.league_id) || S.cfg.leagueId || '');
      const pre = r.leagues.find((l) => l.id === cur) || (r.leagues.length === 1 ? r.leagues[0] : r.leagues.find((l) => l.type === 2));
      if (pre) await pickLeague(pre.id, r.via === 'user' ? r.userId : null);
    } catch (e) {
      P2.error = e.message;
    } finally {
      P2.busy = false;
      render();
    }
  },
  async pickSave() {
    const P2 = S.pick;
    const leagueId = P2.leagueId || ($('[data-pick="league"]') || {}).value;
    const teamUserId = P2.teamUserId || ($('[data-pick="team"]') || {}).value;
    if (!leagueId || !teamUserId) { P2.error = 'Choose a league and a team first.'; render(); return; }
    S.cfg = await sync.saveSettings({ leagueId, teamUserId: teamUserId === loginId() ? '' : teamUserId });
    S.raw = null; S.model = null;
    location.hash = '#overview';
    await runSync();
  },
  async pickReset() {
    S.cfg = await sync.saveSettings({ teamUserId: '' });
    S.pick = { ...S.pick, teamUserId: '', teams: null, leagues: null, auto: false };
    S.raw = null; S.model = null;
    await runSync();
  },
  async lockGate() { await lock(); },
  votHi(el) { const v = S.ui.vot; v.sel ||= []; if (el.dataset.rid === '') v.sel = []; else { const r = Number(el.dataset.rid); v.sel = v.sel.includes(r) ? v.sel.filter((x) => x !== r) : [...v.sel, r]; } render(); },
  votSort(el) { S.ui.vot.sort = el.dataset.key; render(); },
  votPos(el) { const p = el.dataset.pos; S.ui.vot.pos[p] = !S.ui.vot.pos[p]; if (!Object.values(S.ui.vot.pos).some(Boolean)) S.ui.vot.pos[p] = true; render(); },
  votWhen(el) { S.ui.vot.when = el.dataset.when; render(); },
  votFrom(el) { S.ui.vot.from = el.dataset.from; render(); },
  votTrades(el) { S.ui.sumHi = Number(el.dataset.rid); location.hash = '#summary'; setTimeout(() => { const r = document.getElementById('sum-hl'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 120); },
  votDetail(el) { S.ui.vot.detail = { rid: Number(el.dataset.rid), kind: el.dataset.kind }; location.hash = `#ledger/${el.dataset.rid}`; setTimeout(() => { const d = document.getElementById(`ledger-${el.dataset.kind}`); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 150); },
  ledgerJump(el) { const d = document.getElementById(`ledger-${el.dataset.kind}`); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  votDetailClose() { S.ui.vot.detail = null; render(); },
  exportSummary(el) { return exportPoster(el, tradeSummaryPoster); },
  exportSeason(el) { return exportPoster(el, seasonPoster); },
  exportMock(el) { return exportMock(el); },
  exportVot(el) { return exportPoster(el, valueTimePoster); },
  exportLedger(el) { return exportLedger(el); },
  async ktcSource(el) { S.cfg = await sync.saveSettings({ ktcSource: el.dataset.src }); S.book = withKtcSource(S.bookRaw, el.dataset.src); await rebuild(); render(); },
  async saveSettings() {
    const username = ($('#cfg-username') || {}).value || '';
    const leagueId = S.cfg.leagueId || '';
    const strategy = ($('#cfg-strategy') || {}).value || 'auto';
    const draftOrder = ($('#cfg-draftorder') || {}).value || 'standings';
    const changed = S.raw && String(leagueId) !== String(S.raw.league.league_id);
    S.cfg = await sync.saveSettings({ username: username.trim(), leagueId, strategy, draftOrder });
    if (changed || !S.raw) await runSync();
    else { await rebuild(); render(); }
  },
  // waivers
  async addDrop(el) { await savePlan((p) => { if (!p.drops.includes(el.dataset.sid)) p.drops.push(el.dataset.sid); }); render(); },
  async addOpen() { await savePlan((p) => { p.drops.push('OPEN'); }); render(); },
  async removeDrop(el) { await savePlan((p) => { p.drops.splice(Number(el.dataset.i), 1); }); render(); },
  async moveDrop(el) { await savePlan((p) => move(p.drops, Number(el.dataset.i), Number(el.dataset.dir))); render(); },
  async removeTarget(el) { await savePlan((p) => { p.targets.splice(Number(el.dataset.i), 1); }); render(); },
  async moveTarget(el) { await savePlan((p) => move(p.targets, Number(el.dataset.i), Number(el.dataset.dir))); render(); },
  async addTarget(el) { await addWaiverTarget(el.dataset.sid); render(); },
  async loadTrending(el) {
    el.disabled = true;
    try {
      const r = await fetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=150');
      const arr = await r.json();
      S.trending = Object.fromEntries((arr || []).map((x) => [x.player_id, x.count]));
      S.ui.wv.sort = 'trend';
    } catch (e) {
      S.ui.wv.msg = `Couldn't load trending adds: ${e.message}`;
    }
    render();
  },
  async dryRun() {
    if (teamState() !== 'own') return render();
    const r = await chrome.runtime.sendMessage({ type: 'dryRun', uid: uid() });
    S.ui.dry = r && r.ok ? (r.actions.length ? r.actions : ['Nothing to do: no spots, or none of your targets are available.']) : [r ? r.error : 'No reply'];
    render();
  },
  async claimNow() {
    if (teamState() !== 'own') return render();
    if (!confirm('Make real adds and drops in Sleeper right now, using your list?')) return;
    const r = await chrome.runtime.sendMessage({ type: 'arm', uid: uid(), now: true });
    S.ui.wv.msg = r && r.ok ? `Claiming now.${r.warnings && r.warnings.length ? ' ' + r.warnings.join(' ') : ''}` : `Couldn't start: ${r ? r.error : 'no reply'}`;
    await refreshPlans();
  },
  async arm() {
    if (teamState() !== 'own') return render();
    const r = await chrome.runtime.sendMessage({ type: 'arm', uid: uid() });
    S.ui.wv.msg = r && r.ok ? `Armed. Checking starts ${when(r.run.windowStart)}. Leave Chrome open and the computer awake.${r.warnings && r.warnings.length ? ' ' + r.warnings.join(' ') : ''}` : `Couldn't arm: ${r ? r.error : 'no reply'}`;
    await refreshPlans();
  },
  async disarm() {
    await chrome.runtime.sendMessage({ type: 'disarm', uid: uid() });
    S.ui.wv.msg = 'Disarmed.';
    await refreshPlans();
  },
  async armToggle() {
    const p = plan();
    if (p.run) return actions.disarm();
    // The Waivers page explains why claims are off when this isn't the own team.
    if (teamState() !== 'own') { location.hash = '#waivers'; render(); return; }
    if (!p.drops.length || !p.targets.length) {
      S.ui.wv.msg = 'Pick at least one drop spot and one target, then arm.';
      location.hash = '#waivers';
      render();
      return;
    }
    await actions.arm();
  },
};

async function refreshPlans() {
  const r = await chrome.storage.local.get(['plans', 'log']);
  S.plans = r.plans || {};
  S.log = r.log || [];
  render();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'pick-q') { e.preventDefault(); actions.pickFind(); }
  if (e.key === 'Enter' && e.target.id === 'cmp-add') { e.preventDefault(); actions.cmpAdd(); }
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) {
    if (S.ui.feedOpen && !e.target.closest('.results')) { S.ui.feedOpen = false; renderTop(); }
    if (S.ui.results.length && !e.target.closest('.search')) { S.ui.results = []; renderTop(); }
    return;
  }
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.tagName === 'BUTTON' || el.dataset.action === 'player' || el.dataset.action === 'toggleNav') e.preventDefault();
  Promise.resolve(fn(el, e)).catch((err) => { console.error(err); S.error = err.message; render(); });
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'pick-q') { S.pick.q = e.target.value; return; }
  if (e.target.id === 'cmp-add') { S.ui.cmp.addId = e.target.value; return; }
  if (e.target.id === 'q') runSearch(e.target.value);
  if (e.target.dataset && e.target.dataset.labfilter) {
    const q = normName(e.target.value);
    document.querySelectorAll(`#lablist-${e.target.dataset.labfilter} .it`).forEach((row) => { row.style.display = !q || row.dataset.labname.includes(q) ? '' : 'none'; });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { S.ui.drawer = null; S.ui.results = []; renderDrawer(); renderTop(); }
  if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); focusSearch(); }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.switch === 'league') {
    if (el.value === '__pick') { location.hash = '#settings'; render(); return; }
    S.cfg = await sync.saveSettings({ leagueId: el.value, teamUserId: '' });
    S.raw = null; S.model = null;
    location.hash = '#overview';
    await runSync();
    return;
  }
  if (el.dataset.votteam) { S.ui.vot.detail = { ...S.ui.vot.detail, rid: Number(el.value) }; location.hash = `#ledger/${el.value}`; return; }
  if (el.dataset.pick === 'league') {
    try { await pickLeague(el.value); } catch (err) { S.pick.error = err.message; }
    render();
  } else if (el.dataset.pick === 'team') {
    S.pick.teamUserId = el.value;
  } else if (el.dataset.lab) {
    if (el.checked) S.lab.picked.add(el.dataset.lab); else S.lab.picked.delete(el.dataset.lab);
    render();
  } else if (el.dataset.labteam) {
    S.lab[el.dataset.labteam] = Number(el.value);
    S.lab.picked.clear();
    render();
  } else if (el.dataset.treef) {
    S.ui.tree[el.dataset.treef] = el.value;
    render();
  } else if (el.dataset.cmp) {
    S.ui.cmp[el.dataset.cmp] = el.value;
    if (el.dataset.cmp === 'uid') S.ui.cmp.lid = null;
    render();
  } else if (el.dataset.posr) {
    S.ui.posr[el.dataset.posr] = el.value;
    render();
  } else if (el.dataset.rising) {
    S.ui.rising[el.dataset.rising] = el.type === 'checkbox' ? el.checked : el.value;
    render();
  } else if (el.dataset.wk) {
    S.ui.wk[el.dataset.wk] = el.type === 'checkbox' ? el.checked : el.value;
    render();
  } else if (el.dataset.form) {
    S.ui.form[el.dataset.form] = el.value;
    render();
  } else if (el.dataset.inc) {
    S.ui.inc[el.dataset.inc] = el.value;
    render();
  } else if (el.dataset.stance !== undefined && el.matches('[data-stance]')) {
    S.cfg = await sync.saveSettings({ stanceSince: el.value || null });
    render();
  } else if (el.dataset.finder) {
    const key = el.dataset.finder;
    if (key === 'shop') S.cfg = await sync.saveSettings({ shop: el.value || null });
    if (key === 'strategy') S.cfg = await sync.saveSettings({ strategy: el.value });
    if (key === 'pickDiscount') S.cfg = await sync.saveSettings({ pickDiscount: Number(el.value) });
    if (key === 'youthBias') S.cfg = await sync.saveSettings({ youthBias: Number(el.value) });
    await rebuild();
    render();
  } else if (el.dataset.wv) {
    S.ui.wv[el.dataset.wv] = el.value;
    render();
  } else if (el.dataset.timing) {
    const f = el.dataset.timing;
    const v = f === 'startCheck' ? el.value : Math.max(1, Number(el.value) || DEFAULT_PLAN[f]);
    await savePlan((p) => { p[f] = v; });
  }
});

// Broken headshots fall back to initials.
document.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG') e.target.classList.add('broken'); }, true);

document.addEventListener('fullscreenchange', () => { if (route().page === 'tree') { const w = document.querySelector('.tcanvas.ftwrap'); if (w) w.style.height = document.fullscreenElement ? '100vh' : ''; if (S.ui.tree.zoom === 'fit') fitTreeFull(); } });
function fitTreeFull() {
  const wrap = document.querySelector('.tcanvas.ftwrap');
  const fts = [...document.querySelectorAll('.tcanvas .ft')];
  if (!wrap || !fts.length) return;
  if (!document.fullscreenElement) { fitTree(); return; }
  fts.forEach((x) => { x.style.zoom = 1; });
  const w = Math.max(...fts.map((x) => x.scrollWidth)), h = fts.reduce((a, x) => a + x.scrollHeight, 0);
  const z = Math.max(0.2, Math.min(1.2, (window.innerWidth - 60) / w, (window.innerHeight - 60) / h));
  fts.forEach((x) => { x.style.zoom = z; });
}
window.addEventListener('hashchange', () => { S.ui.drawer = null; const r = route(); if (r.page === 'tree' && r.id) S.ui.tree.view = 'tree'; render(); window.scrollTo(0, 0); });

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.settings && ch.settings.newValue) {
    const a = ch.settings.newValue.sleeper || null;
    const changed = String((a && a.userId) || '') !== String((S.auth && S.auth.userId) || '');
    const newToken = !changed && a && a.token && a.token !== (S.auth && S.auth.token);
    S.auth = a;
    if (changed) { S.myLeagues = null; loadMyLeagues().then(() => renderSide()); }
    if (changed) noticeLogin().then((sw) => {
      if (sw || missingOffers()) runSync(); else render();
    });
    // A fresh token for the same account: retry offers once if they failed.
    else if (newToken && teamState(a) === 'own' && !(S.raw.gql && S.raw.gql.ok) && !S.syncing) runSync();
  }
  // Another account's notes and alerts swapped in by the background (see swapAccount).
  // Saving your own note lands here too; only rebuild when the notes really differ.
  const same = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
  const swapped = (ch.notes && !same(ch.notes.newValue, S.notes)) || (ch.briefDone && !same(ch.briefDone.newValue, S.briefDone));
  if (ch.notes) S.notes = ch.notes.newValue || {};
  if (ch.briefDone) S.briefDone = ch.briefDone.newValue || {};
  if (ch.blockExtra) S.blockExtra = ch.blockExtra.newValue || [];
  if (ch['draft:stars']) S.draftStars = ch['draft:stars'].newValue || {};
  if (ch['draft:board']) S.draftBoard = ch['draft:board'].newValue || null;
  if (swapped && !S.syncing && S.raw) rebuild().then(render);
  if (ch['alerts:feed']) S.feed = ch['alerts:feed'].newValue || [];
  if (ch.plans) S.plans = ch.plans.newValue || {};
  if (ch.log) S.log = ch.log.newValue || [];
  if (ch.plans || (ch.log && route().page === 'waivers')) { renderSide(); renderTop(); if (route().page === 'waivers') render(); }
  // The background watcher refreshed rosters, picks and offers (e.g. after a trade).
  if (ch['dossier:raw'] && ch['dossier:raw'].newValue && !S.syncing) {
    S.raw = ch['dossier:raw'].newValue;
    rebuild().then(() => {
      const a = document.activeElement;
      if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) return; // don't wipe what you're typing
      render();
    });
  }
});


// A Sleeper login in this browser decides whose team the dashboard shows.
// When a new account logs in (first time, or someone else on this computer),
// drop any team picked for the old account and rebuild for the new owner.
async function noticeLogin() {
  const id = S.auth && S.auth.userId ? String(S.auth.userId) : '';
  if (!id || S.cfg.loginSeen === id) return false;
  const first = !S.cfg.loginSeen;
  const keepPick = first && S.cfg.teamUserId && String(S.cfg.teamUserId) === id;
  S.cfg = await sync.saveSettings({ loginSeen: id, teamUserId: keepPick ? id : '' });
  if (S.raw && S.raw.me && String(S.raw.me.userId) !== id) {
    S.raw = null; S.model = null;
    await chrome.storage.local.remove('dossier:raw');
  }
  return true;
}

// Data built before the login reached this browser (so offers were never
// asked for): rebuild it with offers. A sync that asked and failed doesn't
// count, or every page open would start another full sync.
const missingOffers = () => teamState() === 'own' && !!(S.raw.gql && S.raw.gql.skipped);

(async function init() {
  await gate();
  await load();
  const switched = await noticeLogin();
  loadMyLeagues().then(() => { if (S.myLeagues && S.myLeagues.length) renderSide(); });
  const noOffers = missingOffers();
  S.prevSeen = S.cfg.lastSeen || 0;
  await rebuild();
  render();
  await sync.saveSettings({ lastSeen: Date.now() });
  const stale = switched || noOffers || !S.raw || !S.book || !S.prod || Date.now() - S.raw.at > 30 * 60e3;
  if (stale) runSync();
  else freshen();
})();

// Coming back to the tab: pull current rosters and pick ownership (cheap) so a
// trade made in Sleeper shows up without a full sync.
async function freshen() {
  if (S.syncing || !S.raw || !S.raw.league) return;
  const last = Math.max(S.raw.at || 0, S.raw.quickAt || 0);
  if (Date.now() - last < 2 * 60e3) return;
  try { await quickRefresh(S.raw); } catch (e) { console.warn('[CDD] freshen', e); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') freshen(); });
