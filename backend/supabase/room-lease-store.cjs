'use strict';
/**
 * PostgreSQL room-ownership building blocks. DRAFT/UNTESTED; source-wired to
 * the Railway secure-server but NOT deployed. Requires unapplied migrations
 * 001, 002, and 003. A live lease claim alone does not guarantee routing, recovery,
 * or distributed matchmaking correctness. Do NOT deploy without approval.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function checkUuid(value){if(typeof value!=='string'||!UUID.test(value))throw Error('Invalid UUID');return value;}
function checkEpoch(value){if(!Number.isSafeInteger(value)||value<1)throw Error('Invalid lease epoch');return value;}
const markerKey='_free4CutoffV1';
function pilotBinding(config){
 if(config===null)return null;
 if(!config || !Number.isSafeInteger(config.cutoffMs) || config.cutoffMs<=0)
  throw Error('Invalid pilot cutoff');
 checkUuid(config.roomId);
 if(config.roomId!==config.roomId.toLowerCase())throw Error('Use canonical pilot UUID');
 return Object.freeze({roomId:config.roomId,cutoffMs:config.cutoffMs});
}
function publicRow(row,pilot){
 if(!row)return row;
 const state=row.game_state;
 const expected=pilot?.roomId===row.room_id;
 if(!Object.hasOwn(state,markerKey)){
  if(expected)throw Error('Missing pilot marker');
  return row;
 }
 const marker=state[markerKey];
 if(!expected || row.mode!=='free' || !marker || Object.keys(marker).length!==2 ||
    marker.roomId!==pilot.roomId || marker.cutoffMs!==pilot.cutoffMs)
  throw Error('Unexpected pilot marker');
 const clean={...state};
 delete clean[markerKey];
 return {...row,game_state:clean};
}
function storedGame(game,pilot,roomId){
 if(Object.hasOwn(game,markerKey))throw Error('Reserved game metadata');
 return pilot?.roomId===roomId?{...game,[markerKey]:pilot}:game;
}
async function lockPilot(client,pilot){
 const lock=await client.query('SELECT room_id,mode,status,game_state FROM game.rooms WHERE room_id=$1 FOR UPDATE',[pilot.roomId]);
 const row=publicRow(lock.rows[0],pilot);
 if(!row)throw Error('Pilot room missing');
 return row;
}
function createRoomLeaseStore(pool,config=null) {
 const pilot=pilotBinding(config);
 if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function')throw Error('PostgreSQL connection pool required');
 return {
  // Contention is decided by the database clock, not the Railway host clock.
  async acquire(roomId,ownerId,ttlSeconds=30){
   checkUuid(roomId);checkUuid(ownerId);
   if(!Number.isInteger(ttlSeconds)||ttlSeconds<10||ttlSeconds>120)throw Error('Invalid lease TTL');
   const isPilot=pilot?.roomId===roomId;
   if(pilot && !isPilot)throw Error('Unexpected pilot room');
   const r=await pool.query(
    `UPDATE game.rooms
      SET lease_owner=$2::uuid, lease_epoch=lease_epoch+1,
          lease_until=clock_timestamp()+($3::integer*interval '1 second')
      WHERE room_id=$1::uuid AND status='playing'
        AND ${isPilot?"mode='free' AND game_state->'_free4CutoffV1'=$4::jsonb":"NOT (game_state ? '_free4CutoffV1')"}
        AND (lease_owner IS NULL OR lease_until<clock_timestamp()
          OR lease_owner=$2::uuid)
      RETURNING room_id,lease_epoch,lease_until,revision,game_state,seats,mode,deadline_ms`,
    [roomId,ownerId,ttlSeconds,...(isPilot?[JSON.stringify(pilot)]:[])]
   );
   return r.rowCount?{leaseEpoch:Number(r.rows[0].lease_epoch),checkpoint:publicRow(r.rows[0],pilot)}:null;
  },
  async renew(roomId,ownerId,leaseEpoch,ttlSeconds=30){
   checkUuid(roomId);checkUuid(ownerId);checkEpoch(leaseEpoch);
   if(!Number.isInteger(ttlSeconds)||ttlSeconds<10||ttlSeconds>120)throw Error('Invalid lease TTL');
   const r=await pool.query(
    `UPDATE game.rooms
      SET lease_until=clock_timestamp()+($4::integer*interval '1 second')
      WHERE room_id=$1::uuid AND lease_owner=$2::uuid
        AND lease_epoch=$3::bigint AND lease_until>clock_timestamp()
        AND status='playing'
      RETURNING lease_until`,
    [roomId,ownerId,leaseEpoch,ttlSeconds]
   );
   return r.rowCount===1;
  },
  async release(roomId,ownerId,leaseEpoch){
   checkUuid(roomId);checkUuid(ownerId);checkEpoch(leaseEpoch);
   const r=await pool.query(
    `UPDATE game.rooms SET lease_owner=NULL,lease_until=NULL
      WHERE room_id=$1::uuid AND lease_owner=$2::uuid
        AND lease_epoch=$3::bigint RETURNING room_id`,
    [roomId,ownerId,leaseEpoch]
   );
   return r.rowCount===1;
  },
  async listRecoverable(limit=50){
   if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid limit');
   const r=await pool.query(
    `SELECT room_id,mode,deadline_ms,lease_epoch
       FROM game.rooms WHERE status='playing'
       AND (lease_owner IS NULL OR lease_until<clock_timestamp())
       ORDER BY created_at,room_id LIMIT $1`,[limit]
   );
   return r.rows;
  },
  /**
   * Source-only draft: atomic fenced game transition + award ledger.
   * Database is authoritative: a lost lease, stale revision or duplicate
   * reward aborts the entire transaction. No websocket broadcast here.
   * Must only be called with game/awards computed by trusted server rules.
   */
  // Reattachment needs positive evidence from the same authoritative row.
  // This is only an observation: every subsequent turn must fence again.
  async inspectPilotFence({roomId,ownerId,leaseEpoch,expectedRevision}){
   if(!pilot||pilot.roomId!==roomId)throw Error('Pilot binding required');
   checkUuid(ownerId);checkEpoch(leaseEpoch);
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('Invalid expected revision');
   const client=await pool.connect();
   let begun=false,discard=false;
   try{
    await client.query('BEGIN');begun=true;
    const row=await lockPilot(client,pilot);
    let status=row.status;
    if(status==='playing'){
     const r=await client.query(
      `SELECT CASE WHEN lease_owner=$2::uuid AND lease_epoch=$3::bigint
             AND revision=$4::bigint AND lease_until>clock_timestamp()
        THEN CASE WHEN extract(epoch FROM clock_timestamp())*1000 >= $5::bigint
                  THEN 'expired' ELSE 'open' END
        ELSE 'stale' END AS result
        FROM game.rooms WHERE room_id=$1::uuid`,
      [roomId,ownerId,leaseEpoch,expectedRevision,pilot.cutoffMs]);
     status=r.rows[0]?.result;
     if(!['open','expired','stale'].includes(status))throw Error('Invalid pilot fence result');
    }else if(!['closed','finished'].includes(status))throw Error('Unexpected pilot status');
    await client.query('COMMIT');begun=false;
    return status;
   }catch(error){
    if(begun)try{await client.query('ROLLBACK');}catch{discard=true;}
    else discard=true;
    throw error;
   }finally{client.release(discard);}
  },
  async closeExpiredPilot({roomId,ownerId,leaseEpoch,expectedRevision}){
   if(!pilot || pilot.roomId!==roomId)throw Error('Pilot binding required');
   checkUuid(ownerId);checkEpoch(leaseEpoch);
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('Invalid expected revision');
   const client=await pool.connect();
   let committing=false,discard=false;
   try{
    await client.query('BEGIN');
    const row=await lockPilot(client,pilot);
    let status=row.status;
    if(status==='playing'){
     const result=await client.query(
      `UPDATE game.rooms SET status='closed',deadline_ms=NULL,lease_owner=NULL,
         lease_until=NULL,revision=revision+1,updated_at=clock_timestamp()
        WHERE room_id=$1 AND revision=$2 AND lease_owner=$3 AND lease_epoch=$4
          AND lease_until>clock_timestamp() AND status='playing'
          AND extract(epoch FROM clock_timestamp())*1000 >= $5::bigint
        RETURNING status`,[roomId,expectedRevision,ownerId,leaseEpoch,pilot.cutoffMs]);
     if(!result.rowCount)throw Error('NOT_EXPIRED_OR_STALE_FENCE');
     status='closed';
    }else if(!['closed','finished'].includes(status))throw Error('Unexpected pilot status');
    committing=true;
    await client.query('COMMIT');
    return status;
   }catch(error){
    if(committing){
     discard=true;
     throw Object.assign(new Error('Close requires read-back',{cause:error}),{code:'AMBIGUOUS_COMMIT'});
    }
    try{await client.query('ROLLBACK');}catch{discard=true;}
    throw error;
   }finally{client.release(discard);}
  },
  async commitFencedTurn({
   roomId,ownerId,leaseEpoch,expectedRevision,game,deadlineMs,awards=[],
   receipt
  }){
   checkUuid(roomId);checkUuid(ownerId);checkEpoch(leaseEpoch);
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('Invalid expected revision');
   if(!game||typeof game!=='object'||Array.isArray(game)||typeof game.over!=='boolean')
     throw Error('Invalid authoritative game state');
   if(game.over ? deadlineMs!==null : (!Number.isSafeInteger(deadlineMs)||deadlineMs<=0))
     throw Error('Invalid game deadline');
   if(!Array.isArray(awards)||awards.length>2)throw Error('Invalid award list');
   // A receipt is required for EVERY persisted turn, including timeout and
   // zero-score rolls. It must be generated by trusted server game rules.
   if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||
      !['roll','timeout'].includes(receipt.type)||
      !Number.isInteger(receipt.actorIndex)||receipt.actorIndex<0||
      (receipt.type==='roll'?
       !Number.isInteger(receipt.dice)||receipt.dice<1||receipt.dice>6:
       receipt.dice!==null)||
      !receipt.outcome||typeof receipt.outcome!=='object'||
      Array.isArray(receipt.outcome))
    throw Error('Invalid authoritative turn receipt');
   const kinds=new Set();
   for(const award of awards){
    if(!award||typeof award!=='object'||Array.isArray(award)||
       typeof award.eventId!=='string'||award.eventId.length>140||
       !checkUuid(award.uid)||award.gameId!==roomId||
       !['win','lucky_box'].includes(award.kind)||
       !['free','vip'].includes(award.mode)||
       !Number.isSafeInteger(award.points)||award.points<=0||
       kinds.has(award.kind))throw Error('Invalid or duplicate game award');
    if(award.kind==='win'&&(!game.over||award.points!==10))
      throw Error('Winner award requires a completed game (+10)');
    kinds.add(award.kind);
   }
   const client=await pool.connect();
   let begun=false,commitIssued=false,destroyClient=false;
   try{
    await client.query('BEGIN');begun=true;
    const isPilot=pilot?.roomId===roomId;
    if(pilot && !isPilot)throw Error('Unexpected pilot room');
    if(isPilot)await lockPilot(client,pilot);
    const state=storedGame(game,pilot,roomId);
    const row=await client.query(
     `UPDATE game.rooms
        SET game_state=$5::jsonb,deadline_ms=$6,
            revision=revision+1,status=$7,updated_at=clock_timestamp()
       WHERE room_id=$1::uuid AND lease_owner=$2::uuid
         AND lease_epoch=$3::bigint AND lease_until>clock_timestamp()
         AND revision=$4::bigint AND status='playing'
         AND ${isPilot?'extract(epoch FROM clock_timestamp())*1000 < $8::bigint':"NOT (game_state ? '_free4CutoffV1')"}
       RETURNING revision,mode,seats`,
     [roomId,ownerId,leaseEpoch,expectedRevision,JSON.stringify(state),
       deadlineMs,game.over?'finished':'playing',...(isPilot?[pilot.cutoffMs]:[])]
    );
    if(row.rowCount!==1)throw Error('LEASE_LOST_OR_STALE_REVISION');
    const {mode,seats}=row.rows[0];
    if(!Array.isArray(seats))throw Error('Invalid persisted seat list');
    if(receipt.actorIndex>=seats.length)
     throw Error('Turn receipt actor index exceeds room seat count');
    if(receipt.type==='timeout'&&awards.length!==0)
     throw Error('Timeout cannot grant awards');
    // Server rules yield the authoritative actor, die and reward. A receipt
    // must not claim one amount while the ledger credits a different one.
    // Validate before award inserts; any mismatch rolls back room revision.
    if(receipt.type==='roll'){
     const reward=receipt.outcome.reward;
     if(!Number.isSafeInteger(reward)||reward<0)
      throw Error('Invalid authoritative roll reward');
     const lucky=awards.find(a=>a.kind==='lucky_box');
     if((reward>0)!==!!lucky || (lucky&&lucky.points!==reward))
      throw Error('Lucky Box reward and receipt mismatch');
    }
    if(receipt.type==='timeout'&&Object.keys(receipt.outcome).length!==0)
     throw Error('Timeout receipt must not contain roll outcome');
    const seatUids=new Set(seats.map(x=>x?.uid));
    for(const award of awards){
     if(award.mode!==mode||!seatUids.has(award.uid))
       throw Error('Award identity not a verified member of this room');
     if(award.uid!==seats[receipt.actorIndex]?.uid)
       throw Error('Award identity differs from authoritative turn actor');
     const result=await client.query(
      `INSERT INTO game.score_events(event_id,uid,mode,game_id,kind,points)
         VALUES($1,$2::uuid,$3,$4::uuid,$5,$6)
         ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [award.eventId,award.uid,award.mode,roomId,award.kind,award.points]
     );
     if(result.rowCount!==1)throw Error('DUPLICATE_AWARD_EVENT');
    }
    // Persist the deterministic room+revision receipt in the very SAME
    // PostgreSQL transaction as the state update and score ledger. A conflict
    // must abort; it cannot turn an unconfirmed write into a second turn.
    const receiptResult=await client.query(
     `INSERT INTO game.turn_receipts
         (room_id,revision,previous_revision,lease_epoch,
          event_type,actor_index,roll,outcome,game_state,award_events)
       VALUES($1::uuid,$2::bigint,$3::bigint,$4::bigint,
              $5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)
       ON CONFLICT (room_id,revision) DO NOTHING
       RETURNING revision`,
     [roomId,expectedRevision+1,expectedRevision,leaseEpoch,
      receipt.type,receipt.actorIndex,receipt.dice,
      JSON.stringify(receipt.outcome),JSON.stringify(game),
      JSON.stringify(awards.map(a=>({
       eventId:a.eventId,uid:a.uid,mode:a.mode,kind:a.kind,points:a.points
      })))]
    );
    if(receiptResult.rowCount!==1)throw Error('DUPLICATE_TURN_RECEIPT');
    // After COMMIT is issued, a thrown transport error cannot distinguish
    // "committed but response lost" from "not committed". Do not retry the
    // turn, roll a second die, or return this client to the pool.
    commitIssued=true;
    await client.query('COMMIT');begun=false;
    return Number(row.rows[0].revision);
   }catch(error){
    if(commitIssued){
     destroyClient=true;
     const ambiguous=new Error('AMBIGUOUS_COMMIT_REQUIRES_RECONCILIATION');
     ambiguous.code='AMBIGUOUS_COMMIT';
     ambiguous.cause=error;
     throw ambiguous;
    }
    if(begun)try{await client.query('ROLLBACK');}catch(rollbackError){
     destroyClient=true;
     error.rollbackErrorCode=rollbackError.code||'ROLLBACK_FAILED';
    }
    // No replay of random dice or awards on any failed transaction.
    throw error;
   }finally{
    // pg client.release(true) discards a potentially broken connection.
    client.release(destroyClient);
   }
  }
 };
}
module.exports={createRoomLeaseStore,pilotBinding,publicRow,storedGame};
