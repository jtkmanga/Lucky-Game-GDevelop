'use strict';
// Exact generated v12 JavaScript, synthetic browser and WebSocket transport.
// Generated-client behavior only; not a real-browser or Railway acceptance test.
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const {setImmediate:flush}=require('node:timers/promises');
const html=fs.readFileSync(path.join(__dirname,'../railway-runtime/backend/railway/public/index.html'),'utf8');
const mark='let onlineSocket=null,onlineSeat=null';
const start=html.indexOf(mark);
const stop=html.indexOf("$('rollDice').addEventListener('click',e=>{",start);
assert.ok(start>=0&&stop>start);
const source=html.slice(start,stop);
const roomId='aaaaaaaa-0000-4000-8000-000000000009';
const game={mode:'free',board:{id:1,version:1},players:[{name:'A',score:10}],current:0,over:false};

function fixture(){
 const nodes=new Map(),sockets=[],views=[],timers=new Map(), tokenRequests=[];
 let nextTimer=0;
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
  close(code=1006){if(this.readyState===3)return;this.readyState=3;this.emit('close',{code});}
 }
 const window={luckySessionUid:'account-a',async luckyGetAccessToken(uid){
  tokenRequests.push(uid);if(uid&&uid!==window.luckySessionUid)throw Error('account changed');
  return 'test-token';
 }};
 const context={WebSocket,$,Date,
  setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id;},
  clearTimeout:id=>timers.delete(id),location:{protocol:'https:',host:'lucky.invalid'},
  window,CHARACTERS:[['A']],state:{name:'A',mode:'free',character:0},
  movementRunning:false,localGame:null,resultVisible:false,luckySeenRoomBoard:null,
  stopClock(){},refreshLocal(){},luckyBoardLayout:()=>game.board,luckyRenderBoardArt(){},renderBoard(){},
  navigate:v=>views.push(v),toast(){}};
 vm.runInNewContext(source,context);
 const click=async()=>{$('matchButton').handlers.click({stopImmediatePropagation(){}});await flush();};
 const state=(revision,id=roomId)=>({type:'state',roomId:id,revision,seat:0,deadline:Date.now()+20000,game,event:{type:'resume'}});
 const tick=async ms=>{
  const entry=[...timers].find(([,t])=>t.ms===ms);
  assert.ok(entry,'expected '+ms+' ms timer');
  timers.delete(entry[0]);entry[1].fn();await flush();
 };
 async function openResume(){
  await click();sockets[0].open();sockets[0].deliver(state(1));sockets[0].close();
  assert.equal(views.at(-1),'lobby');
  await click();sockets[1].open();await flush();
  assert.equal(sockets[1].sent[0].resumeRoomId,roomId);
  return sockets[1];
 }
 return {sockets,views,timers,window,tokenRequests,state,openResume,tick,click,seat:()=>vm.runInContext("onlineSeat",context)};
}
const wait={type:'resume_wait',roomId};
test('one tap retries only the same room, ignores the old transport and returns to the board',async()=>{
 const f=fixture(),s=await f.openResume();
 s.deliver(wait);s.deliver(wait);
 assert.equal(f.timers.size,2,'one retry plus a hard expiration');
 f.sockets[0].deliver(f.state(9));
 assert.equal(f.views.at(-1),'lobby');
 await f.tick(2000);
 assert.equal(s.sent.length,2);
 assert.ok(s.sent.every(p=>p.resumeRoomId===roomId&&p.type==='join'&&p.mode==='free'));
 assert.deepEqual(f.tokenRequests,[undefined,'account-a','account-a']);
 s.deliver(f.state(2));
 assert.equal(f.views.at(-1),'board');
 assert.equal(f.timers.size,0);
 assert.equal(f.sockets.length,2);
});
for(const stop of ['ordinary error','wrong room','explicit cancel','account change','expiration']){
 test('resume-only attempt stops on '+stop+' without matchmaking',async()=>{
  const f=fixture(),s=await f.openResume();
  s.deliver(wait);
  if(stop==='ordinary error')s.deliver({type:'error',message:'rejected'});
  if(stop==='wrong room')s.deliver(f.state(2,'other-room'));
  if(stop==='explicit cancel')await f.click();
  if(stop==='account change'){f.window.luckySessionUid='account-b';f.window.luckyCancelRoomRetry();}
  if(stop==='expiration')await f.tick(36000);
  assert.equal(s.readyState,3);
  assert.equal(f.timers.size,0);
  assert.equal(f.views.at(-1),'lobby');
  assert.equal(s.sent.length,1);
  assert.equal(f.sockets.length,2);
 });
}

test('one tap redials a lost replacement transport and resumes the same seat',async()=>{
 const f=fixture(), first=await f.openResume();
 first.deliver(wait);first.close(1006);
 assert.equal(f.sockets.length,2);
 assert.equal(f.timers.size,2,'redial replaces wait and shares the original hard expiration');
 await f.tick(2000);
 const second=f.sockets[2];
 second.open();await flush();
 assert.equal(f.sockets.length,3);
 assert.equal(second.sent.length,1);
 assert.equal(second.sent[0].resumeRoomId,roomId);
 assert.equal(f.sockets.flatMap(s=>s.sent).filter(p=>!p.resumeRoomId).length,1);
 second.deliver(f.state(2));
 assert.equal(f.views.at(-1),'board');
 assert.equal(f.seat(),0);
 assert.equal(f.timers.size,0);
});

for(const edge of ['cancel','original expiration','second transport loss']){
 test('redial remains bounded after '+edge,async()=>{
  const f=fixture(),s=await f.openResume();
  s.close(1006);
  if(edge==='cancel')await f.click();
  if(edge==='original expiration')await f.tick(36000);
  if(edge==='second transport loss'){
   await f.tick(2000);
   f.sockets[2].open();await flush();
   f.sockets[2].close(1006);
  }
  assert.equal(f.timers.size,0);
  assert.equal(f.views.at(-1),'lobby');
  assert.equal(f.sockets.length,edge==='second transport loss'?3:2);
  assert.equal(f.sockets.flatMap(s=>s.sent).filter(p=>!p.resumeRoomId).length,1);
 });
}


test('intentional session replacement does not redial',async()=>{
 const f=fixture(),s=await f.openResume();
 s.close(4000);
 assert.equal(f.sockets.length,2);
 assert.equal(f.timers.size,0);
 assert.equal(f.views.at(-1),'lobby');
});
