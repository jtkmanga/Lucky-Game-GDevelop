'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const serverFile = require.resolve('../backend/railway/secure-server.cjs');
const source = fs.readFileSync(serverFile, 'utf8');
const start = source.indexOf('const leaderboard=');
const end = source.indexOf('const wss=', start);
assert.ok(start >= 0 && end > start);

function fixture(flag) {
  const calls = [];
  let dispatch;
  vm.runInNewContext(source.slice(start, end), {
    URL, require: createRequire(serverFile), process: { env: { LUCKY_ENABLE_LEADERBOARD: flag } },
    http: { createServer(fn) { dispatch = fn; } },
    requirePlayerIdentity: async ({ accessToken }) => {
      calls.push('auth');
      if (accessToken !== 'fixture') throw Error('denied');
      return { uid: 'verified' };
    },
    store: {
      getVipEntitlement(uid) { calls.push(['vip', uid]); return null; },
      leaderboard(mode) {
        calls.push(['scores', mode]);
        return [{ uid: 'private', display_name: 'private', score: '9007199254740993' }];
      }
    }
  });
  async function get(mode, authorization) {
    let status, body, headers;
    await dispatch({ method: 'GET', url: '/api/leaderboard?mode=' + mode, headers: { authorization } }, {
      writeHead(code, fields) { status = code; headers = fields; },
      end(value) { body = value; }
    });
    assert.equal(headers['Cache-Control'] ?? headers['cache-control'], 'private, no-store');
    return [status, body];
  }
  return { calls, get };
}

test('absent flag and other values return 404 without identity, entitlement or score reads', async () => {
  for (const flag of [undefined, 'false', '1', 'TRUE']) {
    const f = fixture(flag);
    assert.deepEqual(await f.get('vip', 'Bearer fixture'), [404, 'Not Found']);
    assert.deepEqual(f.calls, []);
  }
});

test('opt-in denies anonymous and non-entitled VIP; authorized Free reads once', async () => {
  const f = fixture('true');
  assert.equal((await f.get('free'))[0], 401);
  assert.deepEqual(f.calls, []);
  assert.equal((await f.get('vip', 'Bearer fixture'))[0], 403);
  assert.deepEqual(f.calls, ['auth', ['vip', 'verified']]);
  const [status, body] = await f.get('free', 'Bearer fixture');
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(body), { rows: [['🥇', '👤', 'ผู้เล่น', '9007199254740993']] });
  assert.deepEqual(f.calls, ['auth', ['vip', 'verified'], 'auth', ['scores', 'free']]);
});
