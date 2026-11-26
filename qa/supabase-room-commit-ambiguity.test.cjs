'use strict';
/**
 * PREPARED ONLY. DO NOT EXECUTE before testing pause is explicitly lifted.
 * Node mock checks ambiguous COMMIT / failed ROLLBACK handling. This does
 * NOT demonstrate actual PostgreSQL crash/transaction correctness.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {createRoomLeaseStore}=require('../backend/supabase/room-lease-store.cjs');

const ROOM='11111111-1111-4111-8111-111111111111';
const OWNER='22222222-2222-4222-8222-222222222222';
const PLAYER='44444444-4444-4444-8444-444444444444';
const input={
 roomId:ROOM,ownerId:OWNER,leaseEpoch:1,expectedRevision:0,
 game:{over:true,players:[]},deadlineMs:null,
 awards:[{eventId:ROOM+':win',uid:PLAYER,gameId:ROOM,mode:'free',kind:'win',points:10}]
};
function fakePool({failCommit=false,failInsert=false,failRollback=false}){
 const commands=[],releases=[];
 let committed=false;
 const query=async(sql)=>{
  sql=String(sql);commands.push(sql);
  if(sql==='BEGIN')return {rowCount:0,rows:[]};
  if(sql==='COMMIT'){
   if(failCommit){committed=true;throw Error('SOCKET_DROPPED_AFTER_COMMIT');}
   committed=true;return {rowCount:0,rows:[]};
  }
  if(sql==='ROLLBACK'){
   if(failRollback)throw Error('ROLLBACK_LINK_LOST');
   return {rowCount:0,rows:[]};
  }
  if(sql.includes('UPDATE game.rooms'))
   return {rowCount:1,rows:[{revision:1,mode:'free',seats:[{uid:PLAYER}]}]};
  if(sql.includes('INSERT INTO game.score_events')){
   if(failInsert)throw Error('INSERT_FAILED');
   return {rowCount:1,rows:[{event_id:ROOM+':win'}]};
  }
  throw Error('Unexpected query');
 };
 return {
  pool:{query,connect:async()=>({query,release:(destroy)=>releases.push(destroy)})},
  commands,releases,get committed(){return committed}
 };
}
test('unknown COMMIT result is reported as ambiguous and connection discarded',async()=>{
 const fake=fakePool({failCommit:true});
 const store=createRoomLeaseStore(fake.pool);
 await assert.rejects(store.commitFencedTurn(input),e=>{
  assert.equal(e.code,'AMBIGUOUS_COMMIT');
  assert.match(e.message,/AMBIGUOUS_COMMIT_REQUIRES_RECONCILIATION/);
  return true;
 });
 assert.equal(fake.commands.filter(x=>x==='COMMIT').length,1);
 assert.equal(fake.commands.filter(x=>x==='ROLLBACK').length,0);
 assert.deepEqual(fake.releases,[true]);
 // Simulated "committed despite lost acknowledgement": NEVER replay dice.
 assert.equal(fake.committed,true);
});
test('pre-COMMIT statement failure rolls back and safely releases client',async()=>{
 const fake=fakePool({failInsert:true});
 await assert.rejects(createRoomLeaseStore(fake.pool).commitFencedTurn(input),/INSERT_FAILED/);
 assert.equal(fake.commands.includes('COMMIT'),false);
 assert.equal(fake.commands.filter(x=>x==='ROLLBACK').length,1);
 assert.deepEqual(fake.releases,[false]);
});
test('failed ROLLBACK destroys uncertain client without a repeated COMMIT',async()=>{
 const fake=fakePool({failInsert:true,failRollback:true});
 await assert.rejects(createRoomLeaseStore(fake.pool).commitFencedTurn(input),err=>{
  assert.match(err.message,/INSERT_FAILED/);
  assert.equal(err.rollbackErrorCode,'ROLLBACK_FAILED');
  return true;
 });
 assert.equal(fake.commands.includes('COMMIT'),false);
 assert.deepEqual(fake.releases,[true]);
});
