'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPreviousLeaderboardHandler } = require('../backend/railway/previous-leaderboard-http-handler.cjs');

const ts = Date.parse;
const at = ts('2026-11-21T17:00:00Z'); // Bangkok Sunday midnight
function fixture(vip = false) {
  const calls = [];
  let sampleCount=0;
  const handler=createPreviousLeaderboardHandler({
    clock:()=>{sampleCount++;return at;},
    async verifyIdentity({accessToken}) {
      if(accessToken!=='fixture')throw Error('not signed in');
      return {uid:'trusted-user'};
    },
    store:{
      async getVipEntitlement(uid){
        calls.push(['vip',uid]);
        return vip && {uid,status:'active',tier:'vip',expiresAtMs:Date.now()+60000};
      },
      async leaderboard(...args){
        calls.push(['read',...args]);
        return [{uid:'private-id',display_name:'private-name',score:'9223372036854775807'}];
      }
    }
  });
  const request=async(query,authorization='Bearer fixture')=>{
    let status,headers,body;
    await handler({method:'GET',url:'/not-mounted?'+query,headers:{authorization}},{
      writeHead(code,fields){ status=code;headers=fields; },
      end(payload){body=JSON.parse(payload);}
    });
    assert.equal(headers['Cache-Control'],'private, no-store');
    return {status,body};
  };
  return {request,calls,samples:()=>sampleCount};
}

test('Free prior week and VIP prior day are server-selected at Bangkok midnight',async()=>{
  for(const [mode,start] of [['free','2026-11-14T17:00:00Z'],['vip','2026-11-20T17:00:00Z']]){
    const f=fixture(true);
    const startMs=ts(start);
    assert.deepEqual(await f.request('mode='+mode+'&startMs=1&endMs=2'),{
      status:200,body:{provisional:true,period:{mode,startMs,endMs:at},
        rows:[['🥇','👤','ผู้เล่น','9223372036854775807']]}
    });
    assert.equal(f.samples(),1);
    assert.deepEqual(f.calls,[...(mode==='vip'?[['vip','trusted-user']]:[]),['read',mode,startMs,at]]);
  }
});

test('invalid mode, absent access token and denied VIP never read the ledger',async()=>{
  const f=fixture();
  assert.equal((await f.request('mode=free&mode=vip')).status,400);
  assert.equal((await f.request('mode=free&accessToken=fixture','')).status,401);
  assert.equal((await f.request('mode=vip&uid=trusted-user&vip=true')).status,403);
  assert.equal(f.samples(),0);
  assert.deepEqual(f.calls,[['vip','trusted-user']]);
});
