'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assertNativeInputs}=require('./helpers/disposable-pg17.cjs');
const roster=[1,2,3,4].map(n=>'aaaaaaaa-0000-4000-8000-'+String(n).padStart(12,'0'));
test('database fixture only accepts a local absolute binary path',()=>{
 for(const bad of [undefined,'pg17/bin','postgresql://target/db'])
  assert.throws(()=>assertNativeInputs(bad,roster),/absolute local/);
 assert.doesNotThrow(()=>assertNativeInputs('/fixture/pg17/bin',roster));
});
test('database fixture rejects duplicate or non-fixture identities before SQL setup',()=>{
 for(const bad of [[...roster.slice(0,3),roster[0]],['bbbbbbbb-1111-4000-8000-000000000001',...roster.slice(1)],roster.slice(0,3),[...roster.slice(0,3),"')"]])
  assert.throws(()=>assertNativeInputs('/fixture/pg17/bin',bad),/synthetic fixture/);
});
