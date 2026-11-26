'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLeaderboardHandler } = require('../backend/railway/leaderboard-http-handler.cjs');

function fixture({ vip = false, score = '9007199254740993' } = {}) {
  const calls = [];
  const handler = createLeaderboardHandler({
    async verifyIdentity({ accessToken }) {
      calls.push('auth');
      if (accessToken !== 'fixture') throw Error('private auth detail');
      return { uid: 'verified-id' };
    },
    store: {
      async getVipEntitlement(uid) {
        calls.push(['vip', uid]);
        return vip && { uid, tier: 'vip', status: 'active', expiresAtMs: Date.now() + 60000 };
      },
      async leaderboard(mode) {
        calls.push(['read', mode]);
        return [{ uid: 'private-id', display_name: 'private-name', score }];
      }
    }
  });
  async function request(query, authorization = 'Bearer fixture', method = 'GET') {
    let status, headers, body;
    await handler({ method, url: '/api/leaderboard?' + query, headers: { authorization } }, {
      writeHead(code, values) { status = code; headers = values; },
      end(data) { body = JSON.parse(data); }
    });
    assert.equal(headers['Cache-Control'], 'private, no-store');
    return { status, body };
  }
  return { request, calls };
}

test('Free authenticates; VIP also checks the verified UID before the single score read', async () => {
  for (const mode of ['free', 'vip']) {
    const f = fixture({ vip: true });
    assert.deepEqual(await f.request('mode=' + mode), { status: 200,
      body: { rows: [['🥇', '👤', 'ผู้เล่น', '9007199254740993']] } });
    const expected = mode === 'vip' ? ['auth', ['vip', 'verified-id']] : ['auth'];
    assert.deepEqual(f.calls, [...expected, ['read', mode]]);
  }
});

test('invalid requests and denied identities perform zero score reads', async () => {
  const f = fixture();
  for (const query of ['', 'mode=other', 'mode=free&mode=vip'])
    assert.equal((await f.request(query)).status, 400);
  assert.equal((await f.request('mode=free', '', 'POST')).status, 405);
  assert.equal((await f.request('mode=free&accessToken=fixture', '')).status, 401);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(await f.request('mode=free', 'Bearer rejected'),
    { status: 401, body: { error: 'unauthorized' } });
  assert.deepEqual(await f.request('mode=vip&vip=true&uid=other'),
    { status: 403, body: { error: 'forbidden' } });
  assert.deepEqual(f.calls, ['auth', 'auth', ['vip', 'verified-id']]);
});

test('malformed stored score produces a generic response without a second read', async () => {
  const f = fixture({ score: 'private invalid data' });
  assert.deepEqual(await f.request('mode=free'), { status: 503, body: { error: 'unavailable' } });
  assert.deepEqual(f.calls, ['auth', ['read', 'free']]);
});
