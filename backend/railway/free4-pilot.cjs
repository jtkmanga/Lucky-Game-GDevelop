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
  const rawCutoff = env.LUCKY_FREE4_PILOT_CUTOFF_MS;
  const cutoffMs = Number(rawCutoff);
  if (typeof rawCutoff !== 'string' || !/^[1-9][0-9]{0,15}$/.test(rawCutoff) ||
      !Number.isSafeInteger(cutoffMs) || cutoffMs > 8640000000000000) {
    throw Error('Invalid Free4 pilot cutoff');
  }
  const allowed = new Set(uids);
  return Object.freeze({
    roomId, cutoffMs,
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

// Isolated hosted acceptance branch only. Never merge/deploy to live play.
// The fixture affects two explicit rolls in the bound room, not RNG elsewhere.
function readLuckyBoxFixture(env,pilot){
 const flag=env.LUCKY_PILOT_LUCKY_BOX_FIXTURE;
 if(flag===undefined || flag==='false')return ()=>null;
 if(flag!=='true'||env.RAILWAY_ENVIRONMENT_NAME!=='staging'||
    env.LUCKY_ISOLATED_STAGING_SUPABASE_REF!=='tpwmcozkzlvolehozzri'||!pilot)
  throw Error('Invalid isolated Lucky Box acceptance fixture');
 return (room,seat)=>{
  if(room?.id!==pilot.roomId||room.mode!=='free'||(seat!==0&&seat!==1)||
     room.revision!==seat||room.game?.map!==1||room.game.current!==seat||
     room.game.gift!==16||room.game.giftUsed!==(seat===1)||
     room.game.players?.[seat]?.pos!==15)return null;
  return 1;
 };
}
module.exports.readLuckyBoxFixture=readLuckyBoxFixture;
