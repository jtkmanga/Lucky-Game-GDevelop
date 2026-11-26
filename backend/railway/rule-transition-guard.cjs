'use strict';
/**
 * Source-only guard for the tracked original ZIP Rules.turn/timeout contract.
 * Called after authoritative Rules execution and BEFORE any DB writes.
 * Does not generate dice, alter state, award points, or authorize recovery.
 * Does not replace approved real integration tests.
 */
function requireRuleTransition(before,after,receipt,awards){
 function fail(reason){throw Error('RULE_TRANSITION_MISMATCH:'+reason);}
 if(!before||!after||!receipt||!Array.isArray(before.players)||
    !Array.isArray(after.players)||before.players.length!==after.players.length||
    before.over||!Number.isSafeInteger(before.current)||before.current<0||
    before.current>=before.players.length||
    receipt.actorIndex!==before.current||!Array.isArray(awards))
  fail('ACTOR_OR_STATE');
 const actor=before.current,old=before.players[actor],now=after.players[actor];
 if(!old||!now||!Number.isSafeInteger(before.turn)||before.turn<1)
  fail('INVALID_TURN');
 const sameNonActor=before.players.every((player,i)=>{
  if(i===actor)return true;
  const p=after.players[i];
  return p&&p.pos===player.pos&&p.score===player.score&&
    p.luckyEarned===player.luckyEarned;
 });
 if(!sameNonActor)fail('OTHER_PLAYER_MUTATED');
 if(receipt.type==='timeout'){
  if(receipt.dice!==null||Object.keys(receipt.outcome||{}).length||
     awards.length||after.over||after.winner!==before.winner||
     after.giftUsed!==before.giftUsed||
     now.pos!==old.pos||now.score!==old.score||
     now.luckyEarned!==old.luckyEarned||
     after.current!==(actor+1)%before.players.length||
     after.turn!==before.turn+1||after.lastRoll!==null)
   fail('TIMEOUT_NOT_SKIP_ONLY');
  return;
 }
 const o=receipt.outcome,d=receipt.dice;
 if(receipt.type!=='roll'||!o||!Number.isInteger(d)||d<1||d>6||
    !Number.isSafeInteger(o.from)||!Number.isSafeInteger(o.landing)||
    !Number.isSafeInteger(o.position)||!Number.isSafeInteger(o.reward)||
    o.reward<0||typeof o.gameOver!=='boolean'||
    !['normal','snake','ladder','win'].includes(o.type)||
    !Array.isArray(o.events)||o.events.some(e=>typeof e!=='string'))
  fail('INVALID_ROLL_OUTCOME');
 const win=o.landing>=100;
 const lucky=awards.filter(a=>a.kind==='lucky_box');
 const winners=awards.filter(a=>a.kind==='win');
 if(o.from!==old.pos||o.landing!==old.pos+d||now.pos!==o.position||
    after.lastRoll!==d||after.over!==win||o.gameOver!==win||
    (win?o.type!=='win'||now.pos!==100||after.winner!==actor||
      after.current!==actor||after.turn!==before.turn:
      o.type==='win'||after.winner!==before.winner||
      after.current!==(actor+1)%before.players.length||
      after.turn!==before.turn+1)||
    now.score!==old.score+o.reward+(win?10:0)||
    now.luckyEarned!==old.luckyEarned+o.reward||
    (o.reward>0?(!after.giftUsed||before.giftUsed||
      now.pos!==before.gift||lucky.length!==1||
      lucky[0].points!==o.reward):lucky.length!==0)||
    winners.length!==(win?1:0)||
    (win&&winners[0].points!==10)||
    awards.some(a=>!['win','lucky_box'].includes(a.kind))||
    (o.reward===0&&after.giftUsed!==before.giftUsed))
  fail('OUTCOME_OR_AWARD_DIVERGED');
}
module.exports={requireRuleTransition};
