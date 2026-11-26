'use strict';
// Source-only local unit test. No server listener, DB connection, OAuth or costs.
const test=require('node:test');
const assert=require('node:assert/strict');
const {healthResponse}=require('../backend/railway/health-readiness.cjs');
test('starting before DB preflight returns 503',()=>{
 assert.deepEqual(healthResponse(false,false),{
  statusCode:503,body:{ok:false,status:'starting',mode:'draft-auth-required'}
 });
});
test('ready after preflight/listening returns 200',()=>{
 assert.deepEqual(healthResponse(true,false),{
  statusCode:200,body:{ok:true,status:'ready',mode:'draft-auth-required'}
 });
});
test('stopping overrides ready and returns 503',()=>{
 assert.deepEqual(healthResponse(true,true),{
  statusCode:503,body:{ok:false,status:'stopping',mode:'draft-auth-required'}
 });
});
test('not ready while stopping returns 503',()=>{
 assert.equal(healthResponse(false,true).statusCode,503);
});
