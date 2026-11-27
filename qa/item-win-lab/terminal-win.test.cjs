'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {projectTerminalWin}=require('./terminal-win.cjs');
const app=path.resolve(process.argv[2],'railway-runtime/backend/railway');
const Rules=require(path.join(app,'multi-board-rules.cjs'));
const html=fs.readFileSync(path.join(app,'public/index.html'),'utf8');
const controller=fs.readFileSync(path.join(app,'secure-server.cjs'),'utf8');
const uuid=n=>'cccccccc-0000-4000-8000-'+String(n).padStart(12,'0');
function section(s,start,end) {
  const a=s.indexOf(start),b=s.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a,start);return s.slice(a,b);
}
function fixture(points,mode='free'){
  const roomId=uuid(9),seat=1,verifiedUid=uuid(2);
  const names=mode==='free'?['A','B','C','D']:['A','B'];
  const game=Rules.create(names,mode);
  game.current=seat;game.players[seat].pos=99;
  game.matchItems={version:1,players:names.map((_,i)=>({shieldRemaining:0,winMultiplier:i===seat?points/10:1}))};
  const outcome=Rules.turn(game,1);
  const room={room_id:roomId,revision:'8',lease_epoch:'2',deadline_ms:null,status:'finished',mode,
    seats:names.map((_,i)=>({uid:uuid(i+1)})),game_state:game};
  const win={uid:verifiedUid,mode,kind:'win',points};
  const receipt={room_id:roomId,revision:'8',previous_revision:'7',lease_epoch:'2',
    event_type:'roll',actor_index:seat,roll:1,outcome,game_state:structuredClone(game),
    award_events:[{...win,eventId:roomId+':win'}]};
  return {context:{roomId,revision:8,mode,seat,verifiedUid},evidence:{room,receipts:[receipt],
    ledger:[{...win,event_id:roomId+':win'},
      {mode,uid:uuid(1),kind:'lucky_box',points:10,event_id:roomId+':lucky'}]}};
}
function firstDialog(context,evidence,projection){
  const nodes=new Map(),noop=()=>{};
  function $(id){if(!nodes.has(id))nodes.set(id,{hidden:true,focus(){}});return nodes.get(id);}
  const publicSnapshot=Function('Rules',section(controller,'function verifiedRoomSnapshot','function transmit')+
    '\nreturn verifiedRoomSnapshot;')(Rules);
  const game=publicSnapshot({game:evidence.room.game_state});
  const packet={type:'state',seat:context.seat,roomId:context.roomId,revision:context.revision,game,
    deadline:null,event:{type:'resume',...(projection?{committedWin:projection}:{})}};
  assert.ok(!/matchItems|cccccccc-0000-4000-8000-00000000000[1-4]|award_events|verifiedUid/.test(JSON.stringify(packet)));
  const deps={$,document:{},localGame:null,state:{},stopClock:noop,luckySeenRoomBoard:null,
    luckyBoardLayout:g=>g.board,luckyRenderBoardArt:noop,renderBoard:noop,refreshLocal:noop,
    onlineShowControls:noop,onlineClock:noop,navigate:noop};
  const receive=Function(...Object.keys(deps),'let onlineActive,onlineSeat,onlineRoomId,onlineDeadline,resultPreviousFocus,resultVisible;\n'+
    section(html,'function showResult(', '\nfunction ')+section(html,'function onlineWinPoints','async function onlineConnect')+
    '\nreturn onlineApplyMessage;')(...Object.values(deps));
  receive(packet);
  assert.equal($('gameResultOverlay').hidden,false);
  return $('resultMessage').textContent;
}
for(const [points,mode] of [[10,'free'],[20,'vip']])test('first terminal dialog '+mode+' +'+points,()=>{
  const {context,evidence}=fixture(points,mode);
  const result=projectTerminalWin(context,evidence);
  assert.deepEqual(result,{roomId:context.roomId,revision:8,seat:1,points});
  assert.equal(firstDialog(context,evidence,result),'B คุณชนะได้รับคะแนน +'+points+' คะแนน');
});
test('missing ledger displays a win without an amount',()=>{
  const {context,evidence}=fixture(20);
  evidence.ledger=[];
  const result=projectTerminalWin(context,evidence);
  assert.equal(result,null);assert.equal(firstDialog(context,evidence,result),'B คุณชนะ!');
});
const corruptions={
  'outside viewer':({context:c})=>c.verifiedUid=uuid(5),
  'different bound seat':({context:c})=>c.seat=0,
  'different room':({context:c})=>c.roomId=uuid(8),
  'wrong mode':({context:c})=>c.mode='vip',
  'duplicate seats':({evidence:e})=>e.room.seats[0]=e.room.seats[1],
  'still playing':({evidence:e})=>e.room.status='playing',
  'unsafe revision':({evidence:e})=>e.room.revision='9007199254740993',
  'missing receipt':({evidence:e})=>e.receipts=[],
  'duplicate receipt':({evidence:e})=>e.receipts.push(e.receipts[0]),
  'stale receipt':({evidence:e})=>e.receipts[0].revision='7',
  'wrong predecessor':({evidence:e})=>e.receipts[0].previous_revision='2',
  'wrong receipt room':({evidence:e})=>e.receipts[0].room_id=uuid(8),
  'impossible landing':({evidence:e})=>e.receipts[0].outcome.landing=101,
  'conflicting explicit ledger room':({evidence:e})=>e.ledger[0].game_id=uuid(8),
  'invalid epoch':({evidence:e})=>e.receipts[0].lease_epoch='bad',
  'timeout receipt':({evidence:e})=>e.receipts[0].event_type='timeout',
  'wrong actor':({evidence:e})=>e.receipts[0].actor_index=0,
  'state mismatch':({evidence:e})=>e.receipts[0].game_state.winner=0,
  'wrong receipt event ID':({evidence:e})=>e.receipts[0].award_events[0].eventId='other',
  'wrong award UID':({evidence:e})=>e.receipts[0].award_events[0].uid=uuid(4),
  'duplicate receipt award':({evidence:e})=>e.receipts[0].award_events.push(e.receipts[0].award_events[0]),
  'wrong ledger event ID':({evidence:e})=>e.ledger[0].event_id=uuid(8)+':win',
  'wrong ledger UID':({evidence:e})=>e.ledger[0].uid=uuid(4),
  'wrong ledger mode':({evidence:e})=>e.ledger[0].mode='vip',
  'conflicting amount':({evidence:e})=>e.ledger[0].points=10,
  'duplicate wins':({evidence:e})=>e.ledger[1]=e.ledger[0],
  'malformed ledger row':({evidence:e})=>e.ledger[1]=null,
  'unsupported award':({evidence:e})=>{e.ledger[0].points=30;e.receipts[0].award_events[0].points=30;}
};
for(const [name,change] of Object.entries(corruptions))test('no projection: '+name,()=>{
  const f=fixture(20);change(f);assert.equal(projectTerminalWin(f.context,f.evidence),null);
});
