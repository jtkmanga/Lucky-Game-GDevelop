'use strict';
// Linux loopback only. Build/install railway-runtime first. Running two real
// packaged server processes against a shared SYNTHETIC store broker exercises
// lifecycle, session recovery and app transitions, not PostgreSQL, TLS or OAuth.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const root = path.resolve(__dirname,'..');
const runtime = path.join(root,'railway-runtime');
const use = createRequire(path.join(runtime,'backend/railway/secure-server.cjs'));
const { WebSocket } = use('ws');
const roster = [1,2,3,4].map(n=>'aaaaaaaa-0000-4000-8000-'+String(n).padStart(12,'0'));

async function beforeDeadline(promise, label, ms=2800) {
 const timer = new AbortController();
 try {
  return await Promise.race([promise,delay(ms,null,{signal:timer.signal}).then(()=>{throw Error(label);})]);
 } finally { timer.abort(); }
}

function createFixture(t) {
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'lucky-process-recovery-'));
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const hook = path.join(tmp,'fixture.cjs');
 fs.writeFileSync(hook,`
const http = require('node:http'), crypto = require('node:crypto'), path = require('node:path');
const base = ${JSON.stringify(path.join(runtime,'backend'))};
const roster = ${JSON.stringify(roster)};
const tokenPrefix = 'local-fixture-only-';
function replace(rel,exports) {
  const filename = path.join(base,rel);
  require.cache[filename] = {id:filename,filename,loaded:true,exports};
}
let nextId = 0;
const pending = new Map();
process.on('message',({id,ok,value})=>{
 const handler=pending.get(id);
 if(handler){pending.delete(id);ok?handler.resolve(value):handler.reject(Error(value));}
});
const ops=['health','listRecoverableRooms','loadRoom','findResumableRoomForUid','acquireRoomLease',
 'renewRoomLease','initializeRoom','player','commitFencedTurn','close'];
const store=Object.fromEntries(ops.map(op=>[op,(...args)=>new Promise((resolve,reject)=>{
 const id = ++nextId;
 pending.set(id,{resolve,reject});
 process.send({id,op,args},error=>{if(error){pending.delete(id);reject(error);}});
})]));
replace('supabase/game-store.cjs',{createRailwayStore:()=>store});
replace('auth/supabase-access-token.cjs',{
 readConfig:()=>({origin:'http://127.0.0.1'}),
 requirePlayerIdentity:async msg=>{
  const uid=roster.find((_,i)=>msg.accessToken===tokenPrefix+i);
  if(!uid)throw Error('fixture token does not match');
  return {uid};
 }
});
const rules = require(path.join(base,'railway/multi-board-rules.cjs'));
const realCreate = rules.create;
rules.create = (names,mode)=>{
 const game=realCreate(names,mode,()=>0,1);
 // Start the scripted case one legal roll from the Lucky Box.
 game.gift=16;game.players[0].pos=15;rules.assertRoomBoard(game);
 return game;
};
const realRandomInt = crypto.randomInt;
crypto.randomInt = (min,max,...rest)=>min===1&&max===7&&!rest.length?1:realRandomInt(min,max,...rest);
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function(port, host) {
 if(port !== 0 || host !== '0.0.0.0') throw Error('Expected ephemeral loopback fixture');
 this.once('listening',()=>process.send({fixturePort:this.address().port}));
 return listen.call(this,0,'127.0.0.1');
};
`);
 const data = {room:null,receipts:[],awards:[],inserts:0,closed:[],blockedClaims:0,clockOffset:0,attempts:0};
 let onCommit;
 const firstCommit = new Promise(resolve=>{onCommit=resolve;});
 const dbNow = ()=>Date.now()+data.clockOffset;
 const leaseValid=()=>data.room.lease_until>dbNow();
 const stores = {
  health(){return true;},
  listRecoverableRooms(){return data.room?.status==='playing'&&!leaseValid()?[{room_id:data.room.room_id}]:[];},
  loadRoom(_,id){return data.room?.room_id===id?data.room:null;},
  findResumableRoomForUid(_,uid){
   return data.room?.status==='playing' && data.room.seats.some(x=>x.uid===uid)?data.room.room_id:null;
  },
  acquireRoomLease(_,id,owner,ttl){
   const r=data.room;
   assert.equal(r.room_id,id);assert.equal(ttl,30);
   if(r.status!=='playing'||(r.lease_owner!==owner&&leaseValid())){data.blockedClaims++;return null;}
   r.lease_epoch++;r.lease_owner=owner;r.lease_until=dbNow()+1000*ttl;
   return {leaseEpoch:r.lease_epoch};
  },
  renewRoomLease(_,id,owner,epoch,ttl){
   const r=data.room;
   if(r?.room_id!==id||r.lease_owner!==owner||r.lease_epoch!==epoch||!leaseValid())return false;
   r.lease_until=dbNow()+ttl*1000;return true;
  },
  initializeRoom(_,x){
   assert.equal(data.room,null,'duplicate durable room');
   data.inserts++;
   data.room={room_id:x.roomId, mode:x.mode, status:'playing', seats:x.seats, game_state:x.game,
    deadline_ms:x.deadlineMs,revision:0,lease_owner:x.ownerId,lease_epoch:1,lease_until:dbNow()+30000};
   return 1;
  },
  player(_,uid){assert.ok(roster.includes(uid));},
  commitFencedTurn(worker,x){
   const r=data.room;data.attempts++;
   if(r?.room_id!==x.roomId||r.lease_owner!==x.ownerId||r.lease_epoch!==x.leaseEpoch||
      !leaseValid()||r.revision!==x.expectedRevision||r.status!=='playing')throw Error('LEASE_LOST_OR_STALE_REVISION');
   assert.equal(worker,'A','replacement must not replay the turn');
   r.revision++;r.game_state=x.game;r.deadline_ms=x.deadlineMs;
   data.receipts.push({revision:r.revision,event:x.receipt});
   for(const award of x.awards){
    assert.ok(!data.awards.some(a=>a.eventId===award.eventId));
    data.awards.push(award);
   }
   onCommit();
   // Explicitly withhold only A's commit acknowledgement until A is stopped.
   // The other child can still observe the committed row through this broker.
   return noReply;
  },
  close(worker){data.closed.push(worker);}
 };
 const noReply = Symbol('hold committed response');
 async function launch(worker) {
  const command = require('../railway.json').deploy.startCommand;
  const child = spawn('/bin/sh',['-c',command],{cwd:root,detached:true,
   env:{PATH:process.env.PATH,HOME:tmp,NODE_OPTIONS:'--require='+hook,PORT:'0'},
   stdio:['ignore','pipe','pipe','ipc']});
  let logs='',resolvePort,rejectPort,brokerError;
  const portPromise = new Promise((resolve,reject)=>{resolvePort=resolve;rejectPort=reject;});
  const done = once(child,'exit');
  child.stdout.on('data',b=>{logs=(logs+b).slice(-2000);});
  child.stderr.on('data',b=>{logs=(logs+b).slice(-2000);});
  child.on('error',rejectPort);
  child.on('message',msg=>{
   if(msg.fixturePort){resolvePort(msg.fixturePort);return;}
   try {
    assert.ok(Object.hasOwn(stores,msg.op));
    const value = stores[msg.op](worker,...msg.args);
    if(value!==noReply && child.connected)child.send({id:msg.id,ok:true,value},()=>{});
   }catch(error){
    brokerError=error;
    if(child.connected)child.send({id:msg.id,ok:false,value:error.message},()=>{});
   }
  });
  t.after(async()=>{
   try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
   await done.catch(()=>{});
  });
  const port=await beforeDeadline(Promise.race([
   portPromise,done.then(()=>{throw Error('worker exited before listening: '+logs);})
  ]),'worker did not listen');
  const health=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(1200)});
  assert.equal(health.status,200);
  return {child,done,port,logs:()=>logs,noBrokerErrors:()=>assert.ifError(brokerError)};
 }
 async function connect(worker) {
  const ws = new WebSocket('ws://127.0.0.1:'+worker.port+'/ws');
  ws.on('error',()=>{});
  t.after(()=>ws.terminate());
  const packets=[], events=new (require('node:events').EventEmitter)();
  ws.on('message',raw=>{packets.push(JSON.parse(raw.toString()));events.emit('changed');});
  const closed=once(ws,'close');
  await beforeDeadline(once(ws,'open'),'WebSocket did not open');
  const send=packet=>ws.send(JSON.stringify(packet));
  async function waitFor(predicate) {
   const now=packets.find(predicate);if(now)return now;
   let f;
   try {
    return await beforeDeadline(new Promise(resolve=>{
     f=()=>{const hit=packets.find(predicate);if(hit)resolve(hit);};events.on('changed',f);
    }),'expected packet did not arrive: '+JSON.stringify(packets));
   }finally{events.off('changed',f);}
  }
  return {send,waitFor,closed,packets};
 }
 return {data,firstCommit,launch,connect};
}
const join = seat => ({type:'join',mode:'free',name:'Local '+seat, accessToken:'local-fixture-only-'+seat});

