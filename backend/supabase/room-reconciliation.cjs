'use strict';
/**
 * Read-only forensic classification of an uncertain game transition.
 * All inputs are server-generated, never supplied by a WebSocket player.
 * The classification is evidence for human/operator review, NOT a resume
 * command and NEVER authorizes rerolling dice or awarding points.
 */
const {isDeepStrictEqual}=require('node:util');
function classifyRoomReconciliation({room,ledger,expectedRevision,expectedGame,awards,ownerId,leaseEpoch}){
 if(!room)return {classification:'ROOM_MISSING',manualReview:true};
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||
    !Array.isArray(ledger)||!Array.isArray(awards)||
    !expectedGame||typeof expectedGame!=='object')
  return {classification:'INVALID_EVIDENCE',manualReview:true};
 const revision=Number(room.revision);
 const ownerMatches=room.lease_owner===ownerId&&Number(room.lease_epoch)===leaseEpoch;
 const names=['win','lucky_box'];
 const rewardRows=ledger.filter(e=>names.includes(e.kind));
 const duplicateKinds=names.filter(k=>rewardRows.filter(e=>e.kind===k).length>1);
 const eventRows=ledger.filter(e=>awards.some(a=>a.eventId===e.event_id));
 // An unexpected reward event may be legitimate from an earlier turn.
 // We cannot attribute one ambiguous transition merely from room+ledger;
 // never treat an unexpected event as proof of corruption automatically.
 const unexpectedEvents=ledger.filter(e=>!awards.some(a=>a.eventId===e.event_id))
   .map(e=>e.kind);
 const missingEvents=awards.filter(a=>!eventRows.some(e=>e.event_id===a.eventId)).map(a=>a.kind);
 const mismatchedEvents=awards.filter(a=>{
   const row=eventRows.find(e=>e.event_id===a.eventId);
   return row&&(row.uid!==a.uid||row.kind!==a.kind||row.mode!==a.mode||
      Number(row.points)!==a.points);
 }).map(a=>a.kind);
 const sameState=isDeepStrictEqual(room.game_state,expectedGame);
 const matchedExpected=missingEvents.length===0&&mismatchedEvents.length===0;
 let classification='UNRESOLVED';
 if(duplicateKinds.length||mismatchedEvents.length)classification='LEDGER_CONFLICT';
 else if(revision===expectedRevision+1){
   classification=sameState&&matchedExpected?'COMMIT_EVIDENCE_CONSISTENT':'STATE_OR_AWARD_MISMATCH';
 }else if(revision===expectedRevision){
   // This says only that expected revision is unchanged, not that a retry is
   // safe. A concurrent writer or lost historical reward may still exist.
   classification=awards.some(a=>eventRows.some(e=>e.event_id===a.eventId))?
     'LEDGER_WITH_UNCHANGED_REVISION':'REVISION_UNCHANGED_UNCONFIRMED';
 }else classification='REVISION_DIVERGED';
 return {classification,manualReview:true,expectedRevision,storedRevision:revision,
   ownerMatches,roomStatus:room.status,
   expectedAwards:awards.length,matchingAwardEvents:awards.length-missingEvents.length-mismatchedEvents.length,
   missingKinds:missingEvents,conflictingKinds:mismatchedEvents,
   duplicateKinds,unexpectedKinds:unexpectedEvents,
   gameStateMatches:sameState};
}
module.exports={classifyRoomReconciliation};
