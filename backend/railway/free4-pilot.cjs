'use strict';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

// A dedicated staging process profile, not a client-selectable game mode.
function readFree4Pilot(env) {
  const flag = env.LUCKY_FREE4_PILOT;
  const mode = env.LUCKY_STAGING_PILOT_MODE ?? 'free';
  if (mode !== 'free' && mode !== 'vip') throw Error('Invalid staging pilot mode');
  if (flag === undefined || flag === 'false') {
    if (mode === 'vip') throw Error('VIP requires the isolated pilot');
    return null;
  }
  if (flag !== 'true' || env.RAILWAY_ENVIRONMENT_NAME !== 'staging') {
    throw Error('Invalid Free4 pilot activation');
  }
  if (mode === 'vip' &&
      (env.RAILWAY_ENVIRONMENT_ID !== 'e0202327-924e-4913-9a3b-6c4493b2c31b' ||
       env.RAILWAY_PROJECT_ID !== '5d695e45-30fe-4b08-b0d0-0b0d250937eb' ||
       env.LUCKY_ISOLATED_STAGING_SUPABASE_REF !== 'tpwmcozkzlvolehozzri' ||
       [env.LUCKY_PILOT_LUCKY_BOX_FIXTURE,env.LUCKY_PILOT_FREE_LEADERBOARD]
         .some(flag => flag !== undefined && flag !== 'false'))) {
    throw Error('VIP requires the isolated database and no other QA profile');
  }
  const capacity = mode === 'vip' ? 2 : 4;
  const roomId = env.LUCKY_FREE4_PILOT_ROOM_ID;
  const uids = (env.LUCKY_FREE4_PILOT_UIDS || '').split(',').map(uid => uid.trim());
  if (!UUID.test(roomId || '') || uids.length !== capacity ||
      uids.some(uid => !UUID.test(uid)) || new Set(uids).size !== capacity) {
    throw Error('Invalid Free4 pilot configuration');
  }
  const rawCutoff = env.LUCKY_FREE4_PILOT_CUTOFF_MS;
  const cutoffMs = Number(rawCutoff);
  if (typeof rawCutoff !== 'string' || !/^[1-9][0-9]{0,15}$/.test(rawCutoff) ||
      !Number.isSafeInteger(cutoffMs) || cutoffMs > 8640000000000000) {
    throw Error('Invalid Free4 pilot cutoff');
  }
  if (mode === 'vip' && cutoffMs > Date.now()+30*60*1000) {
    throw Error('VIP pilot cutoff exceeds 30 minutes');
  }
  const allowed = new Set(uids);
  return Object.freeze({
    roomId, cutoffMs, mode,
    admits(uid, requestedMode) {
      return requestedMode === mode && allowed.has(uid);
    },
    matches(room, seats) {
      if (room !== roomId || !Array.isArray(seats) || seats.length !== capacity) return false;
      const seen = new Set(Array.from(seats, seat => seat?.uid));
      return seen.size === capacity && [...seen].every(uid => allowed.has(uid));
    }
  });
}

module.exports = {readFree4Pilot};
