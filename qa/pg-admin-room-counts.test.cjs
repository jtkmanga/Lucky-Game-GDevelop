'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPgAdminRoomCounts } = require('../backend/admin/pg-room-counts.cjs');

test('trusted reader binds only verified UID and separates denial, empty counts and failure', async () => {
  const uid = '11111111-1111-4111-8111-111111111111';
  const request = { accessToken: 'fixture', uid: 'spoof', admin: true };
  const verifyIdentity = input => {
    assert.deepEqual(input, { accessToken: 'fixture' });
    return { uid };
  };
  assert.throws(() => createPgAdminRoomCounts({ verifyIdentity }), /ADMIN_ROOM_COUNTS_DISABLED/);
  const group = { mode: 'vip', status: 'closed', count: '9007199254740993' };
  const results = [[{ counts: [group] }], [{ counts: [] }], [{ counts: null }], [], null];
  const statements = [];
  const read = createPgAdminRoomCounts({ verifyIdentity, reader: {
    async query(sql, params) {
      statements.push(sql);
      assert.deepEqual(params, [uid]);
      const rows = results.shift();
      if (rows === null) throw Error('private driver diagnostic');
      return { rows };
    }
  }});
  assert.deepEqual(await read(request), [group]);
  assert.deepEqual(await read(request), []);
  await assert.rejects(read(request), { message: 'ADMIN_ACCESS_DENIED' });
  for (let i = 0; i < 2; i++)
    await assert.rejects(read(request), { message: 'ROOM_COUNTS_UNAVAILABLE' });
  assert.equal(statements.length, 5);
  assert.equal(new Set(statements).size, 1);
  assert.match(statements[0], /CASE WHEN game\.can_read_room_counts\(\$1::uuid\) IS TRUE THEN/i);
  assert.match(statements[0], /SELECT mode, status, count\(mode\)::text AS count\s+FROM game\.rooms\s+GROUP BY mode, status/i);
});
