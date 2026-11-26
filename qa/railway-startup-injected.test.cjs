'use strict';
// No Supabase, external socket, HTTP/WS process, migrations or Secrets.
// Exercises the SAME bootstrap function used by secure-server.cjs with
// injected DB health, recovery and a fake EventEmitter listener.
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {beginListening}=require('../backend/railway/startup-lifecycle.cjs');
function serverFake(events,{listenError}={}){
 const server=new EventEmitter();
 server.listen=(port,host)=>{
  events.push('listen');
  assert.equal(port,8080);
  assert.equal(host,'0.0.0.0'); // fake method, never binds a socket
  queueMicrotask(()=>listenError?server.emit('error',listenError):server.emit('listening'));
 };
 return server;
}
function deps(events,overrides={}){
 return {
  health:async()=>{events.push('health');},
  recover:async()=>{events.push('recover');},
  server:serverFake(events),
  port:8080,
  shouldStop:()=>false,
  onReady:()=>events.push('ready'),
  ...overrides
 };
}
test('ready only after DB health, room recovery and server listening',async()=>{
 const events=[];
 assert.equal(await beginListening(deps(events)),true);
 assert.deepEqual(events,['health','recover','listen','ready']);
});
test('failed DB health does not recover, listen or signal readiness',async()=>{
 const events=[];
 await assert.rejects(beginListening(deps(events,{health:async()=>{
  events.push('health');throw Error('DB_NOT_READY');
 }})),/DB_NOT_READY/);
 assert.deepEqual(events,['health']);
});
test('failed recovery does not listen or signal readiness',async()=>{
 const events=[];
 await assert.rejects(beginListening(deps(events,{recover:async()=>{
  events.push('recover');throw Error('RECOVERY_FAILED');
 }})),/RECOVERY_FAILED/);
 assert.deepEqual(events,['health','recover']);
});
test('listener error never signals ready',async()=>{
 const events=[];
 await assert.rejects(beginListening(deps(events,{
  server:serverFake(events,{listenError:Error('EADDRINUSE')})
 })),/EADDRINUSE/);
 assert.deepEqual(events,['health','recover','listen']);
});
test('shutdown after preflight prevents recovery and listening',async()=>{
 const events=[];
 let stopping=false;
 const d=deps(events,{
  health:async()=>{events.push('health');stopping=true;},
  shouldStop:()=>stopping
 });
 assert.equal(await beginListening(d),false);
 assert.deepEqual(events,['health']);
});
