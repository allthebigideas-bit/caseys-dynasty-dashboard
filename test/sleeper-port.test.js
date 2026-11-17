import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkSleeper } from '../lib/sleeper-port.js';

// A request Sleeper never answers: it settles only when its signal aborts.
const hang = (url, init) => new Promise((_, reject) => {
  init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

test('network adapter: a hung Sleeper request gives up after 25 seconds', async (t) => {
  t.mock.method(globalThis, 'fetch', hang);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const req = networkSleeper.league('1313340828264960001');
  let settled = false;
  req.catch(() => {}).finally(() => { settled = true; });
  t.mock.timers.tick(24999);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await assert.rejects(req, /api\.sleeper\.app timed out/);
});
