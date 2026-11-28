'use strict';
// Disposable loopback cluster only. Never consumes a hosted DSN or credentials.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const net=require('node:net'),{spawn,spawnSync}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {setTimeout:sleep}=require('node:timers/promises');
const database='lucky_qa_joint_free4',login='lucky_game_server_login',observer='fixture_free4_observer';
function assertNativeInputs(bin,roster) {
 assert.ok(typeof bin==='string'&&path.isAbsolute(bin),'set absolute local PostgreSQL 17 binaries path');
 assert.ok(Array.isArray(roster)&&roster.length===4&&new Set(roster).size===4&&
  roster.every(x=>typeof x==='string'&&/^aaaaaaaa-0000-4000-8000-\d{12}$/.test(x)),
  'use four distinct synthetic fixture identities');
}
async function portOnLoopback(){
 const s=net.createServer();
 await new Promise((resolve,reject)=>s.once('error',reject).listen(0,'127.0.0.1',resolve));
 const {port}=s.address();
 await new Promise((resolve,reject)=>s.close(error=>error?reject(error):resolve()));
 return port;
}

async function startDisposablePg17(t,{bin,roster,runtimeRequire}) {
  assertNativeInputs(bin,roster);
  const manifest=runtimeRequire('../../package.json');
  assert.equal(runtimeRequire('pg/package.json').version,manifest.dependencies.pg);
  assert.equal(runtimeRequire('ws/package.json').version,manifest.dependencies.ws);
  const {Client,Pool}=runtimeRequire('pg');
  const port=await portOnLoopback(),root=await fs.mkdtemp(path.join(os.tmpdir(),'lucky-joint-free4-tcp-'));
  const data=path.join(root,'data'), env={PATH:'/usr/bin:/bin',LC_ALL:'C'};
  let proc,stopped,obs;
  const pools=new Set();
  t.after(async()=>{
   await Promise.allSettled([...Array.from(pools,p=>p.ended?undefined:p.end()),obs?.end()]);
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
  const createPool=()=>{
   const pool=new Pool({...opts(login,pw),max:2});
   pools.add(pool);return pool;
  };
  const pool=createPool();
  assert.deepEqual((await pool.query(`SELECT session_user AS login,
    inet_client_addr()::text AS addr,row_security_active('game.rooms') AS rooms,
    row_security_active('game.turn_receipts') AS receipts,row_security_active('game.score_events') AS scores,
    rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows,
   [{login,addr:'127.0.0.1/32',rooms:true,receipts:true,scores:true,rolsuper:false,rolbypassrls:false}]);
  return {pool,obs,createPool};
}
module.exports={startDisposablePg17,assertNativeInputs};
