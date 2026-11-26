'use strict';
/**
 * Authored only — DO NOT RUN until owner's testing pause is explicitly lifted.
 * These are mock/pure assertions; real PostgreSQL transaction isolation and
 * Supabase security require separate approved verification.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {classifyRoomReconciliation}=require('../backend/supabase/room-reconciliation.cjs');
const U='11111111-1111-4111-8111-111111111111';
const OWNER='22222222-2222-4222-8222-222222222222';
const roomId='33333333-3333-4333-8333-333333333333';
const expectedGame={over:true,players:[{pos:100}]};
const award={eventId:roomId+':win',uid:U,kind:'win',mode:'free',points:10};
function params(extra={}){
 return {room:{revision:2,status:'finished',lease_owner:OWNER,lease_epoch:'1',
   game_state:expectedGame},ledger:[{event_id:award.eventId,uid:U,kind:'win',
   mode:'free',points:10}],expectedRevision:1,expectedGame,awards:[award],
   ownerId:OWNER,leaseEpoch:1,...extra};
}
test('consistent committed revision and matching ledger is classified only as evidence',()=>{
 const result=classifyRoomReconciliation(params());
 assert.equal(result.classification,'COMMIT_EVIDENCE_CONSISTENT');
 assert.equal(result.manualReview,true);
});
test('missing expected winner award is reported separately from room revision',()=>{
 const result=classifyRoomReconciliation(params({ledger:[]}));
 assert.equal(result.classification,'STATE_OR_AWARD_MISMATCH');
 assert.deepEqual(result.missingKinds,['win']);
});
test('incorrect points never become accepted winner evidence',()=>{
 const result=classifyRoomReconciliation(params({
  ledger:[{event_id:award.eventId,uid:U,kind:'win',mode:'free',points:20}]
 }));
 assert.equal(result.classification,'LEDGER_CONFLICT');
});
test('duplicate reward kind is explicitly flagged',()=>{
 const result=classifyRoomReconciliation(params({
  ledger:[{event_id:award.eventId,uid:U,kind:'win',mode:'free',points:10},
   {event_id:roomId+':other-win',uid:U,kind:'win',mode:'free',points:10}]
 }));
 assert.equal(result.classification,'LEDGER_CONFLICT');
 assert.deepEqual(result.duplicateKinds,['win']);
});
test('unchanged revision is not proof a retry is safe',()=>{
 const result=classifyRoomReconciliation(params({room:{
  ...params().room,revision:1,game_state:{over:false,players:[{pos:90}]}
 },ledger:[]}));
 assert.equal(result.classification,'REVISION_UNCHANGED_UNCONFIRMED');
 assert.equal(result.manualReview,true);
});
test('wrong game state is flagged even when expected award exists',()=>{
 const result=classifyRoomReconciliation(params({room:{
  ...params().room,game_state:{over:false,players:[{pos:90}]}
 }}));
 assert.equal(result.classification,'STATE_OR_AWARD_MISMATCH');
});
test('missing room and divergent revision are unresolved',()=>{
 assert.equal(classifyRoomReconciliation(params({room:null})).classification,'ROOM_MISSING');
 assert.equal(classifyRoomReconciliation(params({room:{
  ...params().room,revision:7
 }})).classification,'REVISION_DIVERGED');
});
