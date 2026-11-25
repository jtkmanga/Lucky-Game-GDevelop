'use strict';
// Supabase PostgreSQL private "game" schema adapter for Railway Node.js.
// No schema was applied; no database credentials here. Draft, untested.
const {Pool}=require('pg');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function mustUid(uid){if(typeof uid!=='string'||!UUID.test(uid))throw Error('Invalid Supabase UID');return uid;}
function createRailwayStore(connectionString){
 if(!connectionString)throw Error('DATABASE_URL required');
 const pool=new Pool({connectionString,max:8,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
 return {
  async health(){
   const r=await pool.query("SELECT to_regclass('game.players') AS players,to_regclass('game.vip_entitlements') AS vip,to_regclass('game.rooms') AS rooms,to_regclass('game.score_events') AS score");
   if(Object.values(r.rows[0]||{}).some(x=>x===null))throw Error('Supabase game schema missing; do not start');
  },
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
  async initializeRoom({roomId,mode,seats,game,deadlineMs}){
   if(!UUID.test(roomId)||!['free','vip'].includes(mode)||!Array.isArray(seats)||
    seats.length!==(mode==='vip'?2:4)||new Set(seats.map(s=>s.uid)).size!==seats.length||
    seats.some(s=>!UUID.test(s.uid)))throw Error('Invalid verified seats');
   await pool.query(
     'INSERT INTO game.rooms(room_id,mode,seats,game_state,deadline_ms,status) VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6)',
     [roomId,mode,JSON.stringify(seats.map(s=>({uid:s.uid,name:s.name}))),JSON.stringify(game),deadlineMs,'playing']
   );
  },
  async loadRoom(roomId){
   const r=await pool.query('SELECT * FROM game.rooms WHERE room_id=$1',[roomId]);
   return r.rows[0]||null;
  },
  async commitTurn({roomId,expectedRevision,game,deadlineMs,awards=[]}){
   if(!UUID.test(roomId)||!Number.isSafeInteger(Number(expectedRevision)))throw Error('Bad room revision');
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const r=await client.query(
      'UPDATE game.rooms SET game_state=$1::jsonb,deadline_ms=$2,status=$3,revision=revision+1,updated_at=now() WHERE room_id=$4 AND revision=$5 AND status=$6 RETURNING revision',
      [JSON.stringify(game),deadlineMs,game.over?'finished':'playing',roomId,expectedRevision,'playing']
    );
    if(r.rowCount!==1)throw Error('STALE_ROOM_REVISION');
    for(const a of awards){
     if(typeof a.eventId!=='string'||!['win','lucky_box'].includes(a.kind)||
        !UUID.test(a.uid)||!UUID.test(a.gameId)||a.mode!=='free'&&a.mode!=='vip'||
        !Number.isSafeInteger(a.points)||a.points<=0)throw Error('Invalid trusted award');
     await client.query(
       'INSERT INTO game.score_events(event_id,uid,mode,game_id,kind,points) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
       [a.eventId,a.uid,a.mode,a.gameId,a.kind,a.points]
     );
    }
    await client.query('COMMIT');
    return Number(r.rows[0].revision);
   }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  },
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
