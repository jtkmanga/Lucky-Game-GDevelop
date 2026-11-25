'use strict';

/**
 * Persistence gateway for a future authoritative room coordinator.
 * NOT connected to the current multiplayer ZIP server. Server must:
 *  - verify Firebase identity at every join/rejoin,
 *  - call claimSeat using verified UID only,
 *  - serialize turns per room,
 *  - persist a turn before broadcasting,
 *  - handle revisions and replay idempotent awards on recovery.
 *
 * The gateway intentionally does not accept client-originated dice,
 * points, winner flags, VIP access flags or administrative grants.
 */
const {createJoinGuard}=require('./join-guard.cjs');
const {createRoomCheckpointStore}=require('../storage/room-checkpoints.cjs');
const {createGameStorage}=require('../storage/d1-store.cjs');
const {currentLeaderboard,currentScore,archivePreviousPeriod}=require('../storage/score-period-service.cjs');

function createPersistenceGateway({db,firebaseProjectId}) {
  if(!db || typeof db.prepare!=='function' || typeof db.batch!=='function')
    throw Error('Durable transactional SQL binding required');

  const roomStore=createRoomCheckpointStore(db);
  const playerStore=createGameStorage(db);
  const authorizeJoin=createJoinGuard({firebaseProjectId,storage:playerStore});

  async function authenticateAndMatch(joinMessage) {
    // Must be performed before enqueueing a session in a Free or VIP room.
    const user=await authorizeJoin(joinMessage);
    const displayName=typeof joinMessage.name==='string'
      ? joinMessage.name : 'Player';
    const profile=await playerStore.createPlayer(user.uid,displayName);
    return Object.freeze({
      uid:user.uid,mode:user.mode,
      name:profile.display_name,
      email:user.email
    });
  }

  async function createStartedRoom({roomId,gameId,mode,game,seatedUsers,deadlineAtMs}) {
    if(!Array.isArray(seatedUsers))throw Error('Missing verified players');
    // The caller must supply ONLY identities returned from authenticateAndMatch.
    if(seatedUsers.some(u=>!u||typeof u.uid!=='string'||u.mode!==mode))
      throw Error('Seat identity or mode mismatch');
    return roomStore.initializeRoom({
      roomId,gameId,mode,state:game,status:'playing',
      seats:seatedUsers.map(u=>u.uid),deadlineAtMs
    });
  }

  async function persistGameState({roomId,expectedRevision,game,deadlineAtMs}) {
    if(!game||typeof game!=='object')throw Error('Missing authoritative game');
    return roomStore.updateRoom({
      roomId,expectedRevision,
      state:game,
      status:game.over?'finished':'playing',
      deadlineAtMs:game.over?null:deadlineAtMs
    });
  }

  async function resumeVerifiedSeat({roomId,joinMessage}) {
    // Reverify identity and VIP entitlement on reconnect.
    const user=await authenticateAndMatch(joinMessage);
    const room=await roomStore.loadRoom(roomId);
    if(!room||room.status==='closed'||room.mode!==user.mode)
      throw Error('Room unavailable');
    const seatIndex=await roomStore.findSeatForVerifiedUid(roomId,user.uid);
    if(seatIndex===null)throw Error('Verified account does not own this seat');
    return {room,seatIndex,uid:user.uid};
  }

  // Following actions are called by server-originated result handlers only.
  // DO NOT expose them as arbitrary client websocket message types.
  async function applyWinner({room,verifiedWinnerUid,completedAtMs}) {
    if(!room || room.status!=='finished' || !room.state?.over)
      throw Error('Game has not finished');
    const seat=await roomStore.findSeatForVerifiedUid(room.roomId,verifiedWinnerUid);
    if(seat===null || room.state.winner!==seat)
      throw Error('Winner identity disagrees with completed room');
    return playerStore.recordGameWinner({
      gameId:room.gameId,uid:verifiedWinnerUid,
      mode:room.mode,completedAtMs
    });
  }

  // Reward points and event id must be derived from trusted game engine output.
  // The caller must first persist the room state and enforce one Lucky Box per game.
  async function applyLuckyBox({room,verifiedWinnerUid,points,eventId}) {
    if(!room?.state?.giftUsed)throw Error('No Lucky Box awarded by engine');
    const seat=await roomStore.findSeatForVerifiedUid(room.roomId,verifiedWinnerUid);
    if(seat===null)throw Error('Invalid Lucky Box recipient');
    if(room.state.players?.[seat]?.luckyEarned < points)
      throw Error('Reward disagrees with room state');
    return playerStore.recordLuckyBox({
      gameId:room.gameId,uid:verifiedWinnerUid,
      mode:room.mode,points,eventId
    });
  }

  // Read-only leaderboard scoped to current Free/VIP score period.
  async function getLeaderboard(mode,limit=50,nowMs=Date.now()) {
    return currentLeaderboard(db,mode,limit,nowMs);
  }
  async function getCurrentScore(verifiedUid,mode,nowMs=Date.now()){
    return currentScore(db,verifiedUid,mode,nowMs);
  }

  // Called by a future trusted scheduler, never from a player command.
  async function archivePrevious(mode,nowMs=Date.now()){
    return archivePreviousPeriod(db,mode,nowMs);
  }

  return {
    authenticateAndMatch,createStartedRoom,persistGameState,resumeVerifiedSeat,
    applyWinner,applyLuckyBox,getLeaderboard,getCurrentScore,
    archivePrevious,loadRoom:roomStore.loadRoom,
    listRecoverableRooms:roomStore.listRecoverableRooms
  };
}
module.exports={createPersistenceGateway};
