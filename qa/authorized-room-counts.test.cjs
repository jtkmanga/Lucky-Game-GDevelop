'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthorizedRoomCounts } = require('../backend/admin/room-counts.cjs');

const client = { accessToken: 'fixture', uid: 'spoof', admin: true };
const verified = { uid: 'verified-fixture', email: 'private' };
const denied = { message: 'ADMIN_ACCESS_DENIED' };
const unavailable = { message: 'ROOM_COUNTS_UNAVAILABLE' };

test('each request verifies and makes one UID-bound decision, including after mock revocation', async () => {
  const calls = [];
  let grant = true;
  const read = createAuthorizedRoomCounts({
    verifyIdentity(input) { calls.push(input); return verified; },
    readAuthorizedRoomCounts(uid) {
      calls.push(uid);
      return grant ? { authorized: true, rows: [] } : { authorized: false };
    }
  });
  assert.deepEqual(await read(client), []);
  grant = false;
  await assert.rejects(read(client), denied);
  assert.deepEqual(calls, [{ accessToken: 'fixture' }, verified.uid, { accessToken: 'fixture' }, verified.uid]);
});

test('invalid identity never reaches the reader', async () => {
  let reads = 0;
  const read = createAuthorizedRoomCounts({ verifyIdentity: () => ({}), readAuthorizedRoomCounts: () => reads++ });
  await assert.rejects(read(client), denied);
  assert.equal(reads, 0);
});

test('only normalized aggregate fields leave the adapter; failures reveal no details', async () => {
  const run = reader => createAuthorizedRoomCounts({ verifyIdentity: () => verified, readAuthorizedRoomCounts: reader })(client);
  const row = { mode: 'free', status: 'playing', count: '9007199254740993' };
  assert.deepEqual(await run(() => ({ authorized: true, rows: [{ ...row, ...verified }] })), [row]);
  for (const decision of [null, { rows: [] }, { authorized: 'true', rows: [] }, { authorized: false, rows: [row] }])
    await assert.rejects(run(() => decision), denied);
  for (const rows of [null, Array(1), [row, row], [{ ...row, status: 'private' }]])
    await assert.rejects(run(() => ({ authorized: true, rows })), unavailable);
  await assert.rejects(run(() => { throw Error('private storage detail'); }), unavailable);
});
