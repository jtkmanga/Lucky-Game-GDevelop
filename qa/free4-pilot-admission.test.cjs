'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { EventEmitter } = require('node:events');
const Rules = require('../backend/railway/multi-board-rules.cjs');
const { requireRoomAccess, requireVipExpiry } = require('../backend/auth/room-access.cjs');
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
function fixture({pilot = readFree4Pilot(config), initial = null, getVipEntitlement, initializeRoom, commit, denyClaims = 0, beforeInspect, createFailure, insertThrough, identity = async msg => ({uid:msg.accessToken})} = {}) {
  let row = initial && structuredClone(initial);
  const calls = [];
  const timers=new Map();
  let now=Number(config.LUCKY_FREE4_PILOT_CUTOFF_MS)-100;
  let fence='open',lostClose=false,failRead=false;
  const clock={now:()=>now};
  const wss = new EventEmitter();
  const store = {
    getVipEntitlement,
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
    async initializeRoom(x) {
      calls.push(['create', x.roomId, x.seats.map(s => s.uid)]);
      assert.equal(row, null, 'fixture must never insert a second room');
      if(insertThrough)await insertThrough(x);
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
  if(initializeRoom)store.initializeRoom=initializeRoom;
  const deps = {requireRuleTransition:require('../backend/railway/rule-transition-guard.cjs').requireRuleTransition,Date:clock,Rules, requireRoomAccess, requireVipExpiry, store, pilot, wss, MAX_CONNECTIONS:10,
    requirePlayerIdentity: identity,
    WebSocket:{OPEN:1}, crypto:{randomInt:()=>1,randomUUID:() => uid(20)}, setTimeout:(fn,delay)=>{const key={};timers.set(key,{fn,delay});return key;}, clearTimeout:key=>timers.delete(key)};
  const code = section('const TURN_MS=', '// Readiness reports') +
    section("wss.on('connection'", 'beginListening({');
  const app = Function(...Object.keys(deps), "'use strict';\nlet shuttingDown=false;\n"+code+
    '\nreturn {handle, rooms, waiting, sessions, recoverOrphanedRoomsAtStartup, beginTestShutdown:()=>{shuttingDown=true;}};')(...Object.values(deps));
  function connect() {
    const ws = Object.assign(new EventEmitter(), {readyState:1, bufferedAmount:0, received:[],
      send(x){this.received.push(JSON.parse(x));},
      close(){this.readyState=3;this.emit('close');}});
    wss.emit('connection', ws);
    return ws;
  }
  async function join(id, extra = {}) {
    const ws = connect();
    await app.handle(ws, { ...extra, type:'join', mode:extra.mode||'free', accessToken:id });
    return ws;
  }
  return {...app, connect, join, calls, timers, setTime:value=>now=value, setFence:value=>fence=value, loseClose:()=>lostClose=true, failRead:()=>failRead=true, row:()=>structuredClone(row)};
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
    assert.ok(ws.received.every(packet => packet.type !== 'state'));
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
  if(result==='win'){
   for(const [seat,socket] of sockets.entries()){
    const packet=socket.received.at(-1);
    assert.deepEqual([packet.type,packet.roomId,packet.seat,packet.revision,packet.event.type,packet.game.over],
      ['state',roomId,seat,1,'roll',true]);
    assert.equal(packet.event.committedWin,undefined);
   }
   const blocked=await f.join(roster[0]);
   assert.equal(blocked.received.at(-1).type,'error');
   assert.ok(blocked.received.every(packet=>packet.type!=='state'));
   assert.equal(blocked.session,undefined);
   assert.equal(room.seats[0].ws,sockets[0]);
  }
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


test('wire join binds only the configured Auth project identity to a Free4 seat', async t => {
  const { requirePlayerIdentity } = require('../backend/auth/supabase-access-token.cjs');
  let acknowledge;
  const commits = [];
  const f = fixture({identity: requirePlayerIdentity, commit(args) {
    commits.push(args);
    return new Promise(resolve => { acknowledge = resolve; });
  }});
  const origin = 'https://llbkxnazkliskzcureec.supabase.co';
  const key = 'synthetic-publishable-key';
  const token = label => 'synthetic-offline-test-value-with-no-authority-' + label;
  const requests = [];
  const identities = new Map(roster.map((id, index) => [token(index), id]));
  identities.set(token('outsider'), uid(99));
  const configKeys = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'];
  const previous = configKeys.map(name => process.env[name]);
  t.after(() => configKeys.forEach((name, index) => {
    if (previous[index] === undefined) delete process.env[name];
    else process.env[name] = previous[index];
  }));
  process.env.SUPABASE_URL = origin;
  process.env.SUPABASE_PUBLISHABLE_KEY = key;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const bearer = opts.headers.authorization;
    requests.push([url, opts.method, opts.headers.apikey, bearer]);
    const presented = bearer.slice('Bearer '.length);
    if (presented === token('unavailable')) throw Error('synthetic auth outage');
    const id = identities.get(presented);
    return id ? Response.json({id, aud:'authenticated'}) : new Response(null, {status:401});
  });

  async function wireJoin(accessToken) {
    const socket = f.connect();
    const handlers = socket.listeners('message');
    assert.equal(handlers.length, 1);
    const payload = {type:'join', mode:'free', accessToken, uid:roster[3], roomId:uid(999)};
    await handlers[0](Buffer.from(JSON.stringify(payload)));
    return socket;
  }

  async function rejected(accessToken, expectsFetch) {
    const before = {
      calls:f.calls.slice(), queue:f.waiting.free.slice(), sessions:[...f.sessions.entries()],
      rooms:[...f.rooms.keys()], row:f.row(), requests:requests.length
    };
    const socket = await wireJoin(accessToken);
    assert.equal(socket.received.at(-1)?.type, 'error');
    assert.equal(socket.session, undefined);
    assert.deepEqual(f.calls, before.calls);
    assert.deepEqual(f.waiting.free, before.queue);
    assert.deepEqual([...f.sessions.entries()], before.sessions);
    assert.deepEqual([...f.rooms.keys()], before.rooms);
    assert.deepEqual(f.row(), before.row);
    assert.equal(requests.length, before.requests + Number(expectsFetch));
    if (expectsFetch) assert.deepEqual(requests.at(-1),
      [origin + '/auth/v1/user', 'GET', key, 'Bearer ' + accessToken]);
    socket.close();
  }

  f.setTime(Number(config.LUCKY_FREE4_PILOT_CUTOFF_MS) - 1000);
  await rejected('short', false);
  process.env.SUPABASE_URL = 'https://syntheticwrongproject.supabase.co';
  await rejected(token(0), false);
  process.env.SUPABASE_URL = origin;
  const sockets = [await wireJoin(token(0))];
  assert.deepEqual(f.waiting.free.map(s => s.uid), [roster[0]]);
  for (const reason of ['expired', 'outsider', 'unavailable']) await rejected(token(reason), true);
  for (const i of [1, 2, 3]) sockets.push(await wireJoin(token(i)));
  assert.deepEqual(f.row().seats.map(s => s.uid), roster);
  for (const [i, socket] of sockets.entries()) {
    const frame = socket.received.at(-1);
    assert.equal(socket.session.uid, roster[i]);
    assert.deepEqual([frame.type, frame.roomId, frame.seat], ['state', roomId, i]);
    assert.ok(requests.some(req => req[0] === origin + '/auth/v1/user' &&
      req[1] === 'GET' && req[2] === key && req[3] === 'Bearer ' + token(i)));
  }
  await rejected(token('unavailable'), true);
  const stateCount = ws => ws.received.filter(packet => packet.type === 'state').length;
  const counts = sockets.map(stateCount);
  for (const ws of sockets) assert.equal(ws.received.at(-1).revision, 0);
  f.setTime(Number(config.LUCKY_FREE4_PILOT_CUTOFF_MS) - 1);
  const roll = sockets[0].listeners('message')[0](Buffer.from('{"type":"roll"}'));
  assert.equal(commits.length, 1);
  assert.equal(commits[0].expectedRevision, 0);
  assert.deepEqual(sockets.map(stateCount), counts);
  acknowledge(1);
  await roll;
  for (const [seat, ws] of sockets.entries()) {
    const packet = ws.received.at(-1);
    assert.equal(stateCount(ws), counts[seat] + 1);
    assert.deepEqual([packet.type, packet.roomId, packet.seat, packet.event.type, packet.revision],
      ['state', roomId, seat, 'roll', 1]);
  }
  const live = sockets[1].received.at(-1);
  sockets[1].close();
  const resumed = await wireJoin(token(1));
  const frame = resumed.received.at(-1);
  assert.deepEqual([frame.type,frame.roomId,frame.seat,frame.event.type],
    ['state',roomId,1,'resume']);
  assert.equal(frame.revision, live.revision);
  assert.deepEqual(frame.game, live.game);
  assert.equal(frame.deadline, live.deadline);
  assert.equal(resumed.session.uid,roster[1]);

  f.setTime(Number(config.LUCKY_FREE4_PILOT_CUTOFF_MS));
  f.setFence('expired');
  const afterCutoff = await wireJoin(token(1));
  assert.equal(afterCutoff.session,undefined);
  assert.ok(afterCutoff.received.every(packet=>packet.type!=='state'));
  assert.equal(afterCutoff.received.at(-1)?.type,'error');
  assert.equal(f.waiting.free.length,0);
  assert.deepEqual(requests.at(-1),[origin+'/auth/v1/user','GET',key,'Bearer '+token(1)]);
  assert.equal(f.calls.filter(([action]) => action === 'create').length, 1);
});

test('VIP2 wire admission uses verified UID and strict server expiry', async t => {
  const now = Date.UTC(2030, 1, 1);
  t.mock.method(Date, 'now', () => now);
  const origin = 'https://llbkxnazkliskzcureec.supabase.co';
  for (const [name, value] of Object.entries({
    SUPABASE_URL: origin, SUPABASE_PUBLISHABLE_KEY: 'offline-test-key'
  })) {
    const original = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    });
  }
  const token = i => 'offline-synthetic-identity-with-no-authority-' + i;
  const accounts = new Map(roster.map((id, i) => ['Bearer ' + token(i), id]));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, origin + '/auth/v1/user');
    const id = accounts.get(options.headers.authorization);
    return id ? Response.json({id, aud:'authenticated'}) : new Response(null, {status:401});
  });

  const lookups = [];
  let rows = [];
  const records = new Map();
  const pool = {connect() {throw Error('Unexpected connection');}, async query(sql, params) {
    lookups.push([sql, params]);
    if (rows === null) throw Error('offline lookup unavailable');
    const result = records.get(params[0]) ?? rows;
    return {rowCount:result.length, rows:result};
  }};
  // Instantiate the shipped adapter with a recording pool. No pg driver or connection.
  const source = readFileSync(require.resolve('../backend/supabase/game-store.cjs'), 'utf8');
  const mod = {exports:{}};
  Function('module', 'require', source)(mod, name => {
    if (name === 'pg') return {Pool:class {constructor() {return pool;}}};
    if (name === './pg-tls-config.cjs') return {poolConnectionOptions:() => ({})};
    if (name === './room-lease-store.cjs') return require('../backend/supabase/room-lease-store.cjs');
    throw Error('Unexpected adapter dependency ' + name);
  });
  const store = mod.exports.createRailwayStore('offline-fixture');
  const {requirePlayerIdentity} = require('../backend/auth/supabase-access-token.cjs');
  const f = fixture({pilot:null, identity:requirePlayerIdentity, getVipEntitlement:store.getVipEntitlement});
  f.setTime(now);
  async function join(i, mode = 'vip') {
    const ws = f.connect();
    await ws.listeners('message')[0](Buffer.from(JSON.stringify({
      type:'join', mode, accessToken:token(i), uid:roster[3], vip:true,
      verified:true, shield:true, doubleWin:true, matchItems:{version:1}
    })));
    return ws;
  }
  function record(id, offset, status = 'active') {
    return [{uid:id, status, expires_at:new Date(now + offset).toISOString()}];
  }
  const free = await join(2, 'free');
  assert.equal(free.session.uid, roster[2]);
  assert.equal((await join('unknown')).received.at(-1).type, 'error');
  assert.equal(lookups.length, 0);

  for (rows of [[], null, record(roster[0], 1, 'revoked'), record(roster[3], 1),
                record(roster[0], -1), record(roster[0], 0)]) {
    const before = f.calls.length;
    const denied = await join(0);
    denied.close();
    assert.equal(denied.received.at(-1).type, 'error');
    assert.equal(denied.session, undefined);
    assert.equal(f.calls.length, before);
    assert.equal(f.waiting.vip.length, 0);
    assert.equal(f.sessions.has(roster[0]), false);
  }
  rows = record(roster[0], 1);
  const first = await join(0);
  assert.deepEqual(f.waiting.vip.map(s => s.uid), [roster[0]]);
  records.set(roster[0], rows);
  rows = record(roster[1], 1);
  const second = await join(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.row().seats.map(s => s.uid), roster.slice(0, 2));
  assert.equal(f.row().mode, 'vip');
  assert.deepEqual(f.waiting.free.map(s => s.uid), [roster[2]]);
  assert.equal(free.received.some(p => p.type === 'state'), false);
  for (const [seat, ws] of [first, second].entries()) {
    const packet = ws.received.at(-1);
    assert.deepEqual([packet.type, packet.seat, packet.game.players.length], ['state', seat, 2]);
    assert.equal(Object.hasOwn(packet.game, 'matchItems'), false);
  }
  records.delete(roster[0]);
  rows = record(roster[0], 0);
  assert.equal((await join(0)).received.at(-1).type, 'error');
  assert.equal(f.sessions.get(roster[0]).ws, first);
  assert.equal(Object.hasOwn(f.row().game_state, 'matchItems'), false);
  assert.deepEqual(lookups.map(([,params]) => params),
    [...Array(7).fill(roster[0]), roster[1], roster[0], roster[1], roster[0]].map(id => [id]));
  assert.ok(lookups.every(([sql]) => sql ===
    'SELECT uid,status,expires_at FROM game.vip_entitlements WHERE uid=$1'));
});

