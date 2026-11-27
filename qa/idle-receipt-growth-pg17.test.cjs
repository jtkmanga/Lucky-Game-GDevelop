'use strict';
// Local-only, bounded performance evidence. No hosted config/DSN accepted.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const net=require('node:net'),{spawn,spawnSync}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {EventEmitter}=require('node:events');
const {createRequire}=require('node:module');
const {setTimeout:sleep}=require('node:timers/promises');
const bin=process.env.LUCKY_PG17_BIN;
const database='lucky_qa_idle_skip',login='lucky_game_server_login',observer='fixture_idle_observer';
const uuid=n=>'aaaaaaaa-0000-4000-8000-'+String(n).padStart(12,'0');
const roster=[1,2,3,4].map(uuid);
const names=['ผู้เล่นทดสอบหนึ่ง','ผู้เล่นทดสอบสอง','ผู้เล่นทดสอบสาม','ผู้เล่นทดสอบสี่'];
const roomId=uuid(9);
function section(s,start,end) {
 const i=s.indexOf(start),j=s.indexOf(end,i+start.length);
 assert.ok(i>=0 && j>i,start);
 return s.slice(i,j);
}
async function portOnLoopback(){
 const s=net.createServer();
 await new Promise((resolve,reject)=>s.once('error',reject).listen(0,'127.0.0.1',resolve));
 const {port}=s.address();
 await new Promise((resolve,reject)=>s.close(error=>error?reject(error):resolve()));
 return port;
}

