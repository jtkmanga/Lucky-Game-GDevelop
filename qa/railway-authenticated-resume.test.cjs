'use strict';

// Local-only auth boundary fixture. No application flags or provider credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once, EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { WebSocket, WebSocketServer } = require('ws');
const Rules = require('../backend/railway/multi-board-rules.cjs');

const entry = require.resolve('../backend/railway/secure-server.cjs');
const serverRequire = createRequire(entry);
const source = fs.readFileSync(entry, 'utf8');
const roomId = 'fixture-room';
const names = ['Ann', 'Bee', 'Chai', 'Dao'];
const seats = names.map((name, i) => ({ name, uid: 'fixture-' + i }));

async function start(t, corrupt = false) {
  const game = Rules.create(names, 'free', () => 0.25, 3);
  if (corrupt) game.board = null;
  const row = {
    status: 'playing', mode: 'free', seats, revision: 7,
    deadline_ms: Date.now() + 60000, game_state: game
  };
  const lookups = [], tokens = [], errors = [], reads = [];
  const store = {
    async health() {},
    async listRecoverableRooms() { return []; },
    async findResumableRoomForUid(uid) {
      lookups.push(uid);
      return seats.some(s => s.uid === uid) ? roomId : null;
    },
    async acquireRoomLease(id, owner) {
      assert.equal(id, roomId);
      row.lease_owner = owner;
      row.lease_epoch = 1;
      return { leaseEpoch: 1 };
    },
    async loadRoom(id) {
      reads.push(id);
      return structuredClone(row);
    }
  };
  const signals = new EventEmitter();
  signals.env = { PORT: '0' };
  const timers = new Set(), clients = new Set();
  let listener;
  const deps = {
    ws: { WebSocket, WebSocketServer },
    'node:http': {
      createServer(handler) {
        listener = http.createServer(handler);
        const listen = listener.listen.bind(listener);
        listener.listen = (_port, _host, ready) => listen(0, '127.0.0.1', ready);
        return listener;
      }
    },
    '../auth/supabase-access-token.cjs': {
      readConfig: () => ({ origin: 'http://fixture.invalid' }),
      async requirePlayerIdentity(message) {
        tokens.push(message.accessToken);
        if (message.accessToken !== 'fixture-ticket') throw Error('UNKNOWN_FIXTURE_IDENTITY');
        return { uid: seats[2].uid };
      }
    },
    '../supabase/game-store.cjs': { createRailwayStore: () => store }
  };
  t.after(async () => {
    for (const timer of timers) clearTimeout(timer);
    for (const client of clients) client.terminate();
    if (listener?.listening) await new Promise(resolve => listener.close(resolve));
  });
  vm.runInNewContext(source, {
    require: name => Object.hasOwn(deps, name) ? deps[name] : serverRequire(name),
    __dirname: path.dirname(entry), process: signals, URL, Buffer, structuredClone,
    console: { log() {}, error: (...args) => errors.push(args.join(' ')) },
    clearTimeout, setTimeout(fn, ms) {
      const timer = setTimeout(fn, ms);
      timers.add(timer);
      return timer;
    }
  }, { filename: entry });
  await once(listener, 'listening', { signal: AbortSignal.timeout(3000) });
  async function join(token) {
    const client = new WebSocket('ws://127.0.0.1:' + listener.address().port + '/ws');
    clients.add(client);
    await once(client, 'open', { signal: AbortSignal.timeout(3000) });
    const reply = once(client, 'message', { signal: AbortSignal.timeout(3000) });
    client.send(JSON.stringify({ type: 'join', mode: 'free', accessToken: token }));
    const [data] = await reply;
    return { client, frame: JSON.parse(data.toString()) };
  }
  return { join, game, lookups, reads, tokens, errors };
}

test('restored seat belongs to the verified identity across two connections', async t => {
  const f = await start(t);
  const invalid = await f.join('unknown-ticket');
  assert.equal(invalid.frame.type, 'error');
  assert.deepEqual(f.lookups, []);
  const first = await f.join('fixture-ticket');
  const closed = once(first.client, 'close', { signal: AbortSignal.timeout(3000) });
  first.client.close();
  await closed;
  const again = await f.join('fixture-ticket');
  for (const { frame } of [first, again]) {
    assert.equal(frame.type, 'state');
    assert.equal(frame.event.type, 'resume');
    assert.equal(frame.roomId, roomId);
    assert.equal(frame.seat, 2);
    assert.deepEqual(frame.game, f.game);
  }
  assert.deepEqual(f.tokens, ['unknown-ticket', 'fixture-ticket', 'fixture-ticket']);
  assert.deepEqual(f.lookups, [seats[2].uid]);
  assert.deepEqual(f.reads, [roomId]);
});

test('verified join rejects a corrupt stored map before restoring the seat', async t => {
  const f = await start(t, true);
  const { frame } = await f.join('fixture-ticket');
  assert.equal(frame.type, 'error');
  assert.deepEqual(f.lookups, [seats[2].uid]);
  assert.deepEqual(f.reads, [roomId]);
  assert.ok(f.errors.some(line => line.includes('BOARD_CHECKPOINT_MISMATCH')), f.errors.join('\n'));
});
