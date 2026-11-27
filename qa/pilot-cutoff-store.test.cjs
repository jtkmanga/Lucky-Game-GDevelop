'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createRoomLeaseStore,pilotBinding,storedGame,publicRow}=require('../backend/supabase/room-lease-store.cjs');
const roomId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pilot={roomId,cutoffMs:1900000000000};
const game={over:false};
const marker='_free4CutoffV1';
const args={roomId,ownerId,expectedRevision:2,leaseEpoch:1};
function fixture({status='playing',changed=true,lost=false,fenced='open'}={}){
 const log=[];
 const row={room_id:roomId,mode:'free',status,game_state:storedGame(game,pilot,roomId)};
 const client={async query(sql,params){
  log.push({sql,params});
  if(sql.includes('FOR UPDATE'))return {rows:[row]};
  if(sql.includes('AS result'))return {rows:[{result:fenced}]};
  if(sql.includes('UPDATE game.rooms'))return {rowCount:Number(changed),rows:[{mode:'free',revision:3,seats:[{uid:ownerId}]}]};
  if(sql.includes('INSERT INTO game.turn_receipts'))return {rowCount:1};
  if(sql==='COMMIT'&&lost)throw Error('lost');
 },release(discard){log.push({discard});}};
 const store=createRoomLeaseStore({query:client.query,connect:async()=>client},pilot);
 return {log,row,store};
}
test('metadata is bound, private, and reserved',()=>{
 const {row}=fixture();
 assert.deepEqual(publicRow(row,pilot).game_state,game);
 for(const config of [null,{...pilot,cutoffMs:1}])assert.throws(()=>publicRow(row,config));
 assert.throws(()=>publicRow({...row,game_state:game},pilot));
 assert.throws(()=>storedGame(row.game_state,pilot,roomId));
 assert.throws(()=>pilotBinding({...pilot,cutoffMs:'19'}));
});
test('close locks first, checks clock and fences, leaves terminal rows alone',async()=>{
 for(const status of ['playing','closed','finished']){
  const {store,log}=fixture({status});
  assert.equal(await store.closeExpiredPilot(args),status==='finished'?status:'closed');
  assert.match(log[1].sql,/FOR UPDATE/);
  if(status==='playing'){
   assert.match(log[2].sql,/revision=\$2 AND lease_owner=\$3 AND lease_epoch=\$4/);
   assert.match(log[2].sql,/clock_timestamp\(\)\)\*1000 >=/);
   assert.deepEqual(log[2].params,[roomId,2,ownerId,1,pilot.cutoffMs]);
  }else assert.equal(log[2].sql,'COMMIT');
 }
});
test('close fence miss rolls back; lost acknowledgement discards without replay',async()=>{
 for(const lost of [false,true]){
  const {store,log}=fixture({changed:lost,lost});
  await assert.rejects(store.closeExpiredPilot(args),lost?{code:'AMBIGUOUS_COMMIT'}:/STALE_FENCE/);
  assert.equal(log.at(-2).sql,lost?'COMMIT':'ROLLBACK');
  assert.deepEqual(log.at(-1),{discard:lost});
 }
});
test('turn checks clock after lock, preserves marker only in room and stops on fence miss',async()=>{
 for(const changed of [true,false]){
  const {store,log}=fixture({changed});
  const turn=store.commitFencedTurn({...args,game,deadlineMs:1,receipt:{type:'timeout',actorIndex:0,dice:null,outcome:{}}});
  if(changed)assert.equal(await turn,3);
  else await assert.rejects(turn,/STALE_REVISION/);
  assert.match(log[1].sql,/FOR UPDATE/);
  assert.match(log[2].sql,/clock_timestamp\(\)\)\*1000 < /);
  assert.deepEqual(JSON.parse(log[2].params[4])[marker],pilot);
  if(changed)assert.deepEqual(JSON.parse(log[3].params[8]),game);
  else assert.equal(log[3].sql,'ROLLBACK');
 }
});

test('recovery observation distinguishes open, expired, stale and terminal after locking',async()=>{
 for(const status of ['open','expired','stale','closed','finished']){
  const terminal=['closed','finished'].includes(status);
  const {store,log}=fixture({status:terminal?status:'playing',fenced:status});
  assert.equal(await store.inspectPilotFence(args),status);
  assert.match(log[1].sql,/FOR UPDATE/);
  if(!terminal){
   assert.match(log[2].sql,/lease_until>clock_timestamp/);
   assert.match(log[2].sql,/clock_timestamp\(\)\)\*1000 >=/);
   assert.deepEqual(log[2].params,[roomId,ownerId,1,2,pilot.cutoffMs]);
  }else assert.equal(log[2].sql,'COMMIT');
  assert.ok(log.every(x=>!/^UPDATE|^INSERT/.test(x.sql||'')));
 }
});
