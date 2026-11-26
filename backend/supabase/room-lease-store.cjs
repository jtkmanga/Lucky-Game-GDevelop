'use strict';
/**
 * PostgreSQL room-ownership building blocks. DRAFT/UNTESTED, NOT wired into
 * the active secure-server. Requires the unapplied 002_room_lease_draft.sql.
 * Callers must use the returned leaseEpoch with every game-state transition;
 * acquiring a lease alone is NOT sufficient to prevent a stale server write.
 * commitFencedTurn() is not wired into the runtime; do not deploy it yet.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function checkUuid(value){if(typeof value!=='string'||!UUID.test(value))throw Error('Invalid UUID');return value;}
function checkEpoch(value){if(!Number.isSafeInteger(value)||value<1)throw Error('Invalid lease epoch');return value;}
function createRoomLeaseStore(pool) {
 if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function')throw Error('PostgreSQL connection pool required');
 return {
  // Contention is decided by the database clock, not the Railway host clock.
  async acquire(roomId,ownerId,ttlSeconds=30){
   checkUuid(roomId);checkUuid(ownerId);
   if(!Number.isInteger(ttlSeconds)||ttlSeconds<10||ttlSeconds>120)throw Error('Invalid lease TTL');
   const r=await pool.query(
    `UPDATE game.rooms
      SET lease_owner=$2::uuid, lease_epoch=lease_epoch+1,
          lease_until=clock_timestamp()+($3::integer*interval '1 second')
      WHERE room_id=$1::uuid AND status='playing'
        AND (lease_owner IS NULL OR lease_until<clock_timestamp()
          OR lease_owner=$2::uuid)
      RETURNING lease_epoch,lease_until,revision,game_state,seats,mode,deadline_ms`,
    [roomId,ownerId,ttlSeconds]
   );
   return r.rowCount?{leaseEpoch:Number(r.rows[0].lease_epoch),checkpoint:r.rows[0]}:null;
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
  async commitFencedTurn({
   roomId,ownerId,leaseEpoch,expectedRevision,game,deadlineMs,awards=[]
  }){
   checkUuid(roomId);checkUuid(ownerId);checkEpoch(leaseEpoch);
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('Invalid expected revision');
   if(!game||typeof game!=='object'||Array.isArray(game)||typeof game.over!=='boolean')
     throw Error('Invalid authoritative game state');
   if(game.over ? deadlineMs!==null : (!Number.isSafeInteger(deadlineMs)||deadlineMs<=0))
     throw Error('Invalid game deadline');
   if(!Array.isArray(awards)||awards.length>2)throw Error('Invalid award list');
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
   let begun=false;
   try{
    await client.query('BEGIN');begun=true;
    const row=await client.query(
     `UPDATE game.rooms
        SET game_state=$5::jsonb,deadline_ms=$6,
            revision=revision+1,status=$7,updated_at=clock_timestamp()
       WHERE room_id=$1::uuid AND lease_owner=$2::uuid
         AND lease_epoch=$3::bigint AND lease_until>clock_timestamp()
         AND revision=$4::bigint AND status='playing'
       RETURNING revision,mode,seats`,
     [roomId,ownerId,leaseEpoch,expectedRevision,JSON.stringify(game),
       deadlineMs,game.over?'finished':'playing']
    );
    if(row.rowCount!==1)throw Error('LEASE_LOST_OR_STALE_REVISION');
    const {mode,seats}=row.rows[0];
    if(!Array.isArray(seats))throw Error('Invalid persisted seat list');
    const seatUids=new Set(seats.map(x=>x?.uid));
    for(const award of awards){
     if(award.mode!==mode||!seatUids.has(award.uid))
       throw Error('Award identity not a verified member of this room');
     const result=await client.query(
      `INSERT INTO game.score_events(event_id,uid,mode,game_id,kind,points)
         VALUES($1,$2::uuid,$3,$4::uuid,$5,$6)
         ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [award.eventId,award.uid,award.mode,roomId,award.kind,award.points]
     );
     if(result.rowCount!==1)throw Error('DUPLICATE_AWARD_EVENT');
    }
    await client.query('COMMIT');begun=false;
    return Number(row.rows[0].revision);
   }catch(error){
    if(begun)try{await client.query('ROLLBACK');}catch(rollbackError){
     error.rollbackErrorCode=rollbackError.code||'ROLLBACK_FAILED';
    }
    // A commit transport failure is ambiguous: caller must halt the room
    // and read the authoritative DB state, NEVER replay a random roll.
    throw error;
   }finally{client.release();}
  }
 };
}
module.exports={createRoomLeaseStore};
