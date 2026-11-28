'use strict';
// Exact generated v12 JavaScript, synthetic browser and WebSocket transport.
// Evidence of current behavior; not a real-browser or Railway acceptance test.
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const {setImmediate:flush}=require('node:timers/promises');
const html=fs.readFileSync(path.join(__dirname,'../railway-runtime/backend/railway/public/index.html'),'utf8');
const mark='let onlineSocket=null,onlineSeat=null';
const start=html.indexOf(mark);
const stop=html.indexOf("$('rollDice').addEventListener('click',e=>{",start);
assert.ok(start>=0&&stop>start);
const source=html.slice(start,stop);
const held='ห้องเดิมอยู่บนเซิร์ฟเวอร์อื่นหรือยังไม่พร้อม';
const roomId='aaaaaaaa-0000-4000-8000-000000000009';
const game={mode:'free',board:{id:1,version:1},players:[{name:'A',score:10}],current:0,over:false};

test('legacy client without a recorded session UID retains manual reconnect behavior',async()=>{
 const nodes=new Map(),sockets=[],views=[],notices=[];
 const $=id=>{
  if(!nodes.has(id))nodes.set(id,{style:{},handlers:{},addEventListener(type,cb){this.handlers[type]=cb;}});
  return nodes.get(id);
 };
 class WebSocket{
  static CONNECTING=0;static OPEN=1;static CLOSED=3;
  constructor(){this.readyState=0;this.events={};this.sent=[];sockets.push(this);}
  addEventListener(event,fn){this.events[event]=fn;}
  emit(event,data){this.events[event]?.(data);}
  open(){this.readyState=1;this.emit('open');}
  send(serialized){this.sent.push(JSON.parse(serialized));}
  deliver(msg){this.emit('message',{data:JSON.stringify(msg)});}
  close(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
 }
 const context={WebSocket,$,Date,clearTimeout,location:{protocol:'https:',host:'lucky.invalid'},
  window:{luckyGetAccessToken:async()=>'synthetic-token'},CHARACTERS:[['A']],
  state:{name:'A',mode:'free',character:0},movementRunning:false,localGame:null,
  resultVisible:false,luckySeenRoomBoard:null,stopClock(){},refreshLocal(){},
  luckyBoardLayout:()=>game.board,luckyRenderBoardArt(){},renderBoard(){},
  navigate:v=>views.push(v),toast:m=>notices.push(m)};
 vm.runInNewContext(source,context);
 const click=async()=>{$('matchButton').handlers.click({stopImmediatePropagation(){}});await flush();};
 const state=revision=>({type:'state',roomId,revision,seat:0,deadline:Date.now()+20000,game,event:{type:'resume'}});
 await click();sockets[0].open();sockets[0].deliver(state(1));
 assert.equal(views.at(-1),'board');
 sockets[0].close();
 assert.equal(views.at(-1),'lobby');
 await click();sockets[1].open();
 assert.equal(sockets[1].sent[0].type,'join');
 sockets[1].deliver({type:'error',message:held});
 assert.equal(notices.at(-1),held);
 assert.equal(sockets[1].readyState,WebSocket.CLOSED);
 // Once the fixture considers the lease expired, a reply on the old
 // transport cannot reopen the room. A second click creates a new join.
 sockets[1].deliver(state(2));await flush();
 assert.equal(sockets.length,2);
 assert.equal(views.at(-1),'lobby');
 await click();sockets[2].open();sockets[2].deliver(state(2));
 assert.equal(views.at(-1),'board');
 assert.equal(vm.runInContext('onlineRoomId',context),roomId);
});