for (const event of ['expires during lookup', 'revoked', 'unavailable', 'cancel', 'close', 'takeover']) {
  test('VIP2 queued recheck: ' + event, async t => {
    let now = Date.UTC(2030, 1, 1);
    t.mock.method(Date, 'now', () => now);
    const calls = new Map();
    let releaseLookup, signalStarted;
    const gate = new Promise(resolve => { releaseLookup = resolve; });
    const started = new Promise(resolve => { signalStarted = resolve; });
    const f = fixture({pilot:null, async getVipEntitlement(id) {
      const count = (calls.get(id) || 0) + 1;
      calls.set(id, count);
      let status = 'active', expiresAtMs = now + 10000;
      if (id === roster[0] && count === 2) {
        if (event === 'expires during lookup') expiresAtMs = now + 1;
        if (event === 'revoked' || event === 'takeover') status = 'revoked';
        if (event === 'unavailable') throw Error('fixture outage');
      }
      if (id === roster[1] && count === 2) {
        signalStarted();
        await gate;
      }
      return {uid:id, tier:'vip', status, expiresAtMs};
    }});
    f.setTime(now);
    const settle = () => new Promise(resolve => setImmediate(resolve));
    async function wire(ws, message) {
      await ws.listeners('message')[0](Buffer.from(JSON.stringify(message)));
    }
    async function join(i) {
      const ws = f.connect();
      await wire(ws, {type:'join', mode:'vip', accessToken:roster[i]});
      return ws;
    }
    const first = await join(0);
    const second = await join(1);
    assert.equal(f.row(), null, 'VIP room inserted without a fresh entitlement check');
    let timeout;
    try {
      await Promise.race([started, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error('VIP allocation recheck did not start')), 1000);
      })]);
    } finally { clearTimeout(timeout); }
    // A third join invokes dispatch while the second lookup is unresolved.
    const third = await join(2);
    now += 100;
    f.setTime(now);
    let replacement;
    if (event === 'cancel') await wire(second, {type:'cancel'});
    if (event === 'close') first.close();
    if (event === 'takeover') replacement = await join(0);
    assert.equal(f.row(), null);
    assert.equal(f.calls.filter(c => c[0] === 'create').length, 0);
    releaseLookup();
    await settle();
    const expected = event === 'takeover' ? [0,1] : event === 'cancel' ? [0,2] : [1,2];
    const seats = expected.map(i => roster[i]);
    assert.deepEqual(f.row().seats.map(s => s.uid), seats);
    assert.deepEqual(f.calls.filter(c => c[0] === 'create').map(c => c[2]), [seats]);
    assert.deepEqual(f.waiting.vip.map(s => s.uid), event === 'takeover' ? [roster[2]] : []);
    const sockets = [replacement || first, second, third];
    for (const [i, ws] of sockets.entries()) {
      assert.equal(ws.received.filter(p => p.type === 'state').length, Number(expected.includes(i)));
      assert.equal(f.sessions.has(roster[i]), expected.includes(i) || event === 'takeover');
    }
    if (replacement) {
      assert.equal(f.sessions.get(roster[0]).ws, replacement);
      assert.equal(first.received.some(p => p.type === 'state'), false);
      assert.equal(calls.get(roster[0]), 4);
    }
  });
}

