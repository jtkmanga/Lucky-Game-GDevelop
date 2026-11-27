'use strict';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

// A dedicated staging process profile, not a client-selectable game mode.
function readFree4Pilot(env) {
  const flag = env.LUCKY_FREE4_PILOT;
  if (flag === undefined || flag === 'false') return null;
  if (flag !== 'true' || env.RAILWAY_ENVIRONMENT_NAME !== 'staging') {
    throw Error('Invalid Free4 pilot activation');
  }
  const roomId = env.LUCKY_FREE4_PILOT_ROOM_ID;
  const uids = (env.LUCKY_FREE4_PILOT_UIDS || '').split(',').map(uid => uid.trim());
  if (!UUID.test(roomId || '') || uids.length !== 4 ||
      uids.some(uid => !UUID.test(uid)) || new Set(uids).size !== 4) {
    throw Error('Invalid Free4 pilot configuration');
  }
  const allowed = new Set(uids);
  return Object.freeze({
    roomId,
    admits(uid, mode) {
      return mode === 'free' && allowed.has(uid);
    },
    matches(room, seats) {
      if (room !== roomId || !Array.isArray(seats) || seats.length !== 4) return false;
      const seen = new Set(Array.from(seats, seat => seat?.uid));
      return seen.size === 4 && [...seen].every(uid => allowed.has(uid));
    }
  });
}

module.exports = {readFree4Pilot};
