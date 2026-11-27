'use strict';
// node qa/vip2-native-postgres-race.cjs ABS_SOCKET_DIR PORT lucky_qa_NAME LOCAL_USER ABS_DATA_DIR
// No CI invocation. Requires explicit local arguments and a fresh database.
// Use a fresh throwaway database on a socket-only PG17 cluster owned by this OS uid.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID,createHash} = require('node:crypto');
const {setTimeout:delay} = require('node:timers/promises');
// Inputs pinned on Integration Candidate at 3208ee7b3925fd784152e3f6a7d23da71d530976.
const pinned={
  'proposal.sql':'c9ec964d93e2c68a242d84aa93b6a0cd55930818',
  'game-store.cjs':'67172b51b20eaef3aa985999c408c5e024eb73cf',
  'room-lease-store.cjs':'c52759f1421ff2aa68fc42e3c2dbadfd72b67c6f',
  '001_game_private_schema.sql':'b7439dfb87b1ed4d90d0d9d2a63a5749ee5070f6',
  '002_room_lease_draft.sql':'1e0f66daf316c839ba7c92acf83bd8602802fedf',
  '003_turn_receipts_draft.sql':'bf63b6ec4c7ed916833d8a886c59bf8d199ea0af',
  '004_railway_runtime_access_PROPOSAL.sql':'1a50dd0da9b2ac2e8a2399d5cbac77dab2c141b7',
  '005_restricted_login_no_password.sql':'baa14f19ae0b2d912b6ccd96d432fdcc5787c9a7'
};
function source(name){
  const data=fs.readFileSync(name==='proposal.sql'?path.join(__dirname,'vip-lock-lab',name):path.join(__dirname,'..','backend','supabase',name));
  const hash=createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');
  assert.equal(hash,pinned[name],name);
  return data.toString();
}
for(const name of Object.keys(pinned))source(name);
if (process.argv.length===3 && process.argv[2]==='--verify-sources') {
  console.log('VIP2 source pins OK (8); native races NOT RUN');
  process.exit(0);
}
function driver(){
  const {createRequire}=require('node:module');
  let resolved;
  try{resolved=require.resolve('pg');}
  catch{resolved=createRequire(path.resolve(__dirname,'../railway-runtime/package.json')).resolve('pg');}
  const pg=require(resolved);
  assert.equal(typeof pg.Client.prototype.getTransactionStatus,'function','pg transaction status API required');
  return pg;
}
if(process.argv.length===3 && process.argv[2]==='--check-driver'){driver();process.exit(0);}
for (const key of Object.keys(process.env)) {
  if (/^(PG|DATABASE_URL$)/i.test(key)) delete process.env[key];
}
process.env.PGPASSFILE='/dev/null';
function privateDir(dir) {
  assert.equal(path.resolve(dir), dir);
  assert.equal(fs.realpathSync(dir),dir);
  const stat=fs.statSync(dir);
  assert.ok(stat.isDirectory() && stat.uid===process.getuid() && !(stat.mode & 0o077), 'require owned private directory');
  return dir;
}
const [host,rawPort,database,user,dataDir]=process.argv.slice(2);
assert.equal(process.argv.length,7,'expected socket, port, database, user, data directory');
privateDir(host); privateDir(dataDir);
assert.match(rawPort,/^[1-9][0-9]{0,4}$/);
const port=Number(rawPort);
assert.ok(port<=65535);
assert.match(database,/^lucky_qa_[a-z0-9_]{1,48}$/);
assert.match(user,/^[a-z_][a-z0-9_]{0,62}$/);
const socket=fs.lstatSync(path.join(host,'.s.PGSQL.'+port));
assert.ok(socket.isSocket() && socket.uid===process.getuid());
assert.match(path.dirname(host),/^\/tmp\/lucky-vip2-native\.[a-zA-Z0-9]{8}$/);
assert.equal(host,path.join(path.dirname(host),'socket'));
assert.equal(dataDir,path.join(path.dirname(host),'data'));
privateDir(path.dirname(host));
assert.equal(rawPort,'55439');
assert.equal(user,'lucky_qa_owner');
assert.equal(database,'lucky_qa_vip_pair');
assert.equal(socket.mode & 0o777,0o700);
const {Client,Pool}=driver();
const opts={host,port,database,user,password:'',ssl:false,
  connectionTimeoutMillis:3000,statement_timeout:10000,lock_timeout:9000,
  idle_in_transaction_session_timeout:12000,max:1};