function atomicStoreFixture(scenario, onGate, scoped = null) {
  const calls = [];
  let state = 'I', persisted = false;
  const inserted = p => {
    assert.equal(p[0], scoped?.roomId || uid(20));
    if(scoped){
      assert.equal(p[6],scoped.cutoffMs);
      assert.deepEqual(JSON.parse(p[3])._free4CutoffV1,{mode:'vip',roomId:scoped.roomId,cutoffMs:scoped.cutoffMs});
    }
    assert.deepEqual(JSON.parse(p[2]).map(s => s.uid), roster.slice(0, p[1]==='vip'?2:4));
    return {command:'INSERT', rowCount:1, rows:[{lease_epoch:'1'}]};
  };
  const client = Object.assign(new EventEmitter(), {
    getTransactionStatus:() => state,
    release(discard) { calls.push(discard?'discard':'release'); },
    async query(sql, params) {
      const op = sql.split(/\s/)[0];
      calls.push(op);
      if (op === 'BEGIN') state = 'T';
      if (op === 'SELECT') {
        assert.equal(sql,'SELECT game.lock_vip_pair($1::uuid,$2::uuid) AS admitted');
        assert.deepEqual(params,roster.slice(0,2));
        onGate();
        if(scenario==='query loss')throw Error('lost gate response');
        if(scenario==='client disconnect')this.emit('error',Error('connection lost'));
        return {command:op,rowCount:1,rows:[{admitted:!['deny','rollback loss','rollback not idle'].includes(scenario)}]};
      }
      if (op === 'INSERT') {
        if(scenario==='insert loss')throw Error('lost insert acknowledgement');
        return inserted(params);
      }
      if (op === 'COMMIT') {
        persisted=true;
        if(scenario==='commit loss')throw Error('lost commit acknowledgement');
      }
      if (op === 'ROLLBACK' && scenario==='rollback loss')throw Error('lost rollback acknowledgement');
      if (op !== 'BEGIN' && scenario!=='rollback not idle')state='I';
      return {command:op};
    }
  });
  const pool = {
    async connect() { calls.push('checkout'); return client; },
    async query(sql, params) {
      assert.match(sql,/^INSERT INTO game\.rooms/);
      calls.push('pool INSERT');
      persisted=true;
      return inserted(params);
    }
  };
  const moduleStub={exports:{}};
  const code=readFileSync(require.resolve('../backend/supabase/game-store.cjs'),'utf8');
  Function('module','require',code)(moduleStub, name => {
    if(name==='pg')return {Pool:class {constructor(){return pool;}}};
    if(name==='./pg-tls-config.cjs')return {poolConnectionOptions:()=>({})};
    if(name==='./room-lease-store.cjs')return require('../backend/supabase/room-lease-store.cjs');
    throw Error(name);
  });
  const opts=scenario==='default VIP'?undefined:{atomicVip:true};
  return {calls,persisted:()=>persisted,store:moduleStub.exports.createRailwayStore('offline',scoped && {roomId:scoped.roomId,cutoffMs:scoped.cutoffMs,mode:scoped.mode},opts)};
}

