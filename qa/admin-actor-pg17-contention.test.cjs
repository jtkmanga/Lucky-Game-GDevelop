'use strict';

// Isolated PG17 QA. Installation is socketless single-user; the unchanged
// proposals reject TCP installation. Only the finished synthetic fixture
// is started on loopback for concurrent SCRAM-authenticated sessions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');

const bin = process.env.LUCKY_PG17_BIN;
const database = 'lucky_qa_admin';
const opLogin = 'fixture_admin_executor';
const revLogin = 'fixture_admin_revoker';
const obsLogin = 'fixture_admin_observer';
const id = n => 'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const {port}=server.address();
  await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  return port;
}

test('PG17 Admin actor revocation and duplicate request lock ordering',
  {skip:bin === undefined, timeout:30_000}, async t => {
    assert.ok(path.isAbsolute(bin), 'use an absolute path to local PostgreSQL 17 binaries');
    const {Client}=require(process.env.LUCKY_PG17_DRIVER || 'pg');
    const port=await freePort();
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'lucky-admin-contention-'));
    const data=path.join(root,'data'), env={PATH:'/usr/bin:/bin',LC_ALL:'C'};
    const clients=[];
    let db, closed;
    t.after(async ()=>{
      // Ending all clients rolls back any transaction left by a failed case.
      await Promise.allSettled(clients.map(c=>c.end()));
      if (db?.exitCode === null && db.signalCode === null) {
        db.kill('SIGINT');
        const limit=new AbortController();
        const deadline=sleep(2000,false,{signal:limit.signal}).catch(()=>true);
        if (!await Promise.race([closed.then(()=>true),deadline])) {
          db.kill('SIGKILL'); await closed;
        }
        limit.abort();
      }
      await fs.rm(root,{recursive:true,force:true});
    });
    function run(name,args,input) {
      const out=spawnSync(path.join(bin,name),args,{input,env,encoding:'utf8',timeout:10_000});
      assert.ifError(out.error);
      assert.equal(out.status,0,out.stderr);
      assert.doesNotMatch(out.stderr,/\b(?:ERROR|FATAL|PANIC):/);
      return out.stdout;
    }
    assert.match(run('postgres',['--version']),/^postgres \(PostgreSQL\) 17\./);
    run('initdb',['-D',data,'-A','reject','-U','fixture_bootstrap','--no-locale','-E','UTF8']);
    const offline=(name,sql)=>run('postgres',['--single','-D',data,'-j',name],
      sql.trim().replace(/\n[ \t]*\n/g,'\n')+'\n\n');
    offline('postgres','CREATE DATABASE '+database);
    const backend=path.join(__dirname,'../backend');
    const readFile=rel=>fs.readFile(path.join(backend,rel),'utf8');
    // Single-user initialization needs ordinary object OIDs for RLS checks.
    offline(database,`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      DO $$ DECLARE n int; probe oid; BEGIN
        FOR n IN 1..10000 LOOP
          CREATE TABLE public.oid_probe (id integer);
          probe := 'public.oid_probe'::regclass::oid;
          DROP TABLE public.oid_probe;
          IF probe >= 16384 THEN RETURN; END IF;
        END LOOP;
        RAISE EXCEPTION 'Expected ordinary PostgreSQL object OIDs';
      END $$;`);
    for (const name of ['001_game_private_schema.sql','002_room_lease_draft.sql','003_turn_receipts_draft.sql',
      '004_railway_runtime_access_PROPOSAL.sql','005_restricted_login_no_password.sql'])
      offline(database,await readFile('supabase/'+name));
    for (const stage of ['roles','operator','actor'])
      offline(database,"SET lucky.disposable_admin_qa='on';\n"+await readFile('admin/proposals/room-count-'+stage+'.sql'));

    const passwords = Object.fromEntries([opLogin,revLogin,obsLogin].map(login=>[login,randomBytes(24).toString('hex')]));
    offline(database,`SET password_encryption='scram-sha-256';
      ${Object.entries(passwords).map(([login,pw])=>"CREATE ROLE "+login+" LOGIN NOSUPERUSER NOINHERIT NOBYPASSRLS PASSWORD '"+pw+"';").join('\n')}
      GRANT lucky_count_operator TO ${opLogin} WITH SET TRUE, INHERIT FALSE;
      GRANT USAGE ON SCHEMA game TO ${revLogin}, ${obsLogin};
      GRANT SELECT(actor_uid), DELETE ON game.room_count_operators TO ${revLogin};
      CREATE POLICY fixture_revoker_read ON game.room_count_operators FOR SELECT TO ${revLogin} USING (true);
      CREATE POLICY fixture_revoker_delete ON game.room_count_operators FOR DELETE TO ${revLogin} USING (true);
      ${['room_count_grants','room_count_grant_requests','room_count_grant_audit','room_count_operators'].map(
        table=>`GRANT SELECT ON game.${table} TO ${obsLogin};
          CREATE POLICY fixture_observer_read ON game.${table} FOR SELECT TO ${obsLogin} USING (true);`).join('\n')}
      INSERT INTO auth.users(id) VALUES ${[1,2,3,11,12,13].map(n=>"('"+id(n)+"')").join(',')};
      INSERT INTO game.room_count_operators(actor_uid) VALUES ${[1,2,3].map(n=>"('"+id(n)+"')").join(',')};`);
    await fs.writeFile(path.join(data,'pg_hba.conf'),
      `host ${database} ${Object.keys(passwords).join(',')} 127.0.0.1/32 scram-sha-256\n`);
    db=spawn(path.join(bin,'postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-c','unix_socket_directories='],
      {env,stdio:['ignore','ignore','pipe']});
    closed=new Promise(resolve=>{db.once('close',resolve);db.once('error',resolve);});
    let log='';
    db.stderr.setEncoding('utf8').on('data',chunk=>{log=(log+chunk).slice(-1600);});
    const connect=async login=>{
      const c=new Client({host:'127.0.0.1',port,database,user:login,password:passwords[login],
        ssl:false,connectionTimeoutMillis:700,statement_timeout:2000});
      c.on('error',()=>{});
      try {await c.connect();}
      catch(error){await c.end();throw error;}
      clients.push(c);
      return c;
    };
    let obs;
    for(let n=0;n<50;n++){
      try {obs=await connect(obsLogin);break;}
      catch(error){
        if (!['ECONNREFUSED','57P03'].includes(error.code)) throw error;
        if (db.exitCode !== null) break;
        await sleep(40);
      }
    }
    assert.ok(obs,'loopback PG17 failed to start: '+log);
    const [opA,opB,rev]=await Promise.all([opLogin,opLogin,revLogin].map(connect));
    for(const c of [opA,opB]) {
      await c.query('SET ROLE lucky_count_operator; SET search_path = pg_catalog, pg_temp;');
      assert.deepEqual((await c.query('SELECT session_user AS login,current_user AS role,inet_client_addr()::text AS addr')).rows,
        [{login:opLogin,role:'lucky_count_operator',addr:'127.0.0.1/32'}]);
    }
    assert.equal(new Set([obs,opA,opB,rev].map(c=>c.processID)).size,4);
    const source=await readFile('admin/pg-room-count-grant.cjs');
    const sql=/const applyGrant = `([\s\S]+?)`;/.exec(source)?.[1];
    assert.ok(sql,'missing current Admin adapter statement');
    async function grant(client, actor, subject, request) {
      const r=await client.query(sql,[id(subject),true,id(request),id(actor),opLogin,database]);
      assert.equal(r.rowCount,1,'guarded statement did not recognize the actor session');
      assert.equal(typeof r.rows[0].changed,'boolean');
      return r.rows[0].changed;
    }
    const revoke=(c,actor)=>c.query('DELETE FROM game.room_count_operators WHERE actor_uid=$1',[id(actor)]);
    function observed(promise) {
      // Attach the rejection handler before waiting at the barrier.
      return promise.then(value=>({value}),error=>({error}));
    }
    async function blocked(waiter,holder) {
      const deadline=Date.now()+1300;
      while(Date.now()<deadline) {
        const r=await obs.query('SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS waiting',
          [waiter.processID,holder.processID]);
        if(r.rows[0].waiting)return;
        await sleep(10);
      }
      assert.fail('Expected the specified PostgreSQL session to hold the blocking transaction');
    }
    async function state(actor,subject,request,expected) {
      const r=await obs.query(`SELECT
        EXISTS(SELECT FROM game.room_count_operators WHERE actor_uid=$1) AS operator,
        EXISTS(SELECT FROM game.room_count_grants WHERE uid=$2) AS granted,
        (SELECT count(*)::int FROM game.room_count_grant_requests WHERE subject_uid=$2) AS receipts,
        (SELECT count(*)::int FROM game.room_count_grant_audit WHERE subject_uid=$2) AS audits,
        (SELECT count(*)::int FROM game.room_count_grant_requests r JOIN game.room_count_grant_audit a
          USING(request_id, actor_uid, subject_uid, session_role_oid, granted)
          WHERE r.request_id=$3 AND r.actor_uid=$1 AND r.subject_uid=$2 AND r.changed AND r.granted
          AND r.session_role_oid=$4::regrole::oid) AS linked`,
        [id(actor),id(subject),id(request),opLogin]);
      assert.deepEqual(r.rows,[expected]);
    }

    await t.test('revocation locks first: waiting command makes no write',async ()=>{
      await rev.query('BEGIN');
      assert.equal((await revoke(rev,1)).rowCount,1);
      const pending=observed(grant(opA,1,11,21));
      await blocked(opA,rev);
      await rev.query('COMMIT');
      assert.equal((await pending).error?.code,'42501');
      await state(1,11,21,{operator:false,granted:false,receipts:0,audits:0,linked:0});
    });
    await t.test('command locks first: one audited grant, then revoked actor cannot replay',async ()=>{
      await opA.query('BEGIN');
      assert.equal(await grant(opA,2,12,22),true);
      const pending=observed(revoke(rev,2));
      await blocked(rev,opA);
      await opA.query('COMMIT');
      assert.equal((await pending).value?.rowCount,1);
      await assert.rejects(grant(opA,2,12,22),{code:'42501'});
      await state(2,12,22,{operator:false,granted:true,receipts:1,audits:1,linked:1});
    });
    await t.test('overlapping same-ID commands return one audited transition',async ()=>{
      await opA.query('BEGIN');
      assert.equal(await grant(opA,3,13,23),true);
      const pending=observed(grant(opB,3,13,23));
      await blocked(opB,opA);
      await opA.query('COMMIT');
      const replay=await pending;
      assert.ifError(replay.error);
      assert.equal(replay.value,true);
      await state(3,13,23,{operator:true,granted:true,receipts:1,audits:1,linked:1});
    });
  });
