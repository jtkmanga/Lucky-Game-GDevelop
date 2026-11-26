'use strict';
/** Authored only: NEVER RUN under the current D06 testing pause.
 * These tests are NOT proof of five-map UI compatibility or real multiplayer.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const Multi=require('../backend/railway/multi-board-rules.cjs');
const {BOARDS}=require('../backend/railway/board-maps.cjs');
const {requireRuleTransition}=require('../backend/railway/rule-transition-guard.cjs');
const Legacy=require('../backend/railway/rules.js');
function create(id){return Multi.create(['A','B'],'vip',()=>0.1,id);}
test('all five maps are selectable with a persisted immutable layout',()=>{
 for(const board of BOARDS){
  const g=create(board.id);
  assert.equal(g.map,board.id);
  assert.deepEqual(g.board.snakes,board.snakes);
  assert.deepEqual(g.board.ladders,board.ladders);
 }
});
test('default adapter retains map 1 for frozen HTML v12',()=>{
 const g=Multi.create(['A','B'],'vip',()=>0.1);
 assert.equal(g.map,1);
 assert.deepEqual(g.board.snakes,Legacy.SNAKES);
 assert.deepEqual(g.board.ladders,Legacy.LADDERS);
});
test('snake and ladder travel are derived from the chosen room map',()=>{
 for(const board of BOARDS){
  for(const [kind,links] of [['snake',board.snakes],['ladder',board.ladders]]){
   const [start,end]=Object.entries(links)[0].map(Number);
   const before=create(board.id);
   before.players[0].pos=start-1;
   const after=structuredClone(before);
   const outcome=Multi.turn(after,1,()=>0.2);
   assert.equal(outcome.type,kind);
   assert.equal(outcome.position,end);
   assert.doesNotThrow(()=>requireRuleTransition(before,after,
    {type:'roll',actorIndex:0,dice:1,outcome},[]));
  }
 }
});
test('five-map room timeout is skip-only and preserves board',()=>{
 for(const board of BOARDS){
  const before=create(board.id),after=structuredClone(before);
  Multi.timeout(after);
  assert.equal(after.map,board.id);
  assert.equal(after.players[0].pos,before.players[0].pos);
  assert.doesNotThrow(()=>requireRuleTransition(before,after,
   {type:'timeout',actorIndex:0,dice:null,outcome:{}},[]));
 }
});
test('unknown or swapped board checkpoint is rejected before any turn',()=>{
 const g=create(2);g.board.snakes[96]=50;
 assert.throws(()=>Multi.turn(g,1),/BOARD_CHECKPOINT_MISMATCH/);
});
test('map selection is explicit and pseudo-random helper returns catalog ID',()=>{
 for(let i=0;i<5;i++)
  assert.equal(Multi.selectRandomBoard(()=>i/5+0.001),i+1);
});