test('bounded idle-room skips with actual PG17 store and cold resume',
 {skip:bin===undefined,timeout:30000},async t=>{
  assert.ok(path.isAbsolute(bin),'set absolute local PostgreSQL 17 binaries path');
  const {Client,Pool}=require(process.env.LUCKY_PG17_DRIVER||'pg');
  const port=await portOnLoopback(),root=await fs.mkdtemp(path.join(os.tmpdir(),'lucky-idle-receipts-tcp-'));
  const data=path.join(root,'data'), env={PATH:'/usr/bin:/bin',LC_ALL:'C'};
  let proc,stopped,obs,pool;
  t.after(async()=>{
   await Promise.allSettled([pool?.end(),obs?.end()]);
   if(proc?.exitCode===null && proc.signalCode===null){
    proc.kill('SIGINT');
    const deadline=new AbortController();
    const timeout=sleep(2000,false,{signal:deadline.signal}).catch(()=>true);
    if(!await Promise.race([stopped.then(()=>true),timeout])){proc.kill('SIGKILL');await stopped;}
    deadline.abort();
   }
   await fs.rm(root,{recursive:true,force:true});
  });
  function run(binary,args,input) {
   const r=spawnSync(path.join(bin,binary),args,{env,input,encoding:'utf8',timeout:10000});
   assert.ifError(r.error);assert.equal(r.status,0,r.stderr);
   assert.doesNotMatch(r.stderr,/\b(?:ERROR|FATAL|PANIC):/);
   return r.stdout;
  }
  assert.match(run('postgres',['--version']),/^postgres \(PostgreSQL\) 17\./);
  run('initdb',['-D',data,'-A','reject','-U','fixture_bootstrap','--no-locale','-E','UTF8']);
  const offline=(db,sql)=>run('postgres',['--single','-D',data,'-j',db],
   sql.trim().replace(/\n[ \t]*\n/g,'\n')+'\n\n');
  offline('postgres','CREATE DATABASE '+database);
  offline(database,`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    DO $$ DECLARE n int; probe oid; BEGIN
      FOR n IN 1..10000 LOOP
        CREATE TABLE public.oid_probe(id int);
        probe := 'public.oid_probe'::regclass::oid;
        DROP TABLE public.oid_probe;
        IF probe >= 16384 THEN RETURN; END IF;
      END LOOP;
      RAISE EXCEPTION 'Expected ordinary PostgreSQL object OIDs';
    END $$;`);
  for(const file of ['001_game_private_schema.sql','002_room_lease_draft.sql','003_turn_receipts_draft.sql',
   '004_railway_runtime_access_PROPOSAL.sql','005_restricted_login_no_password.sql'])
   offline(database,await fs.readFile(path.join(__dirname,'../backend/supabase',file),'utf8'));
  const pw=randomBytes(24).toString('hex'),viewPw=randomBytes(24).toString('hex');
  const readTables=['rooms','score_events','turn_receipts'];
  offline(database,`SET password_encryption='scram-sha-256';
    ALTER ROLE ${login} PASSWORD '${pw}';
    CREATE ROLE ${observer} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${viewPw}';
    GRANT USAGE ON SCHEMA game TO ${observer};
    ${readTables.map(x=>`GRANT SELECT ON game.${x} TO ${observer};
      CREATE POLICY fixture_read ON game.${x} FOR SELECT TO ${observer} USING(true);`).join('\n')}
    INSERT INTO auth.users VALUES ${roster.map(x=>"('"+x+"')").join(',')};
    `);
  await fs.writeFile(path.join(data,'pg_hba.conf'),`host ${database} ${login},${observer} 127.0.0.1/32 scram-sha-256\n`);
  proc=spawn(path.join(bin,'postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-c','unix_socket_directories='],
   {env,stdio:['ignore','ignore','pipe']});
  stopped=new Promise(resolve=>{proc.once('close',resolve);proc.once('error',resolve);});
  let log='';
  proc.stderr.setEncoding('utf8').on('data',chunk=>{log=(log+chunk).slice(-1800);});
  const opts=(user,password)=>({host:'127.0.0.1',port,database,user,password,ssl:false,statement_timeout:2000,connectionTimeoutMillis:700});
  for(let tries=0;tries<50;tries++){
   const c=new Client(opts(observer,viewPw));
   c.on('error',()=>{});
   try{await c.connect();obs=c;break;}
   catch(error){
    await c.end();
    if(!['ECONNREFUSED','57P03'].includes(error.code))throw error;
    if(proc.exitCode!==null)break;
    await sleep(40);
   }
  }
  assert.ok(obs,'private PostgreSQL startup failed: '+log);
  await obs.query('SET default_transaction_read_only=on');
  pool=new Pool({...opts(login,pw),max:2});
  assert.deepEqual((await pool.query(`SELECT session_user AS login,
    inet_client_addr()::text AS addr,row_security_active('game.rooms') AS rooms,
    row_security_active('game.turn_receipts') AS receipts,row_security_active('game.score_events') AS scores,
    rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows,
   [{login,addr:'127.0.0.1/32',rooms:true,receipts:true,scores:true,rolsuper:false,rolbypassrls:false}]);
  const backend=path.resolve(__dirname,'../backend');
  const from=rel=>path.join(backend,rel);
  const source=await fs.readFile(from('railway/secure-server.cjs'),'utf8');
  const Rules=require(from('railway/multi-board-rules.cjs'));
  const {requireRoomAccess}=require(from('auth/room-access.cjs'));
  const {requireRuleTransition}=require(from('railway/rule-transition-guard.cjs'));
  const controller=section(source,'const TURN_MS=','// Readiness reports')+
   section(source,"wss.on('connection'",'beginListening({');
  const storePath=from('supabase/game-store.cjs');
  const use=createRequire(storePath);
  const moduleFixture={exports:{}};
  Function('require','module',await fs.readFile(storePath,'utf8'))(id=>{
   if(id==='pg')return {Pool:function(){return pool;}};
   if(id==='./pg-tls-config.cjs')return {poolConnectionOptions:()=>({})};
   return use(id);
  },moduleFixture);
  const actual=moduleFixture.exports.createRailwayStore('fixture-only');
  let now=Date.now(), logical=0,eventArrays=0;
  const latencies=[];
  const store={...actual,async commitFencedTurn(args){
   const start=performance.now();
   const revision=await actual.commitFencedTurn(args);
   latencies.push(performance.now()-start);
   logical+=Buffer.byteLength(JSON.stringify(args.game));
   eventArrays+=Buffer.byteLength(JSON.stringify(args.game.events));
   return revision;
  }};
  function worker(workerId){
   const wss=new EventEmitter(),timers=new Map(),errors=[];
   let uuidCalls=0;
   const deps={requireRuleTransition,Date:{now:()=>now},shuttingDown:false,Rules,requireRoomAccess,store,
    pilot:null,wss,MAX_CONNECTIONS:10,WebSocket:{OPEN:1},
    crypto:{randomUUID:()=>++uuidCalls===1?workerId:roomId,randomInt(){assert.fail('timeout must not roll');}},
    requirePlayerIdentity:async input=>{assert.ok(roster.includes(input.accessToken));return {uid:input.accessToken};},
    setTimeout(fn,delay){const key={};timers.set(key,delay);return key;},
    clearTimeout:key=>timers.delete(key),console:{error:(...args)=>errors.push(args.join(' '))}};
   const app=Function(...Object.keys(deps),controller+'\nreturn {handle,advance,rooms};')(...Object.values(deps));
   return {...app,timers,errors,async join(index){
    const ws=Object.assign(new EventEmitter(),{readyState:1,bufferedAmount:0,packets:[],
     send(x){this.packets.push(JSON.parse(x));},close(){this.readyState=3;this.emit('close');}});
    wss.emit('connection',ws);
    await app.handle(ws,{type:'join',mode:'free',accessToken:roster[index],name:names[index]});
    return ws;
   }};
  }
  const owner=uuid(50),app=worker(owner),sockets=[];
  for(let i=0;i<roster.length;i++)sockets.push(await app.join(i));
  const room=app.rooms.get(roomId);
  assert.ok(room);
  assert.equal(room.deadline-now,20000);
  for(const s of sockets)s.close();
  assert.ok(room.seats.every(s=>s.ws===null),'all four sockets detached using actual close handler');
  assert.equal(app.timers.get(room.timer),20001,'last close does not remove the skip timer');

  const sample=async()=>{
   const r=(await obs.query(`SELECT
    (SELECT count(*)::int FROM game.turn_receipts) AS receipts,
    (SELECT count(*)::int FROM game.turn_receipts WHERE event_type='timeout' AND roll IS NULL
      AND award_events='[]'::jsonb) AS skip_receipts,
    (SELECT count(*)::int FROM game.score_events) AS awards,
    (SELECT revision::int FROM game.rooms WHERE room_id=$1) AS revision,
    pg_relation_size('game.turn_receipts')::int AS receipt_heap_bytes,
    pg_indexes_size('game.turn_receipts')::int AS receipt_index_bytes,
    pg_total_relation_size('game.turn_receipts')::int AS receipt_total_bytes,
    pg_total_relation_size('game.rooms')::int AS rooms_total_bytes`,[roomId])).rows[0];
   assert.equal(r.receipts,room.revision);assert.equal(r.skip_receipts,r.receipts);
   assert.equal(r.revision,r.receipts);assert.equal(r.awards,0);
   const sorted=latencies.slice().sort((a,b)=>a-b);
   const percentile=p=>sorted.length?+sorted[Math.ceil(sorted.length*p)-1].toFixed(3):null;
   return {...r,state_json_input_bytes:logical,event_arrays_input_bytes:eventArrays,
    latest_game_json_bytes:Buffer.byteLength(JSON.stringify(room.game)),
    loopback_transaction_p50_ms:percentile(.50),loopback_transaction_p95_ms:percentile(.95),
    loopback_transaction_p99_ms:percentile(.99)};
  };
  const rows=[await sample()];
  for(let i=1;i<=720;i++){
   now=room.deadline+1; // Fast-forward; this is not a timed soak.
   await app.advance(room,null);
   assert.equal(room.revision,i,app.errors.join(';'));
   assert.equal(room.deadline-now,20000);
   if(i===180||i===720)rows.push(await sample());
  }
  assert.ok(rows[2].receipt_total_bytes>rows[1].receipt_total_bytes);
  assert.ok(rows[2].state_json_input_bytes>rows[1].state_json_input_bytes*4);
  for(const ws of sockets)assert.equal(ws.packets.at(-1).revision,0,'no idle fanout to closed sockets');
  assert.equal(await actual.releaseRoomLease(room.id,owner,room.leaseEpoch),true);
  const fresh=worker(uuid(51));
  const result=(await fresh.join(1)).packets.at(-1);
  assert.equal(result.roomId,roomId);assert.equal(result.revision,720);assert.equal(result.seat,1);
  assert.equal(result.event.type,'resume');assert.deepEqual(result.game,room.game);
  t.diagnostic(JSON.stringify({checkpoints:rows,reconnect_packet_json_bytes:Buffer.byteLength(JSON.stringify(result))}));
 });
