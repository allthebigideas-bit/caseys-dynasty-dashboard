import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwt } from '../lib/sleeper.js';

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (json) => `${b64url('{"alg":"HS256"}')}.${b64url(json)}.sig`;

test('decodeJwt keeps a 19-digit numeric user_id exact', () => {
  // As a JS number this rounds to 1263912537670307800, an account with no leagues.
  const p = decodeJwt(token('{"user_id":1263912537670307840,"display_name":"Pooptoad"}'));
  assert.equal(p.user_id, '1263912537670307840');
  assert.equal(p.display_name, 'Pooptoad');
});

test('decodeJwt accepts a string user_id too', () => {
  assert.equal(decodeJwt(token('{"user_id":"460243821821685760"}')).user_id, '460243821821685760');
});

test('decodeJwt returns null for junk', () => {
  assert.equal(decodeJwt('not-a-token'), null);
});
