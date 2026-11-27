'use strict';
// node qa/free4-native-postgres-race.cjs ABS_SOCKET_DIR PORT lucky_qa_NAME LOCAL_USER ABS_DATA_DIR
// No CI invocation. Requires explicit local arguments and a fresh database.
// Use a fresh throwaway database on a socket-only PG17 cluster owned by this OS uid.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID,createHash} = require('node:crypto');
const {setTimeout:delay} = require('node:timers/promises');
// Inputs pinned on Integration Candidate at 12452556153f4b53c29e2c17076c3a58d8e04005.
const pinned={
  'game-store.cjs':'67172b51b20eaef3aa985999c408c5e024eb73cf',
  'room-lease-store.cjs':'c52759f1421ff2aa68fc42e3c2dbadfd72b67c6f',
  '001_game_private_schema.sql':'b7439dfb87b1ed4d90d0d9d2a63a5749ee5070f6',
  '002_room_lease_draft.sql':'1e0f66daf316c839ba7c92acf83bd8602802fedf',
  '003_turn_receipts_draft.sql':'bf63b6ec4c7ed916833d8a886c59bf8d199ea0af',
  '004_railway_runtime_access_PROPOSAL.sql':'1a50dd0da9b2ac2e8a2399d5cbac77dab2c141b7',
  '005_restricted_login_no_password.sql':'baa14f19ae0b2d912b6ccd96d432fdcc5787c9a7'
};
function source(name){
  const data=fs.readFileSync(path.join(__dirname,'..','backend','supabase',name));
  const hash=createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');
  assert.equal(hash,pinned[name],name);
  return data.toString();
}
for(const name of Object.keys(pinned))source(name);
if (process.argv.length===3 && process.argv[2]==='--verify-sources') {
  console.log('Free4 source pins OK (7); native races NOT RUN');
  process.exit(0);
}
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
const {Client,Pool}=require('pg');
const opts={host,port,database,user,password:'local-synthetic-only',ssl:false,
  connectionTimeoutMillis:3000,statement_timeout:10000,lock_timeout:9000,
  idle_in_transaction_session_timeout:12000,max:1};
