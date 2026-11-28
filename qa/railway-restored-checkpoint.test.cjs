'use strict';
// Test packaged restore logic before register, timer or score side effects.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const backend = path.resolve(__dirname,'../railway-runtime/backend');
const Rules = require(path.join(backend,'railway/multi-board-rules.cjs'));
const source = fs.readFileSync(path.join(backend,'railway/secure-server.cjs'),'utf8');
const first=source.indexOf('async function restoreRoom(roomId){');
const last=source.indexOf('\nfunction ', first);
assert.ok(first>=0&&last>first);
const body=source.slice(first,last);
const code=body+'\nreturn restoreRoom;';
const id='aaaaaaaa-0000-4000-8000-000000000009', owner='aaaaaaaa-0000-4000-8000-000000000010';
const names=['A','B','C','D'];
const seats=names.map((name,index)=>({name, uid:'aaaaaaaa-0000-4000-8000-00000000000'+(1+index)}));

function setup(change){
 const row={mode:'free',status:'playing',lease_owner:owner,lease_epoch:'5',
   revision:'7',deadline_ms:'1950000000123',game_state:Rules.create(names,'free',()=>0,1),seats};
 change(row);
 const rooms=new Map(),sessions=new Map(),restoreTasks=new Map(),effects=[];
 const deps={pilot:null,rooms,sessions,restoreTasks,OWNER_ID:owner,LEASE_MS:30000,
  store:{async acquireRoomLease(...args){assert.deepEqual(args,[id,owner,30]);return {leaseEpoch:5};},
   async loadRoom(room){assert.equal(room,id);return row;}},
  capacity:()=>4,Rules,armPilotCutoff:()=>{},renewRoomLease:()=>effects.push('renew'),schedule:()=>effects.push('schedule')};
 const restore=Function(...Object.keys(deps),code)(...Object.values(deps));
 return {rooms,sessions,restoreTasks,effects,restore};
}

for(const [name,change] of [
 ['missing deadline',r=>r.deadline_ms=null],
 ['negative deadline',r=>r.deadline_ms=-1],
 ['blank revision',r=>r.revision=''],
 ['unsafe revision',r=>r.revision='9007199254740992'],
 ['terminal game in a playing room',r=>r.game_state.over=true],
 ['wrong mode in the game',r=>r.game_state.mode='vip'],
 ['wrong active seat index',r=>r.game_state.current=4],
 ['missing player',r=>r.game_state.players.pop()],
 ['seat order mismatch',r=>r.game_state.players[0].id=1],
 ['impossible position in a playing room',r=>r.game_state.players[0].pos=100],
])test('restore rejects '+name+' before scheduling a turn',async()=>{
 const a=setup(change);
 await assert.rejects(a.restore(id),/Invalid persisted room checkpoint/);
 assert.deepEqual([a.rooms.size,a.sessions.size,a.restoreTasks.size,a.effects.length],[0,0,0,0]);
});

test('restore accepts PostgreSQL BIGINT text and retains seat order',async()=>{
 const a=setup(()=>{});
 const room=await a.restore(id);
 assert.equal(room.revision,7);
 assert.equal(room.deadline,1950000000123);
 assert.deepEqual(room.seats.map(s=>s.uid),seats.map(s=>s.uid));
 assert.deepEqual(a.effects,['renew','schedule']);
 assert.equal(a.rooms.get(id),room);
 assert.equal(a.sessions.size,4);
});
