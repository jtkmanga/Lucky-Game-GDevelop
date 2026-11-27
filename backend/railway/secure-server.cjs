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
const {requireRoomAccess,requireVipExpiry}=require('../auth/room-access.cjs');
const {createRailwayStore}=require('../supabase/game-store.cjs');
const {respondHealth}=require('./health-http-handler.cjs');
const {beginListening}=require('./startup-lifecycle.cjs');
const {beginSocketShutdown}=require('./socket-shutdown.cjs');
const {classifyRoomReconciliation}=require('../supabase/room-reconciliation.cjs');
const {prepareManualRecoveryDecision}=require('../supabase/manual-room-recovery.cjs');

const {readFree4Pilot}=require('./free4-pilot.cjs');
const pilot=readFree4Pilot(process.env);
const supabaseConfig=readConfig();
const store=createRailwayStore(process.env.DATABASE_URL,
 pilot ? {roomId:pilot.roomId,cutoffMs:pilot.cutoffMs} : null);
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
let pilotQuarantined=false,pilotCreateUncertain=false;
let pilotRecoveryTimer=null,pilotRecoveryAttempts=0;
const isTransientPilotRead=error=>/^08/.test(error?.code||'')||
 ['57P01','57P02','57P03','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE'].includes(error?.code);
// One fixed room only. Four 10s retries cover a prior 30s lease, without
// spinning or renewing a lease that this process does not own.
function deferPilotRecovery(){
 if(!pilot||shuttingDown||pilotQuarantined||pilotRecoveryTimer||pilotRecoveryAttempts>=4)return;
 pilotRecoveryAttempts++;
 pilotRecoveryTimer=setTimeout(async()=>{
  pilotRecoveryTimer=null;
  if(shuttingDown||pilotQuarantined||rooms.has(pilot.roomId))return;
  try{await restoreRoom(pilot.roomId);}
  catch(error){
   console.error('Pilot recovery retry failed',error.code||error.message);
   if(isTransientPilotRead(error))deferPilotRecovery();
  }
 },RENEW_MS);
 pilotRecoveryTimer.unref?.();
}
async function checkPilot(room){
 if(shuttingDown||pilotQuarantined||room.halted||room.busy)return false;
 room.busy=true;
 const fence={roomId:room.id,ownerId:OWNER_ID,leaseEpoch:room.leaseEpoch,expectedRevision:room.revision};
 try{
  let status=await store.inspectPilotFence(fence);
  if(shuttingDown||room.halted)return false;
  if(status==='open')return true;
  if(status==='expired')status=await store.closeExpiredPilot(fence);
  if(status!=='closed'&&status!=='finished')throw Error('PILOT_FENCE_'+status);
  haltRoom(room,'PILOT_'+status);
 }catch(error){
  pilotQuarantined=true;
  haltRoom(room,error.code||error.message);
  if(error.code==='AMBIGUOUS_COMMIT'){
   try{
    const row=await store.loadRoom(room.id);
    console.error('Pilot close acknowledgement lost; read-back',row?.status||'absent');
   }catch(readError){console.error('Pilot close read-back failed',readError.message);}
  }
  throw error;
 }finally{room.busy=false;}
 return false;
}
function armPilotCutoff(room){
 if(!pilot||shuttingDown||room.halted||room.game.over)return;
 // Host time sets wake-up frequency. The locked database check decides expiry.
 const delay=Math.min(RENEW_MS,Math.max(250,pilot.cutoffMs-Date.now()));
 room.cutoffTimer=setTimeout(async()=>{
  if(room.halted||room.game.over)return;
  try{
   if(!room.busy)await checkPilot(room);
   armPilotCutoff(room);
  }catch(error){console.error('Pilot cutoff check failed',error.code||error.message);}
 },delay);
 room.cutoffTimer.unref?.();
}
async function restoreRoom(roomId){
 if(pilot&&(roomId!==pilot.roomId||pendingCreates.has(roomId)))return null;
 if(rooms.has(roomId))return rooms.get(roomId);
 if(restoreTasks.has(roomId))return restoreTasks.get(roomId);
 const task=(async()=>{
  if(pilot){
   // Check the fixed row and roster before claiming any lease; check again
   // on the leased checkpoint before attaching sessions or starting timers.
   const candidate=await store.loadRoom(roomId);
   if(!candidate){
    if(pilotCreateUncertain)deferPilotRecovery();
    return null;
   }
   pilotCreateUncertain=false;
   if(['closed','finished'].includes(candidate.status))return null;
   if(candidate.status!=='playing'||candidate.mode!=='free'||!pilot.matches(roomId,candidate.seats))
    throw Error('Invalid Free4 pilot room');
  }
  // Claim ownership BEFORE any local timer/state is reconstructed. If another
  // worker has a valid lease, do not operate the room on this process.
  const claim=await store.acquireRoomLease(roomId,OWNER_ID,LEASE_MS/1000);
  if(!claim){
   if(pilot){
    console.error('Pilot recovery deferred: lease unavailable');
    deferPilotRecovery();
   }
   return null;
  }
  const row=await store.loadRoom(roomId);
  if(!row||row.status!=='playing'||
     row.lease_owner!==OWNER_ID||
     Number(row.lease_epoch)!==claim.leaseEpoch)
    throw Error('Room lease changed during restore');
  const sourceSeats=row.seats;
  if(pilot&&(row.mode!=='free'||!pilot.matches(roomId,sourceSeats)))
   throw Error('Invalid Free4 pilot room');
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
  if(pilot && !await checkPilot(room))return null;
  members.forEach((member,i)=>{
    member.roomId=roomId;member.pendingRoomId=null;
    member.index=i;sessions.set(member.uid,member);
  });
  rooms.set(roomId,room);
  armPilotCutoff(room);
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
  send(s.ws,{type:'state',roomId:room.id,revision:room.revision,seat:i,game,
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
// Keep VIP joins responsive to cancel and takeover while the queue worker awaits storage.
async function dispatchAfterJoin(mode){
 if(mode==='vip'){
  dispatch(mode).catch(error=>console.error('VIP dispatch failed',error.code||error.message));
 }else await dispatch(mode);
}
async function dispatch(mode){
 if(dispatchBusy[mode])return;
 dispatchBusy[mode]=true;
 try{
  const q=waiting[mode];
  while(q.length>=capacity(mode)){
   if(mode==='vip'){
    // Leave the FIFO intact while reading. Socket takeover can reuse the same session.
    const selected=q.slice(0,capacity(mode)).map(session=>({session,ws:session.ws}));
    const checks=await Promise.allSettled(selected.map(({session})=>requireVipExpiry(session.uid,store)));
    if(shuttingDown)return;
    const now=Date.now();
    for(const [i,{session,ws}] of selected.entries()){
     if(!q.includes(session)||session.ws!==ws)continue;
     const owned=sessions.get(session.uid)===session;
     const connected=owned && ws && ws.session===session && ws.readyState===WebSocket.OPEN;
     if(connected && checks[i].status==='fulfilled' && checks[i].value>now)continue;
     takeOut(q,session);
     if(owned)sessions.delete(session.uid);
     if(ws && ws.session===session)ws.session=null;
     session.ws=null;
     if(connected)send(ws,{type:'error',message:'ไม่สามารถยืนยันสิทธิ์ VIP ได้'});
    }
    // A changed queue head or replacement socket requires a fresh selection and read.
    if(selected.some(({session,ws},i)=>q[i]!==session||session.ws!==ws))continue;
   }
   const seats=q.splice(0,capacity(mode));
   if(seats.some(s=>s.ws?.readyState!==WebSocket.OPEN)){ // lost queue member
    for(const s of seats)if(s.ws?.readyState===WebSocket.OPEN)q.unshift(s);
    continue;
   }
   // Seats must be reserved BEFORE the DB call. A disconnect while INSERT is
   // pending must not return a seat to matchmaking (or create two rooms).
   const id=pilot?.roomId||crypto.randomUUID();
   if(pilot&&(mode!=='free'||!pilot.matches(id,seats)||rooms.has(id)))
    throw Error('Invalid Free4 pilot allocation');
   const game=Rules.create(seats.map(s=>s.name),mode);
   seats.forEach((s,i)=>{
     s.index=i;s.pendingRoomId=id;game.players[i].avatar=s.avatar;
   });
   pendingCreates.add(id);
   const deadline=Date.now()+TURN_MS;
   let room,initialized=false;
   try{
    const sockets=mode==='vip'?seats.map(s=>s.ws):null;
    const leaseEpoch=await store.initializeRoom({
      roomId:id,mode,game,ownerId:OWNER_ID,
      ...(sockets && {reservationCurrent:()=>!shuttingDown && seats.every((s,i)=>
       sessions.get(s.uid)===s && s.pendingRoomId===id && s.ws===sockets[i] &&
       s.ws?.readyState===WebSocket.OPEN && s.ws.session===s)}),
      seats:seats.map(s=>({uid:s.uid,name:s.name})),deadlineMs:deadline
    });
    initialized=true;
    if(pilot)pilotCreateUncertain=false;
    room={id,mode,seats,game,deadline,revision:0,timer:null,leaseTimer:null,leaseEpoch,busy:false,halted:false};
    if(pilot && !await checkPilot(room))break;
   }catch(err){
    if(initialized)throw err;
    if(mode==='vip' && err.code==='VIP_PAIR_DENIED'){
     for(const s of seats){
      if(s.ws?.session===s)s.ws.session=null;
      if(sessions.get(s.uid)===s)sessions.delete(s.uid);
      s.pendingRoomId=null;s.index=null;
      send(s.ws,{type:'error',message:'ไม่สามารถยืนยันสิทธิ์ VIP ได้'});
     }
     continue;
    }
    if(mode==='vip' && err.code==='VIP_CREATE_UNCERTAIN'){
     for(const s of seats)s.vipCreateUncertain=true;
    }
    // A network/transaction error does not prove the INSERT rolled back.
    // Quarantine reservations, including offline seats, rather than
    // automatically requeue and potentially create duplicate durable rooms.
    console.error('Room insert uncertain; reservations quarantined',err.code||err.message);
    if(pilot){pilotCreateUncertain=true;deferPilotRecovery();} // never replay INSERT here
    for(const s of seats)send(s.ws,{type:'error',
      message:'ไม่สามารถยืนยันการสร้างห้องได้ กรุณาเชื่อมต่อใหม่'});
    break;
   }finally{
    pendingCreates.delete(id);
   }
   rooms.set(id,room);
   armPilotCutoff(room);
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
 clearTimeout(room.cutoffTimer);
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
  if(next.over)clearTimeout(room.cutoffTimer);
  if(next.over&&room.leaseTimer)clearTimeout(room.leaseTimer);
  schedule(room);transmit(room,event);
 }catch(e){
  console.error('Turn commit failed',e.code||e.message);
  // Halt before any read or client-visible action; a COMMIT acknowledgement
  // may be lost even when the new state and award rows are persisted.
  if(pilot && e.message==='LEASE_LOST_OR_STALE_REVISION'){
   room.busy=false;
   if(!await checkPilot(room))return;
  }
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
  if(pilot&&(pilotQuarantined||!pilot.admits(auth.uid,mode)))
   return send(ws,{type:'error',message:'บัญชีนี้ไม่ได้รับอนุญาตให้เข้าห้องทดสอบ'});
  await requireRoomAccess(auth,mode,store);
  const uid=auth.uid;
  // Different sockets for the SAME verified UID may authenticate concurrently.
  // Serialize all seat registration and takeover changes for this UID.
  await withUidJoinLock(uid,async()=>{
   if(ws.readyState!==WebSocket.OPEN||(pilot&&ws.session))return;
   let existing=sessions.get(uid);
  // On process restart, locate the unfinished verified UID seat in PostgreSQL.
  // The same-process cache remains the fast path. No guest bearer-token resume.
  if(!existing){
   let savedRoomId;
   if(pilot){
    // Read only the configured room. A previously used or malformed room ID
    // may not fall through to normal matchmaking or create a second room.
    const saved=await store.loadRoom(pilot.roomId);
    if(saved){
     if(saved.status!=='playing'||saved.mode!=='free'||!pilot.matches(pilot.roomId,saved.seats))
      return send(ws,{type:'error',message:'ห้องทดสอบไม่พร้อม'});
     savedRoomId=pilot.roomId;
    }else if(Date.now()>=pilot.cutoffMs){
     return send(ws,{type:'error',message:'หมดเวลาทดสอบ'});
    }
   }else savedRoomId=await store.findResumableRoomForUid(uid);
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
     takeOut(waiting[existing.mode],existing);
     sessions.delete(uid);
     if(existing.ws){existing.ws.session=null;existing.ws.close(4000,'duplicate session');}
     existing=null;
   }
  }
  if(existing){
   // No unverified bearer-token resume; the verified UID owns this seat.
   if(ws.readyState!==WebSocket.OPEN||(pilot&&ws.session))return;
   if(pilot && (existing.roomId||existing.pendingRoomId)){
    const fixedId=existing.roomId||existing.pendingRoomId;
    if(pendingCreates.has(fixedId))return send(ws,{type:'error',message:'ห้องทดสอบยังไม่พร้อม'});
    let room=rooms.get(fixedId);
    if(!room&&existing.pendingRoomId){
     const saved=await store.loadRoom(fixedId);
     if(shuttingDown||ws.readyState!==WebSocket.OPEN||ws.session)return;
     if(existing.pendingRoomId!==fixedId||pendingCreates.has(fixedId))
      return send(ws,{type:'error',message:'ห้องทดสอบยังไม่พร้อม'});
     if(!saved){
      // No automatic second INSERT. An approved reconnect before cutoff may
      // release the empty reservation for the same immutable room ID only.
      if(Date.now()>=pilot.cutoffMs)return send(ws,{type:'error',message:'หมดเวลาทดสอบ'});
      for(const member of sessions.values()){
       if(member.pendingRoomId!==fixedId)continue;
       member.pendingRoomId=null;member.index=null;
       if(member.ws?.readyState===WebSocket.OPEN){
        if(!waiting[member.mode].includes(member))waiting[member.mode].push(member);
       }else if(member!==existing){sessions.delete(member.uid);}
      }
     }else if(saved.status==='playing'){
      room=await restoreRoom(fixedId);
      if(!room)return send(ws,{type:'error',message:'ห้องทดสอบยังไม่พร้อม'});
     }else return send(ws,{type:'error',message:'ห้องทดสอบไม่พร้อม'});
    }
    if((!room&&existing.roomId)||(room&&(room.game.over||!await checkPilot(room)||room.halted||room.game.over)))
      return send(ws,{type:'error',message:'ห้องทดสอบไม่พร้อม'});
    if(shuttingDown||ws.readyState!==WebSocket.OPEN||ws.session)return;
   }
   if(existing.vipCreateUncertain)return send(ws,{type:'error',message:'ห้อง VIP รอการตรวจสอบ'});
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
     if(pilot&&room.game.over)return send(ws,{type:'error',message:'ห้องทดสอบจบแล้ว'});
     if(room.halted)return send(ws,{type:'error',message:'ห้องถูกพักเพราะข้อมูลไม่ตรงกัน'});
     let resumedGame;
     try{resumedGame=verifiedRoomSnapshot(room);}
     catch(error){
      haltRoom(room,'INVALID_RESUME_BOARD');
      return send(ws,{type:'error',message:'ข้อมูลกระดานห้องเดิมไม่ถูกต้อง'});
     }
     send(ws,{type:'state',roomId:room.id,revision:room.revision,seat:existing.index,
       game:resumedGame,deadline:room.deadline,event:{type:'resume'}});
   }else if(!existing.roomId){
     if(!waiting[mode].includes(existing))waiting[mode].push(existing);
     reportWaiting(mode);await dispatchAfterJoin(mode);
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
  if(ws.readyState!==WebSocket.OPEN||(pilot&&ws.session))return;
  const session={uid,mode,name,avatar,ws,roomId:null,pendingRoomId:null,index:null};
  ws.session=session;sessions.set(uid,session);
  waiting[mode].push(session);
  await dispatchAfterJoin(mode);
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
  if(pilot && room.busy)return send(ws,{type:'error',message:'ห้องกำลังตรวจสอบ กรุณาลองใหม่'});
  if(room.game.current!==s.index)return send(ws,{type:'error',message:'ยังไม่ถึงตา'});
  if(Date.now()>=room.deadline)return send(ws,{type:'error',message:'หมดเวลา'});
  await advance(room,crypto.randomInt(1,7));
 }
}
// Readiness reports the completed startup database preflight, not ongoing
// database availability. Avoid an unapproved query on every /health request.
let startupReady=false;
let shuttingDown=false;
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/supabase-config'){
  const config={
   url:supabaseConfig.origin,
   publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY,
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
 // The pilot startup path visits only its configured fixed row.
 if(pilot){
  await restoreRoom(pilot.roomId);
  return;
 }
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
 clearTimeout(pilotRecoveryTimer);
 for(const room of rooms.values()){
  room.halted=true;clearTimeout(room.cutoffTimer);clearTimeout(room.timer);clearTimeout(room.leaseTimer);
 }
 beginSocketShutdown({clients,wss,server,graceMs:3000})
  .catch(()=>{})
  .finally(()=>store.close().catch(()=>{}).finally(()=>process.exit(0)));
});
