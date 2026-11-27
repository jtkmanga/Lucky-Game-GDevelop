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
  LUCKY_FREE4_PILOT_CUTOFF_MS:'1900000000000',
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
function fixture({pilot = readFree4Pilot(config), initial = null, commit, denyClaims = 0, beforeInspect, createFailure} = {}) {
  let row = initial && structuredClone(initial);
  const calls = [];
  const timers=new Map();
  let now=Number(config.LUCKY_FREE4_PILOT_CUTOFF_MS)-100;
  let fence='open',lostClose=false,failRead=false;
  const clock={now:()=>now};
  const wss = new EventEmitter();
  const store = {
    commitFencedTurn:commit,
    readRoomAndAwards(){calls.push(['read-evidence']);throw Error('offline evidence unavailable');},
    async inspectPilotFence(args){
      calls.push(['inspect',args.expectedRevision]);
      assert.equal(args.roomId,roomId);
      assert.equal(args.leaseEpoch,row.lease_epoch);
      assert.equal(args.ownerId,row.lease_owner);
      if(beforeInspect)await beforeInspect();
      return fence;
    },
    closeExpiredPilot(args){
      calls.push(['close',args.expectedRevision]);
      row.status='closed';
      if(lostClose)throw Object.assign(Error('ack lost'),{code:'AMBIGUOUS_COMMIT'});
      return row.status;
    },
    player(id) { calls.push(['player', id]); },
    findResumableRoomForUid(id) { calls.push(['ordinary-lookup', id]); return null; },
    loadRoom(id) {
      calls.push(['load',id]);
      if(failRead){failRead=false;throw Object.assign(Error('connection lost'),{code:'ECONNRESET'});}
      return id===roomId&&row?structuredClone(row):null;
    },
    initializeRoom(x) {
      calls.push(['create', x.roomId, x.seats.map(s => s.uid)]);
      assert.equal(row, null, 'fixture must never insert a second room');
      if(createFailure==='absent'){createFailure=null;throw Error('no insert');}
      row = {status:'playing', mode:x.mode, seats:x.seats, game_state:x.game, revision:0,
        deadline_ms:x.deadlineMs, lease_owner:x.ownerId, lease_epoch:1};
      if(createFailure==='persisted'){createFailure=null;throw Error('lost insert response');}
      return 1;
    },
    acquireRoomLease(id, owner) {
      calls.push(['claim', id]);
      if(denyClaims>0){denyClaims--;return null;}
      row.lease_owner=owner;
      row.lease_epoch++;
      return {leaseEpoch:row.lease_epoch};
    },
    listRecoverableRooms(limit) { calls.push(['scan',limit]); return []; }
  };
  const deps = {requireRuleTransition:require('../backend/railway/rule-transition-guard.cjs').requireRuleTransition,Date:clock,Rules, requireRoomAccess, store, pilot, wss, MAX_CONNECTIONS:10,
    requirePlayerIdentity: async msg => ({uid:msg.accessToken}),
    WebSocket:{OPEN:1}, crypto:{randomInt:()=>1,randomUUID:() => uid(20)}, setTimeout:(fn,delay)=>{const key={};timers.set(key,{fn,delay});return key;}, clearTimeout:key=>timers.delete(key)};
  const code = section('const TURN_MS=', '// Readiness reports') +
    section("wss.on('connection'", 'beginListening({');
  const app = Function(...Object.keys(deps), "'use strict';\nlet shuttingDown=false;\n"+code+
    '\nreturn {handle, rooms, recoverOrphanedRoomsAtStartup, beginTestShutdown:()=>{shuttingDown=true;}};')(...Object.values(deps));
  async function join(id, extra = {}) {
    const ws = Object.assign(new EventEmitter(), {readyState:1, bufferedAmount:0, received:[],
      send(x){this.received.push(JSON.parse(x));},
      close(){this.readyState=3;this.emit('close');}});
    wss.emit('connection', ws);
    await app.handle(ws, { ...extra, type:'join', mode:extra.mode||'free', accessToken:id });
    return ws;
  }
  return {...app, join, calls, timers, setTime:value=>now=value, setFence:value=>fence=value, loseClose:()=>lostClose=true, failRead:()=>failRead=true, row:()=>structuredClone(row)};
}

