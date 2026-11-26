'use strict';
/**
 * PostgreSQL room-ownership building blocks. DRAFT/UNTESTED, NOT wired into
 * the active secure-server. Requires the unapplied 002_room_lease_draft.sql.
 * Callers must use the returned leaseEpoch with every game-state transition;
 * acquiring a lease alone is NOT sufficient to prevent a stale server write.
 */
const crypto=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function checkUuid(value){if(typeof value!=='string'||!UUID.test(value))throw Error('Invalid UUID');return value;}
function checkEpoch(value){if(!Number.isSafeInteger(value)||value<1)throw Error('Invalid lease epoch');return value;}
function createRoomLeaseStore(pool) {
 if(!pool||typeof pool.query!=='function')throw Error('Database pool required');
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
   * Safe fencing example. Any future score-award transaction MUST use same
   * WHERE conditions and transaction as its room-state UPDATE.
   * This method intentionally does NOT write scores; don't swap into runtime
   * until full atomic award/turn code is updated and reviewed.
   */
  async guardedCheckpoint({roomId,ownerId,leaseEpoch,revision,nextGame,deadlineMs}){
   checkUuid(roomId);checkUuid(ownerId);checkEpoch(leaseEpoch);
   if(!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid revision');
   const r=await pool.query(
    `UPDATE game.rooms
       SET game_state=$5::jsonb,deadline_ms=$6,revision=revision+1,
           status=CASE WHEN ($5::jsonb->>'over')::boolean THEN 'finished' ELSE 'playing' END,
           updated_at=clock_timestamp()
       WHERE room_id=$1::uuid AND lease_owner=$2::uuid AND lease_epoch=$3::bigint
         AND lease_until>clock_timestamp() AND revision=$4::bigint AND status='playing'
       RETURNING revision`,
    [roomId,ownerId,leaseEpoch,revision,JSON.stringify(nextGame),deadlineMs]
   );
   if(r.rowCount!==1)throw Error('LEASE_LOST_OR_STALE_REVISION');
   return Number(r.rows[0].revision);
  }
 };
}
module.exports={createRoomLeaseStore};
