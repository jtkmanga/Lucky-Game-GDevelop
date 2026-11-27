'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createRoomLeaseStore,createArchiveWriterCandidate}=require('../backend/supabase/room-lease-store.cjs');
const boundary=Date.parse('2026-11-28T17:00:00Z');
const day=86400000;
const sunday=Date.UTC(2026,10,29)/day;
const uid=i=>'aaaaaaaa-0000-4000-8000-'+String(i).padStart(12,'0');
function attempt(mode,opt={}) {
  const args={roomId:uid(1),ownerId:uid(2),leaseEpoch:3,expectedRevision:7,
    game:{over:true,winner:0},deadlineMs:null,
    awards:[{eventId:uid(1)+':win',gameId:uid(1),uid:uid(3),kind:'win',mode,points:10}],
    receipt:{type:'roll',actorIndex:0,dice:1,outcome:{reward:0}}};
  const originalAward=args.awards[0];
  if(opt.mutateEmpty){
    args.awards=[];args.game={over:false};args.deadlineMs=boundary+20000;
  }
  const history=[];
  let checkout=0;
  const span=mode==='free'?7:1;
  function clock(ms){return {rows:[{ms:String(ms),key:ms<boundary?sunday-span:sunday}]};}
  let status=opt.dirty ? 'T' : 'I';
  const client={getTransactionStatus:()=>status, async query(sql,v){
    if(sql.includes('WITH sample')){
      assert.deepEqual(v,[mode]);
      if(sql.includes('SELECT clock_timestamp() AS t')){history.push('wall');return clock(boundary-1);}
      assert.ok(sql.includes('SELECT transaction_timestamp() AS t'));
      history.push('transaction');return clock(opt.cross?boundary:boundary-1);
    }
    if(sql.includes('pg_try_advisory_lock_shared')){
      history.push('gate');assert.deepEqual(v,[mode==='free'?1279739393:1279739394,sunday-span]);
      return {rows:[{held:!opt.busy}]};
    }
    if(sql.startsWith('BEGIN')){
      history.push('begin');status=opt.wrongStatus?'I':'T';return {command:opt.badBegin?'ROLLBACK':'BEGIN'};
    }
    if(sql.includes('game.award_period_is_open')){
      history.push('proof');assert.deepEqual(v,[mode,boundary-span*day,boundary]);
      if(opt.missing)throw Error('undefined function');
      return {rows:[{open:opt.proof===undefined?true:opt.proof}]};
    }
    if(sql.startsWith('UPDATE game.rooms')){
      history.push('room');assert.deepEqual(v.slice(0,4),[uid(1),uid(2),3,7]);
      return {rowCount:opt.stale?0:1,rows:[{revision:'8',mode:opt.other?'vip':mode,seats:[{uid:uid(3)}]}]};
    }
    if(sql.startsWith('INSERT INTO game.score_events')){
      history.push('ledger');assert.ok(sql.startsWith('INSERT INTO game.score_events(event_id,uid,mode,game_id,kind,points)'));
      assert.deepEqual(v,[uid(1)+':win',uid(3),mode,uid(1),'win',10]);return {rowCount:1};
    }
    if(sql.startsWith('INSERT INTO game.turn_receipts')){
      history.push('receipt');assert.deepEqual(v.slice(0,7),[uid(1),8,7,3,'roll',0,1]);return {rowCount:1};
    }
    if(sql==='COMMIT'){history.push('commit');status=opt.dirtyCommit?'T':'I';return {command:opt.unknown&&!opt.dirtyCommit?'ROLLBACK':'COMMIT'};}
    assert.equal(sql,'ROLLBACK');history.push('rollback');return {command:'ROLLBACK'};
  },release(discard){history.push(discard?'discard':'release');}};
  const pool={query:()=>assert.fail('unbound pool query'),connect:async()=>{checkout++;if(opt.mutateEmpty)args.awards.push(originalAward);return client;}};
  const store=(opt.legacy?createRoomLeaseStore:createArchiveWriterCandidate)(pool);
  return {history,finish:async()=>{try{return await store.commitFencedTurn(args);}finally{assert.equal(checkout,1);}}};
}
for(const mode of ['free','vip']){
  test(mode+' refuses a boundary crossing before room, receipt or ledger SQL',async()=>{
    const a=attempt(mode,{cross:true});
    await assert.rejects(a.finish(),/AWARD_PERIOD_CHANGED/);
    assert.deepEqual(a.history,['wall','gate','begin','transaction','discard']);
  });
  test(mode+' writes using the checked transaction period on the same client',async()=>{
    const a=attempt(mode); assert.equal(await a.finish(),8);
    assert.deepEqual(a.history,['wall','gate','begin','transaction','proof','room','ledger','receipt','commit','discard']);
  });
}
for(const [name,opt,err,end] of [
  ['dirty checkout',{dirty:true},/AWARD_CLIENT_NOT_IDLE/,['discard']],
  ['BEGIN without active transaction',{wrongStatus:true},/AWARD_BEGIN_UNCONFIRMED/,['begin','discard']],
  ['busy gate',{busy:true},/AWARD_PERIOD_BUSY/,['gate','discard']],
  ['unconfirmed BEGIN',{badBegin:true},/AWARD_BEGIN_UNCONFIRMED/,['begin','discard']],
  ['archived during clock regression',{proof:false},/AWARD_PERIOD_NOT_OPEN/,['proof','discard']],
  ['missing authoritative proof',{missing:true},/undefined function/,['proof','discard']],
  ['ambiguous predicate result',{proof:null},/AWARD_PERIOD_NOT_OPEN/,['proof','discard']],
  ['stale turn',{stale:true},/LEASE_LOST/,['room','rollback','discard']],
  ['different locked room mode',{other:true},/differs from room mode/,['room','rollback','discard']],
  ['ambiguous commit',{unknown:true},/AMBIGUOUS_COMMIT/,['commit','discard']],
  ['COMMIT without idle checkout',{unknown:true,dirtyCommit:true},/AMBIGUOUS_COMMIT/,['commit','discard']]
])test(name,async()=>{
  const a=attempt('free',opt);
  await assert.rejects(a.finish(),err);
  assert.deepEqual(a.history.slice(-end.length),end);
  if(!opt.unknown){assert.ok(!a.history.includes('ledger'));assert.ok(!a.history.includes('receipt'));}
});
test('existing constructor retains original transaction path',async()=>{
  const a=attempt('free',{legacy:true});assert.equal(await a.finish(),8);
  assert.deepEqual(a.history,['begin','room','ledger','receipt','commit','release']);
});

test('caller mutation cannot introduce an unfenced award after checkout',async()=>{
  const a=attempt('free',{mutateEmpty:true});
  assert.equal(await a.finish(),8);
  assert.deepEqual(a.history,['begin','room','receipt','commit','release']);
});
