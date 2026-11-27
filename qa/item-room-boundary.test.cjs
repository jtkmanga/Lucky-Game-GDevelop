'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const items = require('../backend/railway/match-item-admission.cjs');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'item-room-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
fs.cpSync(path.join(root, 'backend'), path.join(temp, 'backend'), { recursive: true });
execFileSync('git', ['apply', path.join(__dirname, 'fixtures/item-turn-candidate.patch')], { cwd: temp });
const Rules = require(path.join(temp, 'backend/railway/multi-board-rules.cjs'));
const { requireRuleTransition } = require(path.join(temp, 'backend/railway/rule-transition-guard.cjs'));

// Extract the real controller, excluding configuration, listener and startup side effects.
const source = fs.readFileSync(path.join(temp, 'backend/railway/secure-server.cjs'), 'utf8');
const start = source.indexOf('const TURN_MS='), end = source.indexOf('// Readiness reports');
assert.ok(start >= 0 && end > start);
let controller = source.slice(start, end);
function replaceOnce(anchor, replacement) {
  assert.equal(controller.split(anchor).length, 2, anchor);
  controller = controller.replace(anchor, () => replacement);
}
replaceOnce('const session={uid,mode', 'const session={uid,verified:true,mode');
replaceOnce('   let leaseEpoch;', `   if (readEntitlements) {
     try {
       const rows = await readEntitlements(seats.map(s => s.uid));
       game.matchItems = items.admitMatchItems(seats, rows);
     } catch {
       pendingCreates.delete(id);
       for (const s of seats) {
         s.pendingRoomId=null; s.index=null;
         sessions.delete(s.uid);
         if(s.ws) s.ws.session=null;
         send(s.ws,{type:'error',message:'Item lookup failed; rejoin'});
       }
       continue;
     }
   }
   let leaseEpoch;`);
replaceOnce('Rules.assertRoomBoard(row.game_state);',
  'Rules.assertRoomBoard(row.game_state); items.restoreMatchItems(row.game_state);');
replaceOnce("uid:target.uid,kind:'win',points:10",
  "uid:target.uid,kind:'win',points:next.players[actor].score-old.players[actor].score-outcome.reward");
replaceOnce('if(Object.hasOwn(room.game,\'board\'))return room.game;', `const {matchItems,...publicGame}=room.game;
 if(Object.hasOwn(publicGame,'board'))return publicGame;`);
replaceOnce('return {...room.game,board:', 'return {...publicGame,board:');

const uids = 'abcd'.split('').map(c => c.repeat(8) + '-0000-4000-8000-000000000000');
function server(store, readEntitlements) {
  const dependencies = { store, readEntitlements, items, Rules, requireRuleTransition,
    crypto: { randomUUID: crypto.randomUUID, randomInt: () => 1, randomBytes: size => Buffer.alloc(size) }, WebSocket: { OPEN: 1 },
    requireRoomAccess: require('../backend/auth/room-access.cjs').requireRoomAccess,
    requirePlayerIdentity: async msg => {
      const uid = uids[msg.accessToken];
      if (!uid) throw Error('Unknown fixture identity');
      return { uid };
    },
    setTimeout: () => ({}), clearTimeout: () => {}
  };
  return Function(...Object.keys(dependencies), "'use strict';\n" + controller +
    '\nreturn {handle,pendingCreates,sessions,rooms};')(...Object.values(dependencies));
}
function database() {
  const db = { creates: [], turns: [], player() {},
    findResumableRoomForUid(uid) {
      if (db.row?.seats.some(s => s.uid === uid)) return db.row.id;
    },
    initializeRoom(args) {
      db.creates.push(structuredClone(args));
      db.row = { id: args.roomId, mode: args.mode, seats: args.seats, status: 'playing',
        revision: 0, game_state: structuredClone(args.game), deadline_ms: args.deadlineMs };
      return 1;
    },
    acquireRoomLease(id, owner) {
      assert.equal(id, db.row.id);
      db.row.lease_owner = owner;
      db.row.lease_epoch = (db.row.lease_epoch || 1) + 1;
      return { leaseEpoch: db.row.lease_epoch };
    },
    loadRoom: () => structuredClone(db.row),
    commitFencedTurn(turn) {
      assert.equal(turn.expectedRevision, db.row.revision);
      db.turns.push(structuredClone(turn));
      db.row.game_state = structuredClone(turn.game);
      return ++db.row.revision;
    }
  };
  return db;
}
async function join(app, index) {
  const ws = { readyState: 1, bufferedAmount: 0, messages: [], send(s) { this.messages.push(JSON.parse(s)); } };
  await app.handle(ws, { type: 'join', mode: 'free', accessToken: index,
    uid: uids[3-index], verified: true, shield: true, doubleWin: true });
  return ws;
}
async function fill(app) {
  const sockets = [];
  for (const i of uids.keys()) sockets.push(await join(app, i));
  return sockets;
}

