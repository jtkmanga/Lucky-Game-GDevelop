'use strict';
/**
 * SOURCE ONLY — DO NOT RUN until owner lifts the explicit testing pause.
 * Contract checks for Supabase PostgreSQL lease fencing and atomic scores.
 * This is a mock-PG test; it cannot prove actual PostgreSQL transactions,
 * SQL constraints, process crash recovery, or Railway multi-replica behavior.
 *
 * Future authorized command:
 *   node --test qa/supabase-room-lease-contract.test.cjs
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {createRoomLeaseStore}=require('../backend/supabase/room-lease-store.cjs');

const ROOM='11111111-1111-4111-8111-111111111111';
const OWNER='22222222-2222-4222-8222-222222222222';
const OTHER='33333333-3333-4333-8333-333333333333';
const PLAYER='44444444-4444-4444-8444-444444444444';
const mode='free';
function award(kind='win'){
 return {eventId:ROOM+':'+kind,gameId:ROOM,uid:PLAYER,mode,kind,points:kind==='win'?10:3};
}
function args(extra={}){
 return {roomId:ROOM,ownerId:OWNER,leaseEpoch:1,expectedRevision:0,
  game:{over:true,current:0,players:[]},deadlineMs:null,awards:[award()],
  receipt:{type:'roll',actorIndex:0,dice:4,outcome:{}},...extra};
}
function mockPg({claim=true,failAt=null,duplicate=false}={}){
 const calls=[];
 let roomVersion=0,points=0;
 let pendingVersion=0,pendingPoints=0;
 const query=async(sql,params)=>{
  const q=String(sql);calls.push({sql:q,params});
  if(failAt&&q.includes(failAt))throw Error('SIMULATED_SQL_FAILURE');
  if(q==='BEGIN'){pendingVersion=roomVersion;pendingPoints=points;return {rowCount:0,rows:[]};}
  if(q==='ROLLBACK'){return {rowCount:0,rows:[]};}
  if(q==='COMMIT'){roomVersion=pendingVersion;points=pendingPoints;return {rowCount:0,rows:[]};}
  if(q.includes('UPDATE game.rooms')&&q.includes('RETURNING revision,mode,seats')){
   if(!claim)return {rowCount:0,rows:[]};
   pendingVersion++;
   return {rowCount:1,rows:[{revision:pendingVersion,mode,seats:[{uid:PLAYER}]}]};
  }
  if(q.includes('INSERT INTO game.turn_receipts'))
   return {rowCount:1,rows:[{revision:pendingVersion}]};
  if(q.includes('INSERT INTO game.score_events')){
   if(duplicate)return {rowCount:0,rows:[]};
   pendingPoints+=Number(params[5]);
   return {rowCount:1,rows:[{event_id:params[0]}]};
  }
  if(q.includes('SET lease_owner=$2::uuid')){
   return {rowCount:claim?1:0,rows:claim?[{
    lease_epoch:2,lease_until:new Date(),revision:0,game_state:{over:false},
    seats:[{uid:PLAYER}],mode,deadline_ms:Date.now()+20000
   }]:[]};
  }
  if(q.includes('SET lease_until=clock_timestamp()'))return {rowCount:claim?1:0,rows:[{}]};
  if(q.includes('SET lease_owner=NULL'))return {rowCount:claim?1:0,rows:[{}]};
  if(q.includes('SELECT room_id,mode,deadline_ms,lease_epoch'))return {rowCount:0,rows:[]};
  throw Error('Unexpected SQL from source under review: '+q.slice(0,120));
 };
 const pool={query,connect:async()=>({query,release:()=>calls.push({sql:'RELEASE'})})};
 return {store:createRoomLeaseStore(pool),calls,state:()=>({roomVersion,points})};
}
test('one database transaction encloses fenced room transition and winner award',async()=>{
 const db=mockPg();
 assert.equal(await db.store.commitFencedTurn(args()),1);
 assert.deepEqual(db.state(),{roomVersion:1,points:10});
 const commands=db.calls.map(c=>c.sql);
 const begin=commands.indexOf('BEGIN'),commit=commands.indexOf('COMMIT');
 assert(begin>=0 && commit>begin);
 const update=commands.findIndex(x=>x.includes('UPDATE game.rooms')&&x.includes('RETURNING revision,mode,seats'));
 const insert=commands.findIndex(x=>x.includes('INSERT INTO game.score_events'));
 assert(update>begin && insert>update && commit>insert);
 const sql=commands[update];
 for(const guard of ['lease_owner=$2','lease_epoch=$3','lease_until>clock_timestamp()','revision=$4','status=\'playing\''])
  assert(sql.includes(guard),'missing fencing clause: '+guard);
});
test('lost lease or stale revision rejects transition without awarding points',async()=>{
 const db=mockPg({claim:false});
 await assert.rejects(db.store.commitFencedTurn(args()),/LEASE_LOST_OR_STALE_REVISION/);
 assert.deepEqual(db.state(),{roomVersion:0,points:0});
 assert(db.calls.some(x=>x.sql==='ROLLBACK'));
});
test('duplicate award rolls back the state transition',async()=>{
 const db=mockPg({duplicate:true});
 await assert.rejects(db.store.commitFencedTurn(args()),/DUPLICATE_AWARD_EVENT/);
 assert.deepEqual(db.state(),{roomVersion:0,points:0});
});
test('award SQL failure rolls back the room revision and points',async()=>{
 const db=mockPg({failAt:'INSERT INTO game.score_events'});
 await assert.rejects(db.store.commitFencedTurn(args()),/SIMULATED_SQL_FAILURE/);
 assert.deepEqual(db.state(),{roomVersion:0,points:0});
});
test('invalid player UID never reaches database transaction',async()=>{
 const db=mockPg();
 await assert.rejects(db.store.commitFencedTurn(args({
  awards:[{...award(),uid:OTHER}]
 })),/Award identity not a verified member/);
 assert.deepEqual(db.state(),{roomVersion:0,points:0});
});
test('winner award requires completed game and exactly ten points',async()=>{
 const db=mockPg();
 await assert.rejects(db.store.commitFencedTurn(args({
  game:{over:false},deadlineMs:Date.now()+20000,awards:[award('win')]
 })),/Winner award requires/);
 await assert.rejects(db.store.commitFencedTurn(args({
  awards:[{...award(),points:20}]
 })),/Winner award requires/);
 assert.deepEqual(db.state(),{roomVersion:0,points:0});
});
test('fencing lease re-acquisition must change epoch; rejected claim returns null',async()=>{
 const granted=mockPg();
 const claim=await granted.store.acquire(ROOM,OWNER);
 assert.equal(claim.leaseEpoch,2);
 const denied=mockPg({claim:false});
 assert.equal(await denied.store.acquire(ROOM,OTHER),null);
 assert.equal(await denied.store.renew(ROOM,OTHER,1),false);
});
test('commit with a live non-final game must retain an explicit turn deadline',async()=>{
 const db=mockPg();
 await assert.rejects(db.store.commitFencedTurn(args({
  game:{over:false},deadlineMs:null,awards:[]
 })),/Invalid game deadline/);
});
