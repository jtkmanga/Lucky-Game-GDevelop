'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uidKey(uid) {
  if (typeof uid !== 'string' || !UUID.test(uid)) throw Error('INVALID_ITEM_UID');
  return uid.toLowerCase();
}

function fields(value, names) {
  return value != null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}

// Server-only inputs: verified is set by the caller after authentication.
// The source must return both flags, including false/false for an ordinary seat.
function admitMatchItems(seats, results) {
  if (!Array.isArray(seats) || ![2, 4].includes(seats.length) ||
      !Array.isArray(results) || results.length !== seats.length) throw Error('INVALID_ITEM_ROSTER');
  const byUid = new Map();
  for (const result of results) {
    if (!fields(result, ['uid', 'shield', 'doubleWin']) ||
        typeof result.shield !== 'boolean' || typeof result.doubleWin !== 'boolean')
      throw Error('INVALID_ITEM_RESULT');
    const uid = uidKey(result.uid);
    if (byUid.has(uid)) throw Error('DUPLICATE_ITEM_RESULT');
    byUid.set(uid, result);
  }
  const players = [];
  for (const seat of seats) {
    if (!seat || !Object.hasOwn(seat, 'verified') || seat.verified !== true ||
        !Object.hasOwn(seat, 'uid')) throw Error('UNVERIFIED_ITEM_SEAT');
    const uid = uidKey(seat.uid);
    const result = byUid.get(uid);
    if (!result) throw Error('ITEM_ROSTER_MISMATCH');
    byUid.delete(uid);
    players.push({ shieldRemaining: Number(result.shield), winMultiplier: result.doubleWin ? 2 : 1 });
  }
  return { version: 1, players };
}

// Trusted JSON checkpoint in its persisted seat order. No entitlement lookup on resume.
function restoreMatchItems(game) {
  if (!game || !Array.isArray(game.players) || ![2, 4].includes(game.players.length))
    throw Error('INVALID_ITEM_ROSTER');
  if (!Object.hasOwn(game, 'matchItems')) return undefined;
  const snapshot = game.matchItems;
  if (!fields(snapshot, ['version', 'players']) || snapshot.version !== 1 ||
      !Array.isArray(snapshot.players) || snapshot.players.length !== game.players.length)
    throw Error('INVALID_MATCH_ITEM_SNAPSHOT');
  for (const player of snapshot.players) {
    if (!fields(player, ['shieldRemaining', 'winMultiplier']) ||
        ![0, 1].includes(player.shieldRemaining) || ![1, 2].includes(player.winMultiplier))
      throw Error('INVALID_MATCH_ITEM_SNAPSHOT');
  }
  return structuredClone(snapshot);
}

module.exports = { admitMatchItems, restoreMatchItems };
