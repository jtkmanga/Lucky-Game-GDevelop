'use strict';
/*
 * Authoritative turn coordinator (integration draft).
 * The existing WebSocket ZIP runtime is NOT replaced by this module yet.
 * Call only with a Firebase-verified uid from the join guard. No user-supplied
 * roll, prize, seat, winner or event-id is accepted.
 * One coordinator instance per room MUST be guaranteed by the eventual host.
 */
const crypto=require('node:crypto');
const TURN_MS=20000;
const locks=new Set();

function roomId(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/.test(value))
    throw new Error('Invalid room id');
  return value;
}
function uid(value){
  if(typeof value!=='string'||!value||value.length>128)
    throw new Error('Verified user required');
  return value;
}
function deepCopy(game){
  // Source must be a persisted, trusted JSON game state.
  return JSON.parse(JSON.stringify(game));
}
function verifiedSeat(room,verifiedUid){
  const seat=room.seats.find(s=>s.uid===verifiedUid);
  if(!seat)throw new Error('Verified user is not seated in this room');
  return seat.seatIndex;
}
function requirePlaying(room){
  if(!room||room.status!=='playing'||room.state?.over)
    throw new Error('Room is not playing');
  if(!Number.isSafeInteger(room.deadlineAtMs))
    throw new Error('Missing authoritative turn deadline');
}
function buildAwards(room,game,actor,outcome){
  const events=[];
  if(outcome.reward>0){
    events.push({
      eventId:'box:'+room.gameId,
      uid:room.seats[actor].uid,
      kind:'lucky_box',points:outcome.reward
    });
  }
  if(game.over){
    if(game.winner!==actor)throw new Error('Winner mismatch');
    events.push({
      eventId:'win:'+room.gameId,
      uid:room.seats[actor].uid,
      kind:'game_win',points:10
    });
  }
  return events;
}
function createTurnCoordinator({gateway,rules,randomDice=()=>crypto.randomInt(1,7)}) {
  if(!gateway||typeof gateway.loadRoom!=='function'||
     typeof gateway.commitServerTurn!=='function')
    throw new Error('Persistent gateway is required');
  if(!rules||typeof rules.turn!=='function'||typeof rules.timeout!=='function')
    throw new Error('Trusted game rules required');

  async function serialize(id,task){
    if(locks.has(id)){
      const e=new Error('Concurrent turn already running');
      e.code='ROOM_BUSY';
      throw e;
    }
    locks.add(id);
    try{return await task();}
    finally{locks.delete(id);}
  }
  async function roll({roomId:rid,verifiedUid,nowMs=Date.now()}){
    roomId(rid);uid(verifiedUid);
    return serialize(rid,async()=>{
      const room=await gateway.loadRoom(rid);
      requirePlaying(room);
      const actor=verifiedSeat(room,verifiedUid);
      if(room.state.current!==actor){
        const e=new Error('Not your turn');
        e.code='NOT_YOUR_TURN';
        throw e;
      }
      if(nowMs>=room.deadlineAtMs) {
        const e=new Error('Turn deadline has expired');
        e.code='TURN_EXPIRED';
        throw e;
      }
      const game=deepCopy(room.state);
      const dice=randomDice();
      if(!Number.isInteger(dice)||dice<1||dice>6)
        throw new Error('Invalid server dice result');
      const outcome=rules.turn(game,dice);
      const awards=buildAwards(room,game,actor,outcome);
      const deadlineAtMs=game.over?null:Date.now()+TURN_MS;
      const next=await gateway.commitServerTurn({
        roomId:rid,gameId:room.gameId,mode:room.mode,
        expectedRevision:room.revision,state:game,
        status:game.over?'finished':'playing',deadlineAtMs,
        transitionId:'turn:'+room.gameId+':'+(room.revision+1),
        awards
      });
      // Only caller broadcasts after commit succeeds.
      return {roomId:rid,revision:next.revision,game,
        deadlineAtMs,event:{type:'roll',actor,dice,outcome}};
    });
  }
  async function skipExpired({roomId:rid,expectedRevision,nowMs=Date.now()}){
    roomId(rid);
    return serialize(rid,async()=>{
      const room=await gateway.loadRoom(rid);
      requirePlaying(room);
      if(room.revision!==expectedRevision) {
        const e=new Error('Room revision changed');
        e.code='ROOM_VERSION_CONFLICT';throw e;
      }
      if(nowMs<room.deadlineAtMs)throw new Error('Deadline has not expired');
      const game=deepCopy(room.state);
      const actor=game.current;
      rules.timeout(game); // skip turn; DO NOT auto-roll
      const deadlineAtMs=Date.now()+TURN_MS;
      const next=await gateway.commitServerTurn({
        roomId:rid,gameId:room.gameId,mode:room.mode,
        expectedRevision:room.revision,state:game,
        status:'playing',deadlineAtMs,
        transitionId:'timeout:'+room.gameId+':'+(room.revision+1),
        awards:[]
      });
      return {roomId:rid,revision:next.revision,game,
        deadlineAtMs,event:{type:'timeout',actor}};
    });
  }
  return {roll,skipExpired};
}
module.exports={createTurnCoordinator,TURN_MS};
