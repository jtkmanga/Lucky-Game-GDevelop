'use strict';
// Manual offline QA: node qa/lucky-box-postgres17.cjs /absolute/pg17/bin
// Single-user PostgreSQL via stdio; never starts a network server or uses a DSN.
// Exercises pinned v12 turn, rule guard, store SQL, RLS and persisted rows.
// The small stdio adapter substitutes pg parameter binding/transport, the room
// is synthetic, and broadcast hooks are recorded, not sent over WebSockets.
// This does not cover production connection or concurrent multi-session behavior.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const {once}=require('node:events');
const pins={
 'backend/railway/secure-server.cjs':'1d2e3bfb4b1b486c8584d70ade1389ac9341e4e4',
 'backend/railway/rule-transition-guard.cjs':'84771f762f86b121682a1dc1b0eb63cb68d1dec7',
 'backend/railway/multi-board-rules.cjs':'c68f9c164501c2431a388c8ae661596640d9411c',
 'backend/railway/rules.js':'e5436edac8fe597b726a166e7fcd08df09a73bd8',
 'backend/railway/board-maps.cjs':'ab28689023f34192e8291dc54a3a2c6fea5f80c9',
 'backend/railway/board-definitions.json':'76175a8c291e3315a0bf857755973b640cead70d',
 'backend/supabase/room-lease-store.cjs':'c52759f1421ff2aa68fc42e3c2dbadfd72b67c6f',
 'backend/supabase/001_game_private_schema.sql':'b7439dfb87b1ed4d90d0d9d2a63a5749ee5070f6',
 'backend/supabase/002_room_lease_draft.sql':'1e0f66daf316c839ba7c92acf83bd8602802fedf',
 'backend/supabase/003_turn_receipts_draft.sql':'bf63b6ec4c7ed916833d8a886c59bf8d199ea0af',
 'backend/supabase/004_railway_runtime_access_PROPOSAL.sql':'1a50dd0da9b2ac2e8a2399d5cbac77dab2c141b7',
 'backend/supabase/005_restricted_login_no_password.sql':'baa14f19ae0b2d912b6ccd96d432fdcc5787c9a7'
};
const root=path.resolve(__dirname,'..');
function source(file) {
 const bytes=fs.readFileSync(path.join(root,file));
 assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),pins[file],file);
 return bytes.toString('utf8');
}
for(const file of Object.keys(pins))source(file);
const Rules=require('../backend/railway/multi-board-rules.cjs');
const {requireRuleTransition}=require('../backend/railway/rule-transition-guard.cjs');
const {createRoomLeaseStore}=require('../backend/supabase/room-lease-store.cjs');
const int=n=>{assert.ok(Number.isSafeInteger(n));return String(n);};
function literal(v){
 if(v===null)return 'NULL';
 return typeof v==='number'?int(v):"'" + String(v).replaceAll("'","''") + "'";
}
const env={PATH:'/usr/bin:/bin',LC_ALL:'C',TZ:'UTC'};
function tool(bin,args) {
 const result=spawnSync(bin,args,{encoding:'utf8',timeout:20000,env});
 if(result.status!==0)throw Error((result.error||result.stderr||'PG tool failed').toString());
 return result.stdout;
}
function openBackend(postgres,data){
 // stderr is merged so SQL errors arrive before their next backend prompt.
 const proc=spawn('/bin/sh',['-c','exec "$@" 2>&1','sh',postgres,'--single','-D',data,'-j','postgres'],{env});
 const done=once(proc,'close');
 let wait, out='', failure=null;
 function reject(error){failure=error;wait?.reject(error);wait=null;}
 proc.once('error',reject);
 proc.once('close',code=>{if(wait||code!==0)reject(Error('PG backend closed: '+code));});
 proc.stdout.setEncoding('utf8');
 proc.stdout.on('data',chunk=>{
  out+=chunk;
  // The sentinel SELECT forces output for statements with no result rows.
  const end=out.indexOf('qa_stdio_marker = "314159"');
  if(end<0)return;
  const prompt=out.indexOf('backend> ',end);
  if(prompt<0)return;
  const answer=out.slice(0,prompt);out=out.slice(prompt+'backend> '.length);
  const req=wait;wait=null;
  if(/\b(?:ERROR|FATAL|PANIC):/.test(answer))req?.reject(Error(answer));
  else req?.resolve(answer);
 });
 function response(sql=''){
  if(failure)return Promise.reject(failure);
  assert.ok(!wait,'single database session; no parallel requests');
  const pending=new Promise((resolve,reject)=>{wait={resolve,reject};});
  const input=sql.trim().replace(/(?:\n[\t ]*){2,}/g,'\n');
  proc.stdin.write((input?input+'\n\n':'')+'SELECT 314159 AS qa_stdio_marker;\n\n');
  return pending;
 }
 return {
  ready:response(),
  send:response,
  async close(force=false){
   if(force)proc.kill('SIGKILL');
   else proc.stdin.end();
   return (await done)[0];
  }
 };
}
const uid=n=>'abababab-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=uid(99), normalRoom=uid(10), failRoom=uid(11);
async function main(){
 assert.equal(process.argv.length,3,'expected an explicit PostgreSQL 17 bin directory');
 assert.ok(path.isAbsolute(process.argv[2]),'absolute path required');
 const bin=fs.realpathSync(process.argv[2]), pg=path.join(bin,'postgres');
 const version=tool(pg,['--version']).trim();
 assert.match(version,/^postgres \(PostgreSQL\) 17\./);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lucky-box-pg17-'));
 const data=path.join(temp,'data');
 let backend, aborted=true;
 const watch=setTimeout(()=>backend?.close(true).catch(()=>{}),40000);
 try{
  tool(path.join(bin,'initdb'),['-D',data,'-A','reject','--no-locale','-E','UTF8']);
  backend=openBackend(pg,data);
  await backend.ready;
  const raw=sql=>backend.send(sql);
  const history=[];
  async function query(sql,values=[]){
   const rendered=sql.replace(/\$(\d+)/g,(_,n)=>{
    assert.ok(Number(n)>0&&Number(n)<=values.length);
    return literal(values[Number(n)-1]);
   });
   const name=sql.trim().match(/^(UPDATE|INSERT INTO game\.score_events|INSERT INTO game\.turn_receipts|BEGIN|COMMIT|ROLLBACK|SELECT)/)?.[1];
   assert.ok(name,'unsupported fixture query');
   if(['BEGIN','COMMIT','ROLLBACK'].includes(name)){
    await raw(rendered+';');history.push([name,0]);return {rowCount:0,rows:[]};
   }
   const answer=await raw(`WITH qa_rows AS (${rendered})
     SELECT encode(convert_to(COALESCE(jsonb_agg(to_jsonb(qa_rows)),'[]'::jsonb)::text,'UTF8'),'hex') AS qa_json FROM qa_rows;`);
   const match=answer.match(/qa_json = "([0-9a-f]+)"/);
   assert.ok(match,'PG row response missing');
   const rows=JSON.parse(Buffer.from(match[1],'hex').toString());
   history.push([name,rows.length]);return {rowCount:rows.length,rows};
  }
  const [{fresh,no_socket,no_game}]=(await query(`SELECT current_database()='postgres' AS fresh,
    inet_server_addr() IS NULL AS no_socket,to_regnamespace('game') IS NULL AS no_game`)).rows;
  assert.ok(fresh&&no_socket&&no_game);
  await raw('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);');
  // Standalone bootstrap can issue low OIDs treated as catalog objects. Ensure
  // disposable application tables start at the normal user-object boundary.
  await raw(`DO $oid$ DECLARE oid_now pg_catalog.oid; n int := 0; BEGIN LOOP
    CREATE TABLE public.qa_oid_probe(id integer);
    oid_now := 'public.qa_oid_probe'::regclass::oid;
    DROP TABLE public.qa_oid_probe;
    EXIT WHEN oid_now >= 16384;
    n := n+1; IF n > 10000 THEN RAISE EXCEPTION 'Expected normal object OID'; END IF;
   END LOOP; END $oid$;`);
  for(const file of Object.keys(pins).filter(file=>file.endsWith('.sql')))await raw(source(file));
  const names=['QA Alice','QA Bob','QA Carol','QA Dan'], seats=names.map((name,i)=>({name,uid:uid(i+1)}));
  const first=Rules.create(names,'free',()=>0.25,1);
  first.gift=16;first.players[0].pos=15;first.players[1].pos=15;
  assert.equal(Rules.assertRoomBoard(first).id,1);
  for(const seat of seats){
   await raw(`INSERT INTO auth.users VALUES (${literal(seat.uid)});
     INSERT INTO game.players(uid,display_name,name_key) VALUES(${literal(seat.uid)},${literal(seat.name)},${literal(seat.name.toLowerCase())});`);
  }
  const oldDeadline=Date.now()+60000;
  for(const id of [normalRoom,failRoom]){
   await raw(`INSERT INTO game.rooms(room_id,mode,seats,game_state,deadline_ms,revision,status,lease_owner,lease_epoch,lease_until)
   VALUES(${literal(id)},'free',${literal(JSON.stringify(seats))},${literal(JSON.stringify(first))},${int(oldDeadline)},0,'playing',${literal(owner)},1,clock_timestamp()+interval '5 minutes');`);
  }
  await raw(`CREATE FUNCTION public.qa_skip_one_receipt() RETURNS trigger LANGUAGE plpgsql AS $qa$
    BEGIN RETURN NULL; END $qa$;
    CREATE TRIGGER qa_skip_one_receipt BEFORE INSERT ON game.turn_receipts FOR EACH ROW
    WHEN (NEW.room_id = ${literal(failRoom)}::uuid) EXECUTE FUNCTION public.qa_skip_one_receipt();`);
  await raw('SET ROLE lucky_game_runtime;');
  const [{enforced}]=(await query(`SELECT row_security_active('game.rooms') AND row_security_active('game.score_events')
    AND row_security_active('game.turn_receipts') AS enforced`)).rows;
  assert.equal(enforced,true);
  const client={query,release(discard){assert.equal(discard,false);}};
  const store=createRoomLeaseStore({query,connect:async()=>client});
  const pending=[], events=[], errors=[];
  const server=source('backend/railway/secure-server.cjs');
  const start=server.indexOf('async function advance(room,roll)'), end=server.indexOf('async function handle',start);
  assert.ok(start>=0&&end>start);
  const bindings={Rules,requireRuleTransition,OWNER_ID:owner,TURN_MS:20000,pilot:null,
    crypto:{randomBytes(n){return Buffer.alloc(n);}},schedule(){},
    transmit(...args){events.push(args);},
    haltRoom(room){room.halted=true;},console:{error(...args){errors.push(args);}},
    store:{commitFencedTurn(request){pending.push(request);return store.commitFencedTurn(request);}}};
  const advance=Function(...Object.keys(bindings),server.slice(start,end)+'\nreturn advance;')(...Object.values(bindings));
  const room=id=>({id,mode:'free',game:structuredClone(first),seats,leaseEpoch:1,revision:0,deadline:oldDeadline});
  const chosen=room(normalRoom), fault=room(failRoom);
  function expectOps(from,expected){assert.deepEqual(history.slice(from),expected);}
  let mark=history.length;
  await advance(chosen,1);
  expectOps(mark,[['BEGIN',0],['UPDATE',1],['INSERT INTO game.score_events',1],['INSERT INTO game.turn_receipts',1],['COMMIT',0]]);
  assert.equal(chosen.revision,1);assert.equal(events[0][1].outcome.reward,10);
  mark=history.length;
  await assert.rejects(store.commitFencedTurn(pending[0]),/LEASE_LOST_OR_STALE_REVISION/);
  expectOps(mark,[['BEGIN',0],['UPDATE',0],['ROLLBACK',0]]);
  mark=history.length;
  await advance(chosen,1);
  expectOps(mark,[['BEGIN',0],['UPDATE',1],['INSERT INTO game.turn_receipts',1],['COMMIT',0]]);
  assert.equal(chosen.revision,2);assert.equal(events[1][1].outcome.reward,0);
  mark=history.length;
  await advance(fault,1);
  expectOps(mark,[['BEGIN',0],['UPDATE',1],['INSERT INTO game.score_events',1],['INSERT INTO game.turn_receipts',0],['ROLLBACK',0]]);
  assert.deepEqual(errors,[['Turn commit failed','DUPLICATE_TURN_RECEIPT']]);
  assert.equal(events.length,2);assert.equal(fault.halted,true);assert.equal(fault.revision,0);
  const rows=(sql,id)=>query(sql,[id]).then(x=>x.rows);
  const states=id=>rows('SELECT revision,game_state,deadline_ms FROM game.rooms WHERE room_id=$1::uuid',id);
  const scores=id=>rows('SELECT event_id,uid,kind,points FROM game.score_events WHERE game_id=$1::uuid',id);
  const receipts=id=>rows('SELECT revision,previous_revision,actor_index,outcome,game_state,award_events FROM game.turn_receipts WHERE room_id=$1::uuid ORDER BY revision',id);
  assert.deepEqual(await scores(normalRoom),[{event_id:normalRoom+':lucky',uid:seats[0].uid,kind:'lucky_box',points:10}]);
  const durable=await receipts(normalRoom);
  assert.deepEqual(durable.map(r=>[r.revision,r.previous_revision,r.actor_index,r.outcome.reward]),[[1,0,0,10],[2,1,1,0]]);
  assert.equal(durable[0].game_state.giftUsed,true);assert.equal(durable[0].game_state.players[0].score,10);
  assert.deepEqual(durable[0].award_events,[{eventId:normalRoom+':lucky',uid:seats[0].uid,mode:'free',kind:'lucky_box',points:10}]);
  assert.deepEqual(durable[1].award_events,[]);
  assert.deepEqual(await states(normalRoom),[{revision:2,game_state:durable[1].game_state,deadline_ms:chosen.deadline}]);
  assert.deepEqual(await states(failRoom),[{revision:0,game_state:first,deadline_ms:oldDeadline}]);
  assert.deepEqual(await scores(failRoom),[]);assert.deepEqual(await receipts(failRoom),[]);
  assert.equal(await backend.close(),0);backend=null;
  assert.equal(fs.existsSync(path.join(data,'postmaster.pid')),false);
  aborted=false;
  console.log(version+': PASS (RLS, earned/once, stale replay, spent box, rollback after score insert)');
 }finally{
  clearTimeout(watch);
  if(backend)await backend.close(aborted);
  fs.rmSync(temp,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
