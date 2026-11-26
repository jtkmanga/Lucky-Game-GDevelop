'use strict';
/** SOURCE ONLY, DO NOT EXECUTE until owner explicitly lifts test pause.
 * Mock-only verification of receipt requirements; not real PostgreSQL proof.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {classifyRoomReconciliation}=require('../backend/supabase/room-reconciliation.cjs');
const {prepareManualRecoveryDecision}=require('../backend/supabase/manual-room-recovery.cjs');
const roomId='11111111-1111-4111-8111-111111111111';
const ownerId='22222222-2222-4222-8222-222222222222';
const uid='33333333-3333-4333-8333-333333333333';
const state={over:true,players:[{position:100}]};
const awards=[{eventId:roomId+':win',uid,mode:'free',kind:'win',points:10}];
function evidence(changes={}){
 return {
  room:{revision:8,status:'finished',lease_owner:ownerId,lease_epoch:2,game_state:state},
  ledger:[{event_id:awards[0].eventId,uid,mode:'free',kind:'win',points:10}],
  receipts:[{revision:8,previous_revision:7,lease_epoch:2,game_state:state,
    award_events:awards}],
  expectedRevision:7,expectedGame:state,awards,ownerId,leaseEpoch:2,
  ...changes
 };
}
test('matching atomic receipt permits review only, never auto resume',()=>{
 const e=evidence(),assessment=classifyRoomReconciliation(e);
 assert.equal(assessment.receiptStatus,'MATCHED');
 const decision=prepareManualRecoveryDecision({
  assessment,room:e.room,expectedRevision:e.expectedRevision,
  expectedGame:e.expectedGame,expectedAwards:e.awards
 });
 assert.equal(decision.decision,'REVIEW_FOR_OPERATOR_APPROVAL');
 assert.equal(decision.automaticResume,false);
});
test('missing receipt blocks manual recovery readiness',()=>{
 const e=evidence({receipts:[]}),assessment=classifyRoomReconciliation(e);
 assert.equal(assessment.receiptStatus,'MISSING');
 const d=prepareManualRecoveryDecision({assessment,room:e.room,
  expectedRevision:e.expectedRevision,expectedGame:e.expectedGame,expectedAwards:e.awards});
 assert.equal(d.decision,'BLOCK');
 assert(d.blockingReasons.includes('TURN_RECEIPT_UNVERIFIED'));
});
test('conflicting receipt award payload blocks recovery readiness',()=>{
 const e=evidence({receipts:[{revision:8,previous_revision:7,lease_epoch:2,
  game_state:state,award_events:[{...awards[0],points:20}]}]});
 const a=classifyRoomReconciliation(e);
 assert.equal(a.receiptStatus,'MISMATCH');
 assert.equal(prepareManualRecoveryDecision({assessment:a,room:e.room,
  expectedRevision:7,expectedGame:state,expectedAwards:awards}).decision,'BLOCK');
});
test('unavailable receipt evidence blocks recovery readiness',()=>{
 const e=evidence({receipts:undefined}),a=classifyRoomReconciliation(e);
 assert.equal(a.receiptStatus,'UNAVAILABLE');
 assert.equal(prepareManualRecoveryDecision({assessment:a,room:e.room,
  expectedRevision:7,expectedGame:state,expectedAwards:awards}).decision,'BLOCK');
});


test('later room revision does not erase evidence of the earlier receipt',()=>{
 const e=evidence({room:{...evidence().room,revision:12,
  game_state:{over:true,players:[{position:100}],laterRevision:true}}});
 const a=classifyRoomReconciliation(e);
 assert.equal(a.receiptStatus,'MATCHED');
 assert.equal(a.classification,'REVISION_DIVERGED');
 const decision=prepareManualRecoveryDecision({assessment:a,room:e.room,
  expectedRevision:7,expectedGame:state,expectedAwards:awards});
 assert.equal(decision.decision,'BLOCK');
 assert.equal(decision.automaticResume,false);
});
test('exact expected receipt is matched even with a newer receipt in evidence',()=>{
 const newer={revision:9,previous_revision:8,lease_epoch:3,
  game_state:{over:true,later:true},award_events:[]};
 const e=evidence({receipts:[newer,...evidence().receipts]});
 assert.equal(classifyRoomReconciliation(e).receiptStatus,'MATCHED');
});