test('pilot off by default and activation requires staging and four distinct UIDs', () => {
  assert.equal(readFree4Pilot({}), null);
  assert.equal(readFree4Pilot({...config, LUCKY_FREE4_PILOT:'false'}), null);
  for (const override of [
    {LUCKY_FREE4_PILOT_CUTOFF_MS:undefined},
    {LUCKY_FREE4_PILOT_CUTOFF_MS:'1e12'},
    {RAILWAY_ENVIRONMENT_NAME:'production'},
    {LUCKY_FREE4_PILOT:'1'},
    {LUCKY_FREE4_PILOT_ROOM_ID:'bad'},
    {LUCKY_FREE4_PILOT_UIDS:[...roster.slice(0,3),roster[0]].join(',')}
  ]) assert.throws(() => readFree4Pilot({...config,...override}), /Invalid Free4 pilot/);
});

test('only the verified four start the fixed pilot, retain seats, and restore after restart', async () => {
  const f = fixture();
  await f.recoverOrphanedRoomsAtStartup();
  assert.deepEqual(f.calls.splice(0), [['load',roomId]]);
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
  assert.deepEqual(reboot.calls.map(c=>c[0]), ['load','claim','load','inspect']);
  const restored=await reboot.join(roster[2]);
  assert.equal(restored.received.at(-1).seat,2);
  assert.equal(restored.received.at(-1).event.type,'resume');
  assert.deepEqual(reboot.calls.filter(c=>c[0]==='claim'),[['claim',roomId]]);
  assert.ok(reboot.calls.every(c=>c[0]==='load'||c[0]==='claim'||c[0]==='inspect'));
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

test('expired reboot closes before registration or timers',async()=>{
 const seed=fixture();
 for(const id of roster)await seed.join(id);
 const f=fixture({initial:seed.row()});
 f.setFence('expired');
 await f.recoverOrphanedRoomsAtStartup();
 assert.deepEqual(f.calls.map(c=>c[0]),['load','claim','load','inspect','close']);
 assert.equal(f.rooms.size,0);
 assert.equal(f.timers.size,0);
 const ws=await f.join(roster[0]);
 assert.equal(ws.session,undefined);
 assert.equal(ws.received.at(-1).type,'error');
});
test('stale resume cannot replace the existing socket',async()=>{
 const f=fixture();
 const sockets=[];
 for(const id of roster)sockets.push(await f.join(id));
 f.setFence('stale');
 await assert.rejects(f.join(roster[0]),/PILOT_FENCE_stale/);
 assert.equal(sockets[0].session.ws,sockets[0]);
 assert.equal(f.rooms.get(roomId).halted,true);
 assert.ok(!f.calls.some(c=>c[0]==='close'));
});
test('independent timer uses database verdict and reads back a lost close once',async()=>{
 const f=fixture();
 for(const id of roster)await f.join(id);
 const room=f.rooms.get(roomId);
 const tick=()=>f.timers.get(room.cutoffTimer).fn();
 f.setTime(Number(config.LUCKY_FREE4_PILOT_CUTOFF_MS)+500);
 await tick();
 assert.equal(room.halted,false);
 assert.equal(f.timers.get(room.cutoffTimer).delay,250);
 f.setFence('expired');
 f.loseClose();
 await tick();
 assert.equal(room.halted,true);
 assert.deepEqual(f.calls.slice(-3).map(c=>c[0]),['inspect','close','load']);
 const ws=await f.join(roster[2]);
 assert.equal(ws.session,undefined);
 assert.equal(f.calls.filter(c=>c[0]==='close').length,1);
});

test('last roll in flight serializes cutoff and publishes only acknowledged win',async()=>{
 for(const result of ['win','expired','unknown']){
  let finish,fail;
  const pending=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
  const attempts=[];
  const f=fixture({commit:args=>{attempts.push(args);return pending;}});
  const sockets=[];
  for(const id of roster)sockets.push(await f.join(id));
  const room=f.rooms.get(roomId);
  room.game.players[0].pos=99;
  const turn=f.handle(sockets[0],{type:'roll'});
  assert.equal(attempts.length,1);
  assert.deepEqual(attempts[0].awards.map(a=>[a.kind,a.points]),[['win',10]]);
  f.setFence('expired');
  await f.timers.get(room.cutoffTimer).fn();
  assert.ok(!f.calls.some(c=>c[0]==='close'));
  if(result==='win')finish(1);
  else if(result==='expired')fail(Error('LEASE_LOST_OR_STALE_REVISION'));
  else fail(Object.assign(Error('lost'),{code:'AMBIGUOUS_COMMIT'}));
  await turn;
  assert.equal(attempts.length,1);
  assert.equal(sockets[0].received.filter(x=>x.event?.type==='roll').length,result==='win'?1:0);
  assert.equal(f.calls.filter(c=>c[0]==='close').length,result==='expired'?1:0);
  assert.equal(f.calls.filter(c=>c[0]==='read-evidence').length,result==='unknown'?1:0);
  assert.equal(room.halted,result!=='win');
 }
});


test('expired reboot retries a prior lease without a reconnect, and stops after a fixed budget',async()=>{
 const seed=fixture();
 for(const id of roster)await seed.join(id);
 for(const denyClaims of [3,10]){
  const f=fixture({initial:seed.row(),denyClaims});
  f.setFence('expired');
  await f.recoverOrphanedRoomsAtStartup();
  let fired=0;
  while(f.timers.size){
   assert.ok(fired++<4);
   assert.equal(f.timers.size,1);
   const [key,timer]=f.timers.entries().next().value;
   assert.equal(timer.delay,10000);
   f.timers.delete(key);
   await timer.fn();
  }
  const closes=f.calls.filter(c=>c[0]==='close');
  assert.equal(fired,denyClaims===3?3:4);
  assert.equal(closes.length,denyClaims===3?1:0);
  assert.equal(f.row().status,denyClaims===3?'closed':'playing');
  assert.equal(f.rooms.size,0);
 }
});

test('create keeps the seat reserved during an asynchronous cutoff fence check',async()=>{
 let entered,release;
 const enteredCheck=new Promise(resolve=>{entered=resolve;});
 const shouldReturn=new Promise(resolve=>{release=resolve;});
 const f=fixture({beforeInspect:async()=>{entered();await shouldReturn;}});
 for(const id of roster.slice(0,3))await f.join(id);
 const fourth=f.join(roster[3]);
 await enteredCheck;
 const early=await f.join(roster[0]);
 assert.equal(early.received.at(-1).type,'error');
 assert.ok(!early.session);
 assert.equal(f.calls.filter(c=>c[0]==='claim').length,0);
 release();
 assert.equal((await fourth).received.at(-1).event.type,'start');
 assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
});

test('an expired unused pilot denies admission without allocating any row',async()=>{
 const f=fixture();
 f.setTime(Number(config.LUCKY_FREE4_PILOT_CUTOFF_MS));
 for(const id of roster){
  const denied=await f.join(id);
  assert.equal(denied.received.at(-1).type,'error');
 }
 assert.deepEqual(f.calls,roster.map(()=>['load',roomId]));
 assert.equal(f.row(),null);
});


async function recoveryTick(f){
 const [key,timer]=f.timers.entries().next().value;
 f.timers.delete(key);
 await timer.fn();
}
test('uncertain INSERT reconciles the fixed row; only explicit reconnect retries absent create',async()=>{
 for(const createFailure of ['absent','persisted']){
  const f=fixture({createFailure});
  for(const id of roster)await f.join(id);
  assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
  if(createFailure==='persisted')f.setFence('expired');
  await recoveryTick(f);
  assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
  if(createFailure==='persisted'){
   assert.equal(f.row().status,'closed');
   assert.equal(f.rooms.size,0);
  }else{
   const ws=await f.join(roster[0]);
   assert.equal(ws.received.at(-1).event.type,'start');
   assert.equal(f.calls.filter(c=>c[0]==='create').length,2);
  }
 }
});
test('transient startup read preserves remaining recovery attempts',async()=>{
 const seed=fixture();
 for(const id of roster)await seed.join(id);
 const f=fixture({initial:seed.row(),denyClaims:1});
 f.setFence('expired');
 await f.recoverOrphanedRoomsAtStartup();
 f.failRead();
 await recoveryTick(f);
 assert.equal(f.timers.size,1);
 await recoveryTick(f);
 assert.equal(f.row().status,'closed');
});
test('shutdown after inspection starts cannot initiate a fresh close',async()=>{
 let resolve,entered;
 const blocking=new Promise(r=>resolve=r), inCheck=new Promise(r=>entered=r);
 let armed=false;
 const f=fixture({beforeInspect:()=>{if(armed){entered();return blocking;}}});
 for(const id of roster)await f.join(id);
 f.setFence('expired');
 armed=true;
 const tick=f.timers.get(f.rooms.get(roomId).cutoffTimer).fn();
 await inCheck;
 f.beginTestShutdown();
 resolve();
 await tick;
 assert.equal(f.calls.filter(c=>c[0]==='close').length,0);
});
