'use strict';
// Run with: node qa/item-win-lab/fenced-dialog.cjs /path/to/lab-output
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const app=path.resolve(process.argv[2],'railway-runtime/backend/railway');
const Rules=require(path.join(app,'multi-board-rules.cjs'));
const {requireRuleTransition}=require(path.join(app,'rule-transition-guard.cjs'));
const {createRoomLeaseStore}=require(path.join(app,'../supabase/room-lease-store.cjs'));
const server=fs.readFileSync(path.join(app,'secure-server.cjs'),'utf8');
const html=fs.readFileSync(path.join(app,'public/index.html'),'utf8');
function section(source,start,end){
 const i=source.indexOf(start), j=source.indexOf(end,i+start.length);
 assert.ok(i>=0&&j>i,start);return source.slice(i,j);
}
const controller=section(server,'function verifiedRoomSnapshot','function takeOut')+
 section(server,'async function advance','// Readiness reports');
const dialog=section(html,'function showResult(', '\nfunction ')+
 section(html,'function onlineWinPoints','async function onlineConnect')+
 section(html,"$('rollDice').addEventListener('click',e=>","$('restartGame').addEventListener");
const uuid=n=>'aaaaaaaa-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=uuid(8);
function scriptedPg(seats,mode,lost){
 const calls=[];
 const client={
  async query(sql,params){
   const op=sql.trim().split(/\s+/).slice(0,3).join(' ');
   calls.push([op,params]);
   if(op==='UPDATE game.rooms SET')return {rowCount:1,rows:[{revision:'8',mode,seats}]};
   if(['INSERT INTO game.score_events(event_id,uid,mode,game_id,kind,points)',
       'INSERT INTO game.turn_receipts'].includes(op))return {rowCount:1};
   if(op==='COMMIT'&&lost)throw Error('fixture lost acknowledgement');
   assert.ok(['BEGIN','COMMIT','ROLLBACK'].includes(op),op);
  },
  release(discard){calls.push(['release',discard]);}
 };
 return {calls,pool:{query:()=>assert.fail('unexpected pool query'),connect:async()=>client}};
}
function runCase(kind,mode='free'){
 return async()=>{
  const names=mode==='vip'?['A','B']:['A','B','C','D'];
  const id=uuid(mode==='vip'?10:9),actor=mode==='vip'?1:2;
  const seats=Array.from({length:names.length},(_,index)=>({index,uid:uuid(index+1),verified:true,ws:{},roomId:id}));
  for(const seat of seats)seat.ws.session=seat;
  const game=Rules.create(names,mode,()=>0.5);
  game.current=actor;game.players[actor].pos=99;game.players[actor].score=55;
  if(kind!=='ordinary')game.matchItems={version:1,players:seats.map((_,i)=>({
   shieldRemaining:0,winMultiplier:i===actor?(kind==='bad item'?3:2):1}))};
  const room={id,seats,game,mode,revision:7,leaseEpoch:4,deadline:Date.now()+20000};
  const {pool,calls}=scriptedPg(seats,mode,kind==='lost ack');
  const lease=createRoomLeaseStore(pool);
  let reconciled=false,haltReason,storeError;
  const store={async commitFencedTurn(args){
   // Corrupt only the input under test between the guard and store.
   if(kind==='bad amount')args.awards[0].points=10;
   if(kind==='bad winner')args.game.winner=1;
   if(kind==='bad UID')args.awards[0].uid=seats[1].uid;
   try{return await lease.commitFencedTurn(args);}
   catch(e){storeError=e;throw e;}
  }};
  const packets=[];
  const deps={Rules,requireRuleTransition,store,OWNER_ID:owner,rooms:new Map([[id,room]]),
   crypto:{randomInt:()=>1},schedule(){},console:{error(){}},
   send(ws,packet){packets.push(JSON.parse(JSON.stringify(packet)));},
   haltRoom(r,reason){r.halted=true;haltReason=reason;},
   inspectAmbiguousCommit(){reconciled=true;}};
  const handle=Function(...Object.keys(deps),controller+'\nreturn handle;')(...Object.values(deps));
  const nodes=new Map();
  const $=name=>{
   if(!nodes.has(name))nodes.set(name,Object.assign(new EventTarget(),{hidden:true,focus(){}}));
   return nodes.get(name);
  };
  let pending;
  const noop=()=>{};
  const ui={$,document:{},onlineActive:true,localGame:null,state:{},stopClock:noop,
   luckySeenRoomBoard:null,luckyBoardLayout:g=>g.board,luckyRenderBoardArt:noop,renderBoard:noop,
   refreshLocal:noop,onlineShowControls:noop,onlineClock:noop,navigate:noop,
   onlineSend(msg){assert.deepEqual(msg,{type:'roll'});pending=handle(seats[actor].ws,msg);}};
  const receive=Function(...Object.keys(ui), 'let onlineSeat, onlineRoomId, onlineDeadline,resultPreviousFocus,resultVisible;\n'+dialog+'\nreturn onlineApplyMessage;')(...Object.values(ui));
  $('rollDice').dispatchEvent(new Event('click'));await pending;
  if(kind.startsWith('bad')){
   assert.equal(room.halted,true);assert.equal(packets.length,0);
   if(kind==='bad UID'){
    assert.match(storeError.message,/identity differs/);
    assert.deepEqual(calls.map(c=>c[0]),['BEGIN','UPDATE game.rooms SET','ROLLBACK','release']);
   }else{
    assert.deepEqual(calls,[]);
    if(kind==='bad item')assert.equal(storeError,undefined);
    else assert.match(storeError.message,/Winner award differs/);
   }
   return;
  }
  assert.deepEqual(calls.map(c=>c[0]),['BEGIN','UPDATE game.rooms SET',
   'INSERT INTO game.score_events(event_id,uid,mode,game_id,kind,points)','INSERT INTO game.turn_receipts','COMMIT','release']);
  const points=kind==='ordinary'?10:20;
  const update=calls[1][1],ledger=calls[2][1],receipt=calls[3][1];
  assert.deepEqual(update.slice(0,4),[id,owner,4,7]);
  assert.deepEqual(update.slice(5),[null,'finished']);
  assert.deepEqual(ledger,[id+':win',seats[actor].uid,mode,id,'win',points]);
  assert.deepEqual(receipt.slice(0,7),[id,8,7,4,'roll',actor,1]);
  assert.equal(JSON.parse(receipt[7]).gameOver,true);
  assert.deepEqual(JSON.parse(receipt[8]),JSON.parse(update[4]));
  assert.equal(JSON.parse(receipt[8]).players[actor].score,55+points);
  assert.deepEqual(JSON.parse(receipt[9]),[{eventId:ledger[0],uid:ledger[1],mode,kind:'win',points}]);
  assert.equal(calls[5][1],kind==='lost ack');
  if(kind==='lost ack'){
   assert.equal(haltReason,'AMBIGUOUS_COMMIT');assert.equal(reconciled,true);
   assert.equal(room.revision,7);assert.deepEqual(packets,[]);assert.equal($('gameResultOverlay').hidden,true);
   return;
  }
  assert.equal(room.revision,8);assert.equal(packets.length,seats.length);
  for(const packet of packets){
   assert.equal(Object.hasOwn(packet.game,'matchItems'),false);
   assert.equal(packet.revision,8);
   assert.deepEqual(packet.event.committedWin,{roomId:id,revision:8,seat:actor,points});
  }
  receive(packets[actor]);
  assert.equal($('gameResultOverlay').hidden,false);
  assert.equal($('resultMessage').textContent,names[actor]+' คุณชนะได้รับคะแนน +'+points+' คะแนน');
  return {update,ledger,receipt,packets,seats:seats.map(({uid})=>({uid})),at:Date.now()};
 };
}
module.exports={runCase};
if(require.main===module)for(const kind of ['double','ordinary','bad item','bad winner','bad amount','bad UID','lost ack'])
 test('fenced live win: '+kind,runCase(kind));