for(const signal of ['SIGTERM','SIGKILL']){
 test('separate packaged process resumes the same committed seat after '+signal,
  {skip:process.platform!=='linux',timeout:12000},async t=>{
  const {data,firstCommit,launch,connect}=createFixture(t);
  const a=await launch('A'), old=[];
  for(let seat=0;seat<4;seat++){
   const c=await connect(a);old.push(c);
   c.send(join(seat));
   if(seat!==3)await c.waitFor(p=>p.type==='waiting');
  }
  const start=await old[0].waitFor(p=>p.event?.type==='start');
  assert.equal(start.seat,0);assert.equal(start.revision,0);
  await delay(120); // packaged WebSocket rate limiter requires 100 ms between messages
  old[0].send({type:'roll'});
  await beforeDeadline(firstCommit,'expected fixture commit did not arrive').catch(error=>{throw Error(error.message+': '+a.logs());});
  assert.equal(data.room.revision,1);assert.equal(data.room.game_state.giftUsed,true);
  assert.equal(data.receipts[0].event.dice,1);assert.equal(data.awards[0].kind,'lucky_box');
  assert.ok(data.awards[0].points>0);
  // Start B while A still owns a live lease and the first write is committed,
  // but its acknowledgement has not reached process A.
  const b=await launch('B');
  const claimant=await connect(b);
  claimant.send(join(0));
  const denial=await claimant.waitFor(p=>p.type==='error');
  assert.match(denial.message,/ห้องเดิม/);
  assert.equal(data.blockedClaims,1);
  assert.equal(old[0].packets.some(p=>p.event?.type==='roll'),false);
  const terminatedAt=performance.now();
  assert.equal(a.child.kill(signal),true);
  assert.deepEqual(await beforeDeadline(a.done,'old worker did not exit'),signal==='SIGTERM'?[0,null]:[null,'SIGKILL']);
  assert.equal((await beforeDeadline(old[0].closed,'old WebSocket stayed connected'))[0],signal==='SIGTERM'?1001:1006);
  assert.deepEqual(data.closed,signal==='SIGTERM'?['A']:[]);
  const oldLeaseOwner=data.room.lease_owner;
  // Advance only the synthetic storage clock past the old lease; wall clock
  // and the server's real turn deadline remain unchanged.
  data.clockOffset = 31000;
  const elapsedStart=performance.now();
  const resumed=await connect(b);
  resumed.send(join(0));
  const packet=await resumed.waitFor(p=>p.event?.type==='resume');
  assert.equal(packet.roomId,start.roomId);
  assert.equal(packet.seat,0);
  assert.equal(packet.revision,1);
  assert.equal(packet.game.players[0].score,data.awards[0].points);
  assert.equal(packet.game.giftUsed,true);
  assert.equal(packet.game.current,1);
  assert.notEqual(data.room.lease_owner,oldLeaseOwner);
  assert.equal(data.room.lease_epoch,2);
  assert.equal(data.inserts,1);
  assert.equal(data.attempts,1);
  assert.equal(data.receipts.length,1);
  assert.equal(data.awards.length,1);
  assert.equal(data.awards[0].uid,roster[0]);
  a.noBrokerErrors(); b.noBrokerErrors();
  t.diagnostic('termination + socket close observed before synthetic expiry; reconnect '+Math.round(performance.now()-elapsedStart)+' ms after clock advance, '+Math.round(performance.now()-terminatedAt)+' ms after signal (not a native lease wait)');
 });
}