for(const scenario of ['allow','deny','query loss','insert loss','commit loss','client disconnect','socket close',
                        'rollback loss','rollback not idle','default VIP','ordinary Free4']){
  test('atomic VIP creation / '+scenario,async()=>{
    let first;
    const db=atomicStoreFixture(scenario,()=>{if(scenario==='socket close')first.close();});
    const f=fixture({pilot:null,initializeRoom:db.store.initializeRoom,
      getVipEntitlement:async id=>({uid:id,tier:'vip',status:'active',expiresAtMs:Date.UTC(2099,0)})});
    const mode=scenario==='ordinary Free4'?'free':'vip';
    async function wire(i){
      const ws=f.connect();
      await ws.listeners('message')[0](Buffer.from(JSON.stringify({
        type:'join',mode,accessToken:roster[i],uid:uid(999)
      })));
      return ws;
    }
    first=await wire(0);
    const second=await wire(1);
    if(mode==='free'){await wire(2);await wire(3);}
    await new Promise(resolve=>setImmediate(resolve));
    if(scenario==='default VIP'||mode==='free'){
      assert.deepEqual(db.calls,['pool INSERT']);
      assert.equal(second.received.at(-1).type,'state');
      return;
    }
    const prefix=['checkout','BEGIN','SELECT'];
    if(scenario==='allow'){
      assert.deepEqual(db.calls,[...prefix,'INSERT','COMMIT','release']);
      assert.equal(db.persisted(),true);
      assert.equal(second.received.at(-1).type,'state');
      return;
    }
    assert.equal(second.received.some(packet=>packet.type==='state'),false);
    assert.equal(f.rooms.size,0);
    if(scenario==='deny'){
      assert.deepEqual(db.calls,[...prefix,'ROLLBACK','release']);
      assert.equal(f.sessions.size,0);
      assert.equal(second.session,null);
      assert.equal(db.persisted(),false);
      return;
    }
    const afterGate=scenario==='commit loss'?['INSERT','COMMIT']:
      scenario==='insert loss'?['INSERT']:scenario.startsWith('rollback')?['ROLLBACK']:[];
    const expected=[...prefix,...afterGate,'discard'];
    assert.deepEqual(db.calls,expected);
    assert.equal(db.persisted(),scenario==='commit loss');
    for(const id of roster.slice(0,2)){
      assert.equal(f.sessions.get(id).pendingRoomId,uid(20));
      assert.equal(f.sessions.get(id).vipCreateUncertain,true);
    }
    const again=await wire(0);
    assert.equal(again.received.at(-1).type,'error');
    assert.deepEqual(db.calls,expected);
    assert.deepEqual(f.waiting.vip,[]);
  });
}

