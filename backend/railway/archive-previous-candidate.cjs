'use strict';
// Unmounted candidate. Trusted bootstrap supplies an exclusive direct pg.Pool
// with cold, clean sessions, bounded checkout/statement time, and complete RLS
// visibility. Reserve these lock namespaces and fence every writer before use.
const {previousPeriod}=require('../storage/score-periods.cjs');
const {v12LeaderboardRows}=require('./v12-leaderboard-rows.cjs');
const {isDeepStrictEqual}=require('node:util');

const PERIOD = `WITH sample AS MATERIALIZED (SELECT clock_timestamp() AS t),
  day AS (SELECT t, (t AT TIME ZONE 'Asia/Bangkok')::date AS d FROM sample),
  boundary AS (SELECT t, CASE $1::text WHEN 'free' THEN d-extract(dow FROM d)::int ELSE d END AS e FROM day),
  prior AS (SELECT t,e,e-CASE $1 WHEN 'free' THEN 7 ELSE 1 END AS s FROM boundary)
  SELECT floor(extract(epoch FROM t)*1000)::bigint AS now_ms,
    (extract(epoch FROM (s::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint AS lo,
    (extract(epoch FROM (e::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint AS hi,
    s-date '1970-01-01' AS key FROM prior`;
const RANK = `SELECT sum(e.points)::bigint AS score FROM game.players p
  JOIN game.score_events e ON e.uid=p.uid WHERE e.mode=$1
  AND e.created_at >= to_timestamp($2::double precision/1000)
  AND e.created_at < to_timestamp($3::double precision/1000)
  GROUP BY p.uid,p.display_name ORDER BY score DESC,p.uid LIMIT 50`;

async function previous(client,mode) {
  const {rows}=await client.query(PERIOD,[mode]);
  if(rows.length!==1) throw Error('ARCHIVE_CLOCK');
  const r=rows[0];
  for(const x of [r.now_ms,r.lo,r.hi])
    if(typeof x!=='string'||!/^\d+$/.test(x)||!Number.isSafeInteger(Number(x))) throw Error('ARCHIVE_CLOCK');
  const p=previousPeriod(mode,Number(r.now_ms));
  if(p.startMs!==Number(r.lo)||p.endMs!==Number(r.hi)||p.endMs>Number(r.now_ms)||
    !Number.isInteger(r.key)||r.key<0||r.key>2147483647||
    r.key!==Math.floor((p.startMs+7*3600000)/86400000)) throw Error('ARCHIVE_PERIOD');
  return {...p,key:r.key};
}

async function archivePreviousCandidate(pool,mode) {
  if(!['free','vip'].includes(mode)) throw Error('ARCHIVE_MODE');
  const client=await pool.connect();
  // Physical disconnect releases the session lock and rolls back unfinished
  // work, including failures during BEGIN or while acquiring the lock.
  try {
    const p=await previous(client,mode);
    const {rows:gate}=await client.query('SELECT pg_try_advisory_lock($1::int,$2::int) AS held',
      [mode==='free'?1279739393:1279739394,p.key]);
    if(gate.length!==1||gate[0].held!==true) throw Error('ARCHIVE_GATE_BUSY');
    const begin=await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    if(begin.command!=='BEGIN') throw Error('ARCHIVE_BEGIN_UNCONFIRMED');
    if(!isDeepStrictEqual(p,await previous(client,mode))) throw Error('ARCHIVE_PERIOD_CHANGED');
    const bounds=[mode,p.startMs,p.endMs];
    const result=await client.query(RANK,bounds);
    if(result.rows.length>50) throw Error('ARCHIVE_ROWS');
    const snapshot=v12LeaderboardRows({scores:result.rows.map(r=>r.score)});
    const existing=await client.query(
      'SELECT period_end_ms,snapshot FROM game.leaderboard_archives WHERE mode=$1 AND period_start_ms=$2',
      bounds.slice(0,2));
    let inserted=false;
    if(existing.rows.length) {
      const row=existing.rows[0];
      if(existing.rows.length!==1||row.period_end_ms!==String(p.endMs)||!isDeepStrictEqual(snapshot,row.snapshot))
        throw Error('ARCHIVE_CONFLICT');
    } else {
      const write=await client.query(
        'INSERT INTO game.leaderboard_archives(mode,period_start_ms,period_end_ms,snapshot) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT (mode,period_start_ms) DO NOTHING',
        [...bounds,JSON.stringify(snapshot)]);
      if(write.rowCount!==1) throw Error('ARCHIVE_CONFLICT');
      inserted=true;
    }
    try {
      const commit=await client.query('COMMIT');
      if(commit.command!=='COMMIT') throw Error('Unexpected archive transaction tag');
    }
    catch(cause){
      const failure=new Error('ARCHIVE_COMMIT_UNKNOWN',{cause});
      failure.period={mode,startMs:p.startMs,endMs:p.endMs};
      throw failure;
    }
    // A candidate record does not certify completeness of cooperating writers.
    return {mode,startMs:p.startMs,endMs:p.endMs,inserted,provisional:true};
  } finally {client.release(true);}
}
module.exports={archivePreviousCandidate};
