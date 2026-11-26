'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {BOARDS}=require('../backend/railway/board-maps.cjs');
const Rules=require('../backend/railway/multi-board-rules.cjs');
const {requireRuleTransition}=require('../backend/railway/rule-transition-guard.cjs');
const expected=[
 {name:'🌿 สวนมรกต',snakes:{80:50,94:68,59:31,37:17,98:76},ladders:{10:50,65:85,4:25,28:53,42:61,72:91}},
 {name:'🎋 ป่าไผ่',snakes:{23:8,47:26,63:41,79:55,95:70},ladders:{3:22,15:39,31:49,51:76,68:89,84:97}},
 {name:'🏯 วิหารโบราณ',snakes:{29:11,44:19,66:38,81:57,97:73},ladders:{6:27,17:36,33:58,46:67,62:88,75:93}},
 {name:'🐚 อ่าวปะการัง',snakes:{26:9,49:27,70:43,86:59,99:74},ladders:{8:30,18:42,35:54,50:72,64:83,77:96}},
 {name:'☁️ เมืองเมฆ',snakes:{34:14,52:28,73:45,88:61,96:78},ladders:{2:19,13:32,25:48,40:65,57:81,69:92}}
];
const players=['A','B','C','D'];
const create=id=>Rules.create(players,'free',()=>0.18,id);
test('all 5 maps exactly match the owner-selected original V99 rules.js',()=>{
 assert.equal(BOARDS.length,5);
 for(let i=0;i<5;i++){
  assert.equal(BOARDS[i].id,i+1);
  assert.equal(BOARDS[i].name,expected[i].name);
  assert.deepEqual(BOARDS[i].snakes,expected[i].snakes);
  assert.deepEqual(BOARDS[i].ladders,expected[i].ladders);
 }
});
test('four-player Free, two-player VIP, and exactly one board snapshot per room',()=>{
 for(let id=1;id<=5;id++){
  const g=create(id);assert.equal(g.players.length,4);
  assert.equal(g.map,id);assert.equal(g.board.id,id);
  assert.deepEqual(g.board.snakes,BOARDS[id-1].snakes);
  assert.deepEqual(g.board.ladders,BOARDS[id-1].ladders);
  assert.equal(Rules.create(['A','B'],'vip',()=>0.18,id).players.length,2);
 }
});
test('all snake and ladder origins on all five maps use selected map',()=>{
 for(let id=1;id<=5;id++)for(const kind of ['snakes','ladders']){
  for(const [from,end] of Object.entries(BOARDS[id-1][kind])){
   const before=create(id);before.players[0].pos=Number(from)-1;
   const after=structuredClone(before);const outcome=Rules.turn(after,1,()=>0.2);
   assert.equal(after.players[0].pos,end,`map ${id} ${kind} ${from}`);
   assert.equal(outcome.type,kind==='snakes'?'snake':'ladder');
   assert.doesNotThrow(()=>requireRuleTransition(before,after,
    {type:'roll',actorIndex:0,dice:1,outcome},[]));
  }
 }
});
test('20-second timeout skips without automatic roll across maps',()=>{
 for(let id=1;id<=5;id++){
  const g=create(id),pos=g.players[0].pos;
  const event=Rules.timeout(g);
  assert.match(event,/20 วินาที/);assert.equal(g.players[0].pos,pos);
  assert.equal(g.current,1);assert.equal(g.lastRoll,null);assert.equal(g.board.id,id);
 }
});
test('Lucky Box awards exactly once and winner at 100',()=>{
 for(let id=1;id<=5;id++){
  const g=create(id),gift=g.gift;
  g.players[0].pos=gift-1;
  const result=Rules.turn(g,1,()=>0);
  assert.equal(result.reward,10);assert.equal(g.giftUsed,true);
  g.current=0;g.players[0].pos=99;
  const end=Rules.turn(g,1,()=>0.5);assert.equal(end.type,'win');
  assert.equal(g.over,true);assert.equal(g.players[0].pos,100);
  assert.equal(g.players[0].score,20);
 }
});
