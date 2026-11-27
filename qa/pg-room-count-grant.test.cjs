'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createPgRoomCountGrant} = require('../backend/admin/pg-room-count-grant.cjs');
const id = n => 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(n).padStart(12,'0');
const token = n => 'synthetic-credential-without-any-external-authority-' + n;
const cmd = {targetUid:id(3),desired:true,requestId:id(4),actorUid:id(9)};
function fixture(t) {
  const origin = 'https://llbkxnazkliskzcureec.supabase.co';
  for (const [key,value] of Object.entries({SUPABASE_URL:origin,SUPABASE_PUBLISHABLE_KEY:'fixture'})) {
    const old = process.env[key];
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key]=old; });
    process.env[key]=value;
  }
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(url,origin+'/auth/v1/user');
    const n=[1,2].find(i=>options.headers.authorization==='Bearer '+token(i));
    return n ? Response.json({id:id(n),aud:'authenticated'}) : new Response(null,{status:401});
  });
  const f={calls:[],releases:[],responses:[],states:[],checkouts:0};
  const config={host:'db.invalid',port:5432,database:'fixture',login:'qa_operator_login',connectionMode:'verified-direct'};
  const pool={options:{...config,user:config.login,ssl:{ca:'fixture',rejectUnauthorized:true},
    connectionTimeoutMillis:1000,statement_timeout:2000},async connect(){
    f.checkouts++;
    return {getTransactionStatus:()=>f.states.shift() ?? 'I',query:async q=>{
      f.calls.push(q);
      assert.match(q.text,/SELECT game\.set_room_count_grant\(\$1::pg_catalog.uuid,\$2::pg_catalog.bool,\s*\$3::pg_catalog.uuid,\$4::pg_catalog.uuid\)/);
      assert.match(q.text,/WHERE session_user::pg_catalog.text = \$5 AND current_user = 'lucky_count_operator'/);
      const result=f.responses.shift();
      if(result instanceof Error) throw result;
      return result;
    },release:discard=>f.releases.push(discard)};
  }};
  f.config={...config,operatorPool:pool};
  f.run=createPgRoomCountGrant(f.config);
  return f;
}
const answer=changed=>({rows:[{changed}],rowCount:1});
test('binds verified actors on the same login; preserves SQL denial and false outcome',async t=>{
  const f=fixture(t);
  f.responses.push(answer(true),Error('Request ID conflict'),answer(false));
  assert.equal(await f.run(token(1),cmd),true);
  await assert.rejects(f.run(token(2),cmd),/ID conflict/);
  assert.equal(await f.run(token(1),{...cmd,requestId:id(5)}),false);
  assert.deepEqual(f.calls.map(q=>q.values),[[1,4],[2,4],[1,5]].map(([actor,request])=>
    [id(3),true,id(request),id(actor),'qa_operator_login','fixture']));
});
test('fails closed on input, auth, settings, filtered session or malformed result',async t=>{
  const f=fixture(t);
  for (const fields of [{connectionMode:'transaction'},{host:'other.invalid'},{login:'postgres'}])
    assert.throws(()=>createPgRoomCountGrant({...f.config,...fields}),/Unsafe/);
  f.config.operatorPool.options.ssl.rejectUnauthorized=false;
  assert.throws(()=>createPgRoomCountGrant(f.config),/Unsafe/);
  f.config.operatorPool.options.ssl.rejectUnauthorized=true;
  await assert.rejects(f.run(token(1),{...cmd,desired:'true'}),/Invalid/);
  await assert.rejects(f.run(token(9),cmd),/UNAUTHENTICATED/);
  assert.equal(f.checkouts,0);
  f.responses.push({rows:[],rowCount:0},answer('true'));
  await assert.rejects(f.run(token(1),cmd),/Unsafe operator session/);
  await assert.rejects(f.run(token(1),cmd),/Unconfirmed/);
  assert.deepEqual(f.releases,[true,true]);
});
test('lost reply discards client; caller retries exact ID with no automatic replay',async t=>{
  const f=fixture(t);
  f.responses.push(Error('lost acknowledgement'),answer(true));
  await assert.rejects(f.run(token(1),cmd),/lost acknowledgement/);
  assert.equal(f.calls.length,1);
  assert.equal(await f.run(token(1),cmd),true);
  assert.deepEqual(f.calls[0].values,f.calls[1].values);
  assert.deepEqual(f.releases,[true,false]);
});

test('transaction status gates the mutation and the claimed acknowledgement',async t=>{
  const f=fixture(t);
  f.states.push('T');
  await assert.rejects(f.run(token(1),cmd),/Unsafe operator transaction state/);
  assert.equal(f.calls.length,0);
  f.states.push('I','T');
  f.responses.push(answer(true));
  await assert.rejects(f.run(token(1),cmd),/Unconfirmed grant transaction state/);
  assert.deepEqual(f.releases,[true,true]);
});