const vipEnv = {
  ...config,
  LUCKY_STAGING_PILOT_MODE:'vip',
  LUCKY_FREE4_PILOT_CUTOFF_MS:String(Date.now()+15*60*1000),
  LUCKY_FREE4_PILOT_UIDS:roster.slice(0,2).join(','),
  RAILWAY_ENVIRONMENT_ID:'e0202327-924e-4913-9a3b-6c4493b2c31b',
  RAILWAY_PROJECT_ID:'5d695e45-30fe-4b08-b0d0-0b0d250937eb',
  LUCKY_ISOLATED_STAGING_SUPABASE_REF:'tpwmcozkzlvolehozzri'
};
test('VIP scope pins exact isolated environment, two allowlisted seats, and bounded cutoff', ()=>{
  const pilot=readFree4Pilot(vipEnv);
  assert.equal(pilot.mode,'vip');
  assert.equal(pilot.admits(roster[0],'free'),false);
  assert.equal(pilot.admits(roster[2],'vip'),false);
  assert.equal(pilot.matches(uid(99),roster.slice(0,2).map(uid=>({uid}))),false);
  for(const override of [
    {LUCKY_FREE4_PILOT:'false'},
    {RAILWAY_ENVIRONMENT_ID:'other'},
    {RAILWAY_PROJECT_ID:'other'},
    {LUCKY_ISOLATED_STAGING_SUPABASE_REF:'other'},
    {LUCKY_PILOT_LUCKY_BOX_FIXTURE:'true'},
    {LUCKY_PILOT_FREE_LEADERBOARD:'true'},
    {LUCKY_FREE4_PILOT_UIDS:roster.join(',')},
    {LUCKY_FREE4_PILOT_CUTOFF_MS:String(Date.now()+31*60*1000)}
  ]) assert.throws(()=>readFree4Pilot({...vipEnv,...override}));
});