test('disabled dispatch inserts a legacy room despite client item claims', async () => {
  const db = database();
  await fill(server(db));
  assert.equal(db.creates.length, 1);
  assert.equal(Object.hasOwn(db.creates[0].game, 'matchItems'), false);
});

test('failed lookup releases every reservation before initializeRoom; same identities retry', async () => {
  const db = database();
  let attempts = 0;
  const app = server(db, async ids => {
    assert.equal(app.pendingCreates.size, 1);
    assert.ok(ids.every(id => app.sessions.get(id).pendingRoomId));
    if (++attempts === 1) throw Error('lookup unavailable');
    return ids.map(uid => ({ uid, shield: false, doubleWin: false }));
  });
  const sockets = await fill(app);
  assert.equal(db.creates.length, 0);
  assert.equal(app.pendingCreates.size, 0);
  assert.equal(app.sessions.size, 0);
  assert.ok(sockets.every(ws => ws.session === null && ws.messages.at(-1).type === 'error'));
  await fill(app);
  assert.equal(db.creates.length, 1);
});

test('verified admission, shield consumption, cold resume and guarded winner credit', async () => {
  const db = database();
  let reads = 0;
  const reader = ids => {
    assert.equal(++reads, 1);
    assert.deepEqual(ids, uids);
    assert.equal(db.creates.length, 0);
    return ids.map((uid, i) => ({ uid, shield: i === 0, doubleWin: i === 0 })).reverse();
  };
  const sockets = await fill(server(db, reader));
  const created = db.creates[0];
  assert.deepEqual(created.seats.map(s => s.uid), uids);
  assert.deepEqual(created.game.matchItems.players.map(p => [p.shieldRemaining,p.winMultiplier]),
    [[1,2],[0,1],[0,1],[0,1]]);
  assert.equal(Object.hasOwn(sockets[0].messages.at(-1).game, 'matchItems'), false);

  // Stage two near-event checkpoints; both transitions run through handle('roll').
  db.row.game_state.players[0].pos = 36;
  const cold = server(db, reader);
  await cold.handle(await join(cold, 0), { type: 'roll' });
  assert.equal(db.turns[0].receipt.outcome.type, 'shield');
  assert.equal(db.row.game_state.matchItems.players[0].shieldRemaining, 0);
  db.row.game_state.current = 0;
  db.row.game_state.players[0].pos = 99;
  const resumed = server(db, reader);
  const ws = await join(resumed, 0);
  assert.equal(ws.messages.at(-1).event.type, 'resume');
  assert.deepEqual(resumed.rooms.get(db.row.id).game.matchItems.players[0], { shieldRemaining: 0, winMultiplier: 2 });
  await resumed.handle(ws, { type: 'roll' });
  await resumed.handle(ws, { type: 'roll' });
  assert.equal(reads, 1);
  assert.equal(db.turns.length, 2);
  const win = db.turns[1];
  assert.equal(win.game.players[0].score, 20);
  assert.deepEqual(win.awards, [{ eventId: db.row.id+':win', gameId: db.row.id, mode: 'free', uid: uids[0], kind: 'win', points: 20 }]);
});

