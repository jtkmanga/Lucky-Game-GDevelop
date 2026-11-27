'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const out=path.resolve(process.argv[2]);
const app=path.join(out,'railway-runtime/backend/railway');
const html=fs.readFileSync(path.join(app,'public/index.html'),'utf8');
const baseline=fs.readFileSync(path.join(out,'baseline/backend/railway/public/index.html'),'utf8');
function body(name){
 const lines=html.split('\n');
 const i=lines.findIndex(l=>l.startsWith('function '+name+'(')||l.startsWith('async function '+name+'('));
 assert.ok(i>=0,name);
 if(lines[i].endsWith('}'))return lines[i];
 const stop=lines.indexOf('}',i+1);
 assert.ok(stop>i,name);
 return lines.slice(i,stop+1).join('\n');
}
test('generated package resolves local import graph and loads both item consumers',()=>{
 const seen=new Set();
 function walk(file){
  if(seen.has(file)||file.endsWith('.json'))return;
  seen.add(file);
  for(const [,rel] of fs.readFileSync(file,'utf8').matchAll(/require\(['"](\.[^'"]+)['"]\)/g))
   walk(createRequire(file).resolve(rel));
 }
 walk(path.join(app,'secure-server.cjs'));
 const helper=path.join(app,'match-item-effects.cjs');
 assert.ok(seen.has(helper));
 const rules=require(path.join(app,'multi-board-rules.cjs'));
 const guard=require(path.join(app,'rule-transition-guard.cjs'));
 assert.equal(typeof rules.turn,'function');
 assert.equal(typeof guard.requireRuleTransition,'function');
 assert.ok(require.cache[helper]);
});
test('baseline retains both original online +10 calls and local win call',()=>{
 for(const code of ["showResult('win',localGame.players[ev.actor],10)","showResult('win',localGame.players[localGame.winner],10)"])
  assert.ok(baseline.includes(code)&&!html.includes(code));
 const local=baseline.split('\n').filter(l=>l.includes("showResult('win'")&&!l.includes('onlineSeat'));
 assert.ok(local.length>0);
 for(const line of local) assert.ok(html.includes(line));
});
for(const [kind,points,bad,seat=0] of [
 ['roll',20],['roll',10],['resume',20],['resume',10],['resume',null],['roll',null],
 ['roll',20,'revision'],['resume',20,'room'],['roll',20,'winner'],['roll',15],['roll',20,null,1]
]){
 test([kind,points,bad,seat].join('/'),async()=>{
  const nodes=new Map();
  function $(id){
   if(!nodes.has(id))nodes.set(id,Object.assign(new EventTarget(),{hidden:true,focus(){this.focused=true;}}));
   return nodes.get(id);
  }
  let socket;
  class Socket extends EventTarget{
   static OPEN=1;
   constructor(){super();socket=this;this.readyState=1;}
   send(data){this.sent=JSON.parse(data);}
  }
  const noop=()=>{};
  const ctx={$,WebSocket:Socket,state:{name:'Po',mode:'free',character:0},CHARACTERS:[['Cat']],
   location:{protocol:'http:',host:'fixture.invalid'},window:{luckyGetAccessToken:async()=>'fixture'},
   document:{activeElement:null},onlineSocket:null,onlineRoomId:null,localGame:null,luckyAuthPending:false,
   movementRunning:false,luckyConnectAttempt:0,luckySeenRoomBoard:null,stopClock:noop,luckyBoardLayout:g=>g.board,
   luckyRenderBoardArt:noop,renderBoard:noop,refreshLocal:noop,onlineShowControls:noop,onlineClock:noop,navigate:noop,
   luckyEndOnline:()=>assert.fail('unexpected disconnect'),toast:()=>assert.fail('unexpected toast')};
  const listener=html.split('\n').find(l=>l.includes("e.stopImmediatePropagation();onlineConnect();"));
  vm.runInNewContext(['showResult','onlineSend','onlineWinPoints','onlineApplyMessage','onlineConnect'].map(body).join('\n')+'\n'+listener,ctx);
  $('matchButton').dispatchEvent(new Event('click'));
  await new Promise(resolve=>setImmediate(resolve));
  socket.dispatchEvent(new Event('open'));
  assert.equal(socket.sent.accessToken,'fixture');
  assert.equal(socket.sent.type,'join');
  const event={type:kind,actor:0,dice:1,outcome:{gameOver:true,reward:0}};
  if(points!==null)event.committedWin={roomId:bad==='room'?'old':'room',revision:bad==='revision'?1:2,
   seat:bad==='winner'?1:0,points};
  const game={over:true,winner:0,players:[{name:'Po',score:777}],mode:'free',board:{id:1},matchItems:{doubleWin:true}};
  const packet={type:'state',revision:2,roomId:'room',game,event,seat};
  socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(packet)}));
  assert.equal($('gameResultOverlay').hidden,seat!==0);
  if(seat===0){
   const expected=[10,20].includes(points)&&!bad?'Po คุณชนะได้รับคะแนน +'+points+' คะแนน':'Po คุณชนะ!';
   assert.equal($('resultMessage').textContent,expected);
   assert.equal($('resultClose').focused,true);
  }
 });
}
for(const lost of [false,true])test('server confirmation after store acknowledgement: lost='+lost,async()=>{
 const source=fs.readFileSync(path.join(app,'secure-server.cjs'),'utf8');
 const advance=source.slice(source.indexOf('async function advance('),source.indexOf('async function handle('));
 const Rules=require(path.join(app,'multi-board-rules.cjs'));
 const packets=[],writes=[];
 const deps={Rules,crypto:require('node:crypto'),OWNER_ID:'owner',schedule(){},
  transmit:(room,event)=>packets.push(event),
  requireRuleTransition:require(path.join(app,'rule-transition-guard.cjs')).requireRuleTransition,
  store:{commitFencedTurn(args){writes.push(args);if(lost)throw Object.assign(Error('lost'),{code:'AMBIGUOUS_COMMIT'});return 1;}},
  inspectAmbiguousCommit(){},haltRoom(room){room.halted=true;},console:{error(){}}};
 const run=Function(...Object.keys(deps),advance+'\nreturn advance;')(...Object.values(deps));
 const game=Rules.create(['Po','B','C','D'],'free');
 game.players[0].pos=99;
 const room={id:'room',mode:'free',seats:[{uid:'winner'}],game,deadline:Date.now()+20000,revision:0,leaseEpoch:1};
 await run(room,1);
 assert.equal(writes.length,1);
 assert.equal(writes[0].awards[0].points,10);
 if(lost){assert.equal(room.halted,true);assert.deepEqual(packets,[]);}
 else assert.deepEqual(packets[0].committedWin,{roomId:'room',revision:1,seat:0,points:10});
});
test('normal and legacy snapshots omit matchItems without mutating trusted state',()=>{
 const source=fs.readFileSync(path.join(app,'secure-server.cjs'),'utf8');
 const begin=source.indexOf('function verifiedRoomSnapshot(');
 const end=source.indexOf('function takeOut(',begin);
 assert.ok(begin>=0 && end>begin);
 const Rules=require(path.join(app,'multi-board-rules.cjs'));
 const sent=[];
 const {snapshot,transmit}=Function('Rules','send','haltRoom',
  source.slice(begin,end)+'\nreturn {snapshot:verifiedRoomSnapshot,transmit};')(
  Rules,(_,packet)=>sent.push(packet),()=>assert.fail('unexpected halt'));
 for(const legacy of [false,true]){
  const game=Rules.create(['Po','B','C','D'],'free');
  if(legacy)delete game.board;
  game.matchItems={privateFixture:true};
  const room={id:'lab',game,seats:[{ws:{}}],revision:2};
  const resume=snapshot(room);
  assert.equal(resume.board.version,1);
  assert.equal(Object.hasOwn(resume,'matchItems'),false);
  transmit(room,{type:'resume'});
  assert.equal(Object.hasOwn(sent.at(-1).game,'matchItems'),false);
  assert.deepEqual(room.game.matchItems,{privateFixture:true});
 }
});
