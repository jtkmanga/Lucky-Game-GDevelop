'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const Rules = require('../backend/railway/multi-board-rules.cjs');
const { requireRuleTransition } = require('../backend/railway/rule-transition-guard.cjs');
const { requireRoomAccess } = require('../backend/auth/room-access.cjs');
const source = fs.readFileSync(require.resolve('../backend/railway/secure-server.cjs'), 'utf8');
function section(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function fixture(ambiguous = false) {
  const wss = new EventEmitter();
  const game = Rules.create(['A','B','C','D'], 'free', () => 0);
  game.players[0].pos = 99;
  const seats = game.players.map(p => ({ uid: p.name, name: p.name }));
  const commits = [], auth = [];
  let owner, finished = false, inspections = 0;
  const store = {
    findResumableRoomForUid: uid => !finished && seats.some(s => s.uid === uid) ? 'old' : null,
    acquireRoomLease(id, who) { owner = who; return { leaseEpoch: 1 }; },
    loadRoom: () => ({ status: 'playing', mode: 'free', seats, game_state: structuredClone(game),
      revision: 7, deadline_ms: Date.now()+20000, lease_owner: owner, lease_epoch: 1 }),
    player() {},
    commitFencedTurn(turn) {
      commits.push(turn);
      if (ambiguous) throw Object.assign(Error('unknown'), { code: 'AMBIGUOUS_COMMIT' });
      finished = true;
      return turn.expectedRevision + 1;
    },
    readRoomAndAwards() { inspections++; throw Error('fixture unavailable'); }
  };
  const deps = { Rules, requireRuleTransition, requireRoomAccess, store, wss,
    requirePlayerIdentity: async msg => { auth.push(msg.accessToken); return { uid: msg.accessToken }; },
    WebSocket: { OPEN: 1 }, crypto: { randomUUID: () => 'owner', randomInt: () => 1 },
    setTimeout: () => ({}), clearTimeout() {}, console: { error() {} }, MAX_CONNECTIONS: 8 };
  const code = section('const TURN_MS=', '// Readiness reports') +
    section("wss.on('connection'", '// Bounded startup sweep');
  const app = Function(...Object.keys(deps), "'use strict';\n"+code+'\nreturn {handle,rooms,sessions,waiting};')(...Object.values(deps));
  async function join(uid) {
    const ws = Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount: 0, messages: [],
      send(s) { this.messages.push(JSON.parse(s)); }, close() { this.emit('close'); } });
    wss.emit('connection', ws);
    await app.handle(ws, { type: 'join', accessToken: uid, mode: 'free' });
    return ws;
  }
  return { ...app, join, commits, auth, inspections: () => inspections };
}

test('unfinished restore and reconnect keep the seat; confirmed winner can queue again', async () => {
  const f = fixture();
  const old = await f.join('A');
  const b = await f.join('B');
  old.close();
  const a = await f.join('A');
  assert.equal(a.messages.at(-1).event.type, 'resume');
  assert.equal(a.session.index, 0);
  await f.handle(a, { type: 'roll' });
  for (const ws of [a,b]) {
    const final = ws.messages.at(-1);
    assert.equal(final.game.over, true);
    assert.equal(final.event.outcome.type, 'win');
  }
  await f.handle(a, { type: 'roll' });
  const next = await f.join('A');
  assert.equal(next.messages.at(-1).type, 'waiting');
  a.close(); // delayed close from previous match must preserve the new registration
  assert.equal(f.sessions.get('A'), next.session);
  assert.deepEqual(f.waiting.free, [next.session]);
  assert.equal(f.rooms.has('old'), false);
  assert.deepEqual(f.auth, ['A','B','A','A']);
  assert.equal(f.commits.length, 1);
  assert.deepEqual(f.commits[0].awards, [{ eventId:'old:win', gameId:'old', mode:'free', uid:'A', kind:'win', points:10 }]);
});

test('ambiguous commit halts and retains reservations for reconciliation', async () => {
  const f = fixture(true), a = await f.join('A');
  const session = a.session;
  await f.handle(a, { type: 'roll' });
  assert.equal(f.inspections(), 1);
  assert.equal(f.rooms.get('old').halted, true);
  assert.equal(f.sessions.get('A'), session);
  assert.equal(a.session, session);
  assert.equal(a.messages.some(m => m.game?.over), false);
  const retry = await f.join('A');
  assert.equal(retry.messages.at(-1).type, 'error');
  assert.equal(f.waiting.free.length, 0);
  assert.equal(f.commits.length, 1);
});

test('cleanup preserves a pending reservation and stale room, seat, session or socket mappings', async () => {
  for (const change of [
    (f,s) => { s.pendingRoomId = 'reserved'; },
    (f,s) => { s.roomId = 'different'; },
    (f,s) => { s.index = 2; },
    (f,s) => { f.sessions.set(s.uid, { ...s }); },
    (f,s) => { s.ws.session = { ...s }; },
    f => { f.rooms.set('old', { ...f.rooms.get('old') }); }
  ]) {
    const f = fixture(), a = await f.join('A'), b = await f.join('B');
    const prior = a.session;
    const send = b.send.bind(b);
    b.send = data => { send(data); change(f,b.session); };
    await f.handle(a, { type: 'roll' });
    assert.equal(a.messages.at(-1).game.over, true);
    assert.equal(f.sessions.get('A'), prior);
    assert.equal(a.session, prior);
    assert.equal(f.rooms.has('old'), true);
  }
});
