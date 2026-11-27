'use strict';
// First build the disposable item candidate with qa/item-win-lab/build.py.
// LUCKY_ITEM_LAB_OUT and LUCKY_PG17_BIN must be absolute local paths.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const net=require('node:net'),{spawn,spawnSync}=require('node:child_process');
const {randomBytes,createHash}=require('node:crypto');
const {setTimeout:sleep}=require('node:timers/promises');
const bin=process.env.LUCKY_PG17_BIN;
const database='lucky_qa_item_win',login='lucky_game_server_login',observer='fixture_item_observer';
const uuid=n=>'aaaaaaaa-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=uuid(8),player=uuid(1),opponent=uuid(2);
const scenarios=[
 {roomId:uuid(9),kind:'double',dice:[1,1,6,1,6],position:88,win:20},
 {roomId:uuid(10),kind:'ordinary',dice:[1],position:99,win:10},
 {roomId:uuid(11),kind:'deny',dice:[1],position:99,win:0},
];
const jsonSql=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
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

test('PG17 item candidate: fenced store commits box and doubled win to the v12 dialog',
 {skip:bin===undefined,timeout:30000},async t=>{
  const out=process.env.LUCKY_ITEM_LAB_OUT;
  assert.ok(path.isAbsolute(bin) && out && path.isAbsolute(out),'set both absolute fixture paths');
  const {Client,Pool}=require(process.env.LUCKY_PG17_DRIVER||'pg');
  const app=path.join(out,'railway-runtime/backend/railway');
  const load=name=>fs.readFile(path.join(app,name),'utf8');
  const Rules=require(path.join(app,'multi-board-rules.cjs'));
  const {eligibleGiftTiles,getBoard}=require(path.join(app,'board-maps.cjs'));
  const {requireRuleTransition}=require(path.join(app,'rule-transition-guard.cjs'));
  const {createRoomLeaseStore}=require(path.join(app,'../supabase/room-lease-store.cjs'));
  const source=await load('secure-server.cjs');
  const html=await load('public/index.html'),baseline=await fs.readFile(path.join(out,'baseline/backend/railway/public/index.html'),'utf8');
  const hash=s=>createHash('sha256').update(s).digest('hex');
  const skin=s=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*/gi,'');
  assert.equal(hash(baseline),'2f3e23aeb338c202a198b54aca4f7b30006ad2472aebc0a6aad47c9daeedef97');
  assert.equal(hash(skin(html)),hash(skin(baseline)),'UI skin changes are out of scope');
  const controller=section(source,'function verifiedRoomSnapshot','function takeOut')+
   section(source,'async function advance','// Readiness reports');
  const dialog=section(html,'function showResult(', '\nfunction ')+
   section(html,'function onlineWinPoints','async function onlineConnect')+
   section(html,"$('rollDice').addEventListener('click',e=>","$('restartGame').addEventListener");
  const port=await portOnLoopback(),root=await fs.mkdtemp(path.join(os.tmpdir(),'lucky-item-win-tcp-'));
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
   offline(database,await fs.readFile(path.join(__dirname,'../../backend/supabase',file),'utf8'));
  const pw=randomBytes(24).toString('hex'),viewPw=randomBytes(24).toString('hex');
  const readTables=['rooms','score_events','turn_receipts'];
  offline(database,`SET password_encryption='scram-sha-256';
    ALTER ROLE ${login} PASSWORD '${pw}';
    CREATE ROLE ${observer} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${viewPw}';
    GRANT USAGE ON SCHEMA game TO ${observer};
    ${readTables.map(x=>`GRANT SELECT ON game.${x} TO ${observer};
      CREATE POLICY fixture_read ON game.${x} FOR SELECT TO ${observer} USING(true);`).join('\n')}
    INSERT INTO auth.users VALUES ('${player}'),('${opponent}');
    INSERT INTO game.players(uid,display_name,name_key) VALUES
      ('${player}','Fixture A','fixture-a'),('${opponent}','Fixture B','fixture-b');
    ALTER TABLE game.score_events ADD CONSTRAINT fixture_deny_third_room_win
      CHECK (game_id <> '${scenarios[2].roomId}'::uuid OR kind <> 'win');`);
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
  const lease=createRoomLeaseStore(pool);
  const records=async roomId=>{
   const read=async sql=>(await obs.query(sql,[roomId])).rows;
   return {
    rooms:await read('SELECT status,revision::int,game_state,deadline_ms FROM game.rooms WHERE room_id=$1'),
    awards:await read('SELECT kind,points,uid,event_id FROM game.score_events WHERE game_id=$1 ORDER BY kind'),
    receipts:await read('SELECT revision::int,previous_revision::int,actor_index,roll,outcome,award_events,game_state FROM game.turn_receipts WHERE room_id=$1 ORDER BY revision')
   };
  };
  for(const c of scenarios)await t.test(c.kind,async()=>{
   const seats=[player,opponent].map((uid,index)=>({uid,index,verified:true,ws:{},roomId:c.roomId}));
   for(const s of seats)s.ws.session=s;
   const game=Rules.create(['Fixture A','Fixture B'],'vip',()=>0.50);
   assert.ok(eligibleGiftTiles(getBoard(1)).includes(89));
   game.gift=89;game.players[0].pos=c.position;
   if(c.kind==='double')game.matchItems={version:1,players:[
    {shieldRemaining:0,winMultiplier:2},{shieldRemaining:0,winMultiplier:1}]};
   const deadline=Date.now()+20000;
   await pool.query(`INSERT INTO game.rooms(room_id,mode,seats,game_state,status,deadline_ms,lease_owner,lease_epoch,lease_until)
    VALUES ($1,'vip',$2::jsonb,$3::jsonb,'playing',$4,$5,1,clock_timestamp()+interval '30 seconds')`,
    [c.roomId,JSON.stringify(seats.map(({uid})=>({uid}))),JSON.stringify(game),deadline,owner]);
   const room={id:c.roomId,seats,game,mode:'vip',leaseEpoch:1,revision:0,deadline};
   const packets=[],errors=[];
   let nextDie=0,pending;
   const deps={Rules,requireRuleTransition,store:lease,OWNER_ID:owner,rooms:new Map([[c.roomId,room]]),
    crypto:{randomInt:()=>c.dice[nextDie++],randomBytes:()=>Buffer.alloc(4)},TURN_MS:20000,
    schedule(){},console:{error:(...args)=>errors.push(args.join(' '))},clearTimeout(){},
    send(ws,packet){packets.push(JSON.parse(JSON.stringify(packet)));},
    haltRoom(r,why){r.halted=why;}};
   const handle=Function(...Object.keys(deps),controller+'\nreturn handle;')(...Object.values(deps));
   const nodes=new Map(),$=id=>{
    if(!nodes.has(id))nodes.set(id,Object.assign(new EventTarget(),{hidden:true,focus(){}}));
    return nodes.get(id);
   };
   const noop=()=>{};
   const ui={$,document:{},onlineActive:true,localGame:null,state:{},stopClock:noop,
    luckySeenRoomBoard:null,luckyBoardLayout:g=>g.board,luckyRenderBoardArt:noop,renderBoard:noop,
    refreshLocal:noop,onlineShowControls:noop,onlineClock:noop,navigate:noop,toast:noop,
    onlineSend(message){assert.deepEqual(message,{type:'roll'});pending=handle(seats[room.game.current].ws,message);}};
   const receive=Function(...Object.keys(ui),
    'let onlineSeat, onlineRoomId, onlineDeadline,resultPreviousFocus,resultVisible;\n'+dialog+'\nreturn onlineApplyMessage;')(...Object.values(ui));
   for(let n=0;n<c.dice.length;n++){
    const by=room.game.current;
    if(by===0){$('rollDice').dispatchEvent(new Event('click'));await pending;}
    else await handle(seats[by].ws,{type:'roll'});
    if(!c.win)break;
    assert.equal(room.revision,n+1);
    const packet=packets.at(-2); // player's broadcast; the opponent also saw this revision
    assert.equal(packet.revision,n+1);
    assert.equal(Object.hasOwn(packet.game,'matchItems'),false);
    receive(packet);
    if(c.kind==='double'&&n===0){
     assert.equal($('resultMessage').textContent,'Fixture A คุณได้รับคะแนนจาก Lucky Box +10 คะแนน');
     const first=await records(c.roomId);
     assert.equal(first.rooms[0].status,'playing');
     assert.deepEqual(first.awards.map(x=>[x.kind,x.points]),[['lucky_box',10]]);
     assert.deepEqual(first.receipts.map(x=>x.award_events.map(a=>a.kind)),[['lucky_box']]);
    }
   }
   const result=await records(c.roomId);
   assert.equal(nextDie,c.dice.length);
   if(!c.win){
    assert.equal(room.halted,'UNCONFIRMED_TURN_COMMIT');
    assert.match(errors.join(';'),/23514/);
    assert.deepEqual(packets,[]);
    assert.equal($('gameResultOverlay').hidden,true);
    assert.deepEqual(result,{rooms:[{status:'playing',revision:0,game_state:game,deadline_ms:String(deadline)}],awards:[],receipts:[]});
    return;
   }
   assert.equal(errors.length,0);
   assert.equal(packets.length,c.dice.length*2);
   const final=packets.at(-2),finalReceipt=result.receipts.at(-1),stored=result.rooms[0];
   assert.deepEqual(final.event.committedWin,{roomId:c.roomId,revision:c.dice.length,seat:0,points:c.win});
   assert.equal(final.game.players[0].pos,100);
   assert.equal($('gameResultOverlay').hidden,false);
   assert.equal($('resultMessage').textContent,'Fixture A คุณชนะได้รับคะแนน +'+c.win+' คะแนน');
   assert.equal(stored.status,'finished');assert.equal(stored.deadline_ms,null);
   assert.equal(stored.revision,c.dice.length);
   assert.equal(stored.game_state.players[0].score,c.win+(c.kind==='double'?10:0));
   const expectedAwards=c.kind==='double'?[['lucky_box',10],['win',20]]:[['win',10]];
   assert.deepEqual(result.awards.map(x=>[x.kind,x.points]),expectedAwards);
   assert.ok(result.awards.every(x=>x.uid===player));
   assert.deepEqual(result.receipts.map(x=>x.revision),c.dice.map((_,i)=>i+1));
   assert.deepEqual(finalReceipt.award_events.map(a=>[a.kind,a.points,a.uid]),[['win',c.win,player]]);
   assert.deepEqual(finalReceipt.game_state,stored.game_state);
   await handle(seats[0].ws,{type:'roll'});
   assert.deepEqual(await records(c.roomId),result);
  });
 });
