'use strict';

/**
 * Read-only period leaderboard and append-only historical archiving for D1.
 * Draft code; not wired into the current Multiplayer ZIP server or any cron.
 * Source events are still produced by trusted server-side gameplay only.
 */
const {getPeriod,previousPeriod}=require('./score-periods.cjs');

function requireDb(db) {
  if(!db || typeof db.prepare!=='function' || typeof db.batch!=='function')
    throw new Error('Transactional database adapter required');
  return db;
}
function requireMode(mode){
  if(mode!=='free'&&mode!=='vip')throw new Error('Invalid score mode');
  return mode;
}
function requireLimit(limit) {
  if(!Number.isSafeInteger(limit) || limit<1 || limit>100)throw new Error('Invalid leaderboard limit');
  return limit;
}
function requireUid(uid){
  if(typeof uid!=='string'||!uid||uid.length>128)throw new Error('Invalid authenticated uid');
}
function periodValid(p,now){
  requireMode(p?.mode);
  if(!Number.isSafeInteger(p.startMs)||!Number.isSafeInteger(p.endMs)||
     p.startMs<0||p.endMs<=p.startMs||p.endMs>now) throw new Error('Period is not closed');
  // The range MUST be a real Thailand calendar boundary, not client chosen.
  const expected=getPeriod(p.mode,p.startMs);
  if(expected.startMs!==p.startMs||expected.endMs!==p.endMs)
    throw new Error('Invalid period boundary');
}

/** Current ranking only counts events from the active period. */
async function currentLeaderboard(db,mode,limit=50,nowMs=Date.now()) {
  requireDb(db);requireMode(mode);requireLimit(limit);
  const p=getPeriod(mode,nowMs);
  const result=await db.prepare(
    'SELECT p.uid,p.display_name AS displayName,SUM(s.points) AS score'
    +' FROM score_ledger s JOIN players p ON p.uid=s.uid'
    +' WHERE s.mode=? AND s.created_at_ms>=? AND s.created_at_ms<?'
    +' GROUP BY p.uid,p.display_name ORDER BY score DESC,p.uid ASC LIMIT ?'
  ).bind(mode,p.startMs,p.endMs,limit).all();
  return {period:p,rows:result.results||[]};
}
async function currentScore(db,uid,mode,nowMs=Date.now()){
  requireDb(db);requireUid(uid);requireMode(mode);
  const p=getPeriod(mode,nowMs);
  const row=await db.prepare(
    'SELECT COALESCE(SUM(points),0) AS score FROM score_ledger'
    +' WHERE uid=? AND mode=? AND created_at_ms>=? AND created_at_ms<?'
  ).bind(uid,mode,p.startMs,p.endMs).first();
  return {period:p,score:Number(row?.score||0)};
}

/**
 * Atomically archives a closed score period, preserving a top 100 snapshot.
 * Does not delete ledger records. Idempotent by (mode,start_ms).
 * IMPORTANT: caller must ensure no late/backdated ledger event can be inserted
 * into the archived period; otherwise historical snapshot could become stale.
 */
async function archiveClosedPeriod(db,period,nowMs=Date.now()){
  requireDb(db);
  if(!Number.isSafeInteger(nowMs))throw new Error('Invalid time');
  periodValid(period,nowMs);
  const existing=await db.prepare(
    'SELECT entry_count AS entryCount FROM leaderboard_period_archives'
    +' WHERE mode=? AND period_start_ms=?'
  ).bind(period.mode,period.startMs).first();
  if(existing) return {archived:false,entryCount:existing.entryCount};
  const rankQuery=
    'SELECT p.uid,p.display_name AS displayName,SUM(s.points) AS score'
    +' FROM score_ledger s JOIN players p ON p.uid=s.uid'
    +' WHERE s.mode=? AND s.created_at_ms>=? AND s.created_at_ms<?'
    +' GROUP BY p.uid,p.display_name ORDER BY score DESC,p.uid ASC LIMIT 100';
  const insertEntries=
    'INSERT INTO leaderboard_snapshot_entries'
    +' (mode,period_start_ms,uid,display_name,score,ranking)'
    +' SELECT ?,?,ranked.uid,ranked.displayName,ranked.score,'
    +' ROW_NUMBER() OVER(ORDER BY ranked.score DESC,ranked.uid ASC)'
    +' FROM ('+rankQuery+') AS ranked';
  const countQuery='SELECT COUNT(*) AS amount FROM ('+rankQuery+')';
  // Count is read for metadata; this only remains consistent if writes into
  // a closed period are prohibited by the future authoritative ledger writer.
  const countRow=await db.prepare(countQuery)
    .bind(period.mode,period.startMs,period.endMs).first();
  const count=Number(countRow?.amount||0);
  try{
    // In D1, db.batch executes statements transactionally.
    await db.batch([
      db.prepare('INSERT INTO leaderboard_period_archives'
        +' (mode,period_start_ms,period_end_ms,archived_at_ms,entry_count)'
        +' VALUES(?,?,?,?,?)')
        .bind(period.mode,period.startMs,period.endMs,nowMs,count),
      db.prepare(insertEntries)
        .bind(period.mode,period.startMs,period.mode,period.startMs,period.endMs)
    ]);
    return {archived:true,entryCount:count};
  }catch(e){
    const raced=await db.prepare(
      'SELECT entry_count AS entryCount FROM leaderboard_period_archives'
      +' WHERE mode=? AND period_start_ms=?'
    ).bind(period.mode,period.startMs).first();
    if(raced)return {archived:false,entryCount:raced.entryCount};
    throw e;
  }
}
async function archivePreviousPeriod(db,mode,nowMs=Date.now()){
  return archiveClosedPeriod(db,previousPeriod(mode,nowMs),nowMs);
}
async function historicalLeaderboard(db,mode,startMs,limit=50){
  requireDb(db);requireMode(mode);requireLimit(limit);
  if(!Number.isSafeInteger(startMs)||startMs<0)throw new Error('Invalid period start');
  const result=await db.prepare(
    'SELECT ranking,uid,display_name AS displayName,score'
    +' FROM leaderboard_snapshot_entries'
    +' WHERE mode=? AND period_start_ms=? ORDER BY ranking ASC LIMIT ?'
  ).bind(mode,startMs,limit).all();
  return result.results||[];
}
module.exports={
  currentLeaderboard,currentScore,archiveClosedPeriod,
  archivePreviousPeriod,historicalLeaderboard
};
