'use strict';

// QA only: launch no network/socket. Exercise real candidate Node read-path
// SQL against a newly initialized, disposable PostgreSQL 17 cluster.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createLeaderboardHandler} = require('../backend/railway/leaderboard-http-handler.cjs');

const sunday = Date.parse('2030-03-03T00:00:00+07:00');
const day = 86_400_000;
const uid = n => 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(n).padStart(12,'0');
const room = n => 'bbbbbbbb-bbbb-4bbb-8bbb-' + String(n).padStart(12,'0');
const literal = x => {
  if (Number.isSafeInteger(x)) return String(x);
  assert.match(x,/^[a-z0-9-]+$/i);
  return "'" + x + "'";
};
const fixtures = [
  ['free',1,sunday-7*day-1,300], ['free',1,sunday-1,7],
  ['free',1,sunday,10], ['free',1,sunday+1,3], ['free',2,sunday,6],
  ['free',1,sunday+7*day,300],
  ['vip',1,sunday-day-1,300], ['vip',1,sunday-1,51],
  ['vip',1,sunday,61], ['vip',2,sunday+1,41], ['vip',1,sunday+day,71],
];

test('real isolated PG17 current v12 leaderboard respects Bangkok and access boundaries',
  {skip:process.env.LUCKY_PG17_BIN === undefined}, async t => {
  const variable = process.env.LUCKY_PG17_BIN;
  assert.ok(variable && path.isAbsolute(variable), 'set LUCKY_PG17_BIN to the absolute local PG17 binaries directory');
  const bin = fs.realpathSync(variable);
  const env = {PATH:'/usr/bin:/bin',LC_ALL:'C'};
  const schema = path.join(__dirname,'../backend/supabase');
  function command(binary,args,input) {
    const r=spawnSync(path.join(bin,binary),args,{input,env,encoding:'utf8',timeout:30000});
    assert.ifError(r.error);
    assert.equal(r.status,0,r.stderr);
    assert.doesNotMatch(r.stderr,/\b(?:ERROR|FATAL|PANIC):/);
    return r.stdout;
  }
  assert.match(command('postgres',['--version']),/^postgres \(PostgreSQL\) 17\./);
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'lucky-current-board-pg17-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const data = path.join(root,'data'), db='lucky_qa_current_board';
  command('initdb',['-D',data,'-A','reject','--no-locale','-E','UTF8']);
  function single(sql,database=db) {
    return command('postgres',['--single','-D',data,'-j',database],
      sql.trim().replace(/\n[ \t]*\n/g,'\n')+'\n\n');
  }
  single('CREATE DATABASE '+db,'postgres');
  // Standalone initialization can assign reserved object OIDs that bypass RLS.
  single("DO $$ BEGIN EXECUTE (SELECT 'CREATE TYPE oid_pad AS ENUM (' || string_agg(quote_literal(n::text), ',') || ')' FROM generate_series(1,3000) n); END $$; DROP TYPE oid_pad;");
  single('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);');
  for (const migration of [
    '001_game_private_schema.sql','002_room_lease_draft.sql','003_turn_receipts_draft.sql',
    '004_railway_runtime_access_PROPOSAL.sql','005_restricted_login_no_password.sql'
  ]) single(fs.readFileSync(path.join(schema,migration),'utf8'));

  for (const n of [1,2]) {
    single('INSERT INTO auth.users VALUES('+literal(uid(n))+'); INSERT INTO game.players(uid,display_name,name_key) VALUES ('+
      [uid(n),'private-fixture-name-'+n,'fixture-key-'+n].map(literal).join(',')+');');
  }
  single("INSERT INTO game.vip_entitlements(uid,status,expires_at,grant_ref) VALUES("+
    literal(uid(1))+",'active','2031-01-01T00:00:00Z','lab-grant');");
  single(fixtures.map(([mode,n,epoch,score],index) => {
    const id=literal(room(index+1));
    return "INSERT INTO game.rooms(room_id,mode,seats,game_state,status) VALUES ("+id+','+literal(mode)+",'[]','{}','finished');"+
      "INSERT INTO game.score_events(event_id,uid,mode,game_id,kind,points,created_at) VALUES ("+
      [literal('event-'+index),literal(uid(n)),literal(mode),id,"'admin'",score,'to_timestamp('+epoch+'::double precision/1000)'].join(',')+');';
  }).join('\n'));

  // Verify effective RLS before exercising the real SQL. All readback through
  // the restricted login is marked read-only regardless of its writer grants.
  const role = 'SET SESSION AUTHORIZATION lucky_game_server_login; BEGIN READ ONLY;';
  single(role+"DO $$ BEGIN IF current_user <> 'lucky_game_server_login' OR session_user <> current_user "+
     "OR NOT row_security_active('game.players') OR NOT row_security_active('game.score_events') "+
     "OR NOT row_security_active('game.vip_entitlements') THEN RAISE EXCEPTION 'readback denied'; END IF; END $$; COMMIT;");
  const calls=[];
  class LocalReadOnlyPool {
    async query(sql,values) {
      assert.match(sql,/^SELECT /);
      const adapted=sql.replace(/\$(\d+)/g,(_,n)=>literal(values[Number(n)-1]));
      const rank=sql.includes('FROM game.players p JOIN game.score_events e');
      const lookup=sql === 'SELECT uid,status,expires_at FROM game.vip_entitlements WHERE uid=$1';
      assert.ok(rank || lookup,'accept only candidate ranking and VIP readbacks');
      calls.push({kind:rank?'rank':'vip',values});
      // Return the node-postgres shape, including BigInt score transported as text.
      const projection=rank?"json_build_object('uid',uid,'display_name',display_name,'score',score::text)":'row_to_json(got)';
      const stdout=single(role+'WITH got AS MATERIALIZED ('+adapted+") SELECT 'BOARD_ROWS:' || coalesce(json_agg("+projection+")::text,'[]') AS payload FROM got; COMMIT;");
      const output=stdout.split('\n').find(line=>line.includes('payload = "BOARD_ROWS:'));
      assert.ok(output,'missing PostgreSQL rows');
      const rows=JSON.parse(output.slice(output.indexOf('BOARD_ROWS:')+11,output.lastIndexOf('"')));
      return {rows,rowCount:rows.length};
    }
  }
  const loadModule = {exports:{}};
  const source = fs.readFileSync(path.join(schema,'game-store.cjs'),'utf8');
  new Function('module','exports','require',source)(loadModule,loadModule.exports,name=>{
    if(name==='pg')return {Pool:LocalReadOnlyPool};
    if(name==='./pg-tls-config.cjs')return {poolConnectionOptions:()=>({})};
    assert.equal(name,'./room-lease-store.cjs');
    return {pilotBinding:()=>null,createRoomLeaseStore:()=>({})};
  });
  const store=loadModule.exports.createRailwayStore('fixture-only');
  const handler=createLeaderboardHandler({store,verifyIdentity:async ({accessToken})=>
    ['a','b'].includes(accessToken)?{uid:uid(accessToken==='a'?1:2)}:null});
  t.mock.method(Date,'now',()=>sunday-1);
  const mockClock=Date.now.mock;
  const get=async (mode,token)=>{
    let reply;
    await handler({method:'GET',url:'/leaderboard?mode='+mode+'&startMs=0&endMs=1',
      headers:token?{authorization:'Bearer '+token}:{}},{
      writeHead(status,headers){assert.equal(headers['Cache-Control'],'private, no-store');reply={status};},
      end(data){assert.doesNotMatch(data,/private-fixture-name|aaaaaaaa-aaaa/);reply.body=JSON.parse(data);}
    });
    return reply;
  };
  const expected = scores=>({status:200,body:{rows:scores.map((s,i)=>
    [['🥇','🥈'][i],'👤','ผู้เล่น',String(s)])}});
  assert.equal((await get('free')).status,401);
  assert.equal(calls.length,0);
  assert.equal((await get('vip','b')).status,403);
  assert.deepEqual(calls.splice(0),[{kind:'vip',values:[uid(2)]}]);
  assert.deepEqual(await get('free','b'),expected([7]));
  assert.deepEqual(await get('vip','a'),expected([51]));
  mockClock.mockImplementation(()=>sunday);
  assert.deepEqual(await get('free','b'),expected([13,6]));
  assert.deepEqual(await get('vip','a'),expected([61,41]));
  mockClock.mockImplementation(()=>sunday+day);
  assert.deepEqual(await get('free','b'),expected([13,6]));
  assert.deepEqual(await get('vip','a'),expected([71]));
  assert.deepEqual(calls.filter(c=>c.kind==='rank').map(c=>c.values),[
    ['free',sunday-7*day,sunday,50],['vip',sunday-day,sunday,50],
    ['free',sunday,sunday+7*day,50],['vip',sunday,sunday+day,50],
    ['free',sunday,sunday+7*day,50],['vip',sunday+day,sunday+2*day,50]
  ]);
});
