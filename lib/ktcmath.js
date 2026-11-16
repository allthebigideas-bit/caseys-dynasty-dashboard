// Trade-calculator math for KeepTradeCut and FantasyCalc.
//
// Both sites add a "package adjustment" to one side before comparing totals,
// so a raw sum disagrees with them on most uneven deals. These are ports of the
// sites' own functions, taken from the MIT-licensed `ff` project
// (github.com/savvides/ff, src/ff/analysis/calculators.py, © 2026 Philippos
// Savvides), and checked against the 431 KTC test vectors it captured by
// running KTC's live code.

const KTC_PV_SCALE = 10099;
const KTC_MAX_PLAYER_VAL = 10000;
export const KTC_VARIANCE = 5;
const KTC_TOP_OFFSET = 100;
const KTC_DISPLAY_RATIO = 0.033;

const FC_PCT_FACTOR = 0.6982;
const FC_ADJUSTMENT_FACTOR = 753;
const FC_ADJUSTMENT_SCALAR = 0.23;

// JavaScript already has the numeric semantics the ports need.
const pow = Math.pow;
const div = (a, b) => a / b;

function processV(value, topInTrade) {
  return 1 * (0.1 * pow(value / KTC_PV_SCALE, 1.4) + 0.7 * pow(div(value, 1.05 * topInTrade), 1.25) + 0.2) * value;
}

class SolveError extends Error {}

function solveForX(target, t, r) {
  let x = 5 * target;
  for (let i = 0; i < 20; i++) {
    const fx = (0.1 * pow(div(x, t), 1.4) + 0.7 * pow(div(x, 1.05 * r), 1.25) + 0.2) * x - target;
    const dfx = div(0.24 * pow(x, 1.4), pow(t, 1.4)) + div(1.575 * pow(x, 1.25), pow(1.05, 1.25) * pow(r, 1.25)) + 0.2;
    if (Math.abs(dfx) < 1e-12) throw new SolveError();
    const nx = x - div(fx, dfx);
    if (Math.abs(nx - x) < 1e-8) return nx;
    x = nx;
  }
  throw new SolveError();
}

const reverseAdjust = (target, r, t) => Math.round(solveForX(target, t, r));

function checkEquality(e, a, t) {
  e = Math.max(0, e);
  a = Math.max(0, a);
  const n = Math.min(100, div(Math.abs(e - a), e + a) * 100);
  return !(Math.round(10 * n) / 10 > t);
}

