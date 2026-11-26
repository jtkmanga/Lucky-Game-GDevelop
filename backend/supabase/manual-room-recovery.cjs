'use strict';
/**
 * Human-gated recovery decision preparation only. NEVER changes a room,
 * grants scores, sends messages, renews leases, or replays a dice roll.
 * Designed for an operator to review a halted room using consistent,
 * server-origin evidence. NOT a production resume authorization mechanism.
 */
function prepareManualRecoveryDecision({assessment,room,expectedRevision,expectedGame,expectedAwards}){
 const blocking=[];
 if(!assessment||typeof assessment!=='object'||!room){
  return {decision:'BLOCK',blockingReasons:['MISSING_EVIDENCE'],requiresOperator:true,automaticResume:false};
 }
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||
    !expectedGame||!Array.isArray(expectedAwards))blocking.push('INVALID_EXPECTATION');
 if(assessment.classification!=='COMMIT_EVIDENCE_CONSISTENT')
  blocking.push('TRANSACTION_NOT_CONSISTENT');
 if(assessment.ownerMatches!==true)blocking.push('LEASE_OWNERSHIP_CHANGED');
 if(assessment.gameStateMatches!==true)blocking.push('GAME_STATE_MISMATCH');
 if(Number(room.revision)!==expectedRevision+1)
  blocking.push('ROOM_REVISION_NOT_EXPECTED');
 if(!['playing','finished'].includes(room.status))blocking.push('ROOM_STATUS_NOT_REUSABLE');
 if(assessment.missingKinds?.length||assessment.conflictingKinds?.length||
    assessment.duplicateKinds?.length)blocking.push('AWARD_LEDGER_CONFLICT');
 if(assessment.matchingAwardEvents!==expectedAwards.length)
  blocking.push('AWARD_COUNT_NOT_MATCHED');
 if(expectedAwards.some(a=>a.kind==='win')&&room.status!=='finished')
  blocking.push('WIN_WITHOUT_FINISHED_ROOM');
 if(expectedGame.over===true&&room.status!=='finished')
  blocking.push('FINISHED_STATE_STATUS_MISMATCH');
 if(expectedGame.over===false&&room.status!=='playing')
  blocking.push('PLAYING_STATE_STATUS_MISMATCH');
 const ready=blocking.length===0;
 return {
  decision:ready?'REVIEW_FOR_OPERATOR_APPROVAL':'BLOCK',
  blockingReasons:blocking,
  requiresOperator:true,
  automaticResume:false,
  nextAction:ready?'VERIFY_FRESH_LEASE_AND_APPROVE_SEPARATE_RECOVERY':
                   'INVESTIGATE_CANONICAL_DB_WITHOUT_MUTATIONS'
 };
}
module.exports={prepareManualRecoveryDecision};
