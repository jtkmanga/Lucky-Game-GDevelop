'use strict';
// SOURCE ONLY — local static guard tests; NOT executed / NOT a staging test.
// Tests never open a socket, create a Pool, or access Supabase.
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {poolConnectionOptions}=require('../backend/supabase/pg-tls-config.cjs');
const ca=path.resolve(__dirname,'../prod-ca-2021.crt');
const host='aws-1-ap-southeast-1.pooler.supabase.com';
const user='lucky_game_server_login.llbkxnazkliskzcureec';
const uri=(u=user,h=host,tail='')=>
  'postgresql://'+encodeURIComponent(u)+':not-a-real-password@'+h+':5432/postgres'+tail;
test('restricted session endpoint and CA select strict TLS without contacting DB',()=>{
 const c=poolConnectionOptions(uri(),ca);
 assert.equal(c.ssl.rejectUnauthorized,true);
 assert.ok(Buffer.isBuffer(c.ssl.ca));
 assert.ok(c.ssl.ca.toString().includes('BEGIN CERTIFICATE'));
 assert.equal(c.max,8);
 assert.ok(!Object.hasOwn(c,'password'));
});
test('rejects owner and unintended database identities',()=>{
 assert.throws(()=>poolConnectionOptions(uri('postgres.llbkxnazkliskzcureec'),ca),/restricted Session Pooler/);
 assert.throws(()=>poolConnectionOptions(uri('postgres'),ca),/restricted Session Pooler/);
});
test('rejects alternate endpoints, ports, databases and TLS query overrides',()=>{
 assert.throws(()=>poolConnectionOptions(uri(user,'evil.example'),ca),/restricted Session Pooler/);
 assert.throws(()=>poolConnectionOptions(uri().replace(':5432/',':6543/'),ca),/restricted Session Pooler/);
 assert.throws(()=>poolConnectionOptions(uri().replace('/postgres','/other'),ca),/restricted Session Pooler/);
 assert.throws(()=>poolConnectionOptions(uri(user,host,'?sslmode=disable'),ca),/restricted Session Pooler/);
});
test('fails closed for absent root CA and password',()=>{
 assert.throws(()=>poolConnectionOptions(uri(),'/missing/lucky-ca.crt'),/CA certificate missing or invalid/);
 assert.throws(()=>poolConnectionOptions(uri().replace(':not-a-real-password@',':@'),ca),/restricted Session Pooler/);
});
