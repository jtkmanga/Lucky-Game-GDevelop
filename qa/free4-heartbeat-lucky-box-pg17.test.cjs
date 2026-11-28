'use strict';
// Build railway-runtime first. Loopback only, disposable PG17, no hosted DSN.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const net=require('node:net'),{spawn,spawnSync}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {once}=require('node:events');
const http=require('node:http');
const {createRequire}=require('node:module');
const {setTimeout:sleep}=require('node:timers/promises');
const bin=process.env.LUCKY_PG17_BIN;
const database='lucky_qa_joint_free4',login='lucky_game_server_login',observer='fixture_free4_observer';
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

test('packaged Free4 heartbeat preserves committed Lucky Box and reconnect on real PG17',
 {skip:bin===undefined,timeout:30000},async t=>{
  assert.ok(path.isAbsolute(bin),'set absolute local PostgreSQL 17 binaries path');
  const backend=path.resolve(__dirname,'../railway-runtime/backend');
  const runtimeRequire=createRequire(path.join(backend,'railway','secure-server.cjs'));
  const manifest=runtimeRequire('../../package.json');
  assert.equal(runtimeRequire('pg/package.json').version,manifest.dependencies.pg);
  assert.equal(runtimeRequire('ws/package.json').version,manifest.dependencies.ws);
  const {Client,Pool}=runtimeRequire('pg');
  const port=await portOnLoopback(),root=await fs.mkdtemp(path.join(os.tmpdir(),'lucky-joint-free4-tcp-'));
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
  const tx=await pool.connect();
  try {
   assert.equal(tx.getTransactionStatus(),'I');
   await tx.query('BEGIN');
   assert.equal(tx.getTransactionStatus(),'T');
   await assert.rejects(tx.query('SELECT 1/0'),{code:'22012'});
   assert.equal(tx.getTransactionStatus(),'E');
   await tx.query('ROLLBACK');
   assert.equal(tx.getTransactionStatus(),'I');
  } finally { tx.release(true); }
  const {WebSocket,WebSocketServer}=use('ws');
  const {startSocketHeartbeat}=require(from('railway/socket-heartbeat.cjs'));
  const {eligibleGiftTiles,getBoard}=require(from('railway/board-maps.cjs'));
  const listener=http.createServer();
  const wss=new WebSocketServer({server:listener,path:'/ws',maxPayload:16384,perMessageDeflate:false});
  let tick,now=Date.now(),uuidCalls=0,nextDie=1;
  const errors=[],peers=[],clients=[];
  const heartbeat=startSocketHeartbeat({wss,open:WebSocket.OPEN,
   startInterval(fn){tick=fn;return {};},stopInterval(){}});
  wss.on('connection',ws=>peers.push(ws));
  t.after(async()=>{
   heartbeat.stop();
   for(const ws of clients)ws.terminate();
   for(const ws of wss.clients)ws.terminate();
   await Promise.all([new Promise(resolve=>wss.close(()=>resolve())),
    new Promise(resolve=>listener.close(()=>resolve()))]);
  });
  // Select a legal, deterministic gift to make this real sequence repeatable.
  // The product rules and transition/store checks remain unchanged.
  const fixtureRules={...Rules,create(...args){
   const game=Rules.create(...args);
   assert.ok(eligibleGiftTiles(getBoard(1)).includes(16));
   game.gift=16;return game;
  }};
  const deps={requireRuleTransition,Date:{now:()=>now},shuttingDown:false,Rules:fixtureRules,requireRoomAccess,
   store:actual,pilot:null,wss,MAX_CONNECTIONS:10,WebSocket,
   crypto:{randomUUID:()=>++uuidCalls===1?uuid(50):roomId,randomInt:()=>nextDie,randomBytes:()=>Buffer.alloc(4)},
   requirePlayerIdentity:async input=>{assert.ok(roster.includes(input.accessToken));return {uid:input.accessToken};},
   setTimeout(){return {};},clearTimeout(){},console:{error:(...args)=>errors.push(args)}};
  const app=Function(...Object.keys(deps),controller+'\nreturn {rooms,clients};')(...Object.values(deps));
  async function until(read){
   const deadline=Date.now()+2000;
   do{const result=read();if(result)return result;await sleep(10);}while(Date.now()<deadline);
   assert.fail('timed out waiting for room state: '+JSON.stringify(errors));
  }
  listener.listen(0,'127.0.0.1');await once(listener,'listening');
  async function join(seat,autoPong=true){
   const ws=new WebSocket('ws://127.0.0.1:'+listener.address().port+'/ws',{autoPong});
   clients.push(ws);ws.on('error',()=>{});
   const packets=[];
   ws.on('message',data=>packets.push(JSON.parse(data.toString())));
   await once(ws,'open');
   const peer=peers.at(-1);
   const send=msg=>{now+=101;ws.send(JSON.stringify(msg));};
   send({type:'join',mode:'free',accessToken:roster[seat],name:names[seat]});
   await until(()=>packets.find(p=>p.type==='waiting'||p.type==='state'));
   return {ws,peer,packets,send};
  }
  const seats=[];
  for(const i of [0,1,2,3])seats.push(await join(i,i!==0));
  const room=app.rooms.get(roomId);assert.ok(room);
  for(const [i,s] of seats.entries()){
   const p=await until(()=>s.packets.find(p=>p.event?.type==='start'));
   assert.equal(p.seat,i);assert.equal(p.game.gift,16);
  }
  let revision=0;
  async function play(seat,dice){
   nextDie=dice;
   seats[seat].send({type:'roll'});
   const rev=++revision;
   const packets=await Promise.all(seats.map(s=>until(()=>s.packets.find(p=>p.revision===rev))));
   assert.ok(packets.every(p=>p.roomId===roomId && p.event.dice===dice && p.event.actor===seat));
   return packets[seat];
  }
  for(const die of [3,6,6]){
   await play(0,die);
   for(const i of [1,2,3])await play(i,1);
  }
  const gift=await play(0,1);
  assert.equal(gift.revision,13);
  assert.equal(gift.game.players[0].pos,16);assert.equal(gift.event.outcome.reward,10);
  assert.equal(gift.game.giftUsed,true);
  async function evidence(){
   const read=async sql=>(await obs.query(sql,[roomId])).rows;
   return {
    checkpoint:await read('SELECT status,revision::int,game_state FROM game.rooms WHERE room_id=$1'),
    scores:await read('SELECT uid,kind,points FROM game.score_events WHERE game_id=$1'),
    receipts:await read('SELECT revision::int,award_events FROM game.turn_receipts WHERE room_id=$1 ORDER BY revision')
   };
  }
  const before=await evidence();
  assert.equal(before.checkpoint[0].revision,13);assert.equal(before.checkpoint[0].status,'playing');
  assert.deepEqual(before.scores,[{uid:roster[0],kind:'lucky_box',points:10}]);
  assert.deepEqual(before.receipts.map(r=>r.revision),Array.from({length:13},(_,i)=>i+1));
  assert.ok(before.receipts.slice(0,-1).every(r=>r.award_events.length===0));
  assert.deepEqual(before.receipts.at(-1).award_events,[{eventId:roomId+':lucky',
   uid:roster[0],mode:'free',kind:'lucky_box',points:10}]);
  const healthyTick=async()=>{
   const pong=seats.slice(1).map(s=>once(s.peer,'pong'));
   tick();await Promise.all(pong);
  };
  const ping=once(seats[0].ws,'ping');
  await healthyTick();await ping;
  assert.equal(seats[0].ws.readyState,WebSocket.OPEN);
  const closed=once(seats[0].peer,'close');
  await healthyTick();await closed;
  assert.equal(app.clients.size,3);assert.equal(room.seats[0].ws,null);
  const reconnect=await join(0);
  const resumed=reconnect.packets.find(p=>p.event?.type==='resume');
  assert.ok(resumed);
  assert.equal(resumed.seat,0);assert.equal(resumed.revision,13);assert.equal(resumed.roomId,roomId);
  assert.equal(resumed.game.players[0].score,10);assert.equal(resumed.game.giftUsed,true);
  assert.deepEqual(resumed.game,before.checkpoint[0].game_state);
  assert.deepEqual(await evidence(),before,'heartbeat and resume must not write a turn or reward');
  assert.deepEqual(errors,[]);
 });
