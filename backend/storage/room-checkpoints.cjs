'use strict';

// Durable SQL room snapshots; infrastructure-agnostic D1-style db adapter.
// Code draft only: existing Node test server does not call this module.
// One authoritative server/coordinator must serialize turns per room.
const VALID_STATUS = new Set(['waiting','playing','finished','closed']);

function id(s, name) {
  if(typeof s!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/.test(s))throw Error('Invalid '+name);
  return s;
}
function validateMode(mode) {
  if(mode!=='free'&&mode!=='vip')throw Error('Invalid room mode');
  return mode;
}
function integer(n,label,min=0) {
  if(!Number.isSafeInteger(n)||n<min) throw Error('Invalid '+label);
  return n;
}
function validateState(state) {
  if(!state || typeof state!=='object'||Array.isArray(state)) throw Error('Invalid game state');
  // Canonical serialization strips prototypes and forbids circular references.
  const json=JSON.stringify(state);
  if(typeof json!=='string' || Buffer.byteLength(json,'utf8')>262144)throw Error('Game state too large');
  return json;
}

function createRoomCheckpointStore(db) {
  if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function')
    throw Error('Transactional database required');

  async function initializeRoom({roomId,gameId,mode,state,status='playing',seats,deadlineAtMs=null}) {
    id(roomId,'room id');id(gameId,'game id');validateMode(mode);
    if(!VALID_STATUS.has(status))throw Error('Invalid status');
    const seatCount=mode==='free'?4:2;
    if(!Array.isArray(seats)||seats.length!==seatCount ||
       new Set(seats).size!==seatCount)throw Error('Invalid verified seats');
    for(const uid of seats)id(uid,'verified uid');
    if(deadlineAtMs!==null)integer(deadlineAtMs,'deadline');
    const json=validateState(state);
    const now=Date.now();
    const statements=[
      db.prepare('INSERT INTO game_room_checkpoints'
        +' (room_id,mode,game_id,state_json,revision,status,deadline_at_ms,saved_at_ms)'
        +' VALUES(?,?,?,?,0,?,?,?)')
        .bind(roomId,mode,gameId,json,status,deadlineAtMs,now),
      ...seats.map((uid,seatIndex)=>db.prepare(
        'INSERT INTO game_room_seats(room_id,seat_index,uid) VALUES(?,?,?)'
      ).bind(roomId,seatIndex,uid))
    ];
    await db.batch(statements);
    return {roomId,gameId,mode,status,revision:0};
  }

  async function loadRoom(roomId){
    id(roomId,'room id');
    const row=await db.prepare(
      'SELECT room_id AS roomId,game_id AS gameId,mode,state_json AS stateJson,'
      +' revision,status,deadline_at_ms AS deadlineAtMs,saved_at_ms AS savedAtMs'
      +' FROM game_room_checkpoints WHERE room_id=?'
    ).bind(roomId).first();
    if(!row)return null;
    const seats=await db.prepare(
      'SELECT seat_index AS seatIndex,uid FROM game_room_seats'
      +' WHERE room_id=? ORDER BY seat_index'
    ).bind(roomId).all();
    return {
      roomId:row.roomId,gameId:row.gameId,mode:row.mode,
      state:JSON.parse(row.stateJson),revision:row.revision,
      status:row.status,deadlineAtMs:row.deadlineAtMs,
      savedAtMs:row.savedAtMs,seats:seats.results||[]
    };
  }

  // UPDATE ... WHERE revision=? is an optimistic concurrency guard.
  // The caller MUST not broadcast a new turn until this write succeeds.
  // This does not replace a single authoritative coordinator per room.
  async function updateRoom({roomId,expectedRevision,state,status,deadlineAtMs=null}){
    id(roomId,'room id');
    integer(expectedRevision,'expected revision');
    if(!VALID_STATUS.has(status))throw Error('Invalid status');
    if(deadlineAtMs!==null)integer(deadlineAtMs,'deadline');
    const json=validateState(state);
    const result=await db.prepare(
      'UPDATE game_room_checkpoints SET state_json=?,revision=revision+1,'
      +' status=?,deadline_at_ms=?,saved_at_ms=?'
      +' WHERE room_id=? AND revision=? AND status != ?'
    ).bind(json,status,deadlineAtMs,Date.now(),roomId,expectedRevision,'closed').run();
    if(result?.meta?.changes!==1){
      const error=new Error('Room checkpoint version conflict');
      error.code='ROOM_VERSION_CONFLICT';
      throw error;
    }
    return expectedRevision+1;
  }

  // Resume lookup requires a previously VERIFIED identity from Firebase.
  async function findSeatForVerifiedUid(roomId,verifiedUid){
    id(roomId,'room id');id(verifiedUid,'uid');
    const row=await db.prepare(
      'SELECT seat_index AS seatIndex FROM game_room_seats'
      +' WHERE room_id=? AND uid=?'
    ).bind(roomId,verifiedUid).first();
    return row ? row.seatIndex : null;
  }

  async function listRecoverableRooms(limit=50) {
    integer(limit,'limit',1);
    if(limit>100)throw Error('Limit too large');
    const r=await db.prepare(
      'SELECT room_id AS roomId,game_id AS gameId,mode,revision,'
      +' status,deadline_at_ms AS deadlineAtMs'
      +' FROM game_room_checkpoints WHERE status IN (?,?)'
      +' ORDER BY saved_at_ms ASC LIMIT ?'
    ).bind('waiting','playing',limit).all();
    return r.results||[];
  }

  return {initializeRoom,loadRoom,updateRoom,findSeatForVerifiedUid,listRecoverableRooms};
}
module.exports={createRoomCheckpointStore};