test('fixed VIP uses one two-seat locked insert; startup gate denies unsafe scope', async()=>{
  const pilot=readFree4Pilot(vipEnv);
  const accepted=new Set([roster[0]]);
  const db=atomicStoreFixture('allow',()=>{},pilot);
  const f=fixture({pilot,insertThrough:db.store.initializeRoom,
    getVipEntitlement:async id=>accepted.has(id)?({uid:id,tier:'vip',status:'active',expiresAtMs:Date.UTC(2099,0)}):null});
  f.setTime(Date.now());
  await assert.rejects(f.join(roster[1],{mode:'vip'}),{code:'VIP_ACCESS_DENIED'});
  assert.equal(f.waiting.vip.length,0);
  assert.equal((await f.join(roster[0],{mode:'free'})).received.at(-1).type,'error');
  assert.deepEqual(db.calls,[]);
  const a=await f.join(roster[0],{mode:'vip'});
  assert.equal(a.received.at(-1).type,'waiting');
  assert.equal(f.waiting.vip.length,1);
  assert.deepEqual(db.calls,[]);
  accepted.add(roster[1]);
  const b=await f.join(roster[1],{mode:'vip'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(a.received.at(-1).event.type,'start');
  assert.equal(b.received.at(-1).event.type,'start');
  assert.deepEqual(f.row().seats.map(s=>s.uid),roster.slice(0,2));
  assert.deepEqual(f.calls.filter(x=>x[0]==='create'),[['create',roomId,roster.slice(0,2)]]);
  assert.deepEqual(db.calls,['checkout','BEGIN','SELECT','INSERT','COMMIT','release']);
  assert.throws(()=>atomicStoreFixture('default VIP',()=>{},pilot),/requires atomic/);
});

test('VIP marker cannot be loaded or claimed as a Free room',()=>{
  const {pilotBinding,publicRow,storedGame}=require('../backend/supabase/room-lease-store.cjs');
  const vip=pilotBinding(readFree4Pilot(vipEnv));
  const free=pilotBinding({roomId,cutoffMs:vip.cutoffMs,mode:'free'});
  const row={room_id:roomId,mode:'vip',game_state:storedGame({map:1},vip,roomId)};
  assert.deepEqual(publicRow(row,vip).game_state,{map:1});
  assert.throws(()=>publicRow(row,free),/Unexpected pilot marker/);
  assert.throws(()=>publicRow({...row,mode:'free'},vip),/Unexpected pilot marker/);
  assert.deepEqual(storedGame({},free,roomId)._free4CutoffV1,{roomId,cutoffMs:vip.cutoffMs});
});
