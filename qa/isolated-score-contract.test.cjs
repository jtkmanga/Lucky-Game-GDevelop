'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readFree4Pilot}=require('../railway-runtime/backend/railway/free4-pilot.cjs');
const {createStagingCurrentLeaderboard}=require('../railway-runtime/backend/railway/current-leaderboard-staging.cjs');
const {getPeriod}=require('../railway-runtime/backend/storage/score-periods.cjs');
const legacy=require('../railway-runtime/backend/railway/rules.js');
const rules=require('../railway-runtime/backend/railway/multi-board-rules.cjs');
const ids=Array.from({length:6},(_,i)=>'aaaaaaaa-0000-4000-8000-00000000000'+(i+1));
const timestamp=Date.UTC(2026,10,28,12);
const env={RAILWAY_ENVIRONMENT_NAME:'staging',LUCKY_CURRENT_LEADERBOARD:'true',
 LUCKY_ISOLATED_STAGING_SUPABASE_REF:'tpwmcozkzlvolehozzri',
 LUCKY_FREE4_PILOT:'true', LUCKY_FREE4_PILOT_UIDS:ids.slice(0,4).join(','),LUCKY_FREE4_PILOT_ROOM_ID:ids[4],
 LUCKY_FREE4_PILOT_CUTOFF_MS:String(timestamp+600000),LUCKY_CURRENT_LEADERBOARD_ROOMS:ids.slice(4).join(',')};
test('read-only isolated scope: default-off and fail closed outside staging, cohort, rooms or if fixture enabled',()=>{
 const base={pilot:readFree4Pilot(env),verifyIdentity(){},store:{}};
 assert.equal(createStagingCurrentLeaderboard({...base,env:{}}),null);
 for(const invalid of [{RAILWAY_ENVIRONMENT_NAME:'production'},{LUCKY_PILOT_LUCKY_BOX_FIXTURE:'true'},
  {LUCKY_CURRENT_LEADERBOARD_ROOMS:ids[4]+','+ids[4]},{LUCKY_ISOLATED_STAGING_SUPABASE_REF:'shared'},{LUCKY_FREE4_PILOT_UIDS:ids.slice(1,5).join(',')}])
  assert.throws(()=>createStagingCurrentLeaderboard({...base,env:{...env,...invalid}}),/Invalid isolated/);
});
test('read-only route filters mode and UID before ranking and never exposes profile fields',async()=>{
 let now=timestamp,calls=[];
 const run=createStagingCurrentLeaderboard({env,pilot:readFree4Pilot(env),clock:()=>now,
  verifyIdentity:async({accessToken})=>({uid:accessToken==='in'?ids[0]:ids[4]}),
  store:{async scopedFreeLeaderboard(...args){calls.push(args);return [{score:'50',uid:'private'},{score:'10'}];}}
 });
 async function request(mode,auth){let res={writeHead(status,headers){Object.assign(this,{status,headers});},end(body){this.body=body;}};
  await run({url:'/api/current-leaderboard?mode='+mode,method:'GET',headers:auth?{authorization:'Bearer '+auth}:{}},res); return res;}
 assert.equal((await request('vip','in')).status,404);
 assert.equal((await request('free')).status,401);
 assert.equal((await request('free','out')).status,401);
 const allowed=await request('free','in');assert.equal(allowed.status,200);
 assert.equal(allowed.headers['Cache-Control'],'private, no-store');
 assert.deepEqual(JSON.parse(allowed.body).rows.map(row=>row[3]),['50','10']);
 assert.doesNotMatch(allowed.body,/private/);
 const p=getPeriod('free',now);assert.deepEqual(calls,[[ids.slice(0,4),ids.slice(4),p.startMs,p.endMs,50]]);
 now=Number(env.LUCKY_FREE4_PILOT_CUTOFF_MS);
 assert.equal((await request('free','in')).status,404);
});
test('score contract: all maps award exactly +10 on overshoot and use the pinned Lucky Box weights',()=>{
 assert.deepEqual(legacy.REWARDS.map(x=>[x.points,x.weight]),[[10,500],[50,300],[100,190],[500,9],[1000,1]]);
 for(const [roll,points] of [[0,10],[0.5,50],[0.8,100],[0.99,500],[0.999,1000]])
  assert.equal(legacy.pickReward(()=>roll),points);
 for(const map of [1,2,3,4,5]){
  const g=rules.create(['A','B','C','D'],'free',()=>0.25,map);g.players[0].pos=99;
  const result=rules.turn(g,6,()=>0);
  assert.equal(result.type,'win');assert.equal(g.players[0].score,10);assert.equal(g.players[0].pos,100);
 }
 assert.equal(new Date(getPeriod('free',timestamp).endMs).toISOString(),'2026-11-28T17:00:00.000Z');
 assert.equal(new Date(getPeriod('vip',timestamp).endMs).toISOString(),'2026-11-28T17:00:00.000Z');
});
