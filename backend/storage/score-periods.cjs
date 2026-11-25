'use strict';

/**
 * Bangkok score periods for the new Lucky Game. Time is stored in UTC epoch ms.
 * Thailand is UTC+07:00 with no daylight-saving transitions.
 * VIP: local midnight daily. Free: Sunday local midnight weekly.
 *
 * This module only computes periods; it does not reset live data, grant
 * rewards, or schedule any background task.
 */
const HOUR=60*60*1000;
const DAY=24*HOUR;
const OFFSET=7*HOUR;

function requireMode(mode){
  if(mode!=='free' && mode!=='vip') throw new Error('Invalid score mode');
}
function requireTime(nowMs){
  if(!Number.isSafeInteger(nowMs) || nowMs<0) throw new Error('Invalid epoch milliseconds');
}
function getPeriod(mode,nowMs=Date.now()){
  requireMode(mode);
  requireTime(nowMs);
  const localMs=nowMs+OFFSET;
  const dayStart=Math.floor(localMs/DAY)*DAY;
  if(mode==='vip'){
    return Object.freeze({mode,startMs:dayStart-OFFSET,endMs:dayStart+DAY-OFFSET});
  }
  // JS getUTCDay: 0=Sunday. Work in Bangkok local calendar,
  // represented by a UTC date after shifting the clock by +07:00.
  const dow=new Date(dayStart).getUTCDay();
  const startLocal=dayStart-dow*DAY;
  return Object.freeze({mode,startMs:startLocal-OFFSET,endMs:startLocal+7*DAY-OFFSET});
}
function previousPeriod(mode,nowMs=Date.now()){
  const current=getPeriod(mode,nowMs);
  return getPeriod(mode,current.startMs-1);
}
function periodKey(period){
  requireMode(period?.mode);
  requireTime(period.startMs);
  requireTime(period.endMs);
  if(period.endMs<=period.startMs)throw new Error('Invalid period');
  return period.mode+':'+period.startMs;
}
module.exports={getPeriod,previousPeriod,periodKey};
