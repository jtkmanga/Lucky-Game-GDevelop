'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createArchivedPreviousLeaderboardCandidate:create}=require('../backend/railway/archived-previous-leaderboard-candidate.cjs');
const {previousPeriod}=require('../backend/storage/score-periods.cjs');
const now=Date.parse('2026-11-29T02:00:00+07:00');
function fixture(mode,build){
  const period=previousPeriod(mode,now);
  const sample={mode,period_start_ms:String(period.startMs),period_end_ms:String(period.endMs),
    snapshot:[['🥇','👤','ผู้เล่น','9007199254740993']]};
  const calls=[];
  const handler=create({
    clock:()=>now,
    verifyIdentity:async ({accessToken})=>['free','vip'].includes(accessToken)?{uid:accessToken}:null,
    store:{getVipEntitlement:async uid=>{calls.push('vip');return uid==='vip'?{uid,tier:'vip',status:'active',expiresAtMs:Date.now()+60000}:null;},
      leaderboard:async (...params)=>{calls.push('ledger');assert.deepEqual(params,[mode,period.startMs,period.endMs]);return [{score:'10'}];}},
    archivePool:{query:async (sql,params)=>{
      calls.push('archive');assert.match(sql,/FROM game.leaderboard_archives WHERE mode=\$1 AND period_start_ms=\$2/);
      assert.deepEqual(params,[mode,period.startMs]);return build(sample);
    }},
  });
  return {sample,calls,period,async get(token=mode){
    let code,headers,data;
    await handler({method:'GET',url:'/previous?mode='+mode+'&startMs=0&endMs=1',
      headers:token?{authorization:'Bearer '+token}:{}},{writeHead(c,h){code=c;headers=h;},end(d){data=JSON.parse(d);}});
    assert.equal(headers['Cache-Control'],'private, no-store');return {code,data};
  }};
}
for(const mode of ['free','vip'])test('stored '+mode+' result bypasses live ledger and respects server period',async()=>{
  const f=fixture(mode,r=>({rows:[r]}));
  assert.deepEqual(await f.get(),{code:200,data:{provisional:true,source:'archive',period:f.period,rows:f.sample.snapshot}});
  assert.deepEqual(f.calls,mode==='vip'?['vip','archive']:['archive']);
});
test('empty snapshot is still stored; only genuine absence falls back',async()=>{
  const empty=fixture('free',r=>({rows:[{...r,snapshot:[]}]}));
  assert.deepEqual((await empty.get()).data,{provisional:true,source:'archive',period:empty.period,rows:[]});
  assert.deepEqual(empty.calls,['archive']);
  const missing=fixture('free',()=>({rows:[]}));
  assert.deepEqual((await missing.get()).data,{provisional:true,period:missing.period,rows:[['🥇','👤','ผู้เล่น','10']]});
  assert.deepEqual(missing.calls,['archive','ledger']);
});
test('invalid or unavailable archive does not leak data or silently recalculate',async()=>{
  for(const build of [
    r=>({rows:[{...r,period_end_ms:'0'}]}),r=>({rows:[{...r,mode:'vip'}]}),r=>({rows:[r,r]}),
    r=>({rows:[{...r,snapshot:[['🥇','👤','Private User','10']]}]}),
    r=>({rows:[{...r,snapshot:[['🥇','👤','ผู้เล่น','10'],['🥈','👤','ผู้เล่น','11']]}]}),
    r=>({rows:[{...r,snapshot:[['🥇','👤','ผู้เล่น','9223372036854775808']]}]}),
    ()=>({}),()=>{throw Error('private lookup error');},
  ]){
    const f=fixture('free',build);
    assert.deepEqual(await f.get(),{code:503,data:{error:'unavailable'}});
    assert.deepEqual(f.calls,['archive']);
  }
});
test('VIP authorization and authenticated access run before archive lookup',async()=>{
  const f=fixture('vip',r=>({rows:[r]}));
  assert.equal((await f.get(null)).code,401);assert.deepEqual(f.calls,[]);
  assert.equal((await f.get('free')).code,403);assert.deepEqual(f.calls,['vip']);
});
