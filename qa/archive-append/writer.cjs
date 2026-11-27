'use strict';
// Only invoked by verify.py with a fresh private initdb directory. No pg driver.
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const path=require('node:path');
const assert=require('node:assert/strict');
const [pg,data,writer]=process.argv.slice(2);
const fs=require('node:fs');
const scratch=path.dirname(data);
assert.equal(path.basename(data),'data');
assert.equal(path.dirname(scratch),fs.realpathSync(require('node:os').tmpdir()));
assert.match(path.basename(scratch),/^lucky-archive-append-[a-zA-Z0-9_-]+$/);
assert.equal(fs.realpathSync(data),data);
assert.equal(fs.statSync(scratch).uid,process.getuid());
assert.equal(fs.statSync(scratch).mode & 0o077,0);
assert.equal(fs.readFileSync(path.join(scratch,'archive-qa.marker'),'utf8'),'disposable archive QA');
assert.equal(fs.existsSync(path.join(data,'postmaster.pid')),false);
const {archivePreviousCandidate}=require(path.resolve(writer));
function literal(v){
  if (Number.isSafeInteger(v)) return String(v);
  assert.equal(typeof v,'string'); return "'"+v.replaceAll("'","''")+"'";
}
async function invoke(mode){
  const child=spawn('stdbuf',['-o0',pg,'--single','-D',data,'-j','lucky_qa_award_period'],
    {stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  const lines=readline.createInterface({input:child.stdout})[Symbol.asyncIterator]();
  let errors='';
  child.stderr.on('data',b=>errors+=b);
  const exited=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  async function run(sql){
    const rows=[];
    child.stdin.write(sql+';\n\nSELECT 1 AS qa_command_done;\n\n');
    for (;;) {
      const line=await lines.next();
      if(line.done)throw Error('Backend exited: '+errors);
      if(line.value.includes('qa_command_done = "1"'))return rows;
      const m=line.value.match(/qa_row = "(\{.*\})"/);
      if(m)rows.push(JSON.parse(m[1]));
    }
  }
  try {
    await run('SET SESSION AUTHORIZATION lucky_qa_archive_writer');
    const ident=await run("SELECT row_to_json(r) AS qa_row FROM (SELECT current_user AS role,row_security_active('game.leaderboard_archives') AS rls) r");
    assert.deepEqual(ident,[{role:'lucky_qa_archive_writer',rls:true}]);
    let discarded=false;
    let state='I'; // Protocol test shim; actual SQL and RLS run in PostgreSQL.
    const client={getTransactionStatus:()=>state,async query(template,values=[]){
      const sql=template.replace(/\$(\d+)/g,(_,i)=>literal(values[Number(i)-1]));
      if(sql.startsWith('BEGIN')||sql==='COMMIT'){
        const command=sql.split(' ')[0];
        await run(sql);
        assert.doesNotMatch(errors,/\b(ERROR|FATAL|PANIC):/);
        state=command==='BEGIN'?'T':'I';
        return {command};
      }
      const insert=sql.startsWith('INSERT');
      const rows=await run(insert?
        'WITH wrote AS ('+sql+' RETURNING 1 AS inserted) SELECT row_to_json(wrote) AS qa_row FROM wrote':
        'SELECT row_to_json(r) AS qa_row FROM ('+sql+') r');
      for(const row of rows)for(const k of ['ms','now_ms','lo','hi','period_end_ms','score'])
        if(k in row){assert.ok(Number.isSafeInteger(row[k]));row[k]=String(row[k]);}
      return {rows,rowCount:rows.length};
    },release(flag){assert.equal(flag,true);discarded=true;}};
    const result=await archivePreviousCandidate({connect:async()=>client},mode);
    assert.equal(discarded,true);assert.equal(result.provisional,true);
    return result;
  }finally{
    child.stdin.end();
    assert.equal(await exited,0);
    assert.doesNotMatch(errors,/\b(ERROR|FATAL|PANIC):/);
  }
}
(async()=>{
 for(const mode of ['vip','free']){
   const first=await invoke(mode);assert.equal(first.inserted,true);
   assert.deepEqual(await invoke(mode),{...first,inserted:false});
 }
 console.log('PASS archivePreviousCandidate: VIP and Free inserted and replayed under writer role');
})().catch(e=>{console.error(e);process.exitCode=1;});
