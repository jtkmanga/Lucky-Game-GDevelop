'use strict';
/* PREPARED ONLY: the owner has paused ALL game tests.
 * Do not execute this file without scoped authorization.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const Rules=require('../backend/railway/rules.js');
const MultiBoardRules=require('../backend/railway/multi-board-rules.cjs');
const {requireRuleTransition}=require('../backend/railway/rule-transition-guard.cjs');
function scene({pos=0,roll=1,gift=null}={}){
 const before=Rules.create(['Alice','Bob'],'vip',()=>0.25);
 before.players[0].pos=pos;
 if(gift!==null)before.gift=gift;
 const after=structuredClone(before);
 const outcome=Rules.turn(after,roll,()=>0);
 const awards=[];
 if(outcome.reward>0)awards.push({kind:'lucky_box',points:outcome.reward});
 if(after.over)awards.push({kind:'win',points:10});
 const receipt={type:'roll',actorIndex:0,dice:roll,outcome};
 return {before,after,receipt,awards};
}
test('ordinary server roll agrees with persisted actor and outcome',()=>{
 const x=scene({pos:0,roll:2});
 assert.doesNotThrow(()=>requireRuleTransition(x.before,x.after,x.receipt,x.awards));
});
test('server snake and ladder moves agree with immutable board mapping',()=>{
 for(const x of [scene({pos:3,roll:1}),scene({pos:79,roll:1})]){
  assert.doesNotThrow(()=>requireRuleTransition(x.before,x.after,x.receipt,x.awards));
 }
});
test('server overshoot winner and +10 agree with receipt',()=>{
 const x=scene({pos:99,roll:6});
 assert.equal(x.after.over,true);
 assert.doesNotThrow(()=>requireRuleTransition(x.before,x.after,x.receipt,x.awards));
});
test('Lucky Box points and position agree with receipt',()=>{
 const x=scene({pos:14,roll:1,gift:15});
 assert.equal(x.receipt.outcome.reward,10);
 assert.doesNotThrow(()=>requireRuleTransition(x.before,x.after,x.receipt,x.awards));
});
test('server timeout skips without moving a token or awarding points',()=>{
 const before=Rules.create(['Alice','Bob'],'vip',()=>0.5);
 const after=structuredClone(before);Rules.timeout(after);
 assert.doesNotThrow(()=>requireRuleTransition(before,after,{
  type:'timeout',actorIndex:0,dice:null,outcome:{}
 },[]));
});
test('changed player position is rejected before database writes',()=>{
 const x=scene({pos:0,roll:2});x.after.players[0].pos=40;
 assert.throws(()=>requireRuleTransition(x.before,x.after,x.receipt,x.awards),
  /RULE_TRANSITION_MISMATCH/);
});
test('wrong actor or dice is rejected before database writes',()=>{
 const x=scene({pos:0,roll:3});
 assert.throws(()=>requireRuleTransition(x.before,x.after,{
  ...x.receipt,actorIndex:1
 },x.awards),/RULE_TRANSITION_MISMATCH/);
 assert.throws(()=>requireRuleTransition(x.before,x.after,{
  ...x.receipt,dice:6
 },x.awards),/RULE_TRANSITION_MISMATCH/);
});
test('winner and Lucky Box reward tampering are rejected',()=>{
 const win=scene({pos:99,roll:6});win.awards[0].points=20;
 assert.throws(()=>requireRuleTransition(win.before,win.after,win.receipt,win.awards),
  /RULE_TRANSITION_MISMATCH/);
 const box=scene({pos:14,roll:1,gift:15});box.awards[0].points=50;
 assert.throws(()=>requireRuleTransition(box.before,box.after,box.receipt,box.awards),
  /RULE_TRANSITION_MISMATCH/);
});
test('timeout cannot move a player or pretend to roll',()=>{
 const before=Rules.create(['Alice','Bob'],'vip',()=>0.5);
 const after=structuredClone(before);Rules.timeout(after);after.players[0].pos++;
 assert.throws(()=>requireRuleTransition(before,after,{
  type:'timeout',actorIndex:0,dice:null,outcome:{}
 },[]),/RULE_TRANSITION_MISMATCH/);
});

function free4LuckyBoxScene(boardId,giftUsed){
 const before=MultiBoardRules.create(['A','B','C','D'],'free',()=>0.25,boardId);
 // Square 16 is an eligible non-transition gift tile on both tested maps.
 before.gift=16;before.giftUsed=giftUsed;before.players[0].pos=15;
 assert.equal(MultiBoardRules.assertRoomBoard(before).id,boardId);
 const after=structuredClone(before);
 const outcome=MultiBoardRules.turn(after,1,()=>0);
 const receipt={type:'roll',actorIndex:0,dice:1,outcome};
 const awards=outcome.reward>0?[{kind:'lucky_box',points:outcome.reward}]:[];
 return {before,after,receipt,awards};
}
for(const boardId of [1,2]){
 test(`Free4 map ${boardId} must record a Lucky Box reward on an unused gift square`,()=>{
  const x=free4LuckyBoxScene(boardId,false);
  assert.equal(x.receipt.outcome.position,16);
  assert.equal(x.receipt.outcome.reward,10);
  assert.equal(x.after.giftUsed,true);
  assert.deepEqual(x.awards,[{kind:'lucky_box',points:10}]);
  assert.doesNotThrow(()=>requireRuleTransition(x.before,x.after,x.receipt,x.awards));
  const after=structuredClone(x.after);
  after.giftUsed=false;
  after.players[0].score=x.before.players[0].score;
  after.players[0].luckyEarned=x.before.players[0].luckyEarned;
  const receipt={...x.receipt,outcome:{...x.receipt.outcome,reward:0}};
  assert.throws(()=>requireRuleTransition(x.before,after,receipt,[]),
   /RULE_TRANSITION_MISMATCH:LUCKY_BOX_REWARD_REQUIRED/);
 });
 test(`Free4 map ${boardId} does not award a second reward on a used gift square`,()=>{
  const x=free4LuckyBoxScene(boardId,true);
  assert.equal(x.receipt.outcome.position,16);
  assert.equal(x.receipt.outcome.reward,0);
  assert.equal(x.after.giftUsed,true);
  assert.deepEqual(x.awards,[]);
  assert.doesNotThrow(()=>requireRuleTransition(x.before,x.after,x.receipt,x.awards));
 });
}