const client=name=>new Client({...opts,application_name:name});
// Replace only the hosted transport configuration with a native private socket pool.
// Every Pool, SQL query, transaction, lock and receipt goes to native PostgreSQL.
const login='lucky_game_server_login';
function runtimePool(label){
  return new Pool({...opts,user:login,application_name:label});
}
function localStore(pool){
  const module={exports:{}};
  const localRequire=id=>{
    if(id==='pg')return {Pool:function LocalPool(){return pool;}};
    if(id==='./room-lease-store.cjs')return require('../backend/supabase/room-lease-store.cjs');
    assert.equal(id,'./pg-tls-config.cjs');
    return {poolConnectionOptions:()=>({})};
  };
  Function('require','module',source('game-store.cjs'))(localRequire,module);
  return module.exports.createRailwayStore('unix-socket-fixture',null,{atomicVip:true});
}
async function checkRuntime(pool){
  await localStore(pool).health();
  const tables=['players','vip_entitlements','rooms','score_events','turn_receipts',
    'orders','admin_audit','leaderboard_archives'];
  const {rows}=await pool.query(`SELECT name, row_security_active(('game.' || name)::regclass) AS active
    FROM unnest($1::text[]) AS t(name)`,[tables]);
  assert.equal(rows.length,tables.length);
  for(const {name,active} of rows)assert.equal(active,true,'RLS inactive on game.'+name);
}
const observer=client('qa_observer');
const blocker=client('qa_blocker');
const now=async()=>Number((await observer.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS ms')).rows[0].ms);
async function waitUntil(check,label){
  const end=performance.now()+6500;
  do{const value=await check();if(value)return value;await delay(20);}while(performance.now()<end);
  throw Error('Timed out waiting for '+label);
}
async function blocked(label,by,sqlFragment){
  return waitUntil(async()=>{
    const result=await observer.query(`SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND application_name=$1 AND $2::int=ANY(pg_blocking_pids(pid))
      AND position($3 in query)>0`,[label,by,sqlFragment]);
    return result.rows[0]?.pid;
  },label+' blocked by '+by);
}
async function setup(){
  const {rows:[r]}=await observer.query(`SELECT inet_server_addr() IS NULL AS local,
    current_setting('listen_addresses') AS listeners,current_setting('server_version_num')::int AS version,
    current_setting('data_directory') AS dir,current_database() AS db,current_user AS usr,
    to_regnamespace('auth') IS NULL AND to_regnamespace('game') IS NULL AS fresh`);
  assert.ok(r.local && r.fresh && r.listeners==='' && r.version>=170000 && r.version<180000);
  assert.equal(r.dir,dataDir);assert.equal(r.db,database);assert.equal(r.usr,user);
  for(const role of ['anon','authenticated']){
    if(!(await observer.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)
      await observer.query('CREATE ROLE '+role+' NOLOGIN');
  }
  await observer.query('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)');
  for(const name of Object.keys(pinned).filter(x=>/^00[1-5]_/.test(x)))await observer.query(source(name));
  await observer.query("SET lucky.disposable_vip_qa='on'");
  await observer.query(source('proposal.sql'));
}
const settle=promise=>promise.then(value=>({value}),error=>({error}));
async function race(admitFirst){
  const runtime=runtimePool('qa_vip_admission');
  const issuer=client('qa_vip_revocation');
  const reader=client('qa_vip_readback');
  const store=localStore(runtime);
  const seats=[1,2].map(n=>({uid:randomUUID(),name:'VIP fixture '+randomUUID().slice(0,18)}));
  const ids=seats.map(s=>s.uid);
  const roomId=randomUUID(),ownerId=randomUUID(),game={mode:'vip',over:false};
  const pending=[];
  try{
    await issuer.connect();
    await reader.connect();
    await checkRuntime(runtime);
    for(const s of seats){
      await observer.query('INSERT INTO auth.users VALUES($1)',[s.uid]);
      await store.player(s.uid,s.name);
      await observer.query("INSERT INTO game.vip_entitlements(uid,status,expires_at,grant_ref) VALUES($1,'active',clock_timestamp()+interval '1 day',$2)",[s.uid,randomUUID()]);
    }
    const startAdmission=()=>store.initializeRoom({roomId,mode:'vip',seats,game,ownerId,
      deadlineMs:Date.now()+60000,reservationCurrent:()=>true});
    const revoke=()=>issuer.query("UPDATE game.vip_entitlements SET status='revoked' WHERE uid=$1",[ids[0]]);
    await issuer.query('BEGIN');
    let admission;
    if(admitFirst){
      // Block INSERT after the candidate has acquired both FOR SHARE locks.
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE game.rooms IN SHARE MODE');
      admission=settle(startAdmission());pending.push(admission);
      const admissionPid=await blocked('qa_vip_admission',blocker.processID,'INSERT INTO game.rooms');
      const update=settle(revoke());pending.push(update);
      await blocked('qa_vip_revocation',admissionPid,'UPDATE game.vip_entitlements');
      await blocker.query('COMMIT');
      assert.deepEqual(await admission,{value:1});
      const result=await update;
      assert.ifError(result.error);
      assert.equal(result.value.rowCount,1);
      // Revoker has acquired the row, but its change is still uncommitted.
      assert.equal((await reader.query('SELECT status FROM game.vip_entitlements WHERE uid=$1',[ids[0]])).rows[0].status,'active');
      assert.equal((await reader.query('SELECT room_id FROM game.rooms WHERE room_id=$1',[roomId])).rowCount,1);
      await issuer.query('COMMIT');
    }else{
      assert.equal((await revoke()).rowCount,1);
      admission=settle(startAdmission());pending.push(admission);
      await blocked('qa_vip_admission',issuer.processID,'game.lock_vip_pair');
      await issuer.query('COMMIT');
      assert.equal((await admission).error?.code,'VIP_PAIR_DENIED');
    }
    const entitlements=await reader.query('SELECT uid,status FROM game.vip_entitlements WHERE uid=ANY($1::uuid[])',[ids]);
    assert.deepEqual(Object.fromEntries(entitlements.rows.map(r=>[r.uid,r.status])),{[ids[0]]:'revoked',[ids[1]]:'active'});
    const room=await reader.query('SELECT room_id,mode,seats,game_state,revision,status,lease_owner,lease_epoch FROM game.rooms WHERE room_id=$1 OR seats @> $2::jsonb',
      [roomId,JSON.stringify([{uid:ids[0]}])]);
    assert.equal(room.rowCount,admitFirst?1:0);
    if(admitFirst){
      const r=room.rows[0];
      assert.deepEqual([r.room_id,r.mode,r.seats,r.game_state,Number(r.revision),r.status,r.lease_owner,Number(r.lease_epoch)],
        [roomId,'vip',seats,game,0,'playing',ownerId,1]);
    }
    console.log((admitFirst?'admit-first':'revoke-first')+' PASS');
  }finally{
    // Ending the issuer connection rolls back any held or queued UPDATE.
    await Promise.allSettled([issuer.end(),blocker.query('ROLLBACK')]);
    await Promise.allSettled(pending);
    await Promise.allSettled([reader.end(),store.close()]);
  }
}
async function main(){
  try{
    await observer.connect();await blocker.connect();
    await setup();
    await race(false);await race(true);
  }finally{await Promise.allSettled([blocker.end(),observer.end()]);}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
