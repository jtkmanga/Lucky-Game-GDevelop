'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPooledAdminRoomCounts } = require('../backend/admin/pooled-room-counts.cjs');

function fixture({ counts = [], ready = true, failAt, configure = {}, poolOptions = {} } = {}) {
  const calls = [], released = [];
  const readerLogin = 'synthetic_reader';
  const readerPool = {
    options: { user: readerLogin, connectionTimeoutMillis: 750, statement_timeout: 1200, ...poolOptions },
    async connect() {
      calls.push('checkout');
      if (failAt === 'checkout') throw Error('driver detail');
      return {
        async query({ text, values, query_timeout }) {
          assert.equal(query_timeout, 5000);
          const step = text.includes('AS ready') ? 'verify'
            : text.includes('can_read_room_counts') ? 'counts' : text;
          calls.push(step);
          if (step === failAt) throw Error('driver detail');
          if (step === 'verify') {
            assert.deepEqual(values, [readerLogin, 2000]);
            for (const term of ['session_user', 'transaction_read_only', 'row_security_active',
              'statement_timeout', "unit = 'ms'", 'rolbypassrls', 'pg_has_role', 'set_room_count_grant'])
              assert.ok(text.includes(term));
            return { rows: [{ ready }] };
          }
          if (step === 'counts') {
            assert.deepEqual(values, ['verified-subject']);
            return { rows: [{counts}] };
          }
          return { rows: [] };
        },
        release(discard) { released.push(discard); }
      };
    }
  };
  return { calls, released, open: () => createPooledAdminRoomCounts({
    verifyIdentity: () => ({ uid: 'verified-subject' }), readerPool, readerLogin,
    connectionMode: 'verified-direct', ...configure
  }) };
}
const request = { accessToken: 'fixture', uid: 'spoof', role: 'admin' };
const steps = ['checkout', 'BEGIN READ ONLY', 'SET LOCAL search_path = pg_catalog, pg_temp',
  'SET LOCAL ROLE lucky_count_reader', 'verify', 'counts', 'COMMIT'];

test('activation requires a dedicated login, bounded native pool options and verified affinity', () => {
  for (const opts of [{ configure: { connectionMode: undefined } },
    { configure: { connectionMode: 'transaction' } }, { configure: { readerLogin: 'wrong' } },
    { configure: { readerLogin: 'lucky_game_server_login' }, poolOptions: { user: 'lucky_game_server_login' } },
    { poolOptions: { connectionTimeoutMillis: 0 } }, { poolOptions: { connectionTimeoutMillis: 2001 } },
    { poolOptions: { statement_timeout: undefined } }, { poolOptions: { statement_timeout: 2001 } }]) {
    const f = fixture(opts);
    assert.throws(f.open, /ADMIN_ROOM_COUNTS_DISABLED/);
    assert.deepEqual(f.calls, []);
  }
});
test('verified UID gets a fresh checked transaction for every read including denial', async () => {
  for (const counts of [[], [{mode:'free',status:'playing',count:'7'}], null]) {
    const f = fixture({ counts }), read = f.open();
    for (let i = 0; i < 2; i++) {
      if (counts === null) await assert.rejects(read(request), {message:'ADMIN_ACCESS_DENIED'});
      else assert.deepEqual(await read(request), counts);
    }
    assert.deepEqual(f.calls, [...steps, ...steps]);
    assert.deepEqual(f.released, [false, false]);
  }
});
test('invalid identity performs zero checkouts', async () => {
  const f = fixture({ configure: {verifyIdentity: () => ({})} });
  await assert.rejects(f.open()(request), {message:'ADMIN_ACCESS_DENIED'});
  assert.deepEqual(f.calls, []);
});
test('failed effective-session predicate cannot reach counts', async () => {
  for (const ready of [false, null, 'true']) {
    const f = fixture({ ready });
    await assert.rejects(f.open()(request), {message:'ROOM_COUNTS_UNAVAILABLE'});
    assert.deepEqual(f.calls, steps.slice(0, 5));
    assert.deepEqual(f.released, [true]);
  }
});
for (const [index, failAt] of steps.entries()) test('failure at '+failAt, async () => {
  const f = fixture({ failAt });
  await assert.rejects(f.open()(request), {message:'ROOM_COUNTS_UNAVAILABLE'});
  assert.deepEqual(f.calls, steps.slice(0, index+1));
  assert.deepEqual(f.released, index ? [true] : []);
});
