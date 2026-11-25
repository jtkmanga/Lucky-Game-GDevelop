'use strict';

/**
 * Atomic checkpoint + outbox enqueue for the future authoritative server.
 * Draft. Not wired into the ZIP server. Migration 003 is required.
 *
 * Important invariant: one D1 db.batch holds the revision UPDATE, a
 * FOREIGN-KEY-constrained transition marker, and all score intents. If
 * revision UPDATE affects 0 rows, there is no receipt and the marker INSERT
 * fails; the transaction rolls back. Foreign keys must be enforced.
 *
 * Intent payloads MUST be calculated by server game rules. Never pass
 * arbitrary client websocket JSON into this API.
 */
const MAX_STATE_BYTES=262144;
function id(v,what){
  if(typeof v!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/.test(v))
    throw new Error('Invalid '+what);
  return v;
}
function safeInt(v,what,min=0){
  if(!Number.isSafeInteger(v)||v<min)throw new Error('Invalid '+what);
  return v;
}
function modeValue(v){
  if(v!=='free'&&v!=='vip')throw new Error('Invalid mode');
  return v;
}
function dbValue(db){
  if(!db||typeof db.batch!=='function'||typeof db.prepare!=='function')
    throw new Error('Transactional database adapter required');
  return db;
}
function jsonState(v){
  if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Invalid state');
  const data=JSON.stringify(v);
  if(typeof data!=='string'||Buffer.byteLength(data,'utf8')>MAX_STATE_BYTES)
    throw new Error('Invalid state size');
  return data;
}

/**
 * @param {object} input Fields from trusted authoritative server logic only.
 * @param {Array<{eventId:string,uid:string,kind:'game_win'|'lucky_box',points:number}>} input.awards
 */
async function commitRoomTurn(db, {
  roomId, gameId, mode, expectedRevision, state, status,
  deadlineAtMs=null, transitionId, awards=[]
}) {
  dbValue(db);
  id(roomId,'room id');id(gameId,'game id');modeValue(mode);
  id(transitionId,'transition id');
  safeInt(expectedRevision,'revision');
  if(status!=='playing'&&status!=='finished')
    throw new Error('Invalid room status');
  if(deadlineAtMs!==null)safeInt(deadlineAtMs,'deadline');
  if(!Array.isArray(awards)||awards.length>2)
    throw new Error('Invalid award count');
  const serialized=jsonState(state);
  const eventIds=new Set();
  const prepared=[];
  for(const award of awards){
    if(!award||typeof award!=='object')throw new Error('Invalid award');
    id(award.eventId,'event id');id(award.uid,'verified uid');
    if(eventIds.has(award.eventId))throw new Error('Duplicate award event');
    eventIds.add(award.eventId);
    if(award.kind!=='game_win'&&award.kind!=='lucky_box')
      throw new Error('Invalid award kind');
    safeInt(award.points,'award points',1);
    if(award.kind==='game_win'&&award.points!==10)
      throw new Error('Winner reward must be +10');
    if(award.kind==='lucky_box'&&award.points>10000)
      throw new Error('Invalid Lucky Box reward');
    prepared.push(award);
  }
  const current=await db.prepare(
    'SELECT game_id AS gameId,mode,revision,status FROM game_room_checkpoints'
      +' WHERE room_id=?'
  ).bind(roomId).first();
  if(!current||current.gameId!==gameId||current.mode!==mode||
     current.status!=='playing'||current.revision!==expectedRevision){
    const e=new Error('Stale, unknown, or closed game');
    e.code='ROOM_VERSION_CONFLICT';
    throw e;
  }
  for(const award of prepared){
    const seat=await db.prepare(
      'SELECT 1 AS ok FROM game_room_seats WHERE room_id=? AND uid=?'
    ).bind(roomId,award.uid).first();
    if(!seat)throw new Error('Award recipient not seated in room');
  }

  const nextRevision=expectedRevision+1;
  const timestamp=Date.now();
  // The marker insert requires a new receipt made by the trigger. If the
  // conditional update lost a race, the marker's FK fails and batch rolls back.
  const statements=[
    db.prepare(
      'UPDATE game_room_checkpoints SET state_json=?,revision=revision+1,'
      +' status=?,deadline_at_ms=?,saved_at_ms=?'
      +' WHERE room_id=? AND game_id=? AND mode=?'
      +' AND revision=? AND status=?'
    ).bind(serialized,status,deadlineAtMs,timestamp,roomId,gameId,mode,expectedRevision,'playing'),
    db.prepare(
      'INSERT INTO room_transition_markers(room_id,revision,event_id) VALUES(?,?,?)'
    ).bind(roomId,nextRevision,transitionId),
    ...prepared.map(a=>db.prepare(
      'INSERT INTO score_award_outbox'
      +' (event_id,room_id,revision,game_id,mode,uid,kind,points,created_at_ms)'
      +' VALUES(?,?,?,?,?,?,?,?,?)'
    ).bind(a.eventId,roomId,nextRevision,gameId,mode,a.uid,a.kind,a.points,timestamp))
  ];
  await db.batch(statements);
  // This function enqueues award intents. A separate trusted worker must
  // drain them before points will appear in score_ledger.
  return {roomId,revision:nextRevision,queuedAwards:prepared.length};
}

async function pendingAwards(db,limit=50){
  dbValue(db);
  safeInt(limit,'limit',1);
  if(limit>100)throw new Error('Limit too high');
  const r=await db.prepare(
    'SELECT event_id AS eventId,room_id AS roomId,revision,game_id AS gameId,'
    +' mode,uid,kind,points,created_at_ms AS createdAtMs'
    +' FROM score_award_outbox WHERE status=?'
    +' ORDER BY created_at_ms ASC,event_id ASC LIMIT ?'
  ).bind('pending',limit).all();
  return r.results||[];
}

module.exports={commitRoomTurn,pendingAwards};
