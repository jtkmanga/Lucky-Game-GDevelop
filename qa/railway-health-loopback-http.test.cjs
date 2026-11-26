'use strict';
// SOURCE ONLY. Isolated loopback HTTP test: no Supabase, DB, Google, WS,
// real Railway app startup, persistent writes or external listening address.
const http=require('node:http');
const test=require('node:test');
const assert=require('node:assert/strict');
const {respondHealth}=require('../backend/railway/health-http-handler.cjs');
async function withLoopback(fn){
 const state={startupReady:false,shuttingDown:false};
 const server=http.createServer((req,res)=>{
  if(req.url!=='/health'){res.writeHead(404);res.end('Not Found');return;}
  respondHealth(req,res,state);
 });
 try{
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(0,'127.0.0.1',resolve);
  });
  const {port}=server.address();
  async function getHealth(){
   return await new Promise((resolve,reject)=>{
    const req=http.get({
     hostname:'127.0.0.1',port,path:'/health',
     timeout:3000,agent:false
    },res=>{
     let payload='';
     res.setEncoding('utf8');
     res.on('data',chunk=>{payload+=chunk;});
     res.on('end',()=>{
      try{resolve({statusCode:res.statusCode,headers:res.headers,
       body:JSON.parse(payload)});}
      catch(error){reject(error);}
     });
     res.on('error',reject);
    });
    req.once('timeout',()=>req.destroy(Error('LOCAL_HTTP_TIMEOUT')));
    req.on('error',reject);
   });
  }
  await fn(state,getHealth);
 }finally{
  if(server.listening)
   await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 }
}
test('HTTP /health 503 on startup and 200 only after ready',async()=>{
 await withLoopback(async(state,get)=>{
  let res=await get();
  assert.equal(res.statusCode,503);
  assert.equal(res.body.status,'starting');
  assert.equal(res.body.ok,false);
  state.startupReady=true;
  res=await get();
  assert.equal(res.statusCode,200);
  assert.equal(res.body.status,'ready');
  assert.equal(res.body.ok,true);
  assert.match(res.headers['content-type'],/application\/json/);
  assert.equal(res.headers['cache-control'],'no-store');
 });
});
test('HTTP /health responds 503 when stopping',async()=>{
 await withLoopback(async(state,get)=>{
  state.startupReady=true;
  state.shuttingDown=true;
  const res=await get();
  assert.equal(res.statusCode,503);
  assert.equal(res.body.status,'stopping');
  assert.equal(res.body.ok,false);
 });
});
test('HTTP /health never reveals live DB state or secrets',async()=>{
 await withLoopback(async(state,get)=>{
  state.startupReady=true;
  const res=await get();
  assert.deepEqual(Object.keys(res.body).sort(),['mode','ok','status']);
  assert.equal(res.body.mode,'draft-auth-required');
 });
});
