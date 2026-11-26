'use strict';
/**
 * FUTURE QA ONLY. Owner D06 prohibits executing tests at this checkpoint.
 * These source-contract assertions are not browser, database or multiplayer tests.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const load=p=>fs.readFileSync(path.join(root,p),'utf8');
test('generated v12 bridge rejects missing canonical board on online state',()=>{
 const builder=load('tools/prepare_railway_secure.py');
 assert.match(builder,/msg\.game\?\.board&&luckyBoardLayout\(msg\.game\)/);
 assert.match(builder,/luckySeenRoomBoard\?\.roomId===msg\.roomId/);
 assert.match(builder,/sameLinks\(board\.snakes,expected\.snakes\)/);
 assert.match(builder,/sameLinks\(board\.ladders,expected\.ladders\)/);
});
test('generated v12 bridge uses canonical catalog and no CSS changes',()=>{
 const builder=load('tools/prepare_railway_secure.py');
 assert.match(builder,/board-definitions\.json/);
 assert.match(builder,/luckyRenderBoardArt\(board\)/);
 assert.match(builder,/luckyBoardLayout\(localGame\)/);
 assert.doesNotMatch(builder,/html=html\.replace\(['"]<style/);
});
test('Railway source validates snapshot for every resume and multicast',()=>{
 const server=load('backend/railway/secure-server.cjs');
 assert.match(server,/function verifiedRoomSnapshot\(room\)/);
 assert.match(server,/resumedGame=verifiedRoomSnapshot\(room\)/);
 assert.match(server,/game=verifiedRoomSnapshot\(room\)/);
 assert.match(server,/Rules\.assertRoomBoard\(row\.game_state\)/);
});
test('ambiguous COMMIT forensic variables are declared outside try',()=>{
 const server=load('backend/railway/secure-server.cjs');
 const advance=server.slice(server.indexOf('async function advance('),
   server.indexOf('async function handle('));
 assert.match(advance,/let expectedRevision=null,expectedGame=null,expectedAwards=\[\];\s*try\{/);
 assert.match(advance,/expectedGame=next;\s*expectedAwards=awards;/);
 assert.match(advance,/inspectAmbiguousCommit\(room,expectedRevision,expectedGame,expectedAwards\)/);
 assert.doesNotMatch(advance,/const expectedRevision=room\.revision;/);
});

test('legacy map-one online snapshot adds canonical board without mutating room state',()=>{
 const server=load('backend/railway/secure-server.cjs');
 const segment=server.slice(server.indexOf('function verifiedRoomSnapshot('),
   server.indexOf('function transmit('));
 assert.match(segment,/Rules\.assertRoomBoard\(room\.game\)/);
 assert.match(segment,/Object\.hasOwn\(room\.game,'board'\)/);
 assert.match(segment,/return \{\.\.\.room\.game,board:\{version:1,id:board\.id/);
 assert.doesNotMatch(segment,/room\.game\.board\s*=/);
 assert.doesNotMatch(segment,/store\.|await\s/);
});
test('resume and broadcast use canonical snapshot and halt invalid board',()=>{
 const server=load('backend/railway/secure-server.cjs');
 const tx=server.slice(server.indexOf('function transmit('),
   server.indexOf('function takeOut('));
 assert.match(tx,/game=verifiedRoomSnapshot\(room\)/);
 assert.match(tx,/haltRoom\(room,'INVALID_ROOM_BOARD'\)/);
 assert.match(tx,/send\(s\.ws,\{type:'state'/);
 const resume=server.slice(server.indexOf('let resumedGame;'),
   server.indexOf("event:{type:'resume'}"));
 assert.match(resume,/resumedGame=verifiedRoomSnapshot\(room\)/);
 assert.match(resume,/haltRoom\(room,'INVALID_RESUME_BOARD'\)/);
 assert.match(resume,/game:resumedGame/);
});
