'use strict';
/**
 * Draft Railway single-instance authoritative multiplayer listener.
 * Requires DATABASE_URL, SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY; no unauthenticated fallback.
 * NOT tested, deployed, or production-ready. Web UI must send Supabase Auth access token.
 *
 * This server cannot safely scale to multiple replicas without a shared
 * room coordinator / routing strategy. Restart recovery and fencing are
 * untested drafts, not a multi-replica solution. Payment/VIP grants and
 * admin API are deliberately absent.
 */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {WebSocket,WebSocketServer}=require('ws');
// Multi-board adapter deliberately defaults to board 1 until client board rendering is reviewed.
const Rules=require('./multi-board-rules.cjs');
const {requireRuleTransition}=require('./rule-transition-guard.cjs');
const {requirePlayerIdentity,readConfig}=require('../auth/supabase-access-token.cjs');
const {requireRoomAccess}=require('../auth/room-access.cjs');
const {createRailwayStore}=require('../supabase/game-store.cjs');
const {respondHealth}=require('./health-http-handler.cjs');
const {beginListening}=require('./startup-lifecycle.cjs');
const {beginSocketShutdown}=require('./socket-shutdown.cjs');
const {classifyRoomReconciliation}=require('../supabase/room-reconciliation.cjs');
const {prepareManualRecoveryDecision}=require('../supabase/manual-room-recovery.cjs');

