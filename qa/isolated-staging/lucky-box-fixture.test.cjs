'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const {readLuckyBoxFixture}=require('../../backend/railway/free4-pilot.cjs');
const env={RAILWAY_ENVIRONMENT_NAME:'staging',LUCKY_ISOLATED_STAGING_SUPABASE_REF:'tpwmcozkzlvolehozzri',LUCKY_PILOT_LUCKY_BOX_FIXTURE:'true'};
const pilot={roomId:'fixed-room'};
const room={id:'fixed-room',mode:'free',revision:0,game:{map:1,current:0,gift:16,giftUsed:false,players:[{pos:15},{pos:15}]}};
test('fixture blocked in the wrong environment or project and inert by default',()=>{
 assert.equal(readLuckyBoxFixture({},null)(room,0),null);
 for(const e of [{RAILWAY_ENVIRONMENT_NAME:'production'},{LUCKY_ISOLATED_STAGING_SUPABASE_REF:'old'},{LUCKY_PILOT_LUCKY_BOX_FIXTURE:'on'}])
  assert.throws(()=>readLuckyBoxFixture({...env,...e},pilot),/Invalid isolated/);
 assert.throws(()=>readLuckyBoxFixture(env,null),/Invalid isolated/);
});
test('only the two scoped acceptance rolls are deterministic',()=>{
 const roll=readLuckyBoxFixture(env,pilot);
 assert.equal(roll(room,0),1);
 const second=structuredClone(room);second.revision=1;second.game.current=1;second.game.giftUsed=true;
 assert.equal(roll(second,1),1);
 for(const other of [{id:'unbound'},{mode:'vip'},{revision:2},{game:{...room.game,gift:17}}])
  assert.equal(roll({...room,...other},0),null);
 assert.equal(roll(room,1),null);
});