test('synthetic windows across successive admissions and cold resume', async () => {
  const source = require('./fixtures/synthetic-item-windows.cjs');
  const start = Date.UTC(2030, 0, 1);
  const end = start + 24 * 60 * 60 * 1000;
  const grants = [
    {uid:uids[0], item:'shield', startMs:start, endMs:end},
    {uid:uids[1], item:'doubleWin', startMs:start-100, endMs:end+100}
  ];
  let instant = start, samples = 0;
  const reader = source(async ids => {
    assert.deepEqual(ids, uids);
    samples++;
    return {complete:true, atMs:instant, windows:grants};
  });
  async function create() {
    const db = database();
    await fill(server(db, reader));
    assert.equal(db.creates.length, 1);
    assert.equal(db.row.mode, 'free');
    return db;
  }
  async function rollAfterResume(db, seat, position) {
    db.row.game_state.current = seat;
    db.row.game_state.players[seat].pos = position;
    const cold = server(db, reader);
    const ws = await join(cold, seat);
    assert.equal(ws.messages.at(-1).event.type, 'resume');
    await cold.handle(ws, {type:'roll'});
    return db.turns.at(-1);
  }
  for (const [index, at] of [start,end-1].entries()) {
    instant = at;
    const db = await create();
    assert.deepEqual(db.row.game_state.matchItems.players.map(p => [p.shieldRemaining,p.winMultiplier]),
      [[1,1],[0,2],[0,1],[0,1]]);
    assert.equal((await rollAfterResume(db,0,36)).receipt.outcome.type, 'shield');
    // The second match crosses expiry before a cold restore.
    if (index === 1) instant = end;
    const spent = await rollAfterResume(db,0,36);
    assert.equal(spent.receipt.outcome.type, 'snake');
    assert.equal(spent.game.matchItems.players[0].shieldRemaining, 0);
    const box = await rollAfterResume(db,1,db.row.game_state.gift-1);
    assert.deepEqual(box.awards.map(a => [a.kind,a.points,a.uid]), [['lucky_box',10,uids[1]]]);
    const win = await rollAfterResume(db,1,99);
    assert.deepEqual(win.awards.map(a => [a.kind,a.points,a.uid]), [['win',20,uids[1]]]);
    assert.equal(win.game.players[1].score, 30);
    assert.equal(samples, index+1);
  }
  instant = end;
  const expired = await create();
  assert.deepEqual(expired.row.game_state.matchItems.players.map(p => [p.shieldRemaining,p.winMultiplier]),
    [[0,1],[0,2],[0,1],[0,1]]);
  assert.equal(samples, 3);
  for (const [atMs,shield,doubleWin] of [[start-101,false,false],[start-100,false,true],[end+100,false,false]]) {
    const rows = await source(() => ({complete:true, atMs, windows:grants}))(uids);
    assert.deepEqual(rows, uids.map((uid,i) => ({uid,shield:i===0 && shield,doubleWin:i===1 && doubleWin})));
  }
  const empty = await source(() => ({complete:true,atMs:start,windows:[]}))(uids);
  assert.deepEqual(empty, uids.map(uid => ({uid,shield:false,doubleWin:false})));
  for (const readBatch of [
    () => { throw Error('unavailable'); },
    () => ({complete:false,atMs:start,windows:[]}),
    () => ({complete:true,atMs:NaN,windows:[]}),
    () => ({complete:true,atMs:start,windows:[{...grants[0],endMs:start}]}),
    () => ({complete:true,atMs:start,windows:[grants[0],grants[0]]})
  ]) {
    const db = database();
    const sockets = await fill(server(db, source(readBatch)));
    assert.equal(db.creates.length, 0);
    assert.ok(sockets.every(ws => ws.session === null && ws.messages.at(-1).type === 'error'));
  }
});
