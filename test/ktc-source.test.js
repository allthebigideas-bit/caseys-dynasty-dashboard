import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBook, withKtcSource, playerValue, pickValue } from '../lib/values.js';

const fmt = { superflex: true, ktcTier: 0, qbs: 2, teams: 12, ppr: 0.5 };
const row = (id, name, pos, crowd, trade, blend) => ({ id, name, pos, team: 'DET', v: [crowd, crowd, crowd, crowd], sf: [crowd, crowd, crowd, crowd], vt: [trade, trade, trade, trade], sft: [trade, trade, trade, trade], vb: [blend, blend, blend, blend], sfb: [blend, blend, blend, blend] });

function book() {
  const ktc = [];
  const sleeperDict = {};
  for (let i = 0; i < 150; i++) {
    ktc.push(row(String(i), `Player ${i}`, 'WR', 9000 - i * 10, 8000 - i * 10, 8500 - i * 10));
    sleeperDict[`s${i}`] = [`Player ${i}`, 'WR', 'DET', 25, ''];
  }
  ktc.push({ ...row('p1', '2027 Mid 1st', 'PICK', 5000, 4000, 4500) });
  return buildBook({ fmt, ktc, fc: null, dp: null, crosswalk: [], sleeperDict, status: {} });
}

test('crowdsourced is the default and the other sources swap values', () => {
  const b = book();
  const sid = Object.keys(b.players)[0];
  const crowd = playerValue(b, sid).v;
  const trade = playerValue(withKtcSource(b, 'trade'), sid).v;
  const blend = playerValue(withKtcSource(b, 'blend'), sid).v;
  assert.equal(crowd - trade, 1000);
  assert.equal(crowd - blend, 500);
  assert.equal(withKtcSource(b, 'trade').ktcTop, 8000);
  assert.equal(withKtcSource(b, 'crowd'), b);
  assert.equal(pickValue(withKtcSource(b, 'trade'), 2027, 1, 'mid'), 4000);
});
