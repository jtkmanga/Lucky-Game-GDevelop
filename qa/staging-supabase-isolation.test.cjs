'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const path=require('node:path');
const {readConfig,SHARED_PROJECT_REF}=require('../backend/auth/supabase-access-token.cjs');
const {poolConnectionOptions}=require('../backend/supabase/pg-tls-config.cjs');

const REF='isolatedstagingfixture';
const HOST='aws-0-ap-southeast-1.pooler.supabase.com';
const KEY='sb_publishable_fixtureOnly-no-auth';
const CA=path.resolve(__dirname,'../prod-ca-2021.crt');
const profile={
 RAILWAY_ENVIRONMENT_NAME:'staging',
 LUCKY_FREE4_PILOT:'true',
 LUCKY_ISOLATED_STAGING_SUPABASE_REF:REF,
 LUCKY_ISOLATED_STAGING_POOLER_HOST:HOST,
 SUPABASE_URL:'https://'+REF+'.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:KEY
};
function db(ref=REF,host=HOST){return 'postgresql://lucky_game_server_login.'+ref+':fixture@'+host+':5432/postgres';}

test('ordinary configuration still pins the existing Auth and DB targets',()=>{
 const shared={SUPABASE_URL:'https://'+SHARED_PROJECT_REF+'.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-only'};
 const uri=db(SHARED_PROJECT_REF,'aws-1-ap-southeast-1.pooler.supabase.com');
 assert.equal(readConfig(shared).origin,shared.SUPABASE_URL);
 assert.equal(poolConnectionOptions(uri,CA,shared).ssl.rejectUnauthorized,true);
 assert.throws(()=>readConfig({...shared,LUCKY_FREE4_PILOT:'true'}),/separate Singapore/);
 assert.throws(()=>poolConnectionOptions(db(),CA,shared),/approved restricted/);
});

test('Free4 pilot uses one isolated project for both Auth and restricted Session Pooler',()=>{
 assert.deepEqual(readConfig(profile),{origin:profile.SUPABASE_URL,key:KEY});
 const opts=poolConnectionOptions(db(),CA,profile);
 assert.equal(opts.connectionString,db());
 assert.equal(opts.ssl.rejectUnauthorized,true);
 assert.ok(Buffer.isBuffer(opts.ssl.ca));
 const profiles=[
  {...profile,RAILWAY_ENVIRONMENT_NAME:'production'},
  {...profile,LUCKY_FREE4_PILOT:'false'},
  {...profile,LUCKY_ISOLATED_STAGING_SUPABASE_REF:undefined},
  {...profile,LUCKY_ISOLATED_STAGING_POOLER_HOST:undefined},
  {...profile,LUCKY_ISOLATED_STAGING_SUPABASE_REF:SHARED_PROJECT_REF},
  {...profile,LUCKY_ISOLATED_STAGING_POOLER_HOST:'aws-0-us-west-1.pooler.supabase.com'}
 ];
 for(const invalid of profiles){
  assert.throws(()=>readConfig(invalid),/separate Singapore/);
  assert.throws(()=>poolConnectionOptions(db(),CA,invalid),/separate Singapore/);
 }
 assert.throws(()=>readConfig({...profile,SUPABASE_URL:'https://'+SHARED_PROJECT_REF+'.supabase.co'}),/Unexpected Supabase/);
 assert.throws(()=>readConfig({...profile,SUPABASE_PUBLISHABLE_KEY:'sb_secret_fixtureOnly'}),/publishable key/);
 for(const invalid of [db(SHARED_PROJECT_REF),db(REF,'aws-1-ap-southeast-1.pooler.supabase.com'),
   db().replace('5432','6543'),db().replace('lucky_game_server_login','postgres'),
   db()+'?sslmode=disable',db()+'#fragment']){
  assert.throws(()=>poolConnectionOptions(invalid,CA,profile),/approved restricted/);
 }
});

test('database startup rejects an unbound or mismatched acceptance run',async t=>{
 const source=require.resolve('../backend/supabase/game-store.cjs');
 const fromStore=createRequire(source);
 const roomId='aaaaaaaa-0000-4000-8000-000000000007';
 const cutoffMs=1890000000000;
 const name='LUCKY_ISOLATED_STAGING_SUPABASE_REF';
 const previous=process.env[name];process.env[name]=REF;
 t.after(()=>{if(previous===undefined)delete process.env[name];else process.env[name]=previous;});
 let matches=0;
 const pool={connect(){throw Error('Unexpected connect');},async query(sql,args){
  if(sql.includes('current_user AS role_name'))return {rows:[{role_name:'lucky_game_server_login',
   session_name:'lucky_game_server_login',schema_ok:true,orders_read:false}]};
  if(sql.includes('information_schema.columns'))return {rowCount:3};
  if(sql.includes('AS receipts'))return {rows:[{receipts:'game.turn_receipts'}]};
  if(sql.includes('AS players'))return {rows:[{players:'game.players'}]};
  if(sql.includes('staging_acceptance_binding')){
   assert.deepEqual(args,[REF,roomId,cutoffMs]);return {rows:[{matches}]};
  }
  throw Error('Unexpected startup query');
 }};
 const mod={exports:{}};
 Function('require','module',fs.readFileSync(source,'utf8'))(id=>{
  if(id==='pg')return {Pool:function(){return pool;}};
  if(id==='./pg-tls-config.cjs')return {poolConnectionOptions:()=>({})};
  return fromStore(id);
 },mod);
 const store=mod.exports.createRailwayStore('fake-db',{roomId,cutoffMs});
 await assert.rejects(store.health(),/not bound/);
 matches=1;
 await store.health();
});