const client=name=>new Client({...opts,application_name:name});
// Supply the same warmed socket pool to both unbound and pilot-bound store adapters.
// Every Pool, SQL query, transaction, lock and receipt goes to native PostgreSQL.
const login='lucky_game_server_login';
function runtimePool(label){
  return new Pool({...opts,user:login,application_name:label});
}
function localStore(pool,binding){
  const module={exports:{}};
  const localRequire=id=>{
    if(id==='pg')return {Pool:function LocalPool(){return pool;}};
    if(id==='./room-lease-store.cjs')return require('../backend/supabase/room-lease-store.cjs');
    assert.equal(id,'./pg-tls-config.cjs');
    return {poolConnectionOptions:()=>({})};
  };
  Function('require','module',source('game-store.cjs'))(localRequire,module);
  return module.exports.createRailwayStore('unix-socket-fixture',binding);
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
  for(const name of Object.keys(pinned).filter(x=>x.endsWith('.sql')))await observer.query(source(name));
}
const settle=promise=>promise.then(value=>({value}),error=>({error}));
async function run(kind){
  const roomId=randomUUID(),ownerId=randomUUID();
  const turnPool=runtimePool('qa_turn'),closePool=runtimePool('qa_close');
  const reader=client('qa_readback');
  const seats=Array.from({length:4},(_,i)=>({uid:randomUUID(),name:'Player '+roomId+' '+i}));
  const game={over:false},final={over:true,winner:0};
  let locked=false;
  try{
    await checkRuntime(turnPool);
    await checkRuntime(closePool);
    const seed=localStore(turnPool);
    for(const seat of seats){
      await observer.query('INSERT INTO auth.users VALUES($1)',[seat.uid]);
      await seed.player(seat.uid,seat.name);
    }
    const cutoffMs=await now()+2500;
    const binding={roomId,cutoffMs},turn=localStore(turnPool,binding),close=localStore(closePool,binding);
    const leaseEpoch=await turn.initializeRoom({roomId,ownerId,mode:'free',seats,game,deadlineMs:cutoffMs+5000});
    assert.equal(leaseEpoch,1);
    const fence={roomId,ownerId,leaseEpoch,expectedRevision:0};
    const eventId=roomId+':win',uid=seats[0].uid;
    const award={gameId:roomId,eventId,uid,kind:'win',points:10,mode:'free'};
    const receipt={type:'roll',actorIndex:0,dice:1,outcome:{reward:0}};
    const win=()=>settle(turn.commitFencedTurn({...fence,game:final,deadlineMs:null,awards:[award],receipt}));
    const expire=()=>close.closeExpiredPilot(fence);
    const past=()=>waitUntil(async()=>await now()>=cutoffMs,'database cutoff');
    if(kind!=='close-first'){
      await blocker.query('BEGIN');locked=true;
      if(kind==='blocked-turn')await blocker.query('SELECT room_id FROM game.rooms WHERE room_id=$1 FOR UPDATE',[roomId]);
      else await blocker.query('LOCK TABLE game.score_events IN SHARE MODE');
      const pending=win();
      const turnPid=await blocked('qa_turn',blocker.processID,kind==='blocked-turn'?'FOR UPDATE':'INSERT INTO game.score_events');
      assert.ok(await now()<cutoffMs,'block must be observed before cutoff');
      await past();
      const closing=kind==='win-first'?settle(expire()):null;
      if(closing)await blocked('qa_close',turnPid,'FOR UPDATE');
      await blocker.query('COMMIT');locked=false;
      const result=await pending;
      if(closing){
        assert.deepEqual(result,{value:1});
        assert.deepEqual(await closing,{value:'finished'});
      }else{
        assert.match(result.error?.message,/^LEASE_LOST_OR_STALE_REVISION$/);
        assert.equal(await expire(),'closed');
      }
    }else{
      await past();assert.equal(await expire(),'closed');
      assert.match((await win()).error?.message,/^LEASE_LOST_OR_STALE_REVISION$/);
      assert.equal(await expire(),'closed');
    }
    await reader.connect();
    const won=kind==='win-first';
    const rows=async(q)=>(await reader.query(q,[roomId])).rows;
    const [room]=await rows('SELECT status,revision,deadline_ms,game_state FROM game.rooms WHERE room_id=$1');
    assert.deepEqual(room,{status:won?'finished':'closed',revision:'1',deadline_ms:null,
      game_state:{...(won?final:game),_free4CutoffV1:binding}});
    const ledger=await rows('SELECT event_id,uid,game_id,mode,kind,points FROM game.score_events WHERE game_id=$1');
    assert.deepEqual(ledger,won?[{event_id:eventId,uid,game_id:roomId,mode:'free',kind:'win',points:10}]:[]);
    const receipts=await rows('SELECT room_id,revision,previous_revision,lease_epoch,event_type,actor_index,roll,outcome,game_state,award_events FROM game.turn_receipts WHERE room_id=$1');
    assert.deepEqual(receipts,won?[{room_id:roomId,revision:'1',previous_revision:'0',lease_epoch:'1',event_type:'roll',
      actor_index:0,roll:1,outcome:{reward:0},game_state:final,award_events:[{eventId,uid,kind:'win',points:10,mode:'free'}]}]:[]);
    console.log('PASS',kind,'status='+room.status,'revision='+room.revision,'receipts='+receipts.length,'awards='+ledger.length);
  }finally{
    if(locked)await blocker.query('ROLLBACK');
    await Promise.allSettled([turnPool.end(),closePool.end(),reader.end()]);
  }
}
async function main(){
  try{
    await observer.connect();await setup();await blocker.connect();
    for(const kind of ['blocked-turn','win-first','close-first'])await run(kind);
  }finally{await Promise.allSettled([blocker.end(),observer.end()]);}
}
const watchdog=setTimeout(()=>{console.error('Native QA exceeded 60 seconds');process.exit(1);},60000);
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
