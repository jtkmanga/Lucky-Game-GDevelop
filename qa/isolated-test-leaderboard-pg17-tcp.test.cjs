'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const { setTimeout: sleep } = require('node:timers/promises');
const { createIsolatedTestLeaderboard } = require('../backend/railway/isolated-test-leaderboard.cjs');

const requestedBin = process.env.LUCKY_PG17_BIN;
const driver = process.env.LUCKY_PG17_DRIVER || 'pg';
const work = promisify(execFile);
const installer = 'lucky_rank_installer';
const reader = 'lucky_qa_rank_reader';
const owner = 'lucky_qa_rank_owner';
const database = 'lucky_qa_rank_tcp';
const scoreFunction = 'lucky_rank_qa.read_current(text,bigint,bigint,integer)';
const startMs = Date.parse('2030-03-03T00:00:00+07:00');
const room = '10000000-1111-4111-8111-111111111111';
const otherRoom = '20000000-1111-4111-8111-111111111111';
const uid = '30000000-1111-4111-8111-111111111111';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve,reject) => server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const {port} = server.address();
  await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test('native PG17: non-superuser installs rank reader and authenticated TCP pool stays scoped',
  {skip: requestedBin === undefined, timeout:30_000}, async t => {
    assert.ok(path.isAbsolute(requestedBin), 'use an absolute local PostgreSQL 17 bin directory');
    const {Client, Pool} = require(driver);
    const port = await freePort();
    const root = await fs.mkdtemp(path.join(os.tmpdir(),'lucky-ranked-tcp-'));
    const data = path.join(root,'data');
    const pwFile = path.join(root,'init-pass');
    const newPassword = () => randomBytes(24).toString('hex');
    const adminPw = newPassword(), installPw = newPassword(), readPw = newPassword();
    const env = {PATH:'/usr/bin:/bin', LC_ALL:'C'};
    const clients = [];
    let processDb, pool, stopped;
    t.after(async () => {
      try {
        if (pool) await pool.end();
        await Promise.allSettled(clients.map(c => c.end()));
      } finally {
        if (processDb && processDb.exitCode === null && processDb.signalCode === null) {
          processDb.kill('SIGINT');
          const stopDeadline = new AbortController();
          const deadline = sleep(2_000, false, {signal:stopDeadline.signal}).catch(()=>true);
          if (!await Promise.race([stopped.then(()=>true),deadline])) {
            processDb.kill('SIGKILL');
            await stopped;
          }
          stopDeadline.abort();
        }
        await fs.rm(root,{recursive:true,force:true});
      }
    });
    const pg = (binary,args) => work(path.join(requestedBin,binary),args,{env,timeout:10_000});
    assert.match((await pg('postgres',['--version'])).stdout,/PostgreSQL\) 17\./);
    await fs.writeFile(pwFile,adminPw+'\n',{mode:0o600});
    await pg('initdb',['-D',data,'--auth-host=scram-sha-256','--auth-local=reject','-U','fixture_bootstrap',
      '--pwfile='+pwFile,'--no-locale','-E','UTF8']);
    await fs.unlink(pwFile);
    processDb=spawn(path.join(requestedBin,'postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),
      '-c','unix_socket_directories=','-c','password_encryption=scram-sha-256'],
      {env,stdio:['ignore','ignore','pipe']});
    stopped=new Promise(resolve=>{processDb.once('close',resolve);processDb.once('error',resolve);});
    let startup='';
    processDb.stderr.setEncoding('utf8').on('data',chunk=>{startup=(startup+chunk).slice(-3000);});
    const opts=(user,password,db=database)=>({
      host:'127.0.0.1',port,user,password,database:db,ssl:false,
      connectionTimeoutMillis:700,statement_timeout:4000
    });
    async function connect(options) {
      const client = new Client(options);
      client.on('error',()=>{});
      clients.push(client);
      try { await client.connect(); return client; }
      catch (error) { await client.end(); clients.pop(); throw error; }
    }
    let bootstrap;
    for(let n=0;n<50;n++){
      try {bootstrap=await connect(opts('fixture_bootstrap',adminPw,'postgres'));break;}
      catch (error) {
        if (!['ECONNREFUSED','57P03'].includes(error.code)) throw error;
        if (processDb.exitCode !== null) break;
        await sleep(50);
      }
    }
    assert.ok(bootstrap,'loopback PG17 failed to start: '+startup);
    await bootstrap.query('CREATE DATABASE '+database);
    const setup=await connect(opts('fixture_bootstrap',adminPw));
    const schemaPath=path.join(__dirname,'../backend/supabase');
    await setup.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);');
    for(const file of ['001_game_private_schema.sql','002_room_lease_draft.sql','003_turn_receipts_draft.sql',
      '004_railway_runtime_access_PROPOSAL.sql','005_restricted_login_no_password.sql'])
      await setup.query(await fs.readFile(path.join(schemaPath,file),'utf8'));

    // Model migration ownership and role-management rights, not a managed
    // provider's otherwise unrelated elevated service role.
    await setup.query("CREATE ROLE "+installer+" LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS PASSWORD '"+installPw+"'");
    await setup.query(`GRANT CREATE ON DATABASE ${database} TO ${installer};
      GRANT USAGE ON SCHEMA game TO ${installer} WITH GRANT OPTION;
      GRANT REFERENCES ON game.rooms, game.players TO ${installer};
      ALTER TABLE game.score_events OWNER TO ${installer}`);
    const migrate=await connect(opts(installer,installPw));
    assert.deepEqual((await migrate.query(`SELECT session_user AS login, current_user AS active,
      rolsuper,rolbypassrls
      FROM pg_roles WHERE rolname=current_user`)).rows,
      [{login:installer,active:installer,rolsuper:false,rolbypassrls:false}]);
    await migrate.query(await fs.readFile(path.join(__dirname,'staging-leaderboard/isolated-test-score-reader.PROPOSAL.sql'),'utf8'));
    // Only disposable fixtures use these random credentials. No provider secrets.
    await setup.query("ALTER ROLE "+reader+" PASSWORD '"+readPw+"'");
    await setup.query('INSERT INTO auth.users VALUES($1)',[uid]);
    await setup.query("INSERT INTO game.players(uid,display_name,name_key) VALUES($1,'Synthetic only','synthetic-only')",[uid]);
    await setup.query("INSERT INTO game.rooms(room_id,mode,seats,game_state,status) SELECT id,'free','[]','{}','finished' FROM unnest($1::uuid[]) id",[[room,otherRoom]]);
    await migrate.query("INSERT INTO lucky_rank_qa.allowed_score_pairs VALUES($1,$2,'free')",[room,uid]);
    await setup.query(`INSERT INTO game.score_events(event_id,uid,mode,game_id,kind,points,created_at)
       VALUES ('included',$1,'free',$2,'admin',10,to_timestamp($4::double precision/1000)),
       ('excluded',$1,'free',$3,'admin',950,to_timestamp($4::double precision/1000))`,[uid,room,otherRoom,startMs]);
    const policy=await setup.query(`SELECT
      pg_has_role($1,$2,'SET') AS installer_can_set_owner,
      pg_has_role($3,$2,'SET') AS reader_can_set_owner,
      has_schema_privilege($2,'lucky_rank_qa','CREATE') AS owner_can_create,
      has_function_privilege($1,$4,'EXECUTE') AS installer_can_execute,
      has_function_privilege($3,$4,'EXECUTE') AS reader_can_execute,
      has_any_column_privilege($3,'game.score_events','SELECT') AS reader_can_read_scores,
      has_any_column_privilege($3,'game.players','SELECT') AS reader_can_read_names,
      has_any_column_privilege($3,'game.leaderboard_archives','SELECT') AS reader_can_read_archives,
      has_any_column_privilege($3,'lucky_rank_qa.allowed_score_pairs','INSERT,UPDATE') AS reader_can_enroll
      `,[installer,owner,reader,scoreFunction]);
    assert.deepEqual(policy.rows,[{installer_can_set_owner:false,reader_can_set_owner:false,owner_can_create:false,
      installer_can_execute:false,reader_can_execute:true,reader_can_read_scores:false,reader_can_read_names:false,
      reader_can_read_archives:false,reader_can_enroll:false}]);
    pool=new Pool({...opts(reader,readPw),max:1});
    assert.deepEqual((await pool.query(`SELECT session_user AS login,current_user AS active,
       inet_client_addr()::text AS address, (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl`)).rows,
       [{login:reader,active:reader,address:'127.0.0.1/32',ssl:false}]);
    const authenticatedReader=await connect(opts(reader,readPw));
    for (const table of ['game.score_events','game.players','game.leaderboard_archives',
      'lucky_rank_qa.allowed_score_pairs']) {
      await assert.rejects(authenticatedReader.query('SELECT * FROM '+table+' LIMIT 1'),{code:'42501'});
    }
    await assert.rejects(migrate.query('SELECT * FROM lucky_rank_qa.read_current($1,$2,$3,$4)',
      ['free',startMs,startMs+1000,1]),{code:'42501'});
    const app=createIsolatedTestLeaderboard({verifyIdentity:async()=>({uid}),store:{},scopedPool:pool,limit:1,clock:()=>startMs});
    let result;
    await app({method:'GET',url:'/leaderboard?mode=free',headers:{authorization:'Bearer synthetic'}},{
      writeHead(status){result={status};},end(json){result.body=JSON.parse(json);}
    });
    assert.deepEqual(result,{status:200,body:{rows:[['🥇','👤','ผู้เล่น','10']]}});
  });
