'use strict';
/**
 * Local WebSocket frame integration for production outbound snapshot functions.
 * Runs only on 127.0.0.1, with no real DB/Auth/deploy.
 * NOTE: It does not exercise full secure-server join/UID authentication.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Rules=require('../backend/railway/multi-board-rules.cjs');
let wsLib;
for(const candidate of [
 'ws',
 '../railway-runtime/node_modules/ws',
 '../render-web/node_modules/ws'
]){
 try{wsLib=require(candidate);break;}catch(error){
  if(error.code!=='MODULE_NOT_FOUND')throw error;
 }
}
if(!wsLib)throw Error('ws dependency unavailable. Prepare local railway-runtime dependencies only; do not deploy.');
const {WebSocket,WebSocketServer}=wsLib;
const source=fs.readFileSync(path.join(__dirname,'../backend/railway/secure-server.cjs'),'utf8');
function extract(a,b){
 const start=source.indexOf(a),end=source.indexOf(b,start);
 assert(start>=0&&end>start,'Source function boundaries changed: '+a);
 return source.slice(start,end);
}
const log=[];
const code=[
 extract('const send=(ws,obj)=>{','function capacity('),
 extract('function verifiedRoomSnapshot(','function takeOut('),
 extract('function haltRoom(','// An ambiguous COMMIT')
].join('\n');
const {transmit}=vm.runInNewContext(code+';({transmit})',{
 WebSocket,Rules,clearTimeout,console:{error:(...args)=>log.push(args)}
});
const game=(id)=>Rules.create(['Alice','Bob'],'vip',()=>0.23,id);
async function fixtures(){
 const server=new WebSocketServer({host:'127.0.0.1',port:0});
 await new Promise((resolve,reject)=>{
  server.once('listening',resolve);server.once('error',reject);
 });
 const sockets=[],clients=[];
 async function connect(){
  const client=new WebSocket('ws://127.0.0.1:'+server.address().port);
  const socket=await new Promise((resolve,reject)=>{
   server.once('connection',resolve);client.once('error',reject);
  });
  await new Promise((resolve,reject)=>{
   if(client.readyState===WebSocket.OPEN)return resolve();
   client.once('open',resolve);client.once('error',reject);
  });
  clients.push(client);sockets.push(socket);
  return client;
 }
 async function close(){
  for(const client of clients)client.terminate();
  for(const socket of sockets)socket.terminate();
  await new Promise(resolve=>server.close(resolve));
 }
 return {connect,sockets,close};
}
function message(client,trigger){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(Error('WS_MESSAGE_TIMEOUT'));},1500);
  const onMessage=data=>{cleanup();resolve(JSON.parse(data.toString()))};
  const onError=e=>{cleanup();reject(e)};
  const cleanup=()=>{clearTimeout(timer);client.off('message',onMessage);client.off('error',onError)};
  client.on('message',onMessage);client.on('error',onError);
  try{trigger()}catch(e){cleanup();reject(e)}
 });
}
test('legacy map-one broadcasts versioned board to both local WebSocket clients without DB mutation',async()=>{
 const fx=await fixtures();
 try{
  const a=await fx.connect(),b=await fx.connect();
  const original=game(1);delete original.board;
  const saved=JSON.stringify(original);
  const room={id:'local-legacy',game:original,halted:false,
   deadline:4102444800000,seats:fx.sockets.map(ws=>({ws})),timer:null,leaseTimer:null};
  const pa=message(a,()=>transmit(room,{type:'resume'}));
  // First multicast occurs synchronously: b listener must be registered
  // before transmit, so instead capture b in an ordinary event queue.
  const result=await pa;
  assert.equal(result.type,'state');
  assert.equal(result.game.map,1);
  assert.equal(result.game.board.version,1);
  assert.equal(result.game.board.id,1);
  assert.equal(result.event.type,'resume');
  assert.equal(JSON.stringify(original),saved);
  assert.equal(room.halted,false);
  // Second recipient receives the same canonical board on its next send.
  const second=await message(b,()=>transmit(room,{type:'resume'}));
  assert.deepEqual(second.game.board,result.game.board);
 }finally{await fx.close()}
});
test('corrupt board halts room and emits error but never state frame',async()=>{
 const fx=await fixtures();
 try{
  const client=await fx.connect();
  const corrupt=game(1);corrupt.board=null;
  const room={id:'local-corrupt',game:corrupt,halted:false,
   deadline:4102444800000,seats:[{ws:fx.sockets[0]}],timer:null,leaseTimer:null};
  const msg=await message(client,()=>transmit(room,{type:'resume'}));
  assert.equal(msg.type,'error');
  assert.equal(room.halted,true);
  assert.equal(log.at(-1)?.[2],'INVALID_ROOM_BOARD');
  assert.equal(client.readyState,WebSocket.OPEN);
 }finally{await fx.close()}
});
