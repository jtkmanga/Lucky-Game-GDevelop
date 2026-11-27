'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {archivePreviousCandidate:archive}=require('../backend/railway/archive-previous-candidate.cjs');
const end=Date.parse('2026-11-28T17:00:00Z');
const day=86400000;
function fixture(mode, opt={}) {
  const ns=mode==='free'?1279739393:1279739394;
  const start=end-(mode==='free'?7:1)*day;
  const key=Math.floor((start+7*3600000)/day);
  const history=[];
  let stored=opt.stored;
  const pool={connect:async()=>{
    let clocks=0;
    const seq=[];
    history.push(seq);
    return {async query(sql,args) {
      if(sql.startsWith('WITH sample')) {
        seq.push('clock');
        assert.match(sql,/AS MATERIALIZED \(SELECT clock_timestamp\(\)/);
        assert.deepEqual(args,[mode]);
        const offset=opt.cross&&clocks++?end-start:0;
        return {rows:[{now_ms:String(end+offset),lo:String(start+offset),hi:String(end+offset),
          key:key+offset/day+(opt.invalidKey?1:0)}]};
      }
      if(sql.includes('pg_try_advisory_lock')) {
        seq.push('gate');assert.deepEqual(args,[ns,key]);return {rows:[{held:!opt.busy}]};
      }
      if(sql==='BEGIN ISOLATION LEVEL READ COMMITTED') {seq.push('begin');return {command:'BEGIN'};}
      if(sql.startsWith('SELECT sum')) {
        assert.deepEqual(seq,['clock','gate','begin','clock']);
        assert.deepEqual(args,[mode,start,end]);
        assert.match(sql,/e.mode=\$1[\s\S]*e.created_at >= to_timestamp\(\$2[\s\S]*e.created_at < to_timestamp\(\$3/);
        assert.match(sql,/ORDER BY score DESC,p.uid LIMIT 50/);
        seq.push('rank');return {rows:[{score:opt.score??'9007199254740993'}]};
      }
      if(sql.startsWith('SELECT period_end_ms')) {
        seq.push('read');assert.deepEqual(args,[mode,start]);return {rows:stored?[stored]:[]};
      }
      if(sql.startsWith('INSERT')) {
        seq.push('insert');assert.match(sql,/ON CONFLICT \(mode,period_start_ms\) DO NOTHING$/);
        assert.deepEqual(args.slice(0,3),[mode,start,end]);
        if(opt.race)return {rowCount:0};
        stored={period_end_ms:String(end),snapshot:JSON.parse(args[3])};
        return {rowCount:1};
      }
      assert.equal(sql,'COMMIT');seq.push('commit');
      if(opt.unknown)throw Error('lost acknowledgement');
      return {command:opt.rollbackTag?'ROLLBACK':'COMMIT'};
    },release(destroy){assert.equal(destroy,true);seq.push('discard');}};
  }};
  return {pool,history,get stored(){return stored;}};
}
for(const mode of ['free','vip'])test(mode+' stores the preceding period and validates immutable replay',async()=>{
  const f=fixture(mode);
  const first=await archive(f.pool,mode);
  assert.deepEqual(first,{mode,startMs:end-(mode==='free'?7:1)*day,endMs:end,inserted:true,provisional:true});
  assert.deepEqual(f.stored.snapshot,[['🥇','👤','ผู้เล่น','9007199254740993']]);
  assert.deepEqual(await archive(f.pool,mode),{...first,inserted:false});
  assert.deepEqual(f.history[0],['clock','gate','begin','clock','rank','read','insert','commit','discard']);
  assert.deepEqual(f.history[1],['clock','gate','begin','clock','rank','read','commit','discard']);
});
for(const [name,opt,error,last] of [
  ['gate busy',{busy:true},'ARCHIVE_GATE_BUSY','gate'],
  ['key mismatch',{invalidKey:true},'ARCHIVE_PERIOD','clock'],
  ['boundary crossed',{cross:true},'ARCHIVE_PERIOD_CHANGED','clock'],
  ['conflicting stored window',{stored:{period_end_ms:'0',snapshot:[]}},'ARCHIVE_CONFLICT','read'],
  ['conflicting snapshot',{stored:{period_end_ms:String(end),snapshot:[]}},'ARCHIVE_CONFLICT','read'],
  ['insert raced',{race:true},'ARCHIVE_CONFLICT','insert'],
  ['invalid public score',{score:'-2'},'Invalid leaderboard score','rank'],
  ['rollback tag is not an acknowledged commit',{rollbackTag:true},'ARCHIVE_COMMIT_UNKNOWN','commit'],
  ['uncertain commit',{unknown:true},'ARCHIVE_COMMIT_UNKNOWN','commit']
])test(name,async()=>{
  const f=fixture('vip',opt);
  await assert.rejects(archive(f.pool,'vip'),err=>{
    assert.match(err.message,new RegExp(error));
    if(opt.unknown||opt.rollbackTag) assert.deepEqual(err.period,{mode:'vip',startMs:end-day,endMs:end});
    return true;
  });
  assert.equal(f.history.length,1);
  assert.deepEqual(f.history[0].slice(-2),[last,'discard']);
});
test('reject mode before checkout',async()=>{
  await assert.rejects(archive(null,{mode:'free',startMs:0}),/ARCHIVE_MODE/);
});
