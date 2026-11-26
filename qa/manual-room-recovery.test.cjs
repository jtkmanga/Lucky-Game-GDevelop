'use strict';
/* Authored only. DO NOT RUN while owner testing pause remains active.
 * Pure decision tests cannot prove SQL consistency or operational recovery.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {prepareManualRecoveryDecision}=require('../backend/supabase/manual-room-recovery.cjs');
const room={revision:6,status:'playing',lease_owner:'owner',lease_epoch:3};
const game={over:false,players:[]};
const base={
 assessment:{classification:'COMMIT_EVIDENCE_CONSISTENT',
  ownerMatches:true,gameStateMatches:true,matchingAwardEvents:0,
  missingKinds:[],conflictingKinds:[],duplicateKinds:[]},
 room,expectedRevision:5,expectedGame:game,expectedAwards:[]
};
test('consistent evidence still REQUIRES explicit operator review, never auto-resumes',()=>{
 const r=prepareManualRecoveryDecision(base);
 assert.equal(r.decision,'REVIEW_FOR_OPERATOR_APPROVAL');
 assert.equal(r.automaticResume,false);
 assert.equal(r.requiresOperator,true);
});
test('lost lease blocks recovery',()=>{
 const r=prepareManualRecoveryDecision({...base,assessment:{...base.assessment,ownerMatches:false}});
 assert.equal(r.decision,'BLOCK');
 assert(r.blockingReasons.includes('LEASE_OWNERSHIP_CHANGED'));
});
test('missing or duplicate award blocks recovery',()=>{
 for(const key of ['missingKinds','conflictingKinds','duplicateKinds']){
  const a={...base.assessment,[key]:['win']};
  assert.equal(prepareManualRecoveryDecision({...base,assessment:a}).decision,'BLOCK');
 }
});
test('changed revision or inconsistent transaction blocks recovery',()=>{
 const r=prepareManualRecoveryDecision({...base,room:{...room,revision:8}});
 assert.equal(r.decision,'BLOCK');
 assert(r.blockingReasons.includes('ROOM_REVISION_NOT_EXPECTED'));
 const wrong=prepareManualRecoveryDecision({...base,
  assessment:{...base.assessment,classification:'REVISION_UNCHANGED_UNCONFIRMED'}});
 assert.equal(wrong.decision,'BLOCK');
});
test('finished game must have finished database room status',()=>{
 const r=prepareManualRecoveryDecision({...base,
  expectedGame:{over:true},room:{...room,status:'playing'}});
 assert.equal(r.decision,'BLOCK');
 assert(r.blockingReasons.includes('FINISHED_STATE_STATUS_MISMATCH'));
});
test('award event count mismatch requires inspection',()=>{
 const r=prepareManualRecoveryDecision({...base,
  expectedAwards:[{kind:'lucky_box'}]});
 assert.equal(r.decision,'BLOCK');
 assert(r.blockingReasons.includes('AWARD_COUNT_NOT_MATCHED'));
});
test('missing evidence fails closed',()=>{
 assert.equal(prepareManualRecoveryDecision({...base,room:null}).decision,'BLOCK');
});
