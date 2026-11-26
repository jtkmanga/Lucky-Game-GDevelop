'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminRoomCounts } = require('../backend/admin/room-counts.cjs');

const uid = '33333333-3333-4333-8333-333333333333';
const client = { accessToken: 'fixture', uid: 'other', admin: true, vip: true };
const verifyIdentity = async () => ({ uid, vip: true });
const readAdminGrant = async () => ({ uid, admin: true });

test('invalid identity stops before grant lookup or room read', async () => {
  let calls = 0;
  for (const verify of [() => null, () => ({ uid: '' }), () => { throw Error('private'); }]) {
    const read = createAdminRoomCounts({ verifyIdentity: verify, readAdminGrant: () => calls++, query: () => calls++ });
    await assert.rejects(read(client), { message: 'ADMIN_ACCESS_DENIED' });
  }
  assert.equal(calls, 0);
});

test('missing, failed, malformed, VIP-only or mismatched grants deny before query', async () => {
  let reads = 0;
  for (const grant of [undefined, () => { throw Error('private'); }, () => null, () => true,
    () => ({ uid, vip: true }), () => ({ uid, admin: false }), () => ({ uid, admin: 'true' }),
    () => ({ uid: 'other', admin: true }), () => ({ uid, admin: true, revoked: true })]) {
    const read = createAdminRoomCounts({ verifyIdentity, readAdminGrant: grant, query: () => reads++ });
    await assert.rejects(read(client), { message: 'ADMIN_ACCESS_DENIED' });
  }
  assert.equal(reads, 0);
});

test('verified UID authorizes one grouped SELECT; only aggregate fields leave the module', async () => {
  const calls = [];
  const row = { mode: 'free', status: 'playing', count: '9007199254740993' };
  const read = createAdminRoomCounts({
    verifyIdentity(message) { calls.push(message); return { uid }; },
    readAdminGrant(id) { calls.push(id); return { uid, admin: true }; },
    query(sql) { calls.push(sql); return { rows: [{ ...row, seats: ['private'] }] }; }
  });
  assert.deepEqual(await read(client), [row]);
  assert.deepEqual(calls, [{ accessToken: 'fixture' }, uid,
    'SELECT mode, status, count(*)::text AS count FROM game.rooms GROUP BY mode, status ORDER BY mode, status']);
});

test('empty results stay empty; invalid aggregates and store errors are sanitized', async () => {
  const row = { mode: 'vip', status: 'closed', count: '1' };
  const run = query => createAdminRoomCounts({ verifyIdentity, readAdminGrant, query })(client);
  assert.deepEqual(await run(() => ({ rows: [] })), []);
  for (const rows of [[{ ...row, mode: 'other' }], [{ ...row, status: 'private' }],
    [{ ...row, count: '9223372036854775808' }], [{ ...row, count: '1.5' }], [row, row]])
    await assert.rejects(run(() => ({ rows })), { message: 'ROOM_COUNTS_UNAVAILABLE' });
  await assert.rejects(run(() => { throw Error('private database detail'); }), { message: 'ROOM_COUNTS_UNAVAILABLE' });
});
