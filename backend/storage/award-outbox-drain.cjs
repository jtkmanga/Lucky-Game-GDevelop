'use strict';

/**
 * Trusted D1 score outbox drain. NOT wired to a scheduler or deployed.
 * Designed for repeated delivery: ledger event_id and game_id have UNIQUE
 * constraints; the outbox status update shares the same transaction.
 *
 * Important: only consume events from server-owned outbox table. Never allow
 * WebSocket clients to submit their own win, points, or award events.
 */
const {pendingAwards}=require('./turn-outbox.cjs');

function requireDb(db){
  if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function')
    throw Error('Transactional DB required');
}
async function applyOne(db,event){
  requireDb(db);
  if(!event||!['game_win','lucky_box'].includes(event.kind))
    throw Error('Unknown outbox kind');
  if(!Number.isSafeInteger(event.createdAtMs)||event.createdAtMs<0)
    throw Error('Invalid authoritative event timestamp');

  // Re-read status and payload from the database to reject forged caller
  // objects and avoid processing an event that is already acknowledged.
  const row=await db.prepare(
    'SELECT event_id AS eventId,game_id AS gameId,mode,uid,kind,points,'
      +' created_at_ms AS createdAtMs,status'
      +' FROM score_award_outbox WHERE event_id=?'
  ).bind(event.eventId).first();
  if(!row)throw Error('Unknown award event');
  if(row.status==='applied')return {applied:false};
  if(row.status!=='pending')throw Error('Unknown award status');
  const statements=[];

  if(row.kind==='game_win'){
    if(row.points!==10)throw Error('Invalid winner reward');
    // Reject conflicting winner identity for this game.
    const existing=await db.prepare(
      'SELECT winner_uid AS uid,mode FROM game_results WHERE game_id=?'
    ).bind(row.gameId).first();
    if(existing && (existing.uid!==row.uid||existing.mode!==row.mode))
      throw Error('Conflicting winner already recorded');
    statements.push(db.prepare(
      'INSERT INTO game_results(game_id,mode,winner_uid,completed_at_ms)'
      +' VALUES(?,?,?,?) ON CONFLICT(game_id) DO NOTHING'
    ).bind(row.gameId,row.mode,row.uid,row.createdAtMs));
  }else if(row.kind==='lucky_box'){
    if(!Number.isSafeInteger(row.points)||row.points<1||row.points>10000)
      throw Error('Invalid Lucky Box reward');
  }

  statements.push(db.prepare(
    'INSERT INTO score_ledger'
      +' (event_id,uid,mode,points,reason,game_id,created_at_ms)'
      +' VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING'
  ).bind(row.eventId,row.uid,row.mode,row.points,row.kind,row.gameId,row.createdAtMs));

  statements.push(db.prepare(
    'UPDATE score_award_outbox SET status=?,applied_at_ms=?'
      +' WHERE event_id=? AND status=?'
  ).bind('applied',Date.now(),row.eventId,'pending'));

  // D1 batch runs transactionally. Retry is safe for the same immutable
  // outbox row; never overwrite historical ledger rows.
  await db.batch(statements);
  return {applied:true};
}
async function drainPendingAwards(db,limit=50){
  requireDb(db);
  const events=await pendingAwards(db,limit);
  let applied=0;
  for(const event of events){
    const r=await applyOne(db,event);
    if(r.applied)applied++;
  }
  return {examined:events.length,applied};
}
module.exports={applyOne,drainPendingAwards};
