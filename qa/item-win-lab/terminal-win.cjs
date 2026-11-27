'use strict';
const { isDeepStrictEqual } = require('node:util');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validId = value => typeof value === 'string' && uuid.test(value);

function integer(value) {
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// QA only. Caller has already verified this viewer, authorized the existing seat
// and selected its terminal snapshot. Context comes from the server session,
// never the wire. Evidence must be one readRoomAndAwards(roomId,revision-1)
// result: ledger rows omit game_id because that query filters on this room ID.
// The existing in-memory resume packet omits revision and award evidence. A future
// authorized caller would have to bind the same revision to both packet and proof.
// Restart lookup and lease recovery select playing rooms only. No finished-room
// routing or historical viewer permission follows from this projection.
function projectTerminalWin(context, evidence) {
  const { roomId, revision, mode, seat, verifiedUid } = context || {};
  const { room, receipts, ledger } = evidence || {};
  if (!validId(roomId) || !validId(verifiedUid) || !Number.isSafeInteger(revision) || revision < 1 ||
      !['free','vip'].includes(mode) || !Number.isInteger(seat) || !room ||
      room.room_id !== roomId || room.mode !== mode || room.status !== 'finished' ||
      room.deadline_ms !== null || integer(room.revision) !== revision) return null;

  const game = room.game_state;
  const capacity = mode === 'free' ? 4 : 2;
  if (!Array.isArray(room.seats) || room.seats.length !== capacity ||
      !game || game.over !== true || game.mode !== mode || game.winner !== seat ||
      seat < 0 || seat >= capacity || !Array.isArray(game.players) || game.players.length !== capacity ||
      game.current !== seat || game.players[seat]?.id !== seat || game.players[seat].pos !== 100 || room.seats[seat]?.uid !== verifiedUid) return null;
  const uids = Array.from(room.seats, s => s?.uid);
  if (!uids.every(validId) || new Set(uids).size !== capacity) return null;

  if (!Array.isArray(receipts) || receipts.length !== 1) return null;
  const receipt = receipts[0];
  if (!receipt || receipt.room_id !== roomId || integer(receipt.revision) !== revision ||
      integer(receipt.previous_revision) !== revision-1 || integer(receipt.lease_epoch) < 1 ||
      integer(receipt.lease_epoch) !== integer(room.lease_epoch) || receipt.event_type !== 'roll' ||
      receipt.actor_index !== seat || !Number.isInteger(receipt.roll) || receipt.roll < 1 || receipt.roll > 6 ||
      receipt.roll !== game.lastRoll || receipt.outcome?.type !== 'win' ||
      receipt.outcome.gameOver !== true || receipt.outcome.reward !== 0 ||
      receipt.outcome.position !== 100 || !Number.isInteger(receipt.outcome.from) ||
      receipt.outcome.from < 0 || receipt.outcome.from >= 100 ||
      receipt.outcome.landing !== receipt.outcome.from + receipt.roll || receipt.outcome.landing < 100 ||
      !isDeepStrictEqual(receipt.game_state, game)) return null;

  // The current winning roll lands at 100, outside the gift range. Earlier
  // Lucky Box awards can be in the room ledger but not this winning receipt.
  if (!Array.isArray(receipt.award_events) || receipt.award_events.length !== 1 ||
      !Array.isArray(ledger) || ledger.length < 1 || ledger.length > 2) return null;
  const award = receipt.award_events[0];
  if (!award || award.kind !== 'win' || award.eventId !== roomId+':win' ||
      award.uid !== verifiedUid || award.mode !== mode || ![10,20].includes(award.points)) return null;
  let wins = 0;
  for (const row of ledger) {
    if (!row || (Object.hasOwn(row,'game_id') && row.game_id !== roomId) || row.mode !== mode || !uids.includes(row.uid)) return null;
    if (row.kind === 'win' && row.event_id === award.eventId &&
        row.uid === verifiedUid && row.points === award.points) wins++;
    else if (row.kind !== 'lucky_box' || row.event_id !== roomId+':lucky' ||
             !Number.isSafeInteger(row.points) || row.points <= 0) return null;
  }
  return wins === 1 ? { roomId, revision, seat, points:award.points } : null;
}
module.exports = { projectTerminalWin };
