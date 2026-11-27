'use strict';

// QA only: launch no network/socket. Exercise real candidate Node read-path
// SQL against a newly initialized, disposable PostgreSQL 17 cluster.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createIsolatedTestLeaderboard} = require('../backend/railway/isolated-test-leaderboard.cjs');

const sunday = Date.parse('2030-03-03T00:00:00+07:00');
const uid = n => 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(n).padStart(12,'0');
const room = n => 'bbbbbbbb-bbbb-4bbb-8bbb-' + String(n).padStart(12,'0');
const literal = x => {
  if (Number.isSafeInteger(x)) return String(x);
  assert.match(x,/^[a-z0-9-]+$/i);
  return "'" + x + "'";
};

test('scoped PG17 leaderboard ranks only exact test pairs and fails closed',
  {skip:process.env.LUCKY_PG17_BIN === undefined}, async t => {
  const variable = process.env.LUCKY_PG17_BIN;
  assert.ok(path.isAbsolute(variable), 'set LUCKY_PG17_BIN to the absolute local PG17 binaries directory');
  const bin = fs.realpathSync(variable);
  const env = {PATH:'/usr/bin:/bin', LC_ALL:'C'};
  function command(binary,args,input) {
    const result=spawnSync(path.join(bin,binary),args,{input,env,encoding:'utf8',timeout:30000});
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stderr);
    assert.doesNotMatch(result.stderr,/\b(?:ERROR|FATAL|PANIC):/);
    return result.stdout;
  }
  assert.match(command('postgres',['--version']),/^postgres \(PostgreSQL\) 17\./);
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'lucky-scoped-rank-pg17-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const data = path.join(root,'data'), db = 'lucky_qa_rank';
  command('initdb',['-D',data,'-A','reject','--no-locale','-E','UTF8']);
  function single(sql,database=db) {
    return command('postgres',['--single','-D',data,'-j',database],
      sql.trim().replace(/\n[ \t]*\n/g,'\n')+'\n\n');
  }
  single('CREATE DATABASE '+db,'postgres');
  // Avoid assigning reserved built-in OIDs to fixture roles in standalone mode.
  single("DO $$ BEGIN EXECUTE (SELECT 'CREATE TYPE oid_pad AS ENUM (' || string_agg(quote_literal(n::text), ',') || ')' FROM generate_series(1,3000) n); END $$; DROP TYPE oid_pad;");
  single('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);');
  for(const migration of ['001_game_private_schema.sql','002_room_lease_draft.sql','003_turn_receipts_draft.sql',
    '004_railway_runtime_access_PROPOSAL.sql','005_restricted_login_no_password.sql'])
    single(fs.readFileSync(path.join(__dirname,'../backend/supabase',migration),'utf8'));
  single(fs.readFileSync(path.join(__dirname,'staging-leaderboard/isolated-test-score-reader.PROPOSAL.sql'),'utf8'));

  for(const n of [1,2,3]) {
    single('INSERT INTO auth.users VALUES('+literal(uid(n))+'); INSERT INTO game.players(uid,display_name,name_key) VALUES ('+
      [uid(n),'private-fixture-'+n,'synthetic-key-'+n].map(literal).join(',')+');');
    single('INSERT INTO game.rooms(room_id,mode,seats,game_state,status) VALUES ('+literal(room(n))+",'free','[]','{}','finished');");
  }
  for(const n of [1,2]) single('INSERT INTO lucky_rank_qa.allowed_score_pairs VALUES ('+
    literal(room(n))+','+literal(uid(n))+",'free');");
  const fixtures = [
    [1,1,7,'free',sunday], [1,1,3,'free',sunday+1], [2,2,8,'free',sunday],
    [3,1,200,'free',sunday], [1,3,300,'free',sunday],
    [1,2,400,'free',sunday], [2,1,500,'free',sunday],
    [1,1,600,'vip',sunday], [1,1,700,'free',sunday-1], [2,2,800,'free',sunday+7*86_400_000],
  ];
  single(fixtures.map(([r,n,score,mode,epoch],index)=>
    'INSERT INTO game.score_events(event_id,uid,mode,game_id,kind,points,created_at) VALUES ('+
      [literal('event-'+index),literal(uid(n)),literal(mode),literal(room(r)),"'admin'",score,
        'to_timestamp('+epoch+'::double precision/1000)'].join(',')+');').join('\n'));
  single(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON m.member=r.oid
               WHERE r.rolname IN ('lucky_qa_rank_reader','lucky_qa_rank_owner'))
      OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('lucky_qa_rank_reader','lucky_qa_rank_owner')
                 AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication))
      OR has_any_column_privilege('lucky_qa_rank_reader','game.score_events','SELECT')
      OR has_any_column_privilege('lucky_qa_rank_reader','game.players','SELECT')
      OR has_any_column_privilege('lucky_qa_rank_reader','game.leaderboard_archives','SELECT')
      OR has_any_column_privilege('lucky_qa_rank_reader','lucky_rank_qa.allowed_score_pairs','SELECT,INSERT,UPDATE')
      OR has_table_privilege('lucky_qa_rank_reader','lucky_rank_qa.allowed_score_pairs','DELETE,TRUNCATE')
      OR has_any_column_privilege('lucky_qa_rank_owner','game.players','SELECT')
      OR has_table_privilege('lucky_qa_rank_owner','lucky_rank_qa.allowed_score_pairs','DELETE,TRUNCATE')
      OR has_any_column_privilege('lucky_qa_rank_owner','lucky_rank_qa.allowed_score_pairs','INSERT,UPDATE')
      OR has_function_privilege('lucky_game_server_login','lucky_rank_qa.read_current(text,bigint,bigint,integer)','EXECUTE')
      OR has_function_privilege('authenticated','lucky_rank_qa.read_current(text,bigint,bigint,integer)','EXECUTE')
    THEN RAISE EXCEPTION 'Unexpected ranking privilege'; END IF;
    END $$;`);
  // Verify the definer itself has scoped row visibility and cannot see discarded pairs.
  single(`SET SESSION AUTHORIZATION lucky_qa_rank_owner;
    DO $$ BEGIN
      IF NOT row_security_active('game.score_events')
        OR (SELECT count(points) FROM game.score_events) <> 5
      THEN RAISE EXCEPTION 'Rank owner missing pair-only RLS'; END IF;
    END $$;`);

  let reads=0, fallbacks=0;
  const scopedPool={async query(sql,args) {
    assert.equal(sql,'SELECT score::text AS score FROM lucky_rank_qa.read_current($1::text,$2::bigint,$3::bigint,$4::integer) WITH ORDINALITY ORDER BY ordinality');
    assert.ok([1,50].includes(args[3]));
    const adapted=sql.replace(/\$(\d+)/g,(_,i)=>literal(args[Number(i)-1]));
    reads++;
    const stdout=single("SET SESSION AUTHORIZATION lucky_qa_rank_reader; BEGIN READ ONLY; WITH got AS MATERIALIZED ("+adapted+
      ") SELECT 'SCORES:' || coalesce(json_agg(score)::text,'[]') AS payload FROM got; COMMIT;");
    const output=stdout.split('\n').find(line=>line.includes('payload = "SCORES:'));
    assert.ok(output,'missing PostgreSQL rows');
    return {rows:JSON.parse(output.slice(output.indexOf('SCORES:')+7,output.lastIndexOf('"'))).map(score=>({score}))};
  }};
  const options={
    clock:()=>sunday, limit:1, scopedPool,
    verifyIdentity:async ({accessToken})=>['free','vip'].includes(accessToken)?{uid:uid(accessToken==='vip'?1:2)}:null,
    store:{
      async leaderboard(){fallbacks++; throw Error('unscoped ranking forbidden');},
      async getVipEntitlement(uidValue) {
        return uidValue === uid(1) ? {uid:uidValue,tier:'vip',status:'active',expiresAtMs:Date.now()+60_000} : null;
      }
    }
  };
  const request=async (handler,mode,token)=>{
    let reply;
    await handler({method:'GET',url:'/leaderboard?mode='+mode,headers:token?{authorization:'Bearer '+token}:{}},{
      writeHead(status,headers){assert.equal(headers['Cache-Control'],'private, no-store');reply={status};},
      end(data){assert.doesNotMatch(data,/private-fixture|aaaaaaaa-aaaa/);reply.body=JSON.parse(data);}
    });
    return reply;
  };
  const handler=createIsolatedTestLeaderboard(options);
  assert.equal((await request(handler,'free')).status,401);
  assert.equal((await request(handler,'vip','free')).status,403);
  assert.equal(reads,0);
  assert.deepEqual(await request(handler,'free','free'),{status:200,body:{rows:[['🥇','👤','ผู้เล่น','10']]}});
  assert.deepEqual(await request(handler,'vip','vip'),{status:200,body:{rows:[]}});
  assert.deepEqual(await request(createIsolatedTestLeaderboard({...options,limit:50}),'free','free'),
    {status:200,body:{rows:[['🥇','👤','ผู้เล่น','10'],['🥈','👤','ผู้เล่น','8']]}});
  assert.equal(reads,3);
  assert.deepEqual(await request(createIsolatedTestLeaderboard({...options,scopedPool:undefined}),'free','free'),
    {status:503,body:{error:'unavailable'}});
  assert.deepEqual(await request(createIsolatedTestLeaderboard({...options,
    scopedPool:{async query(){throw Error('fixture connection failed');}}}),'free','free'),
    {status:503,body:{error:'unavailable'}});
  assert.equal(fallbacks,0);
});
