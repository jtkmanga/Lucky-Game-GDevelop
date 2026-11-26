'use strict';
// SOURCE ONLY; no network socket, Supabase, Railway, real WS or process signals.
const test=require('node:test');
const assert=require('node:assert/strict');
const {beginSocketShutdown}=require('../backend/railway/socket-shutdown.cjs');
function fake({hung=false,listener=true}={}){
 const trace=[];
 const ws={
  close(code,reason){trace.push(['close',code,reason]);},
  terminate(){trace.push(['terminate']);}
 };
 const clients=new Set([ws]);
 const wss={close(){trace.push(['wss.close']);}};
 const server={listening:listener,close(cb){trace.push(['server.close']);if(!hung)queueMicrotask(cb);}};
 return {trace,ws,clients,wss,server};
}
test('drains upgraded sockets before HTTP close',async()=>{
 const f=fake();
 await beginSocketShutdown({...f,graceMs:20});
 assert.deepEqual(f.trace.map(e=>e[0]),['close','wss.close','server.close']);
 assert.equal(f.trace[0][1],1001);
});
test('does not wait for HTTP close when listener never opened',async()=>{
 const f=fake({listener:false});
 await beginSocketShutdown({...f,graceMs:20});
 assert.deepEqual(f.trace.map(e=>e[0]),['close','wss.close']);
});
test('hung server close triggers bounded termination',async()=>{
 const f=fake({hung:true});
 await beginSocketShutdown({...f,graceMs:10});
 assert.deepEqual(f.trace.map(e=>e[0]),['close','wss.close','server.close','terminate']);
});
test('invalid timeout fails closed before touching sockets',async()=>{
 const f=fake();
 assert.throws(()=>beginSocketShutdown({...f,graceMs:0}),/INVALID_SHUTDOWN_GRACE/);
 assert.deepEqual(f.trace,[]);
});
