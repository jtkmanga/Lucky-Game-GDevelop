'use strict';

/**
 * Plan state restoration after a backend restart.
 * Does not start timers, run game turns, or make database writes.
 * The authoritative room coordinator must consume this plan and
 * re-check room revision before applying a timeout or broadcasting.
 */
const TURN_TIMEOUT_MS=20000;

function recoveryPlan(room, nowMs=Date.now()){
  if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new Error('Invalid clock');
  if(!room||typeof room!=='object' || typeof room.roomId!=='string' ||
     !Number.isSafeInteger(room.revision)||room.revision<0)
    throw new Error('Invalid room checkpoint');
  if(room.status==='finished'||room.status==='closed'){
    return {action:'none',roomId:room.roomId,revision:room.revision};
  }
  if(room.status==='waiting'){
    // Do not assume disconnected sockets are still connected.
    return {action:'restore_waiting',roomId:room.roomId,revision:room.revision};
  }
  if(room.status!=='playing'||!room.state||typeof room.state!=='object')
    throw new Error('Invalid playing room');
  const deadline=room.deadlineAtMs;
  if(!Number.isSafeInteger(deadline)||deadline<0){
    // Without persisted deadline, never invent a missed dice roll.
    return {action:'manual_reconciliation',reason:'missing_deadline',
      roomId:room.roomId,revision:room.revision};
  }
  if(nowMs>=deadline){
    // Caller MUST use current turn/revision and game rules to skip once
    // (never auto-roll), then commit via transactional outbox before emit.
    return {action:'skip_expired_turn',roomId:room.roomId,
      revision:room.revision,deadlineAtMs:deadline};
  }
  return {action:'restore_timer',roomId:room.roomId,
    revision:room.revision,deadlineAtMs:deadline,
    remainingMs:deadline-nowMs};
}

/**
 * Load a bounded set of rooms. Output is a plan only, never a claim of
 * successful recovery. The host needs a durable single-writer coordinator.
 */
async function getRecoveryPlans(roomStore,limit=50,nowMs=Date.now()){
  if(!roomStore||typeof roomStore.listRecoverableRooms!=='function' ||
     typeof roomStore.loadRoom!=='function')throw Error('Invalid room store');
  const candidates=await roomStore.listRecoverableRooms(limit);
  const plans=[];
  for(const candidate of candidates){
    const room=await roomStore.loadRoom(candidate.roomId);
    if(room)plans.push(recoveryPlan(room,nowMs));
  }
  return plans;
}
module.exports={TURN_TIMEOUT_MS,recoveryPlan,getRecoveryPlans};
