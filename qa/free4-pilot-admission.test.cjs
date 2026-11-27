'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { EventEmitter } = require('node:events');
const Rules = require('../backend/railway/multi-board-rules.cjs');
const { requireRoomAccess } = require('../backend/auth/room-access.cjs');
const { readFree4Pilot } = require('../backend/railway/free4-pilot.cjs');

const uid = n => '11111111-1111-4111-8111-' + String(n).padStart(12, '0');
const roster = [1,2,3,4].map(uid);
const roomId = uid(10);
const config = {
  RAILWAY_ENVIRONMENT_NAME: 'staging',
  LUCKY_FREE4_PILOT: 'true',
  LUCKY_FREE4_PILOT_UIDS: roster.join(','),
  LUCKY_FREE4_PILOT_ROOM_ID: roomId
};
const source = readFileSync(require.resolve('../backend/railway/secure-server.cjs'), 'utf8');
function section(from, to) {
  const i = source.indexOf(from);
  const j = source.indexOf(to, i);
  assert.ok(i >= 0 && j > i);
  return source.slice(i,j);
}

// Exercise the real controller without loading credentials or opening a listener.
function fixture({pilot = readFree4Pilot(config), initial = null} = {}) {
  let row = initial && structuredClone(initial);
  const calls = [];
  const wss = new EventEmitter();
  const store = {
    player(id) { calls.push(['player', id]); },
    findResumableRoomForUid(id) { calls.push(['ordinary-lookup', id]); return null; },
    loadRoom(id) { calls.push(['load', id]); return id === roomId && row ? structuredClone(row) : null; },
    initializeRoom(x) {
      calls.push(['create', x.roomId, x.seats.map(s => s.uid)]);
      assert.equal(row, null, 'fixture must never insert a second room');
      row = {status:'playing', mode:x.mode, seats:x.seats, game_state:x.game, revision:0,
        deadline_ms:x.deadlineMs, lease_owner:x.ownerId, lease_epoch:1};
      return 1;
    },
    acquireRoomLease(id, owner) {
      calls.push(['claim', id]);
      row.lease_owner=owner;
      row.lease_epoch++;
      return {leaseEpoch:row.lease_epoch};
    },
    listRecoverableRooms(limit) { calls.push(['scan',limit]); return []; }
  };
  const deps = {Rules, requireRoomAccess, store, pilot, wss, MAX_CONNECTIONS:10,
    requirePlayerIdentity: async msg => ({uid:msg.accessToken}),
    WebSocket:{OPEN:1}, crypto:{randomUUID:() => uid(20)}, setTimeout:()=>({}), clearTimeout(){}};
  const code = section('const TURN_MS=', '// Readiness reports') +
    section("wss.on('connection'", 'beginListening({');
  const app = Function(...Object.keys(deps), "'use strict';\n"+code+
    '\nreturn {handle, rooms, recoverOrphanedRoomsAtStartup};')(...Object.values(deps));
  async function join(id, extra = {}) {
    const ws = Object.assign(new EventEmitter(), {readyState:1, bufferedAmount:0, received:[],
      send(x){this.received.push(JSON.parse(x));},
      close(){this.readyState=3;this.emit('close');}});
    wss.emit('connection', ws);
    await app.handle(ws, { ...extra, type:'join', mode:extra.mode||'free', accessToken:id });
    return ws;
  }
  return {...app, join, calls, row:()=>structuredClone(row)};
}

test('pilot off by default and activation requires staging and four distinct UIDs', () => {
  assert.equal(readFree4Pilot({}), null);
  assert.equal(readFree4Pilot({...config, LUCKY_FREE4_PILOT:'false'}), null);
  for (const override of [
    {RAILWAY_ENVIRONMENT_NAME:'production'},
    {LUCKY_FREE4_PILOT:'1'},
    {LUCKY_FREE4_PILOT_ROOM_ID:'bad'},
    {LUCKY_FREE4_PILOT_UIDS:[...roster.slice(0,3),roster[0]].join(',')}
  ]) assert.throws(() => readFree4Pilot({...config,...override}), /Invalid Free4 pilot/);
});

test('only the verified four start the fixed pilot, retain seats, and restore after restart', async () => {
  const f = fixture();
  await f.recoverOrphanedRoomsAtStartup();
  assert.deepEqual(f.calls, []);
  const outsider = await f.join(uid(5), {uid:roster[0], roomId, pilot:true});
  assert.equal(outsider.received.at(-1).type,'error');
  const vip = await f.join(roster[0],{mode:'vip'});
  assert.equal(vip.received.at(-1).type,'error');
  assert.deepEqual(f.calls, [], 'rejected identities must not reach the store');
  const sockets=[];
  for(const id of roster) sockets.push(await f.join(id,{roomId:uid(99)}));
  assert.deepEqual(f.calls.filter(c=>c[0]==='create'),[['create',roomId,roster]]);
  for(const [index,ws] of sockets.entries()){
    const state=ws.received.at(-1);
    assert.equal(state.event.type,'start');
    assert.equal(state.roomId,roomId);
    assert.equal(state.seat,index);
  }
  sockets[1].close();
  const same=await f.join(roster[1]);
  assert.equal(same.received.at(-1).event.type,'resume');
  assert.equal(same.received.at(-1).seat,1);

  const reboot=fixture({initial:f.row()});
  await reboot.recoverOrphanedRoomsAtStartup();
  const stranger=await reboot.join(uid(5),{roomId});
  assert.equal(stranger.received.at(-1).type,'error');
  assert.deepEqual(reboot.calls, []);
  const restored=await reboot.join(roster[2]);
  assert.equal(restored.received.at(-1).seat,2);
  assert.equal(restored.received.at(-1).event.type,'resume');
  assert.deepEqual(reboot.calls.filter(c=>c[0]==='claim'),[['claim',roomId]]);
  assert.ok(reboot.calls.every(c=>c[0]==='load'||c[0]==='claim'));
});

test('never allocate after the configured room is finished or has a mismatched roster', async () => {
  const f=fixture();
  for(const id of roster) await f.join(id);
  for(const initial of [{...f.row(),status:'finished'},
    {...f.row(),seats:[...f.row().seats.slice(0,3),{uid:uid(5)}]}]){
    const reboot=fixture({initial});
    const ws=await reboot.join(roster[0]);
    assert.equal(ws.received.at(-1).type,'error');
    assert.deepEqual(reboot.calls,[['load',roomId]]);
  }
});

test('ordinary Free access and startup lookup stay unchanged with the pilot off', async () => {
  const f=fixture({pilot:null});
  await f.recoverOrphanedRoomsAtStartup();
  const normal=await f.join(uid(5),{roomId,pilot:true});
  assert.equal(normal.received.at(-1).type,'waiting');
  assert.deepEqual(f.calls,[['scan',10],['ordinary-lookup',uid(5)],['player',uid(5)]]);
});
