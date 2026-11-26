'use strict';
/**
 * Authored only. DO NOT execute while owner testing pause D06 applies.
 * Pure contract checks cannot prove actual browser rendering, OAuth, WSS,
 * Railway recovery or PostgreSQL durability.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const canonical=require('../backend/railway/board-definitions.json');
const {BOARDS,getBoard,eligibleGiftTiles}=require('../backend/railway/board-maps.cjs');
const Rules=require('../backend/railway/multi-board-rules.cjs');
test('server catalog and browser embedding input use identical versioned source',()=>{
 assert.equal(canonical.version,1);
 assert.deepEqual(BOARDS.map(b=>b.id),[1,2,3,4,5]);
 for(const spec of canonical.boards){
  const board=getBoard(spec.id);
  assert.deepEqual(board.snakes,spec.snakes);
  assert.deepEqual(board.ladders,spec.ladders);
 }
});
test('every persisted map is restored with identical authoritative layout',()=>{
 for(const spec of canonical.boards){
  const original=Rules.create(['Alice','Bob'],'vip',()=>0.12,spec.id);
  const snapshot=JSON.parse(JSON.stringify(original));
  assert.equal(Rules.assertRoomBoard(snapshot).id,spec.id);
  assert(eligibleGiftTiles(getBoard(spec.id)).includes(snapshot.gift));
 }
});
test('unknown map ID or swapped room board cannot be restored',()=>{
 const g=Rules.create(['Alice','Bob'],'vip',()=>0.23,2);
 g.map=3;
 assert.throws(()=>Rules.assertRoomBoard(g),/BOARD_CHECKPOINT_MISMATCH/);
});
test('same room with a substituted snake exit is rejected before restore',()=>{
 const g=Rules.create(['Alice','Bob'],'vip',()=>0.23,4);
 g.board.snakes['99']=67;
 assert.throws(()=>Rules.assertRoomBoard(g),/BOARD_CHECKPOINT_MISMATCH/);
});
test('invalid Lucky Box tile cannot be restored or used on a turn',()=>{
 const g=Rules.create(['Alice','Bob'],'vip',()=>0.23,5);
 g.gift=Number(Object.keys(g.board.snakes)[0]);
 assert.throws(()=>Rules.assertRoomBoard(g),/INVALID_ROOM_GIFT_FOR_BOARD/);
 assert.throws(()=>Rules.turn(g,2),/INVALID_ROOM_GIFT_FOR_BOARD/);
});
test('map1 legacy state without versioned board remains recoverable',()=>{
 const g=Rules.create(['Alice','Bob'],'vip',()=>0.23,1);
 delete g.board;
 assert.equal(Rules.assertRoomBoard(g).id,1);
});

test('legacy map-one checkpoint can be normalized without mutating persisted snapshot',()=>{
 const g=Rules.create(['Alice','Bob'],'vip',()=>0.23,1);
 delete g.board;
 const persisted=JSON.stringify(g);
 const canonicalBoard=Rules.assertRoomBoard(g);
 const online={...g,board:{version:1,id:canonicalBoard.id,
  snakes:canonicalBoard.snakes,ladders:canonicalBoard.ladders}};
 assert.equal(JSON.stringify(g),persisted);
 assert.equal(online.map,1);
 assert.deepEqual(online.board,{version:1,id:1,
  snakes:getBoard(1).snakes,ladders:getBoard(1).ladders});
 assert.equal(Rules.assertRoomBoard(online).id,1);
});
test('explicit corrupt or missing map checkpoint must not silently become board one',()=>{
 const valid=Rules.create(['Alice','Bob'],'vip',()=>0.23,2);
 const missing={...valid};delete missing.board;
 assert.throws(()=>Rules.assertRoomBoard(missing),/MISSING_BOARD_CHECKPOINT/);
 for(const badBoard of [null,{}, {...valid.board,id:1},
   {...valid.board,version:2}]){
  assert.throws(()=>Rules.assertRoomBoard({...valid,board:badBoard}),
    /BOARD_CHECKPOINT_MISMATCH/);
 }
 const old=Rules.create(['Alice','Bob'],'vip',()=>0.23,1);
 old.board=null;
 assert.throws(()=>Rules.assertRoomBoard(old),/BOARD_CHECKPOINT_MISMATCH/);
});
test('persisted map is stable across reconnection copies for every catalog map',()=>{
 for(const id of [1,2,3,4,5]){
  const room=Rules.create(['Alice','Bob'],'vip',()=>0.23,id);
  const saved=JSON.stringify(room);
  const reconnectA=JSON.parse(saved),reconnectB=JSON.parse(saved);
  const boardA=Rules.assertRoomBoard(reconnectA);
  const boardB=Rules.assertRoomBoard(reconnectB);
  assert.equal(boardA.id,id);
  assert.deepEqual(boardA,boardB);
  assert.deepEqual(reconnectA.board,reconnectB.board);
  assert.equal(reconnectA.gift,reconnectB.gift);
 }
});
