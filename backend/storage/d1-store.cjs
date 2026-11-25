'use strict';

// Cloudflare D1-compatible server-controlled persistence adapter.
// Draft only: no migration or deployment performed.
// All values must originate from verified authentication/server gameplay, not
// client-provided balances, winners or paid entitlement flags.

function requireUid(uid) {
  if (typeof uid !== 'string' || !uid || uid.length > 128) throw new Error('Invalid verified uid');
  return uid;
}
function requireMode(mode) {
  if (mode !== 'free' && mode !== 'vip') throw new Error('Invalid mode');
  return mode;
}
function assertDb(db) {
  if (!db || typeof db.prepare !== 'function') throw new Error('Database is not configured');
  return db;
}
function requireId(id, label) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(id)) {
    throw new Error('Invalid ' + label);
  }
  return id;
}
function nameFields(displayName) {
  if (typeof displayName !== 'string') throw new Error('Invalid display name');
  const name = displayName.normalize('NFKC').trim();
  if (name.length < 2 || name.length > 32 || /[\x00-\x1f\x7f]/.test(name)) {
    throw new Error('Invalid display name');
  }
  return {name, key:name.toLocaleLowerCase('en-US')};
}

function createGameStorage(db) {
  assertDb(db);

  // Unlike client-side profile storage this is authoritative server data.
  async function createPlayer(uid, displayName) {
    requireUid(uid);
    const {name,key} = nameFields(displayName);
    const now = Date.now();
    await db.prepare(
      'INSERT INTO players(uid,display_name,display_name_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?)'
      + ' ON CONFLICT(uid) DO NOTHING'
    ).bind(uid,name,key,now,now).run();
    return db.prepare('SELECT uid,display_name FROM players WHERE uid=?').bind(uid).first();
  }

  async function renamePlayer(uid, displayName) {
    requireUid(uid);
    const {name,key}=nameFields(displayName);
    const result=await db.prepare(
      'UPDATE players SET display_name=?, display_name_key=?, updated_at_ms=? WHERE uid=?'
    ).bind(name,key,Date.now(),uid).run();
    if (!result.meta || result.meta.changes !== 1) throw new Error('Player not found');
  }

  async function getVipEntitlement(uid) {
    requireUid(uid);
    const row=await db.prepare(
      'SELECT uid,tier,status,expires_at_ms AS expiresAtMs FROM vip_entitlements WHERE uid=?'
    ).bind(uid).first();
    return row || null;
  }

  // Winner recording must only be invoked by trusted server after a completed game.
  // game_results PK prevents recording the same match twice.
  // Score derived from the ledger means duplicate events never double-award.
  // The two writes are atomic when db.batch is D1's transactional batch API.
  async function recordGameWinner({gameId,uid,mode,completedAtMs=Date.now()}) {
    requireId(gameId,'game id');requireUid(uid);requireMode(mode);
    if (!Number.isSafeInteger(completedAtMs) || completedAtMs <= 0) throw new Error('Invalid timestamp');
    if (typeof db.batch !== 'function') throw new Error('Transactional database batch required');
    const existing=await db.prepare('SELECT game_id,winner_uid,mode FROM game_results WHERE game_id=?').bind(gameId).first();
    if(existing) {
      if (existing.winner_uid !== uid || existing.mode !== mode) throw new Error('Conflicting game result');
      return {recorded:false};
    }
    // Concurrent inserts: SQLite UNIQUE constraints reject double-wins.
    try {
      await db.batch([
        db.prepare('INSERT INTO game_results(game_id,mode,winner_uid,completed_at_ms) VALUES(?,?,?,?)')
          .bind(gameId,mode,uid,completedAtMs),
        db.prepare('INSERT INTO score_ledger(event_id,uid,mode,points,reason,game_id,created_at_ms) VALUES(?,?,?,?,?,?,?)')
          .bind('win:'+gameId,uid,mode,10,'game_win',gameId,completedAtMs)
      ]);
      return {recorded:true};
    } catch (error) {
      // A concurrent identical request may have won the race; look up winner.
      const winner=await db.prepare('SELECT winner_uid,mode FROM game_results WHERE game_id=?').bind(gameId).first();
      if(winner && winner.winner_uid===uid && winner.mode===mode) return {recorded:false};
      throw error;
    }
  }

  // Winner score is +10. Lucky box amount must come from authoritative rules.
  async function recordLuckyBox({gameId,uid,mode,points,eventId}) {
    requireId(gameId,'game id');requireUid(uid);requireMode(mode);requireId(eventId,'event id');
    if (!Number.isSafeInteger(points) || points <= 0 || points > 10000) throw new Error('Invalid reward');
    const result=await db.prepare(
      'INSERT INTO score_ledger(event_id,uid,mode,points,reason,game_id,created_at_ms)'
      + ' VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING'
    ).bind('box:'+eventId,uid,mode,points,'lucky_box',gameId,Date.now()).run();
    return {recorded:Boolean(result.meta && result.meta.changes===1)};
  }

  async function getScore(uid,mode) {
    requireUid(uid);requireMode(mode);
    const row=await db.prepare(
      'SELECT COALESCE(SUM(points),0) AS score FROM score_ledger WHERE uid=? AND mode=?'
    ).bind(uid,mode).first();
    return Number(row?.score || 0);
  }

  async function leaderboard(mode,limit=50) {
    requireMode(mode);
    if(!Number.isSafeInteger(limit) || limit<1 || limit>100) throw new Error('Invalid limit');
    const rows=await db.prepare(
      'SELECT p.uid,p.display_name AS displayName,COALESCE(SUM(s.points),0) AS score'
      + ' FROM players p LEFT JOIN score_ledger s ON s.uid=p.uid AND s.mode=?'
      + ' GROUP BY p.uid,p.display_name ORDER BY score DESC,p.uid ASC LIMIT ?'
    ).bind(mode,limit).all();
    return rows.results || [];
  }

  return {createPlayer,renamePlayer,getVipEntitlement,recordGameWinner,recordLuckyBox,getScore,leaderboard};
}
module.exports={createGameStorage};
