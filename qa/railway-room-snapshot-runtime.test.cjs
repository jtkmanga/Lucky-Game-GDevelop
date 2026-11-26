'use strict';
/**
 * Targeted no-network runtime contract for verifiedRoomSnapshot from the
 * existing Railway source. Does NOT instantiate WebSocket, connect Supabase,
 * prove UID auth, or verify a deployed service.
 *
 * This extracts the actual production function rather than rewriting its
 * normalization logic in the test. If its location/contract changes,
 * fail loudly and review the new production implementation.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Rules=require('../backend/railway/multi-board-rules.cjs');
const server=fs.readFileSync(path.join(__dirname,'../backend/railway/secure-server.cjs'),'utf8');
const start=server.indexOf('function verifiedRoomSnapshot(');
const end=server.indexOf('function transmit(',start);
assert(start>=0&&end>start,'Production snapshot function boundaries must exist');
const snippet=server.slice(start,end);
const verify=vm.runInNewContext(snippet+';verifiedRoomSnapshot', {Rules});

const game=(id)=>Rules.create(['Alice','Bob'],'vip',()=>0.23,id);

test('production snapshot preserves every persisted canonical board 1–5',()=>{
 for(let id=1;id<=5;id++){
  const original=game(id);
  const snapshot=verify({game:original,halted:false});
  assert.equal(snapshot,original);
  assert.equal(snapshot.board.id,id);
  assert.equal(Rules.assertRoomBoard(snapshot).id,id);
 }
});
test('legacy map one is normalized only in outbound snapshot, not stored state',()=>{
 const original=game(1);
 delete original.board;
 const saved=JSON.stringify(original);
 const snapshot=verify({game:original,halted:false});
 assert.notEqual(snapshot,original);
 assert.equal(JSON.stringify(original),saved);
 assert.deepEqual(JSON.parse(JSON.stringify(snapshot.board)),{
  version:1,id:1,
  snakes:JSON.parse(JSON.stringify(Rules.gameBoard(original).snakes)),
  ladders:JSON.parse(JSON.stringify(Rules.gameBoard(original).ladders))
 });
 assert.equal(Rules.assertRoomBoard(snapshot).id,1);
});
test('missing map two checkpoint is rejected',()=>{
 const original=game(2);
 delete original.board;
 assert.throws(()=>verify({game:original,halted:false}),/MISSING_BOARD_CHECKPOINT/);
});
test('explicit null map-one board is rejected, not treated as legacy',()=>{
 const original=game(1);
 original.board=null;
 assert.throws(()=>verify({game:original,halted:false}),/BOARD_CHECKPOINT_MISMATCH/);
});
test('halted room cannot produce outbound snapshot',()=>{
 assert.throws(()=>verify({game:game(1),halted:true}),/ROOM_UNAVAILABLE/);
});