// KTC's adjustPackageNew. Returns {adj1, adj2, side, shown} or null when a side
// is empty or the solve fails (KTC shows no verdict then either).
export function ktcAdjustment(side1, side2, top, variance = KTC_VARIANCE) {
  if (!side1.length || !side2.length) return null;
  const t1 = [...side1].sort((x, y) => y - x);
  const t2 = [...side2].sort((x, y) => y - x);
  const s1 = t1.reduce((s, v) => s + v, 0);
  const s2 = t2.reduce((s, v) => s + v, 0);
  const t = top + KTC_TOP_OFFSET;
  const r = Math.max(t1[0], t2[0]);
  let e = 0;
  for (const v of t1) e += processV(v, r);
  let a = 0;
  for (const v of t2) a += processV(v, r);
  const d = div(e, s1);
  const u = div(a, s2);
  const c = Math.floor(Math.abs(e - a));
  const f = checkEquality(s1, s2, variance);
  const h = checkEquality(e, a, variance);

  let side = -1, value = 0, adj1 = 0, adj2 = 0, y = true;
  try {
    if (f && h) {
      if (e > a) {
        side = 1;
        const b = s2 + reverseAdjust(c, r, t) - s1;
        if (b > 0) value = adj1 = b;
        else { y = false; side = 2; value = adj2 = -1 * b; }
      } else if (a > e) {
        side = 2;
        const b = s1 + reverseAdjust(c, r, t) - s2;
        if (b > 0) value = adj2 = b;
        else { y = false; side = 1; value = adj1 = -1 * b; }
      }
    } else if (d > u) {
      side = 1;
      if (e > a) {
        const b = s2 + reverseAdjust(c, r, t) - s1;
        if (b > 0) value = adj1 = b;
        else { y = false; side = 2; value = adj2 = Math.abs(b); }
      } else {
        const g = s1 < s2 ? 1 : s2 < s1 ? 2 : -1;
        const w = reverseAdjust(Math.abs(e - a), r, t);
        if (w > 0 && g > 0) {
          side = g;
          if (g === 2) {
            const tt = w - (s1 - s2);
            if (tt > 0) value = adj2 = tt;
            else { y = false; value = adj2 = tt; }
          } else {
            const tt = w - (s2 - s1);
            if (tt > 0) {
              if (tt > KTC_MAX_PLAYER_VAL) { y = false; value = 0; side = 1; adj1 = 0; }
              else { side = 2; value = adj2 = tt; }
            } else { y = true; value = adj1 = -1 * tt; }
          }
        } else y = false;
      }
    } else {
      side = 2;
      if (a > e) {
        const b = s1 + reverseAdjust(c, r, t) - s2;
        if (b > 0) value = adj2 = b;
        else { y = false; side = 1; value = adj1 = Math.abs(b); }
      } else {
        const g = s1 < s2 ? 1 : s2 < s1 ? 2 : -1;
        const w = reverseAdjust(Math.abs(e - a), r, t);
        if (w > 0 && g > 0) {
          side = g;
          if (g === 1) {
            const tt = w - (s2 - s1);
            if (tt > 0) value = adj1 = tt;
            else { y = false; value = adj1 = tt; }
          } else {
            const tt = w - (s1 - s2);
            if (tt > 0) {
              if (tt > KTC_MAX_PLAYER_VAL) { y = false; value = 0; side = 1; adj2 = 0; }
              else { side = 1; value = adj1 = tt; }
            } else { y = true; value = adj2 = -1 * tt; }
          }
        } else y = false;
      }
    }
  } catch (err) {
    if (err instanceof SolveError) return null;
    throw err;
  }

  let shown = false;
  if (value !== 0) {
    shown = y;
    if (Math.abs(div(value, s1 + s2)) < KTC_DISPLAY_RATIO) shown = false;
  }
  shown = shown && (side1.length > 1 || side2.length > 1);
  return { adj1, adj2, side, shown };
}

// KTC's verdict for one trade: totals including the adjustment, and whether
// the site would call it fair (within `variance` percent).
export function ktcVerdict(side1, side2, top, variance = KTC_VARIANCE) {
  const raw1 = side1.reduce((s, v) => s + v, 0);
  const raw2 = side2.reduce((s, v) => s + v, 0);
  const adj = ktcAdjustment(side1, side2, top, variance) || { adj1: 0, adj2: 0, side: -1, shown: false };
  const total1 = raw1 + adj.adj1;
  const total2 = raw2 + adj.adj2;
  return { raw1, raw2, adj1: adj.adj1, adj2: adj.adj2, total1, total2, fair: checkEquality(total1, total2, variance) };
}

// FantasyCalc's dynasty adjustment: the side sending fewer pieces gets credit.
export function fcAdjustment(side1, side2) {
  const n1 = side1.length, n2 = side2.length;
  if (n1 === n2 || !n1 || !n2) return [0, 0];
  const more = n1 < n2 ? side2 : side1;
  const k = Math.abs(n1 - n2);
  const parts = [...more].sort((a, b) => a - b).slice(0, k)
    .map((v, i) => Math.min(v * FC_PCT_FACTOR, FC_ADJUSTMENT_FACTOR + i * FC_ADJUSTMENT_SCALAR));
  const adj = parts.reduce((s, p) => s + Math.floor(p), 0);
  return n1 < n2 ? [adj, 0] : [0, adj];
}

// Grades use each side's share of the combined value (after adjustments):
// edge = (received - gave) / (received + gave). KTC treats anything within
// 5% as fair; the scale widens from there so A+/F are for real blowouts.
export function gainPct(received, gave) {
  const total = Math.max(received + gave, 1);
  return (received - gave) / total;
}

export function letterGrade(received, gave) {
  const e = gainPct(received, gave);
  if (e >= 0.35) return 'A+';
  if (e >= 0.22) return 'A';
  if (e >= 0.13) return 'A-';
  if (e >= 0.05) return 'B+';
  if (e > -0.05) return 'B';
  if (e > -0.13) return 'B-';
  if (e > -0.22) return 'C';
  if (e > -0.35) return 'D';
  return 'F';
}
