'use strict';
// Supabase PostgreSQL private "game" schema adapter for Railway Node.js.
// No schema was applied; no database credentials here. Draft, untested.
const {Pool}=require('pg');
const {poolConnectionOptions}=require('./pg-tls-config.cjs');
const {createRoomLeaseStore}=require('./room-lease-store.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function mustUid(uid){if(typeof uid!=='string'||!UUID.test(uid))throw Error('Invalid Supabase UID');return uid;}
function createRailwayStore(connectionString){
 if(!connectionString)throw Error('DATABASE_URL required');
 const pool=new Pool(poolConnectionOptions(connectionString));
 const leases=createRoomLeaseStore(pool);
 return {
  async health(){
   // Startup must confirm the actual session uses the restricted DB role;
   // no fallback to postgres even when schema checks would otherwise pass.
   const identity=await pool.query("SELECT current_user AS role_name, session_user AS session_name, has_schema_privilege(current_user,'game','USAGE') AS schema_ok, has_table_privilege(current_user,'game.orders','SELECT') AS orders_read");
   const row=identity.rows[0];
   if(!row||row.role_name!=='lucky_game_server_login'||
      row.session_name!=='lucky_game_server_login'||
      row.schema_ok!==true||row.orders_read!==false)
     throw Error('Restricted PostgreSQL identity or grants invalid; refuse startup');
   const r=await pool.query("SELECT to_regclass('game.players') AS players,to_regclass('game.vip_entitlements') AS vip,to_regclass('game.rooms') AS rooms,to_regclass('game.score_events') AS score");
   if(Object.values(r.rows[0]||{}).some(x=>x===null))throw Error('Supabase game schema missing; do not start');
   const columns=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='game' AND table_name='rooms' AND column_name IN ('lease_owner','lease_epoch','lease_until')");
   if(columns.rowCount!==3)throw Error('Supabase room lease schema 002 missing; do not start');
   const receipts=await pool.query("SELECT to_regclass('game.turn_receipts') AS receipts");
   if(!receipts.rows[0]?.receipts)throw Error('Supabase turn receipt schema 003 missing; do not start');
  },
  acquireRoomLease:leases.acquire,
  renewRoomLease:leases.renew,
  releaseRoomLease:leases.release,
  listRecoverableRooms:leases.listRecoverable,
  commitFencedTurn:leases.commitFencedTurn,
  async player(uid,name){
   mustUid(uid);
   const normalized=String(name||'Player').trim().slice(0,50);
   if(normalized.length<2)throw Error('Name must be >=2 characters');
   // A name collision fails closed; never reassign another user's name.
   const r=await pool.query(
     'INSERT INTO game.players(uid,display_name,name_key) VALUES($1,$2,lower($2)) ON CONFLICT(uid) DO UPDATE SET display_name=EXCLUDED.display_name,name_key=EXCLUDED.name_key,updated_at=now() RETURNING uid,display_name',
     [uid,normalized]
   );return r.rows[0];
  },
  async getVipEntitlement(uid){
   mustUid(uid);
   const r=await pool.query('SELECT uid,status,expires_at FROM game.vip_entitlements WHERE uid=$1',[uid]);
   if(!r.rowCount)return null;
   return {uid:r.rows[0].uid,status:r.rows[0].status,tier:'vip',expiresAtMs:new Date(r.rows[0].expires_at).getTime()};
  },
  async initializeRoom({roomId,mode,seats,game,deadlineMs,ownerId}){
   if(!UUID.test(roomId)||!['free','vip'].includes(mode)||!Array.isArray(seats)||
    seats.length!==(mode==='vip'?2:4)||new Set(seats.map(s=>s.uid)).size!==seats.length||
    seats.some(s=>!UUID.test(s.uid)))throw Error('Invalid verified seats');
   mustUid(ownerId);
   const r=await pool.query(
     `INSERT INTO game.rooms(room_id,mode,seats,game_state,deadline_ms,status,lease_owner,lease_epoch,lease_until)
       VALUES($1,$2,$3::jsonb,$4::jsonb,$5,'playing',$6::uuid,1,clock_timestamp()+interval '30 seconds')
       RETURNING lease_epoch`,
     [roomId,mode,JSON.stringify(seats.map(s=>({uid:s.uid,name:s.name}))),JSON.stringify(game),deadlineMs,ownerId]
   );
   return Number(r.rows[0].lease_epoch);
  },
  async findResumableRoomForUid(uid){
   mustUid(uid);
   const r=await pool.query(
     "SELECT room_id FROM game.rooms WHERE status='playing' AND seats @> jsonb_build_array(jsonb_build_object('uid',$1::text)) ORDER BY created_at DESC LIMIT 1",
     [uid]
   );
   return r.rows[0]?.room_id||null;
  },
  async loadRoom(roomId){
   const r=await pool.query('SELECT * FROM game.rooms WHERE room_id=$1',[roomId]);
   return r.rows[0]||null;
  },
  // Consistent forensic snapshot: both reads use one repeatable-read,
  // read-only transaction on one PostgreSQL connection. No mutation and
  // no automatic decision to resume a halted room.
  async readRoomAndAwards(roomId,expectedRevision){
   if(!UUID.test(roomId))throw Error('Invalid room ID');
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
    throw Error('Invalid expected revision');
   const client=await pool.connect();
   let begun=false,discard=false;
   try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    begun=true;
    const roomResult=await client.query(
     `SELECT room_id,mode,seats,game_state,deadline_ms,revision,status,
             lease_owner,lease_epoch,lease_until
       FROM game.rooms WHERE room_id=$1::uuid`,[roomId]
    );
    const ledgerResult=await client.query(
     `SELECT event_id,uid,mode,kind,points
       FROM game.score_events WHERE game_id=$1::uuid
         AND kind IN ('win','lucky_box')
       ORDER BY kind,event_id`,[roomId]
    );
    const receiptsResult=await client.query(
     `SELECT room_id,revision,previous_revision,lease_epoch,event_type,
             actor_index,roll,outcome,game_state,award_events
        FROM game.turn_receipts
        WHERE room_id=$1::uuid AND revision=$2::bigint`,
     [roomId,expectedRevision+1]
    );
    await client.query('COMMIT');begun=false;
    return {room:roomResult.rows[0]||null,ledger:ledgerResult.rows,
      receipts:receiptsResult.rows};
   }catch(error){
    if(begun){
     try{await client.query('ROLLBACK');}
     catch(e){discard=true;error.rollbackErrorCode=e.code||'ROLLBACK_FAILED';}
    }
    throw error;
   }finally{client.release(discard);}
  },
  // Legacy unfenced commit intentionally removed. Only commitFencedTurn is allowed.
  async leaderboard(mode,startMs,endMs,limit=50){
   if(!['free','vip'].includes(mode))throw Error('Invalid leaderboard mode');
   const r=await pool.query(
     'SELECT p.uid,p.display_name,sum(e.points)::bigint AS score FROM game.players p JOIN game.score_events e ON e.uid=p.uid WHERE e.mode=$1 AND e.created_at >= to_timestamp($2::double precision/1000) AND e.created_at < to_timestamp($3::double precision/1000) GROUP BY p.uid,p.display_name ORDER BY score DESC,p.uid LIMIT $4',
     [mode,startMs,endMs,Math.max(1,Math.min(100,Number(limit)||50))]
   );return r.rows;
  },
  async close(){await pool.end();}
 };
}
module.exports={createRailwayStore};
