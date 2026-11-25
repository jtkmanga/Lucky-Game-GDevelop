'use strict';
// PostgreSQL storage for a future single-coordinator Railway server.
// Not wired to legacy ZIP, not migrated, not tested, not deployed.
// Requires 'pg' and an externally configured DATABASE_URL.
const {Pool}=require('pg');

function createRailwayStore(connectionString) {
  if(!connectionString || typeof connectionString!=='string')throw Error('DATABASE_URL required');
  const pool=new Pool({connectionString,max:8,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
  const db={
    async health(){const r=await pool.query("SELECT to_regclass('public.lucky_players') AS players, to_regclass('public.lucky_rooms') AS rooms, to_regclass('public.lucky_score_events') AS scores");if(!r.rows[0]?.players||!r.rows[0]?.rooms||!r.rows[0]?.scores)throw Error('Run 001_postgres.sql migration before starting server');},
    async player(uid,name){
      if(typeof uid!=='string'||uid.length>128)throw Error('Bad player identity');
      const cleaned=String(name||'Player').trim().slice(0,50)||'Player';
      const r=await pool.query(
        'INSERT INTO lucky_players(uid,display_name) VALUES($1,$2) ON CONFLICT(uid) DO UPDATE SET display_name=EXCLUDED.display_name,updated_at=now() RETURNING uid,display_name',
        [uid,cleaned]
      );return r.rows[0];
    },
    async getVipEntitlement(uid){
      const r=await pool.query('SELECT uid,status,expires_at FROM lucky_vip_entitlements WHERE uid=$1',[uid]);
      if(!r.rowCount)return null;
      return {uid:r.rows[0].uid,status:r.rows[0].status,tier:'vip',expiresAtMs:new Date(r.rows[0].expires_at).getTime()};
    },
    async initializeRoom({roomId,mode,seats,game,deadlineMs}){
      // Each seat must have already passed ID token verification and VIP checks.
      if(!Array.isArray(seats)||seats.length!==(mode==='vip'?2:4)||
         seats.some(s=>typeof s.uid!=='string'||!s.uid))throw Error('Bad verified room seats');
      await pool.query(
        'INSERT INTO lucky_rooms(room_id,mode,seats,game,deadline_ms,status) VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6)',
        [roomId,mode,JSON.stringify(seats.map(s=>({uid:s.uid,name:s.name}))),JSON.stringify(game),deadlineMs,'playing']
      );
    },
    async loadRoom(roomId){
      const r=await pool.query('SELECT * FROM lucky_rooms WHERE room_id=$1',[roomId]);
      return r.rows[0]||null;
    },
    async commitTurn({roomId,expectedRevision,game,deadlineMs,awards=[]}){
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        // One authoritative event per revision; optimistic CAS guards duplicates.
        const r=await client.query(
          'UPDATE lucky_rooms SET game=$1::jsonb,deadline_ms=$2,status=$3,revision=revision+1,updated_at=now() WHERE room_id=$4 AND revision=$5 AND status=$6 RETURNING revision',
          [JSON.stringify(game),deadlineMs,game.over?'finished':'playing',roomId,expectedRevision,'playing']
        );
        if(r.rowCount!==1)throw Error('STALE_ROOM_REVISION');
        for(const a of awards){
          if(typeof a.eventId!=='string'||!['win','lucky_box'].includes(a.kind)||
             !Number.isSafeInteger(a.points)||a.points<=0)throw Error('Invalid authoritative award');
          await client.query(
            'INSERT INTO lucky_score_events(event_id,uid,mode,game_id,kind,points) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_id) DO NOTHING',
            [a.eventId,a.uid,a.mode,a.gameId,a.kind,a.points]
          );
        }
        await client.query('COMMIT');
        return Number(r.rows[0].revision);
      }catch(error){await client.query('ROLLBACK');throw error;}
      finally{client.release();}
    },
    async leaderboard(mode,startMs,endMs,limit=50) {
      const n=Math.max(1,Math.min(100,Number(limit)||50));
      const r=await pool.query(
        'SELECT p.uid,p.display_name,COALESCE(SUM(e.points),0)::bigint AS score FROM lucky_players p JOIN lucky_score_events e ON e.uid=p.uid WHERE e.mode=$1 AND e.created_at>=to_timestamp($2::double precision/1000) AND e.created_at<to_timestamp($3::double precision/1000) GROUP BY p.uid,p.display_name ORDER BY score DESC,p.uid LIMIT $4',
        [mode,startMs,endMs,n]
      );return r.rows;
    },
    async close(){await pool.end();}
  };
  return db;
}
module.exports={createRailwayStore};
