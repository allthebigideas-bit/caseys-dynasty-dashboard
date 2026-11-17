import { gate, lock } from '../splash/gate.js';
import { downloadPoster } from './poster.js';
import * as sync from '../lib/sync.js';
import { buildModel, roundName, ordinal, dateStr, fmtK, dur } from '../lib/intel.js';
import { ktcVerdict, fcAdjustment, letterGrade, gainPct } from '../lib/ktcmath.js';
import { playerValue } from '../lib/values.js';
import { scoreLine, starterSlots, bestLineup } from '../lib/startsit.js';
import { DEFAULT_PLAN } from '../lib/engine.js';
import { fcTrades } from '../lib/fctrades.js';
import { repairBoard } from '../lib/draft.js';
import { normName, ownsTeam } from '../lib/util.js';
import { quickRefresh } from '../lib/alerts.js';
import { gqlTrades, gqlLeaguePlayers } from '../lib/sleeper.js';
import { fetchLeague, compareLeagues } from '../lib/compare.js';

// ---- state ----------------------------------------------------------------------------

const S = {
  raw: null, book: null, aux: { fpBySid: {}, proj: {}, sidToFp: {} }, dict: {}, snaps: {}, hist: null, prod: null, vhist: {},
  cfg: {}, feed: [], lastCheck: null, auth: null, notes: {}, briefDone: {}, plans: {}, wleagues: {}, log: [],
  model: null, syncing: null, error: null, buildError: null, prevSeen: 0,
  lab: { a: null, b: null, picked: new Set() },
  ui: { season: { key: 'playoffOdds', dir: -1 }, wk: { min: 0.1, pos: 'ALL' }, form: { rid: null, pos: 'ALL', sort: 'form' }, inc: { rid: 'all', from: '', to: '', status: 'all', sort: 'date', open: null }, boardEdit: false, sum: { key: 'posture', dir: -1 }, history: false, open: { managers: false, trades: true }, q: '', results: [], drawer: null, wv: { sort: 'value', pos: 'ALL', msg: '' }, rising: { pos: 'ALL', need: false, owner: 'all', sort: 'next3' }, posr: { mode: 'dyn', sort: 'avg', focus: 'RB', owner: 'all' }, cmp: { uid: null, lid: null, pos: 'ALL' }, dealTab: {}, tree: { zoom: 'fit', side: 'both', orient: 'auto', autoOrient: null, stacked: false, for: null, view: 'tree', kind: 'all', mgr: 'all', asset: 'all', sort: 'gen', depth: '0', open: {}, closed: {} }, feedOpen: false },
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

const KEYS = ['dossier:weekly', 'blockExtra', 'ui:neutral', 'dossier:draft', 'draft:fp', 'draft:board', 'draft:stars', 'dossier:raw', 'dossier:book', 'dossier:aux', 'sleeperPlayers2', 'tradeSnaps', 'valueHistory', 'dossierSettings', 'alerts:feed', 'alerts:lastCheck', 'settings', 'dossier:hist', 'dossier:prod', 'notes', 'briefDone', 'plans', 'leagues', 'log'];

async function load() {
  const r = await chrome.storage.local.get(KEYS);
  S.raw = r['dossier:raw'] || null;
  S.book = r['dossier:book'] || null;
  S.aux = r['dossier:aux'] || { fpBySid: {}, proj: {}, sidToFp: {} };
  S.dict = (r.sleeperPlayers2 && r.sleeperPlayers2.map) || {};
  S.snaps = r.tradeSnaps || {};
  S.vhist = r.valueHistory || {};
  S.cfg = r.dossierSettings || { username: '', leagueId: '', strategy: 'auto', lastSeen: 0 };
  S.feed = r['alerts:feed'] || [];
  S.lastCheck = r['alerts:lastCheck'] || null;
  S.auth = (r.settings && r.settings.sleeper) || null;
  S.hist = r['dossier:hist'] || null;
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
    snaps: S.snaps, valueHistory: S.vhist, hist: S.hist, prod: S.prod, managerNotes: S.notes,
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
  season: ['pa-trophy', 'The race for the trophy', 'Season table'],
  summary: ['pa-winners', 'Who won the trade', 'Trade summary'],
  trades: ['pa-winners', 'Deals and offers', 'Trades'],
  managers: ['pa-qb', 'Know your rivals', 'Managers'],
  waivers: ['pa-duds', 'Overnight claims', 'Waivers', 'flip'],
  draft: ['pa-board', 'Next year starts now', 'Rookie draft', 'flip'],
  startsit: ['pa-qb', 'This week', 'Start / Sit'],
  rising: ['pa-winners', 'Coming into their prime', 'Rising players'],
  positions: ['pa-grades', 'Room by room', 'Positional ranks', 'flip'],
  demand: ['pa-qb', 'Who wants your guys', 'Demand'],
  block: ['pa-duds', 'Up for grabs', 'My trade block', 'flip'],
  picks: ['pa-board', 'Future capital', 'Picks', 'flip'],
  market: ['pa-winners', 'Risers and fallers', 'Market'],
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
const PAGE_NAMES = { season: 'Season table', form: 'Roster form', block: 'My trade block', draft: 'Rookie draft', overview: 'Overview', summary: 'Trade summary', managers: 'Managers', manager: 'Managers', trades: 'Trades', demand: 'Demand', rising: 'Rising players', positions: 'Positional ranks', startsit: 'Start/Sit', waivers: 'Waivers', picks: 'Picks', compare: 'League compare', tree: 'Trade trees', lopsided: 'Most lopsided trades', branches: 'Most branching trades', market: 'Market', settings: 'Settings' };

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
    <a class="logo" href="#overview"><img src="../splash/crest-sm.png" alt=""><span>Casey's<b>Dynasty</b></span></a>
    <div class="switcher">${me ? teamAvatar(me) : '<span class="av">CD</span>'}<div><b>${esc(L ? L.name : 'No league yet')}</b><span>${esc(me ? `${me.teamName || me.name}` : 'Sync to start')}</span></div></div>
    <div class="nav-h">Main</div>
    <nav class="nav">
      ${item('#season', 'trophy', 'Season table', r.page === 'season')}
      ${item('#overview', 'home', 'Overview', r.page === 'overview')}
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
        <li class="${armed ? '' : 'off'}">${icon(armed ? 'check' : 'x')}${armed ? 'Waivers armed tonight' : 'Waivers not armed'}</li>
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
    <div class="crumbs">${esc(L ? L.name : "Casey's Dynasty Dashboard")} / ${crumb}${viewingOther() ? ` <a class="pill warn" href="#settings" title="This isn't your Sleeper login. Offers, alerts and waiver claims are off.">Viewing as ${esc(tname(S.raw.me.rosterId))}</a>` : ''}</div>
    <div class="spacer"></div>
    <div class="search">${icon('search')}<input type="text" id="q" placeholder="Search players or managers" value="${esc(S.ui.q)}" autocomplete="off">
      ${S.ui.results.length ? `<div class="results">${S.ui.results.map((x) => x.kind === 'team' ? `<a href="#manager/${x.rid}" data-action="closeSearch">${teamAvatar(team(x.rid))}<div><b>${esc(x.name)}</b><div class="muted small">Manager</div></div></a>` : `<a href="#" data-action="player" data-sid="${esc(x.sid)}">${headshot(x.sid)}<div><b>${esc(x.name)}</b><div class="muted small">${esc(x.pos)} ${esc(x.team || '')} · ${esc(x.owner)}</div></div></a>`).join('')}</div>` : ''}
    </div>
    <button class="iconbtn" data-action="toggleFeed" aria-label="Background alerts">${icon('history')}</button>
    <a class="iconbtn" href="#trades/offers" aria-label="Offers waiting">${icon('bell')}${pend ? '<span class="pip"></span>' : ''}</a>
    <button class="iconbtn" data-action="refreshNow" aria-label="Refresh rosters, picks and offers" title="Refresh rosters, picks, offers and trade blocks from Sleeper (a few seconds). Sync now in the sidebar reloads everything.">${icon('sync')}</button>
    <button class="iconbtn" data-action="cycleTheme" aria-label="Colour theme: ${themeName()}" title="Colour theme: ${themeName()}. Click to change.">${icon(themeIcon())}</button>
    <button class="toggle ${armed ? 'on' : ''}" data-action="armToggle" title="Overnight waiver claims">Waivers armed <span class="sw"></span></button>
    ${S.ui.feedOpen ? `<div class="results" style="right:22px;top:52px;position:fixed;width:360px">${S.feed.length ? S.feed.slice(0, 12).map((f) => `<div style="padding:8px"><b>${esc(f.title)}</b> <span class="faint small">${esc(when(f.at))}</span><div class="muted small">${esc(f.body)}</div></div>`).join('') : '<div class="empty" style="padding:10px">No background alerts yet. They appear here and as Chrome notifications.</div>'}</div>` : ''}`;
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
    const why = (S.error && S.error !== sync.NEED_TEAM ? S.error : null) || S.buildError;
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
      curPts: net[t.rid] ? net[t.rid].curPts : 0, oldPts: net[t.rid] ? net[t.rid].oldPts : 0,
      allPts: net[t.rid] ? net[t.rid].curPts + net[t.rid].oldPts : 0,
      allThen: net[t.rid] ? net[t.rid].curThen + net[t.rid].oldThen : 0,
      histTrades: ht[t.rid] || 0,
    };
  });
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
      { h: th('allNow', 'Net now', 'num grp', "All seasons, today's values"), td: (r) => `<td class="num grp"><b>${r.trades + r.histTrades ? netCell(r.allNow) : faint}</b></td>` },
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
  const body = rows.map((r) => `<tr class="${r.isMe ? 'me' : ''}">${groups.map((g) => visCols(g).map((c) => c.td(r)).join('')).join('')}</tr>`).join('');
  // league totals
  const others = rows.filter((r) => !r.isMe);
  const tot = (key) => others.reduce((s2, r) => s2 + (r[key] || 0), 0);
  const asks = others.filter((r) => r.ask != null);
  return myOffersCard(m) + `<div class="sec-h" style="margin-top:18px"><h2>Manager summary</h2><span class="row" style="gap:10px"><button class="btn sm primary" data-action="exportSummary">${icon('download')}Export PNG</button><button class="toggle ${S.ui.neutral ? 'on' : ''}" data-action="toggleNeutral" title="Hide postures, ease ratings, avoid tags and your notes so you can show this screen to others">Share view <span class="sw"></span></button></span></div><div class="row" style="margin:-6px 0 12px"><span class="muted small">Click a column to sort. Offer columns only count offers between you and that manager: Sleeper hides other managers' offers to each other.</span></div>
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


// Why offers are missing, shown on the offer pages instead of a page of zeros.
function offersNotice() {
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
  return `<div class="three" style="margin-bottom:16px">
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
  const orderRow = (p) => {
    const o = team(p.owner);
    const proj = board && p.overall ? board.players[p.overall - 1] : null;
    const h = p.overall ? bucketFor(p.overall) : null;
    return `<tr class="${p.owner === m.me ? 'me' : ''}">
      <td class="num">${p.overall ? `${p.round}.${String(p.slot).padStart(2, '0')}` : roundName(p.round)}</td>
      <td><div class="who">${teamAvatar(o)}<div>${tlink(p.owner)}<div class="meta">${posture(o)}${p.orig !== p.owner ? ` via ${esc(tname(p.orig))}` : ''}</div></div></div></td>
      <td class="num">${team(p.orig) ? `${team(p.orig).w}-${team(p.orig).l}` : ''}</td>
      <td class="num">${team(p.orig) ? `${Math.round(team(p.orig).maxPf)} <span class="faint">(${Math.round(team(p.orig).maxPfProj)})</span>` : ''}</td>
      <td>${proj ? `${posTag(proj.pos)} ${esc(proj.name)}${S.draftStars[normName(proj.name)] ? ' ★' : ''}` : '<span class="faint">—</span>'}</td>
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
        <div class="card"><h3>${y} draft order, rounds 1-2</h3><p class="lede">${m.draftOrderMethod === 'standings' ? 'Order from the playoff simulation: worst projected finish picks first.' : m.draftOrderMethod === 'maxpf' ? 'Non-playoff teams by projected max PF (lowest first: best lineup each week so far, plus the same weekly pace for the rest of the season), then playoff teams by projected finish.' : 'Every team by projected max PF, lowest first.'} Change this in Settings. "Board" is the prospect at that spot on ${board ? esc(board.mine ? 'your board' : board.source) : 'a prospect board (add one below)'}. "Starter rate" is how often that slot produced a weekly starter in past classes.</p>
          <div class="scroll"><table class="t"><thead><tr><th>Pick</th><th>Owner</th><th class="num">Record</th><th class="num">Max PF (proj.)</th><th>Board</th><th class="num">Starter rate</th><th class="num">Value</th></tr></thead><tbody>${r12.map(orderRow).join('')}</tbody></table></div>
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
          <div class="facts" style="margin-top:12px">${['QB', 'RB', 'WR', 'TE'].map((pos) => `<div><span>${pos} in rounds 1-2</span><b>${D.posHit[pos].rate == null ? '—' : pct(D.posHit[pos].rate)}</b><span>${D.posHit[pos].n} players</span></div>`).join('')}</div>` : '<p class="muted">Loads on the next sync.</p>'}</div>
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
  if (viewingOther()) return `<div class="card"><h3>Overnight waiver claims</h3><p class="muted">You're viewing <b>${esc(tname(S.raw.me.rosterId))}</b>, which isn't your Sleeper login. Waiver claims only work for your own team.</p><a class="btn primary" href="#settings">Switch back to your team</a></div>`;
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
  const sortSel = `<select data-wv="sort">${[['value', 'Dynasty value'], ['week', 'This week projection'], ['season', 'Season pts/game'], ['fp', 'FantasyPros rank'], ['trend', 'Trending adds'], ['rising', 'Rising (3-yr projection)']].map(([v, l]) => `<option value="${v}" ${wv.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const posSel = `<select data-wv="pos">${['ALL', 'QB', 'RB', 'WR', 'TE', 'DEF', 'K'].map((v) => `<option ${wv.pos === v ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  return `
    <div class="card banner"><div class="art">${icon('moon')}</div><div><b>Overnight waiver claims</b><p>When waivers clear in ${esc(lg.name)} (${esc(lg.waiverType || 'waivers')}${s.waiver_day_of_week != null ? `, processing ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.waiver_day_of_week]}` : ''}), the vulture adds your top available targets into your drop spots. Leave Chrome open and the computer awake.</p></div>
      <div class="row" style="margin-left:auto"><span class="pill ${run ? 'buy' : 'mid'}">${esc(phase)}</span>${locked ? `<button class="btn danger" data-action="disarm">Disarm</button>` : `<button class="btn primary" data-action="arm">Arm for tonight</button>`}</div></div>
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
  if (!src.length) return '<div class="card"><h3>League compare</h3><p class="muted">No other leagues found yet. League-mates\' other leagues load during a sync (refreshed once a day).</p></div>';
  if (!f.uid || !src.find((x) => x.uid === f.uid)) f.uid = (src.find((x) => x.uid !== 'me') || src[0]).uid;
  const who = src.find((x) => x.uid === f.uid);
  if (!f.lid || !who.leagues.find((l) => String(l.id) === String(f.lid))) f.lid = who.leagues[0].id;
  const sel = (key, opts) => `<select data-cmp="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(f[key]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const picker = `<div class="card"><div class="sec-h"><h3 style="margin:0">Compare ${esc(m.league.name)} with</h3>
    <div class="row">${sel('uid', src.map((x) => [x.uid, `${x.name} (${x.leagues.length} other league${x.leagues.length === 1 ? '' : 's'})`]))}
    ${sel('lid', who.leagues.map((l) => [l.id, `${l.name.trim()}${l.size ? ` · ${l.size} teams` : ''}${l.sf ? ' · SF' : ''}${l.tep ? ' · TE+' : ''}`]))}
    <button class="btn sm" data-action="cmpReload" title="Fetch this league again">${icon('sync')}</button></div></div>
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

// How much a trade's tree moved for each side: value at the trade vs what it's worth today.
function treeGain(nt) {
  const per = nt.rids.map((r) => {
    const then = nt.deal && nt.deal[r] ? nt.deal[r].got : null;
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
  return `<div class="fdealsum">${nt.rids.map((r) => `<div><div class="small muted dsh">${tmini(nt, r)} ${esc(treeNm(nt, r))} received</div><ul>${(nt.recv[r] || []).map(item).join('') || '<li class="muted">nothing</li>'}</ul></div>`).join('<div class="fx">⇄</div>')}</div>`;
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
    return `<div class="fbox st-${n.status}">${pic}<div class="fb"><div class="fn">${tag(x)} ${name}</div>${x.draftedWith ? `<div class="fs">Drafted ${esc(x.draftedWith)}</div>` : ''}${statusTxt(n) ? `<div class="fs">${esc(statusTxt(n))}</div>` : ''}<div class="fv">${n.status === 'traded' || n.status === 'drafted' ? `became <b>${k(n.total)}</b>` : n.status === 'kept' || n.status === 'owned' ? `worth <b>${k(n.total)}</b>` : '<b>0</b>'}</div></div>${tg}</div>`;
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
    const then = nt.deal && nt.deal[r] ? nt.deal[r].got : null;
    return `<li><div class="fteam">${teamAvatar(team(r))}<div><b>${esc(treeNm(nt, r))}</b> got
      <div class="fs">${then != null ? `${k(then)} at the trade → ` : ''}<b class="${then != null && tr.total >= then ? 'up' : then != null ? 'down' : ''}">${k(tr.total)}</b> today · ${tr.generations} gen · ${tr.laterTrades} later deal${tr.laterTrades === 1 ? '' : 's'} · ${tr.playersNow} still rostered</div>${opts.part ? `<div class="fs fpart">${esc(opts.part)}</div>` : ''}</div></div>${opts.only ? kidsIdx(tr.nodes, opts.only, `s${r}`) : kids(tr.nodes, 0, `s${r}`)}</li>`;
  };
  if (lr) return `<div class="ft lr"><ul>${sides.map(sideCol).join('')}</ul></div>`;
  if (opts.stack && sides.length > 1) return sides.map((r) => `<div class="ft" style="margin-bottom:28px"><ul>${sideCol(r)}</ul></div>`).join('');
  return `<div class="ft"><ul><li><div class="froot">${esc(dateY(nt.created))}${nt.leg ? ` · week ${nt.leg}` : ''}<div class="fs">${esc(nt.rids.map((r) => treeNm(nt, r)).join(' ⇄ '))}</div></div><ul>${sides.map(sideCol).join('')}</ul></li></ul></div>`;
}

function treeLead(nt) {
  const ranked = [...nt.rids].sort((a, b) => nt.tree[b].total - nt.tree[a].total);
  return ranked.length > 1 ? `${treeNm(nt, ranked[0])}'s side of the tree is worth ${k(nt.tree[ranked[0]].total)} today, ${k(nt.tree[ranked[0]].total - nt.tree[ranked[1]].total)} more than ${treeNm(nt, ranked[1])}'s.` : '';
}

// The math behind a tree: each later deal's split, then every asset the tree ends in with the
// product of shares that carries its value back to the original trade.
function attributionTables(nt) {
  const pickName = (x) => `${x.season} ${roundName(Number(x.round))}${x.no ? ` (${x.no})` : ''}`;
  const nmOf = (x) => (x.kind === 'pick' || x.round != null ? pickName(x) : P(x.sid).name);
  const keyName = (key) => {
    if (key.startsWith('p:')) return P(key.slice(2)).name;
    const [, y, r, o] = key.split(':');
    return `${y} ${roundName(Number(r))} (${tname(Number(o))})`;
  };
  const pct = (x) => `${Math.round(x * 100)}%`;
  const deals = [], rows = [];
  const walk = (rid, nodes, factor, path) => {
    for (const n of nodes || []) {
      if (n.status === 'traded' || n.kind === 'package') {
        const label = n.kind === 'package' ? n.items.map(nmOf).join(' + ') : nmOf(n);
        const share = n.share != null ? n.share : 1;
        deals.push({ rid, at: n.at, partner: n.partner || [], label, parts: n.parts, share, full: n.fullTotal != null ? n.fullTotal : n.total, credited: n.total, src: n.valSrc, via: n.via });
        const no = deals.length;
        walk(rid, n.children, factor * share, [...path, { label, deal: no, share }]);
      } else if (n.status === 'drafted') {
        walk(rid, n.children, factor, [...path, { label: nmOf(n), drafted: true }]);
      } else {
        rows.push({ rid, n, path, value: n.total || 0, factor, attr: (n.total || 0) * factor });
      }
    }
  };
  for (const r of nt.rids) walk(r, nt.tree[r].nodes, 1, []);
  const statusTxt = (n) => ({ kept: 'On the roster', owned: 'Pick still owned', released: 'Released', gone: 'No longer on the roster', unknown: 'Pick used (player not matched)' }[n.status] || n.status);
  const dealRows = deals.map((d, i) => {
    const tr = d.parts ? d.parts.tree : [], ex = d.parts ? d.parts.extra : [];
    const list = (arr) => arr.map((x) => `${esc(keyName(x.key))} <span class="faint">${k(x.v)}</span>`).join('<br>') || '<span class="faint">—</span>';
    const tv = tr.reduce((a, x) => a + x.v, 0), ev = ex.reduce((a, x) => a + x.v, 0);
    return `<tr><td class="num"><span class="dno">D${i + 1}</span></td><td class="nowrap">${d.at ? esc(dateY(d.at)) : '—'}</td><td>${tnameLogo(nt, d.rid)}</td><td>${d.partner.map((r) => tnameLogo(nt, r)).join(' ')}</td>
      <td>${list(tr)}${tr.length > 1 ? `<div class="msum">= ${k(tv)}</div>` : ''}</td><td>${list(ex)}${ex.length > 1 ? `<div class="msum">= ${k(ev)}</div>` : ''}</td>
      <td class="num"><b>${pct(d.share)}</b><div class="meta">${ex.length ? `${k(tv)} ÷ ${k(tv + ev)}` : 'all of it'}</div></td><td class="num">${k(d.full)}</td><td class="num"><b>${k(d.credited)}</b><div class="meta">${ex.length ? `${k(d.full)} × ${pct(d.share)}` : ''}</div></td></tr>`;
  }).join('');
  const pathHtml = (path, n) => [...path.map((p2) => `${esc(p2.label)} <span class="parrow">${p2.drafted ? '→ drafted' : `→ <span class="dno">D${p2.deal}</span>${p2.share < 0.995 ? ` <b class="pshare">${pct(p2.share)}</b>` : ''}`} →</span>`), `<b>${esc(nmOf(n))}</b>`].join(' ');
  const sideBlock = (r) => {
    const rs = rows.filter((x) => x.rid === r).sort((a, b) => b.attr - a.attr);
    const tot = rs.reduce((a, x) => a + x.attr, 0);
    const then = nt.deal && nt.deal[r] ? nt.deal[r].got : null;
    const body = rs.map((x) => `<tr class="${x.value ? '' : 'faint-row'}"><td>${x.n.kind === 'pick' || x.n.round != null ? '<span class="pos PK">PK</span>' : posTag(P(x.n.sid).pos)} ${esc(nmOf(x.n))}<div class="meta">${esc(statusTxt(x.n))}</div></td>
      <td class="small">${x.path.length ? pathHtml(x.path, x.n) : '<span class="faint">received in the original trade</span>'}</td>
      <td class="num">${k(x.value)}</td><td class="num">${x.factor < 0.995 ? `× ${pct(x.factor)}` : '× 100%'}</td><td class="num"><b>${k(x.attr)}</b></td></tr>`).join('');
    return `<tr class="mside"><td colspan="5">${tnameLogo(nt, r)} <span class="faint">got</span> ${(nt.recv[r] || []).map((a) => esc(a.kind === 'pick' ? a.label : a.name)).join(', ')}</td></tr>${body}
      <tr class="mtotal"><td colspan="4">${esc(treeNm(nt, r))}: attributable residual value today${then != null ? ` · worth ${k(then)} at the trade · net <b class="${tot - then >= 0 ? 'up' : 'down'}">${sk(Math.round(tot - then))}</b>` : ''}</td><td class="num"><b>${k(tot)}</b></td></tr>`;
  };
  return `<div class="tdeal tmath"><div class="hd"><b>Attribution math</b><span class="faint small">how the tree's values are worked out</span></div>
    <p class="small muted" style="margin:4px 0 10px">Each asset's <b>attributable value = value today × the tree's share of every later deal on its path</b>. The tree's share of a deal = what the tree's assets were worth on the day of that deal ÷ everything that team sent in it (${esc(deals.find((d) => d.src) ? deals.find((d) => d.src).src : 'KTC / DynastyProcess values at the time')}). Deals with nothing added from outside count 100%.</p>
    ${deals.length ? `<h3 class="mh">Later deals</h3><div class="scroll"><table class="t tlist tmt"><thead><tr><th class="num">Deal</th><th>Date</th><th>Team</th><th>Traded to</th><th>From the tree (value then)</th><th>Added from outside (value then)</th><th class="num">Tree's share</th><th class="num">Got back (today)</th><th class="num">Credited to tree</th></tr></thead><tbody>${dealRows}</tbody></table></div>` : '<p class="muted">Nothing from this trade has been flipped yet, so every asset counts at 100%.</p>'}
    <h3 class="mh">Residual value by asset</h3><div class="scroll"><table class="t tlist tmt"><thead><tr><th>Asset today</th><th>How it got there</th><th class="num">Value today</th><th class="num">× Tree's share</th><th class="num">= Attributable</th></tr></thead><tbody>${nt.rids.map(sideBlock).join('')}</tbody></table></div></div>`;
}

// League top 10 most lopsided trades, judged by what each side's tree is worth today.
function lopsidedList() {
  return allTreeTrades().filter((nt) => nt.rids.length === 2).map((nt) => ({ nt, ...treeStats(nt), gain: treeGain(nt) }))
    .filter((x) => x.gain.gap > 0).sort((a, b) => b.gain.gap - a.gain.gap).slice(0, 10);
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
  for (const nt of list) for (const r of nt.rids) { if (nt.deal && nt.deal[r]) { then += nt.deal[r].got; now += nt.tree[r].total; } }
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
function branchesList() {
  return allTreeTrades().map((nt) => ({ nt, ...treeStats(nt), gain: treeGain(nt),
    br: nt.rids.reduce((a, r) => a + (nt.tree[r].branches || 0), 0),
    boxes: nt.rids.reduce((a, r) => a + countBoxes(nt.tree[r].nodes), 0),
    worth: nt.rids.reduce((a, r) => a + nt.tree[r].total, 0) }))
    .filter((x) => x.br > 0).sort((a, b) => b.br - a.br || b.g - a.g || b.later - a.later || b.worth - a.worth).slice(0, 10);
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
  const row = (x, i) => `<tr><td class="num"><span class="rank">${i + 1}</span></td><td class="nowrap">${esc(dateY(x.nt.created))}</td>
    <td>${x.nt.rids.map((r) => tnameLogo(x.nt, r)).join(' <span class="faint">⇄</span> ')}<div class="meta">${x.nt.rids.map((r) => `${esc(treeNm(x.nt, r))} got ${(x.nt.recv[r] || []).map((a) => esc(a.kind === 'pick' ? a.label : a.name)).slice(0, 3).join(', ')}${(x.nt.recv[r] || []).length > 3 ? '…' : ''}`).join(' · ')}</div></td>
    <td class="num"><b>${x.br}</b></td><td class="num">${x.g}</td><td class="num">${x.later}</td><td class="num">${x.boxes}</td><td class="num">${k(x.worth)}</td>
    <td><a class="tbtn sm" href="#tree/${esc(x.nt.id)}">${TREE_ICON} Tree</a></td></tr>`;
  return `<div class="ttop">${heroCard(L.name || 'Your league', 'Most Branching Trades', 'The ten trades whose players and picks have been flipped the most times since — the league\'s biggest trade trees.')}${sumCard(tiles, extra)}${legendCard()}</div>
    <div class="ttool"><a class="tbtn" href="#tree">${TREE_ICON} All trade trees</a><a class="tbtn" href="#lopsided">Most lopsided ›</a><span style="flex:1"></span><span class="tlab">Branches = times an asset from the deal was flipped (traded on, or a pick spent), both sides counted.</span><button class="tcta sm" data-action="treePdf" data-kind="branches">${icon('note')} Download PDF report</button></div>
    <div class="tcanvas tlw"><table class="t tlist"><thead><tr><th class="num">#</th><th>Date</th><th>Trade</th><th class="num">Branches</th><th class="num">Gens</th><th class="num">Later deals</th><th class="num">Assets in tree</th><th class="num">Worth today</th><th></th></tr></thead><tbody>${top.map(row).join('') || '<tr><td colspan="9" class="muted">No trade has been flipped on yet.</td></tr>'}</tbody></table></div>`;
}

function viewLopsided() {
  const top = lopsidedList();
  const L = S.raw.league || {};
  const atTrade = (nt, r) => (nt.deal && nt.deal[r] ? nt.deal[r].got : null);
  const biggest = top[0];
  const flips = top.filter((x) => { const w = x.gain.winner, l = x.gain.loser; const tw = atTrade(x.nt, w), tl = atTrade(x.nt, l); return tw != null && tl != null && tw < tl; }).length;
  const tiles = [
    { label: 'Trades ranked', value: top.length },
    { label: 'Biggest gap', value: biggest ? k(biggest.gain.gap) : '—', cls: 'up' },
    { label: 'Flipped in hindsight', value: flips, sub: 'lost on the day, won today' },
    { label: 'Deepest tree', value: top.length ? Math.max(...top.map((x) => x.g)) : 0, sub: 'generations' },
  ];
  const w = biggest ? biggest.gain.winner : null;
  const extra = biggest ? `<div class="who2"><span>Biggest winner</span><div>${teamAvatar(team(w))}<div><b>${esc(treeNm(biggest.nt, w))}</b><em>+${k(biggest.gain.gap)} on ${esc(dateY(biggest.nt.created))}</em></div></div></div>` : '';
  const row = (x, i) => {
    const { nt, gain } = x;
    const wn = gain.winner, ln = gain.loser;
    const tw = atTrade(nt, wn), tl = atTrade(nt, ln);
    const thenPct = tw != null && tl != null ? Math.round(tw / ((tw + tl) || 1) * 100) : null;
    const nowPct = Math.round(gain.share * 100);
    return `<tr><td class="num"><span class="rank">${i + 1}</span></td><td class="nowrap">${esc(dateY(nt.created))}</td>
      <td>${tnameLogo(nt, wn, 'up')} <span class="faint">over</span> ${tnameLogo(nt, ln, 'down')}<div class="meta">${esc(treeNm(nt, wn))} got ${(nt.recv[wn] || []).map((a) => esc(a.kind === 'pick' ? a.label : a.name)).join(', ')} · ${esc(treeNm(nt, ln))} got ${(nt.recv[ln] || []).map((a) => esc(a.kind === 'pick' ? a.label : a.name)).join(', ')}</div></td>
      <td class="num">${thenPct != null ? `${thenPct}% / ${100 - thenPct}%` : '—'}</td>
      <td class="num"><div class="split2"><i style="width:${nowPct}%"></i></div><b>${nowPct}%</b> / ${100 - nowPct}%</td><td class="num"><b>${k(gain.gap)}</b></td><td class="num">${x.g}</td>
      <td><a class="tbtn sm" href="#tree/${esc(nt.id)}">${TREE_ICON} Tree</a></td></tr>`;
  };
  return `<div class="ttop">${heroCard(L.name || 'Your league', 'Most Lopsided Trades', 'The ten trades whose two sides have grown furthest apart, counting everything each haul turned into.')}${sumCard(tiles, extra)}${legendCard()}</div>
    <div class="ttool"><a class="tbtn" href="#tree">${TREE_ICON} All trade trees</a><a class="tbtn" href="#branches">Most branches ›</a><span style="flex:1"></span><span class="tlab">"At the trade" is the value split on the day; "today" is the tree split now.</span><button class="tcta sm" data-action="treePdf" data-kind="lopsided">${icon('note')} Download PDF report</button></div>
    <div class="tcanvas tlw"><table class="t tlist"><thead><tr><th class="num">#</th><th>Date</th><th>Trade</th><th class="num">At the trade</th><th class="num">Today</th><th class="num">Gap</th><th class="num">Gens</th><th></th></tr></thead><tbody>${top.map(row).join('') || '<tr><td colspan="8" class="muted">No completed two-team trades yet.</td></tr>'}</tbody></table></div>`;
}

// PDF report: same neon look, printed (Chrome → Save as PDF).
function printTreeReport(kind = 'lopsided') {
  const isBr = kind === 'branches';
  const top = isBr ? branchesList() : lopsidedList();
  const L = S.raw.league || {};
  const date = new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
  const atTrade = (nt, r) => (nt.deal && nt.deal[r] ? nt.deal[r].got : null);
  // Cover: hero, summary, and a one-line-per-trade top-10 table that always fits the page.
  const lop = isBr ? viewBranches() : viewLopsided();
  const heroSum = lop.slice(0, lop.indexOf('<div class="ttool">'));
  const coverRows = isBr ? top.map((x, i) => `<tr><td class="num"><span class="rank">${i + 1}</span></td><td class="nowrap">${esc(dateY(x.nt.created))}</td><td class="nowrap">${x.nt.rids.map((r) => tnameLogo(x.nt, r)).join(' <span class="faint">⇄</span> ')}</td><td><div class="clip">${esc(x.nt.rids.map((r) => `${treeNm(x.nt, r)} got ${(x.nt.recv[r] || []).map((a) => (a.kind === 'pick' ? a.label : a.name)).join(', ')}`).join(' · '))}</div></td><td class="num"><b>${x.br}</b></td><td class="num">${x.g}</td><td class="num">${x.later}</td><td class="num">${k(x.worth)}</td><td class="num">p.${i + 2}</td></tr>`).join('') : top.map((x, i) => {
    const { nt, gain } = x; const w = gain.winner, l = gain.loser;
    const tw = atTrade(nt, w), tl = atTrade(nt, l);
    const thenPct = tw != null && tl != null ? Math.round(tw / ((tw + tl) || 1) * 100) : null;
    const nowPct = Math.round(gain.share * 100);
    const gotW = (nt.recv[w] || []).map((a) => (a.kind === 'pick' ? a.label : a.name)).join(', ');
    return `<tr><td class="num"><span class="rank">${i + 1}</span></td><td class="nowrap">${esc(dateY(nt.created))}</td><td class="nowrap">${tnameLogo(nt, w, 'up')} <span class="faint">over</span> ${tnameLogo(nt, l, 'down')}</td><td><div class="clip">${esc(treeNm(nt, w))} got ${esc(gotW)}</div></td><td class="num">${thenPct != null ? `${thenPct}/${100 - thenPct}` : '—'}</td><td class="num"><b>${nowPct}/${100 - nowPct}</b></td><td class="num"><b>${k(gain.gap)}</b></td><td class="num">${x.g}</td><td class="num">p.${i + 2}</td></tr>`;
  }).join('');
  const cover = `<section class="pr-page pr-cover">${heroSum}
    <div class="tcanvas tlw"><table class="t tlist"><thead>${isBr ? '<tr><th class="num">#</th><th>Date</th><th>Trade</th><th>What each side got</th><th class="num">Branches</th><th class="num">Gens</th><th class="num">Later deals</th><th class="num">Worth today</th><th class="num">Tree</th></tr>' : '<tr><th class="num">#</th><th>Date</th><th>Winner</th><th>What the winner got</th><th class="num">At trade</th><th class="num">Today</th><th class="num">Gap</th><th class="num">Gens</th><th class="num">Tree</th></tr>'}</thead><tbody>${coverRows}</tbody></table></div>
    <p class="pr-foot">${esc(L.name || '')} · generated ${esc(date)} · values from KeepTradeCut${isBr ? ' · branches = times an asset from the deal was flipped' : ' · "at trade" and "today" are each side\'s share of the value'}</p></section>`;

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

  top.forEach((x, i) => {
    const nt = x.nt, g = x.gain;
    const tiles = isBr ? [
      { label: 'Branches', value: x.br, cls: 'up' },
      { label: 'Generations', value: x.g },
      { label: 'Later deals', value: x.later },
      { label: 'Worth today', value: k(x.worth) },
    ] : [
      { label: 'Gap today', value: k(g.gap), cls: 'up' },
      { label: 'Split today', value: `${Math.round(g.share * 100)}% / ${100 - Math.round(g.share * 100)}%` },
      { label: 'Generations', value: x.g },
      { label: 'Later deals', value: x.later },
    ];
    const header = (cont) => `<div class="thero small"><div class="ico"><span class="rankbig">#${i + 1}</span></div><div><div class="eyebrow">${esc(L.name || '')} · traded ${esc(dateY(nt.created))}${cont ? ' · continued' : ''}</div><h1 class="h1logos">${nt.rids.map((r) => `${tmini(nt, r)}${esc(treeNm(nt, r))}`).join('<i>⇄</i>')}</h1>${cont ? '' : `<p>${esc(treeLead(nt))}</p>`}</div>${cont ? '' : `<div class="prstats">${tiles.map((t) => `<div><span>${esc(t.label)}</span><b class="${t.cls || ''}">${t.value}</b></div>`).join('')}</div>`}<div class="glow"></div></div>`;
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
    file: `caseys-trade-summary-${fileStamp()}.png`,
    title: 'Trade summary', eyebrow: leagueName(),
    subtitle: `Who won the trades · week ${m.league.week}, ${m.league.season}`,
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

async function exportPoster(el, build) {
  if (!S.model) return;
  const label = el ? el.innerHTML : '';
  if (el) { el.disabled = true; el.textContent = 'Drawing…'; }
  try { await downloadPoster(build()); } catch (e) { console.error(e); S.error = `Couldn't make the image: ${e.message}`; render(); }
  finally { if (el) { el.disabled = false; el.innerHTML = label; } }
}

// ---- your team picker -----------------------------------------------------------------------

const loginId = () => (S.auth && S.auth.userId ? String(S.auth.userId) : '');
const viewingOther = () => !!(S.raw && S.raw.me && loginId()) && !ownsTeam(S.raw, S.auth);

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
    ${viewingOther() ? `<div class="notice info">Viewing <b>${esc(tname(S.raw.me.rosterId))}</b>, which isn't your Sleeper login. Offers, alerts and waiver claims are off while you do.</div>` : ''}
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
  el.innerHTML = `<div class="drawer-bg" data-action="closeDrawer"></div><aside class="drawer" role="dialog" aria-label="${esc(p.name)}">
    <button class="iconbtn close" data-action="closeDrawer" aria-label="Close">${icon('x')}</button>
    <div style="text-align:center">${headshot(sid, 'lg ring')}<h2 style="margin:10px 0 2px;font-size:19px">${esc(p.name)}</h2><div class="muted">${esc(p.pos)} · ${esc(p.team || 'FA')}${p.age ? ` · age ${p.age.toFixed(1)}` : ''}${p.inj ? ` · <span class="down">${esc(p.inj)}</span>` : ''}</div>
      <div style="margin-top:8px">${owner ? `${teamAvatar(owner)} ${tlink(owner.rid)}` : '<span class="pill good">Free agent</span>'}</div></div>
    <div class="facts" style="margin-top:16px"><div><span>Dynasty value</span><b>${k(v.v)}</b></div><div><span>KTC</span><b>${k(v.ktc)}</b></div><div><span>FantasyCalc</span><b>${k(v.fc)}</b></div><div><span>Redraft</span><b>${k(v.redraft)}</b></div></div>
    ${fp ? `<p class="muted" style="margin-top:12px">This week: ${esc(fp.posRank || '')} ${fp.grade ? grade(fp.grade) : ''} ${esc(fp.opp || '')}</p>` : ''}
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
  treeView(el, e) { S.ui.tree.view = el.dataset.v; if (el.tagName !== 'A') render(); },
  treeFull() { const c = document.querySelector('.tcanvas'); if (c && c.requestFullscreen) c.requestFullscreen(); },
  treeOrient(el) { const f = S.ui.tree; f.orient = el.dataset.v; f.autoOrient = null; f.tried = null; f.settled = false; f.stacked = false; f.zoom = 'fit'; render(); },
  treeOpen(el) { const f = S.ui.tree; delete f.closed[el.dataset.path]; f.open[el.dataset.path] = true; render(); },
  treeClose(el) { const f = S.ui.tree; f.closed[el.dataset.path] = true; delete f.open[el.dataset.path]; render(); },
  treeSide(el) { S.ui.tree.side = el.dataset.side; render(); },
  dealTab(el) { S.ui.dealTab[el.dataset.rid] = el.dataset.tab; render(); },
  cmpPos(el) { S.ui.cmp.pos = el.dataset.pos; render(); },
  cmpReload() { const id = S.ui.cmp.lid; if (id) delete CMP[id]; render(); },
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
      const [trades, lp] = await Promise.all([gqlTrades(lid, 80).catch(() => null), gqlLeaguePlayers(lid).catch(() => null)]);
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
  exportSummary(el) { return exportPoster(el, tradeSummaryPoster); },
  exportSeason(el) { return exportPoster(el, seasonPoster); },
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
    const r = await chrome.runtime.sendMessage({ type: 'dryRun', uid: uid() });
    S.ui.dry = r && r.ok ? (r.actions.length ? r.actions : ['Nothing to do: no spots, or none of your targets are available.']) : [r ? r.error : 'No reply'];
    render();
  },
  async claimNow() {
    if (viewingOther()) return render();
    if (!confirm('Make real adds and drops in Sleeper right now, using your list?')) return;
    const r = await chrome.runtime.sendMessage({ type: 'arm', uid: uid(), now: true });
    S.ui.wv.msg = r && r.ok ? `Claiming now.${r.warnings && r.warnings.length ? ' ' + r.warnings.join(' ') : ''}` : `Couldn't start: ${r ? r.error : 'no reply'}`;
    await refreshPlans();
  },
  async arm() {
    if (viewingOther()) return render();
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
    // The Waivers page explains why claims are off for someone else's team.
    if (viewingOther()) { location.hash = '#waivers'; render(); return; }
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
    if (changed) noticeLogin().then((sw) => {
      if (sw || missingOffers()) runSync(); else render();
    });
    // A fresh token for the same account: retry offers once if they failed.
    else if (newToken && ownsTeam(S.raw, a) && !(S.raw.gql && S.raw.gql.ok) && !S.syncing) runSync();
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
const missingOffers = () => ownsTeam(S.raw, S.auth) && !S.raw.me.own;

(async function init() {
  await gate();
  await load();
  const switched = await noticeLogin();
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
