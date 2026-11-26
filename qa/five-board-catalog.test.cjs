'use strict';
/** Prepared-only tests. DO NOT RUN until the owner explicitly unpauses tests.
 * Board catalog is NOT enabled in the multiplayer runtime yet.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const {BOARDS,getBoard,pickBoard,eligibleGiftTiles,validate}=
 require('../backend/railway/board-maps.cjs');
const Original=require('../backend/railway/rules.js');

test('five numbered distinct board layouts are available',()=>{
 assert.equal(BOARDS.length,5);
 assert.deepEqual(BOARDS.map(b=>b.id),[1,2,3,4,5]);
 const definitions=BOARDS.map(b=>JSON.stringify([b.snakes,b.ladders]));
 assert.equal(new Set(definitions).size,5);
});
test('original board one matches the unchanged ZIP rules',()=>{
 assert.deepEqual(getBoard(1).snakes,Original.SNAKES);
 assert.deepEqual(getBoard(1).ladders,Original.LADDERS);
});
test('all board snakes descend and ladders ascend without tile collisions',()=>{
 for(const board of BOARDS)assert.equal(validate(board),true);
});
test('server-selected board is deterministic for controlled randomness',()=>{
 for(let i=0;i<5;i++)
  assert.equal(pickBoard(()=>i/5+0.000001).id,i+1);
 assert.throws(()=>pickBoard(()=>1),/INVALID_BOARD_RANDOM/);
 assert.throws(()=>getBoard(6),/UNKNOWN_BOARD/);
});
test('Lucky Box tile never overlaps special starts or destinations',()=>{
 for(const board of BOARDS){
  const excluded=new Set([...Object.keys(board.snakes),
   ...Object.keys(board.ladders),...Object.values(board.snakes),
   ...Object.values(board.ladders)].map(Number));
  const tiles=eligibleGiftTiles(board);
  assert(tiles.length>0);
  assert(tiles.every(tile=>tile>=12&&tile<=89&&!excluded.has(tile)));
 }
});
