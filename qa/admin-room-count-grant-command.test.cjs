'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomCountGrantCommand } = require('../backend/admin/room-count-grant-command.cjs');

const id = n => 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(n).padStart(12, '0');
const token = n => 'offline-synthetic-access-token-without-authority-' + n;

function fixture(t) {
  const origin = 'https://llbkxnazkliskzcureec.supabase.co';
  const operators = new Set([id(1), id(2)]);
  const sessions = new Map([1,2,3].map(n => ['Bearer ' + token(n), id(n)]));
  for (const [key, value] of Object.entries({SUPABASE_URL: origin, SUPABASE_PUBLISHABLE_KEY: 'offline-key'})) {
    const previous = process.env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    process.env[key] = value;
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, origin + '/auth/v1/user');
    const uid = sessions.get(options.headers.authorization);
    return uid ? Response.json({ id: uid, aud: 'authenticated' }) : new Response(null, { status: 401 });
  });

  const f = { operators, state: { grants: new Set(), receipts: new Map() }, transactions: 0, failAudit: false };
  f.execute = createRoomCountGrantCommand({
    async transactionForRequest(requestId, work) {
      f.transactions++;
      const draft = structuredClone(f.state);
      const result = await work({
        isOperator: uid => operators.has(uid),
        sessionPrincipal: () => 'shared-test-login',
        findReceipt: key => draft.receipts.get(key),
        setGrant(uid, desired) {
          const before = draft.grants.has(uid);
          if (desired) draft.grants.add(uid); else draft.grants.delete(uid);
          return before !== desired;
        },
        appendReceipt(row) {
          assert.equal(row.requestId, requestId);
          assert.ok(!draft.receipts.has(requestId));
          draft.receipts.set(requestId, row);
          if (f.failAudit) throw Error('Audit failed');
        }
      });
      f.state = draft;
      return result;
    }
  });
  return f;
}
const grant = { targetUid: id(4), desired: true, requestId: id(5), actorUid: id(2), operator: true };

test('server Auth and independent authority gate mutations and replays', async t => {
  const f = fixture(t);
  await assert.rejects(f.execute(token(99), grant), /UNAUTHENTICATED/);
  assert.equal(f.transactions, 0);
  await assert.rejects(f.execute(token(3), grant), /access denied/);
  assert.equal(f.state.receipts.size, 0);
  assert.equal(await f.execute(token(1), grant), true);
  assert.deepEqual(f.state.receipts.get(id(5)), {
    targetUid: id(4), desired: true, requestId: id(5), actorUid: id(1),
    sessionPrincipal: 'shared-test-login', changed: true
  });
  f.operators.delete(id(1));
  await assert.rejects(f.execute(token(1), grant), /access denied/);
});

test('shared-login actor mismatch fails and changed/no-op replays survive revoke', async t => {
  const f = fixture(t);
  const noop = {...grant, requestId: id(6)};
  assert.equal(await f.execute(token(1), grant), true);
  assert.equal(await f.execute(token(1), noop), false);
  assert.equal(await f.execute(token(2), {...grant, desired:false, requestId:id(7)}), true);
  const before = structuredClone(f.state);
  assert.equal(await f.execute(token(1), grant), true);
  assert.equal(await f.execute(token(1), noop), false);
  await assert.rejects(f.execute(token(2), grant), /ID conflict/);
  for (const fields of [{targetUid:id(8)}, {desired:false}])
    await assert.rejects(f.execute(token(1), {...grant, ...fields}), /ID conflict/);
  assert.deepEqual(f.state, before);
  assert.equal(f.state.grants.size, 0);
});

test('audit failure rolls back both writes and leaves the ID available', async t => {
  const f = fixture(t);
  f.failAudit = true;
  await assert.rejects(f.execute(token(1), grant), /Audit failed/);
  assert.equal(f.state.grants.size, 0);
  assert.equal(f.state.receipts.size, 0);
  f.failAudit = false;
  assert.equal(await f.execute(token(1), grant), true);
});
