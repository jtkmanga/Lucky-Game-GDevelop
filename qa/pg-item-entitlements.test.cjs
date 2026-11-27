'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createItemEntitlementReader,READ_SQL}=require('../backend/railway/pg-item-entitlements.cjs');
const {restoreMatchItems}=require('../backend/railway/match-item-admission.cjs');
const seats=['a','b','c','d'].map(c=>({uid:c.repeat(8)+'-0000-4000-8000-000000000000',verified:true}));
const rows=seats.map(({uid},i)=>({uid,shield:i===0,doubleWin:i===1}));
test('dedicated reader uses only verified seat IDs and exactly one clocked query',async()=>{
 let called=0;
 const reader=createItemEntitlementReader({async query(query,args){
   assert.equal(query,READ_SQL);
   assert.equal((query.match(/clock_timestamp\(/g)||[]).length,1);
   assert.deepEqual(args,[seats.map(s=>s.uid)]);
   called++;
   return {rows:[...rows].reverse()};
 }});
 const original=seats.map(s=>({...s,shield:true,vip:true}));
 const snapshot=await reader(original);
 assert.equal(called,1);
 assert.deepEqual(snapshot.players.map(i=>[i.shieldRemaining,i.winMultiplier]),[[1,1],[0,2],[0,1],[0,1]]);
 snapshot.players[0].shieldRemaining=0;
 assert.deepEqual(restoreMatchItems({players:seats,matchItems:snapshot}),snapshot);
 assert.equal(called,1);
});
test('invalid or duplicate roster fails before touching the reader',async()=>{
 const reader=createItemEntitlementReader({query(){assert.fail('unexpected query');}});
 for(const roster of [null,[],Array(2),[seats[0],seats[0]],[seats[0],{uid:seats[1].uid}]]){
   await assert.rejects(reader(roster),/INVALID_ITEM_ROSTER/);
 }
});
test('empty, partial, wrong identity and unavailable results are not treated as no grants',async()=>{
 const allowed=rows.slice(0,2);
 for(const returned of [[],allowed.slice(0,1),[allowed[0],{...allowed[1],uid:seats[2].uid}],
   [allowed[0],{...allowed[1],doubleWin:1}]]){
   await assert.rejects(createItemEntitlementReader({query:async()=>({rows:returned})})(seats.slice(0,2)),/ITEM/);
 }
 await assert.rejects(createItemEntitlementReader({query:async()=>{throw Error('connection lost');}})(seats.slice(0,2)),/connection lost/);
 const none=await createItemEntitlementReader({query:async()=>({rows:allowed.map(x=>({uid:x.uid,shield:false,doubleWin:false}))})})(seats.slice(0,2));
 assert.deepEqual(none.players.map(i=>[i.shieldRemaining,i.winMultiplier]),[[0,1],[0,1]]);
});