const supabaseConfig=readConfig();
const store=createRailwayStore(process.env.DATABASE_URL);
const PORT=Number(process.env.PORT||8080);
const WEB=path.resolve(__dirname,'public');
const MAX_CONNECTIONS=500; // conservative until authorized capacity validation
const TURN_MS=20000;
const OWNER_ID=crypto.randomUUID(); // unique per Node process; never supplied by a player
const LEASE_MS=30000;
const RENEW_MS=10000;
const waiting={free:[],vip:[]}, rooms=new Map(), sessions=new Map();
const clients=new Set(), dispatchBusy={free:false,vip:false};
const restoreTasks=new Map(); // single-process de-duplication, not cross-replica coordination
const pendingCreates=new Set(); // DB insertion may be in-flight; never requeue these seats
const uidJoinLocks=new Map(); // serialize joins for one verified account in this process
async function withUidJoinLock(uid,task){
 const prior=uidJoinLocks.get(uid)||Promise.resolve();
 const current=prior.catch(()=>{}).then(task);
 const barrier=current.catch(()=>{});
 uidJoinLocks.set(uid,barrier);
 try{return await current;}
 finally{if(uidJoinLocks.get(uid)===barrier)uidJoinLocks.delete(uid);}
}
async function restoreRoom(roomId){
 if(rooms.has(roomId))return rooms.get(roomId);
 if(restoreTasks.has(roomId))return restoreTasks.get(roomId);
 const task=(async()=>{
  // Claim ownership BEFORE any local timer/state is reconstructed. If another
  // worker has a valid lease, do not operate the room on this process.
  const claim=await store.acquireRoomLease(roomId,OWNER_ID,LEASE_MS/1000);
  if(!claim)return null;
  const row=await store.loadRoom(roomId);
  if(!row||row.status!=='playing'||
     row.lease_owner!==OWNER_ID||
     Number(row.lease_epoch)!==claim.leaseEpoch)
    throw Error('Room lease changed during restore');
  const sourceSeats=row.seats;
  if(!['free','vip'].includes(row.mode)||!Array.isArray(sourceSeats)||
    sourceSeats.length!==capacity(row.mode)||!Number.isSafeInteger(Number(row.revision))||
    !row.game_state||typeof row.game_state!=='object'||!Number.isFinite(Number(row.deadline_ms)))
    throw Error('Invalid persisted room checkpoint');
  // A stored room can have been edited or corrupted while offline.
  // Refuse restoration before registering sessions or scheduling any turns.
  Rules.assertRoomBoard(row.game_state);
  // Validate ALL persisted seats before writing anything to the session map.
  const uids=sourceSeats.map(seat=>seat?.uid);
  if(uids.some(uid=>typeof uid!=='string'||!uid)||
     new Set(uids).size!==sourceSeats.length ||
     uids.some(uid=>{
       const session=sessions.get(uid);
       return session&&(session.mode!==row.mode||
         (session.roomId&&session.roomId!==roomId)||
         (session.pendingRoomId&&session.pendingRoomId!==roomId));
     }))throw Error('Invalid or conflicting persisted room seats');
  const members=sourceSeats.map((seat,i)=>{
   const existing=sessions.get(seat.uid);
   return existing||{uid:seat.uid,mode:row.mode,name:seat.name||'Player',
      avatar:'🐱',ws:null,roomId,index:i};
  });
  const room={id:roomId,mode:row.mode,seats:members,game:row.game_state,
    deadline:Number(row.deadline_ms),revision:Number(row.revision),
    timer:null,leaseTimer:null,leaseEpoch:claim.leaseEpoch,busy:false,halted:false};
  members.forEach((member,i)=>{
    member.roomId=roomId;member.pendingRoomId=null;
    member.index=i;sessions.set(member.uid,member);
  });
  rooms.set(roomId,room);
  renewRoomLease(room);
  schedule(room); // expired turns are skipped by authoritative timer, not auto-rolled
  return room;
 })();
 restoreTasks.set(roomId,task);
 try{return await task;}finally{restoreTasks.delete(roomId);}
}
const send=(ws,obj)=>{
 if(ws?.readyState===WebSocket.OPEN && ws.bufferedAmount<262144)
   ws.send(JSON.stringify(obj));
};
function capacity(mode){return mode==='vip'?2:4;}
function verifiedRoomSnapshot(room){
 if(!room||room.halted)throw Error('ROOM_UNAVAILABLE');
 const board=Rules.assertRoomBoard(room.game);
 if(Object.hasOwn(room.game,'board'))return room.game;
 // Legacy map-one rows predate versioned board snapshots. Supply the
 // validated original layout to online clients without rewriting the row.
 return {...room.game,board:{version:1,id:board.id,snakes:board.snakes,ladders:board.ladders}};
}
function transmit(room,event){
 let game;
 try{game=verifiedRoomSnapshot(room);}
 catch(error){haltRoom(room,'INVALID_ROOM_BOARD');return;}
 for(let i=0;i<room.seats.length;i++){
  const s=room.seats[i];
  send(s.ws,{type:'state',roomId:room.id,seat:i,game,
    deadline:room.deadline,event});
 }
}
function takeOut(queue,session){
 const i=queue.indexOf(session);if(i>=0)queue.splice(i,1);
}
function reportWaiting(mode){
 waiting[mode].forEach((s,i)=>send(s.ws,
  {type:'waiting',mode,joined:i+1,needed:capacity(mode)}));
}
async function dispatch(mode){
 if(dispatchBusy[mode])return;
 dispatchBusy[mode]=true;
 try{
  const q=waiting[mode];
  while(q.length>=capacity(mode)){
   const seats=q.splice(0,capacity(mode));
   if(seats.some(s=>s.ws?.readyState!==WebSocket.OPEN)){ // lost queue member
    for(const s of seats)if(s.ws?.readyState===WebSocket.OPEN)q.unshift(s);
    continue;
   }
   // Seats must be reserved BEFORE the DB call. A disconnect while INSERT is
   // pending must not return a seat to matchmaking (or create two rooms).
   const id=crypto.randomUUID(), game=Rules.create(seats.map(s=>s.name),mode);
   seats.forEach((s,i)=>{
     s.index=i;s.pendingRoomId=id;game.players[i].avatar=s.avatar;
   });
   pendingCreates.add(id);
   const deadline=Date.now()+TURN_MS;
   let leaseEpoch;
   try{
    leaseEpoch=await store.initializeRoom({
      roomId:id,mode,game,ownerId:OWNER_ID,
      seats:seats.map(s=>({uid:s.uid,name:s.name})),deadlineMs:deadline
    });
   }catch(err){
    // A network/transaction error does not prove the INSERT rolled back.
    // Quarantine reservations, including offline seats, rather than
    // automatically requeue and potentially create duplicate durable rooms.
    console.error('Room insert uncertain; reservations quarantined',err.code||err.message);
    for(const s of seats)send(s.ws,{type:'error',
      message:'ไม่สามารถยืนยันการสร้างห้องได้ กรุณาเชื่อมต่อใหม่'});
    break;
   }finally{
    pendingCreates.delete(id);
   }
   const room={id,mode,seats,game,deadline,revision:0,timer:null,leaseTimer:null,leaseEpoch,busy:false,halted:false};
   rooms.set(id,room);
   for(const s of seats){s.roomId=id;s.pendingRoomId=null;}
   renewRoomLease(room);
   schedule(room);
   transmit(room,{type:'start'});
  }
  reportWaiting(mode);
 }finally{dispatchBusy[mode]=false;}
}
function haltRoom(room,reason){
 if(room.halted)return;
 room.halted=true;
 if(room.timer)clearTimeout(room.timer);
 if(room.leaseTimer)clearTimeout(room.leaseTimer);
 console.error('Room halted:',room.id,reason);
 for(const member of room.seats)
  send(member.ws,{type:'error',message:'ห้องถูกพักชั่วคราว กรุณาลองเชื่อมต่อใหม่ภายหลัง'});
}
// An ambiguous COMMIT has no safe automatic replay: an acknowledgement can
// be lost after the database commits. Read the authoritative checkpoint from
// a fresh pool query for operator diagnostics ONLY. Never mutate the local
// state, release or reacquire a lease, reschedule, or broadcast a guessed turn.
async function inspectAmbiguousCommit(room,expectedRevision,expectedGame,awards){
 try{
  const evidence=await store.readRoomAndAwards(room.id,expectedRevision);
  const assessment=classifyRoomReconciliation({
   ...evidence,expectedRevision,expectedGame,awards,
   ownerId:OWNER_ID,leaseEpoch:room.leaseEpoch
  });
  // This is advisory ONLY: it never clears the room halt flag and is not
  // an operator-controlled endpoint. A future explicit recovery workflow
  // must acquire/check a fresh lease and re-read canonical state.
  const recovery=prepareManualRecoveryDecision({
   assessment,room:evidence.room,expectedRevision,expectedGame,
   expectedAwards:awards
  });
  // Log category and counts only: no tokens, emails or user identifiers.
  console.error('AMBIGUOUS_COMMIT_RECONCILIATION',JSON.stringify({
   roomId:room.id,classification:assessment.classification,
   storedRevision:assessment.storedRevision,
   expectedRevision,ownerMatches:assessment.ownerMatches,
   missingKinds:assessment.missingKinds,
   conflictingKinds:assessment.conflictingKinds,
   duplicateKinds:assessment.duplicateKinds,
   receiptStatus:assessment.receiptStatus,
   recoveryDecision:recovery.decision,
   recoveryBlockingReasons:recovery.blockingReasons,
   nextAction:'HALTED_REQUIRES_REVIEW'
  }));
 }catch(error){
  console.error('AMBIGUOUS_COMMIT_UNRESOLVED',room.id,error.code||'READ_FAILED');
 }
}
function renewRoomLease(room){
 if(room.halted||room.game.over)return;
 if(room.leaseTimer)clearTimeout(room.leaseTimer);
 room.leaseTimer=setTimeout(async()=>{
  if(room.halted||room.game.over)return;
  try{
   const renewed=await store.renewRoomLease(room.id,OWNER_ID,room.leaseEpoch,LEASE_MS/1000);
   if(!renewed)return haltRoom(room,'LEASE_EXPIRED_OR_STOLEN');
   renewRoomLease(room);
  }catch(e){haltRoom(room,'LEASE_RENEW_FAILED: '+(e.code||e.message));}
 },RENEW_MS);
 room.leaseTimer.unref?.();
}
function schedule(room){
 if(room.timer)clearTimeout(room.timer);
 if(room.halted)return;
 if(room.game.over){room.deadline=null;return;}
 const revision=room.revision, delay=Math.max(0,room.deadline-Date.now());
 room.timer=setTimeout(()=>{
  if(room.revision!==revision||room.game.over||room.halted)return;
  if(room.busy){
   // A previous roll is still committing. Don't discard the deadline forever:
   // the successful commit will reschedule; while busy, retry this revision.
   room.timer=setTimeout(()=>schedule(room),100);
   room.timer.unref?.();
   return;
  }
  advance(room,null).catch(err=>console.error('Timeout transition failed',err.code||err.message));
 },delay+1);
 room.timer.unref?.();
}
async function advance(room,roll){
 if(room.busy||room.game.over||room.halted)return;
 room.busy=true;
 // Evidence must be visible to the catch handler after an ambiguous COMMIT.
 // Do not attempt forensic inspection with block-scoped values from try.
 let expectedRevision=null,expectedGame=null,expectedAwards=[];
 try{
  const now=Date.now();
  if(roll===null && now<room.deadline)return;
  if(roll!==null && now>=room.deadline){
   // A late roll must not consume the turn. Explicitly trigger the timeout
   // instead of relying on a timer that may have fired while a turn was busy.
   if(!room.halted)setImmediate(()=>advance(room,null).catch(
     e=>console.error('Late-roll timeout failed',e.code||e.message)));
   return;
  }
  const old=room.game;
  const next=structuredClone(old);
  const actor=next.current;
  let event, awards=[];
  if(roll===null){
   Rules.timeout(next);event={type:'timeout'};
  }else{
   const outcome=Rules.turn(next,roll,()=>{
     const b=crypto.randomBytes(4).readUInt32BE(0);
     return b/0x100000000;
   });
   event={type:'roll',actor,dice:roll,outcome};
   const target=room.seats[actor];
   if(outcome.reward>0)awards.push({
     eventId:room.id+':lucky',gameId:room.id,mode:room.mode,
     uid:target.uid,kind:'lucky_box',points:outcome.reward
   });
   if(next.over)awards.push({
     eventId:room.id+':win',gameId:room.id,mode:room.mode,
     uid:target.uid,kind:'win',points:10
   });
  }
  const nextDeadline=next.over?null:Date.now()+TURN_MS;
  expectedRevision=room.revision;
  expectedGame=next;
  expectedAwards=awards;
  const receipt={
   type:roll===null?'timeout':'roll',actorIndex:actor,
   dice:roll,outcome:roll===null?{}:{...event.outcome}
  };
  // Reject a corrupted/mismatched receipt BEFORE any PostgreSQL mutation.
  // This also prevents an invalid state from being broadcast to the room.
  requireRuleTransition(old,next,receipt,awards);
  const revision=await store.commitFencedTurn({
    roomId:room.id,ownerId:OWNER_ID,leaseEpoch:room.leaseEpoch,
    expectedRevision,game:next,deadlineMs:nextDeadline,awards,receipt
  });
  // A concurrent heartbeat failure may halt this worker while COMMIT is in
  // flight. Never broadcast or schedule from a locally halted coordinator;
  // persisted state will be reconciled by a future valid lease owner.
  if(room.halted)return;
  room.game=next;room.deadline=nextDeadline;room.revision=revision;
  if(next.over&&room.leaseTimer)clearTimeout(room.leaseTimer);
  schedule(room);transmit(room,event);
 }catch(e){
  console.error('Turn commit failed',e.code||e.message);
  // Halt before any read or client-visible action; a COMMIT acknowledgement
  // may be lost even when the new state and award rows are persisted.
  haltRoom(room,e.code==='AMBIGUOUS_COMMIT'?'AMBIGUOUS_COMMIT':'UNCONFIRMED_TURN_COMMIT');
  if(e.code==='AMBIGUOUS_COMMIT' &&
     expectedRevision!==null && expectedGame!==null)
   await inspectAmbiguousCommit(room,expectedRevision,expectedGame,expectedAwards);
  // Do not replay dice, write scores, renew a halted room or broadcast state.
 }finally{room.busy=false;}
}
async function handle(ws,msg){
 if(!msg||typeof msg!=='object'||Array.isArray(msg))return;
 if(msg.type==='join'){
  if(ws.session)return send(ws,{type:'error',message:'อยู่ในคิวหรือห้องแล้ว'});
  const mode=msg.mode;
  if(mode!=='free'&&mode!=='vip')return send(ws,{type:'error',message:'โหมดไม่ถูกต้อง'});
  // Every join and resume must supply a valid Supabase access token.
  const auth=await requirePlayerIdentity(msg);
  await requireRoomAccess(auth,mode,store);
  const uid=auth.uid;
  // Different sockets for the SAME verified UID may authenticate concurrently.
  // Serialize all seat registration and takeover changes for this UID.
  await withUidJoinLock(uid,async()=>{
   if(ws.readyState!==WebSocket.OPEN)return;
   let existing=sessions.get(uid);
  // On process restart, locate the unfinished verified UID seat in PostgreSQL.
  // The same-process cache remains the fast path. No guest bearer-token resume.
  if(!existing){
   const savedRoomId=await store.findResumableRoomForUid(uid);
   if(savedRoomId){
     const recovered=await restoreRoom(savedRoomId);
     if(!recovered)return send(ws,{type:'error',
       message:'ห้องเดิมอยู่บนเซิร์ฟเวอร์อื่นหรือยังไม่พร้อม'});
   }
   existing=sessions.get(uid);
  }
  if(existing){
   if(existing.mode!==mode && (existing.roomId||existing.pendingRoomId))
     return send(ws,{type:'error',message:'กำลังอยู่ในห้องอื่นหรืออยู่ระหว่างสร้างห้อง'});
   if(existing.mode!==mode){
     takeOut(waiting[existing.mode],existing);existing=null;
   }
  }
  if(existing){
   // No unverified bearer-token resume; the verified UID owns this seat.
   if(ws.readyState!==WebSocket.OPEN)return;
   const last=existing.ws;
   if(last&&last!==ws){last.session=null;last.close(4000,'duplicate session');}
   existing.ws=ws;ws.session=existing;
   if(existing.pendingRoomId){
     const pendingId=existing.pendingRoomId;
     if(pendingCreates.has(pendingId)){
       return send(ws,{type:'waiting',mode,preparing:true,needed:capacity(mode)});
     }
     // Only a successful DB read can release an uncertain reservation.
     // DB outage => leave every seat quarantined, fail closed.
     const persisted=await store.loadRoom(pendingId);
     if(persisted && persisted.status==='playing'){
       const recovered=await restoreRoom(pendingId);
       if(!recovered)return send(ws,{type:'error',
         message:'ห้องเดิมกำลังถูกจัดการโดยเซิร์ฟเวอร์อื่น'});
     }else if(persisted){
       return send(ws,{type:'error',message:'ห้องเดิมไม่พร้อม กรุณาติดต่อผู้ดูแล'});
     }else{
       // Confirmed absent: release ALL seats held by this failed room.
       for(const member of sessions.values()){
         if(member.pendingRoomId!==pendingId)continue;
         member.pendingRoomId=null;member.index=null;
         if(member.ws?.readyState===WebSocket.OPEN){
           if(!waiting[member.mode].includes(member))waiting[member.mode].push(member);
         }else{sessions.delete(member.uid);}
       }
     }
   }
   const room=rooms.get(existing.roomId);
   if(room){
     if(room.halted)return send(ws,{type:'error',message:'ห้องถูกพักเพราะข้อมูลไม่ตรงกัน'});
     let resumedGame;
     try{resumedGame=verifiedRoomSnapshot(room);}
     catch(error){
      haltRoom(room,'INVALID_RESUME_BOARD');
      return send(ws,{type:'error',message:'ข้อมูลกระดานห้องเดิมไม่ถูกต้อง'});
     }
     send(ws,{type:'state',roomId:room.id,seat:existing.index,
       game:resumedGame,deadline:room.deadline,event:{type:'resume'}});
   }else if(!existing.roomId){
     if(!waiting[mode].includes(existing))waiting[mode].push(existing);
     reportWaiting(mode);await dispatch(mode);
   }else{
     // Room restoration failure must never create a fresh match for this UID.
     send(ws,{type:'error',message:'ไม่สามารถกู้คืนห้องเดิมได้'});
   }
   return;
  }
  const name=String(msg.name||'Player').trim().slice(0,20)||'Player';
  const avatar=typeof msg.avatar==='string' && msg.avatar.length<=12?msg.avatar:'🐱';
  await store.player(uid,name);
  // The socket may close while the database operation is pending. Never leave
  // a ghost player in matchmaking or a stale active-session registry.
  if(ws.readyState!==WebSocket.OPEN)return;
  const session={uid,mode,name,avatar,ws,roomId:null,pendingRoomId:null,index:null};
  ws.session=session;sessions.set(uid,session);
  waiting[mode].push(session);
  await dispatch(mode);
  }); // UID lock held through DB lookup, seat recovery and queue registration
  return;
 }
 const s=ws.session;
 if(!s||s.ws!==ws)return;
 if(msg.type==='cancel'&&!s.roomId&&!s.pendingRoomId){
  takeOut(waiting[s.mode],s);sessions.delete(s.uid);ws.session=null;
  send(ws,{type:'cancelled'});reportWaiting(s.mode);return;
 }
 if(msg.type==='roll'){
  const room=rooms.get(s.roomId);
  if(!room||room.game.over||room.halted)return send(ws,{type:'error',message:'ห้องไม่พร้อม'});
  if(room.game.current!==s.index)return send(ws,{type:'error',message:'ยังไม่ถึงตา'});
  if(Date.now()>=room.deadline)return send(ws,{type:'error',message:'หมดเวลา'});
  await advance(room,crypto.randomInt(1,7));
 }
}
// Readiness reports the completed startup database preflight, not ongoing
// database availability. Avoid an unapproved query on every /health request.
let startupReady=false;
let shuttingDown=false;
const leaderboard=process.env.LUCKY_ENABLE_LEADERBOARD==='true'
 ? require('./leaderboard-http-handler.cjs').createLeaderboardHandler({verifyIdentity:requirePlayerIdentity,store})
 : null;
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/leaderboard'){
  if(leaderboard)return leaderboard(req,res);
  res.writeHead(404,{'cache-control':'private, no-store'});res.end('Not Found');return;
 }
 if(u.pathname==='/api/supabase-config'){
  const config={
   url:supabaseConfig.origin,
   publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY,
   leaderboardEnabled:Boolean(leaderboard),
   mode:'supabase'
  };
  if(!config.publishableKey){res.writeHead(503);res.end('Supabase web config missing');return;}
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(config));return;
 }
 if(u.pathname==='/health'){
  respondHealth(req,res,{startupReady,shuttingDown});return;
 }
 let filename;
 try{
  filename=path.resolve(WEB,'.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(filename!==WEB&&!filename.startsWith(WEB+path.sep))throw Error('invalid');
  if(!fs.existsSync(filename)||!fs.statSync(filename).isFile())throw Error('not found');
 }catch{
  res.writeHead(404);res.end('Not Found');return;
 }
 res.writeHead(200,{'content-type':filename.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream',
  'cache-control':'no-store','x-content-type-options':'nosniff'});
 fs.createReadStream(filename).pipe(res);
});
const wss=new WebSocketServer({server,path:'/ws',maxPayload:16384,perMessageDeflate:false});
wss.on('connection',ws=>{
 if(clients.size>=MAX_CONNECTIONS){ws.close(1013,'Server capacity gate');return;}
 clients.add(ws);
 let last=0,processing=false;
 ws.on('message',async raw=>{
  if(processing)return;
  const now=Date.now();
  if(now-last<100)return;last=now;
  processing=true;
  try{await handle(ws,JSON.parse(raw.toString()));}
  catch(e){
   console.error('WS action rejected',e.code||e.message);
   send(ws,{type:'error',message:'ไม่สามารถยืนยันตัวตนหรือทำคำสั่งนี้ได้'});
  }finally{processing=false;}
 });
 ws.on('close',()=>{
  clients.delete(ws);
  const s=ws.session;
  if(s&&s.ws===ws){
   s.ws=null;
   if(!s.roomId&&!s.pendingRoomId){
     takeOut(waiting[s.mode],s);sessions.delete(s.uid);reportWaiting(s.mode);
   }
  }
 });
});
// Bounded startup sweep: at most 10 candidate rooms. A lease claim is
// mandatory; rooms owned by another live worker are never started here.
// No periodic global scan yet: defer to authenticated reconnect and avoid
// unexpected database costs while capacity remains untested.
async function recoverOrphanedRoomsAtStartup(){
 const candidates=await store.listRecoverableRooms(10);
 for(const item of candidates){
  try{await restoreRoom(item.room_id);}
  catch(error){console.error('Room recovery deferred:',item.room_id,error.code||error.message);}
 }
}
beginListening({
 health:()=>store.health(),
 recover:recoverOrphanedRoomsAtStartup,
 server,port:PORT,shouldStop:()=>shuttingDown,
 onReady:()=>{
  startupReady=true;
  console.log('Lucky Game Supabase-auth leased draft listening on '+PORT);
 }
}).catch(err=>{
 startupReady=false;
 console.error('Database/startup preflight failed; server will NOT be ready:',err.code||'STARTUP_FAILED');
 process.exitCode=1;
 store.close().catch(()=>{}).finally(()=>process.exit(1));
});
let shutdownStarted=false;
process.on('SIGTERM',()=>{
 if(shutdownStarted)return;
 shutdownStarted=true;
 shuttingDown=true;startupReady=false;
 for(const room of rooms.values()){
  room.halted=true;clearTimeout(room.timer);clearTimeout(room.leaseTimer);
 }
 beginSocketShutdown({clients,wss,server,graceMs:3000})
  .catch(()=>{})
  .finally(()=>store.close().catch(()=>{}).finally(()=>process.exit(0)));
});
