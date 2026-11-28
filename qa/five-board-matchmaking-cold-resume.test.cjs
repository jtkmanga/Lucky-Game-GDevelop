'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const Rules=require('../backend/railway/multi-board-rules.cjs');
const {getBoard,eligibleGiftTiles}=require('../backend/railway/board-maps.cjs');
const {requireRoomAccess}=require('../backend/auth/room-access.cjs');
const {requireRuleTransition}=require('../backend/railway/rule-transition-guard.cjs');
const source=fs.readFileSync(path.join(__dirname,'../backend/railway/secure-server.cjs'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../railway-runtime/backend/railway/public/index.html'),'utf8');
const uid=n=>'11111111-0000-4000-8000-'+String(n).padStart(12,'0');
const roster=[1,2,3,4].map(uid);
const roomId=uid(90);
const optIn={NODE_ENV:'test',LUCKY_QA_RANDOM_BOARDS:'true'};
function section(s,from,to) {
 const start=s.indexOf(from),end=s.indexOf(to,start+from.length);
 assert.ok(start>=0 && end>start,from);
 return s.slice(start,end);
}
const controller=section(source,'const TURN_MS=','// Readiness reports')+
 section(source,"wss.on('connection'",'beginListening({');
const renderer=section(html,'const luckyKnownBoards=','function renderPlayerSlots(')+
 section(html,'function tilePercent(n)','function renderTokens(')+
 section(html,'function onlineApplyMessage(msg)','async function onlineConnect(');

function fixture(t) {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lucky-qa-board-'));
 const file=path.join(temp,'room.json');
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
 const write=row=>{
  const tmp=file+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(row),{mode:0o600});
  fs.renameSync(tmp,file);
 };
 return {read,write,controller({env=optIn,force,worker=uid(50)}={}) {
  let selections=0;
  const logs=[],timers=new Map(),wss=new EventEmitter();
  const store={
   player(){},
   findResumableRoomForUid(id){const row=read();return row?.seats.some(x=>x.uid===id)?roomId:null;},
   loadRoom(id){assert.equal(id,roomId);return read();},
   initializeRoom(x){
    assert.equal(read(),null,'cannot create a second room');
    assert.equal(x.roomId,roomId);
    write({room_id:x.roomId,mode:x.mode,status:'playing',game_state:x.game,seats:x.seats,
      deadline_ms:x.deadlineMs,revision:0,lease_epoch:1,lease_owner:x.ownerId});
    return 1;
   },
   acquireRoomLease(id,owner){
    assert.equal(id,roomId);
    const row=read();assert.ok(row);
    row.lease_owner=owner;row.lease_epoch++;
    write(row);
    return {leaseEpoch:row.lease_epoch};
   },
   commitFencedTurn(x){
    const row=read();
    assert.equal(x.roomId,row.room_id);
    assert.equal(x.ownerId,row.lease_owner);
    assert.equal(x.leaseEpoch,row.lease_epoch);
    assert.equal(x.expectedRevision,row.revision);
    assert.deepEqual(x.awards,[]);
    row.game_state=x.game;row.deadline_ms=x.deadlineMs;row.revision++;
    write(row);
    return row.revision;
   }
  };
  const deps={
   requireRuleTransition, Date:{now:()=>1_900_000_000_000},shuttingDown:false,process:{env},
   Rules:{...Rules,selectRandomBoard(){
    selections++;assert.ok(force>=1&&force<=5,'a fresh controller must not reselect a saved board');
    return Rules.selectRandomBoard(()=>((force-0.5)/5));
   }},
   WebSocket:{OPEN:1},crypto:{randomInt:()=>1},
   requirePlayerIdentity:async msg=>{
    assert.ok(roster.includes(msg.accessToken),'synthetic verified UID only');
    return {uid:msg.accessToken};
   },
   requireRoomAccess, store, pilot:null, wss, MAX_CONNECTIONS:10,
   setTimeout(fn){const key={};timers.set(key,fn);return key;},
   clearTimeout:key=>timers.delete(key),console:{error:(...args)=>logs.push(args)}
  };
  let uuidCalls=0;
  deps.crypto.randomUUID=()=>++uuidCalls===1?worker:roomId;
  const app=Function(...Object.keys(deps),"'use strict';\n"+controller+
    '\nreturn {handle,rooms,sessions};')(...Object.values(deps));
  return {...app, logs,timers, selections:()=>selections,
   socket(){
    const ws=Object.assign(new EventEmitter(),{readyState:1,bufferedAmount:0,received:[],
     send(msg){this.received.push(JSON.parse(msg));},
     close(){this.readyState=3;this.emit('close');}});
    wss.emit('connection',ws);return ws;
   },
   async join(index){
    const ws=this.socket();
    // Client-supplied board and UID must not control selection or attribution.
    await app.handle(ws,{type:'join',mode:'free',accessToken:roster[index],board:5,map:5,uid:roster[0],name:'Player '+index});
    return ws;
   }
  };
 }};
}
function dom() {
 const element=(name,html='')=>({name,innerHTML:html,children:[],attrs:{},
  setAttribute(k,v){this.attrs[k]=v;},
  append(node){this.children.push(node);},appendChild(node){this.children.push(node);},
  classList:new Set(),
  replaceChildren(frag){this.innerHTML='';this.children=frag?.children.slice()??[];}
 });
 const names=['.snake-bodies','.snake-faces','.ladder-illustrations'];
 const groups=Object.fromEntries(names.map(n=>[n,element(n,'original-'+n)]));
 const svg={dataset:{},querySelector:k=>groups[k]};
 const events=[],grid=element('boardGrid'),nodes={boardGrid:grid,lastRoll:element('lastRoll')};
 const scope={$:id=>nodes[id],document:{querySelector:k=>k==='.board-art'?svg:null,
  createElement:element,createElementNS(_ns,name){return element(name);},createDocumentFragment:()=>element('fragment')},
  state:{},localGame:null,onlineActive:false,onlineSeat:null,onlineRoomId:null,onlineDeadline:null,
  stopClock(){},refreshLocal(){},onlineShowControls(){},onlineClock(){},
  navigate:name=>events.push(name),luckyEndOnline:()=>events.push('rejected'),toast:()=>{}};
 vm.runInNewContext(renderer,scope);
 return {scope,events,svg,groups,names,grid};
}
async function match(app) {
 const sockets=[];
 for(const i of [0,1,2,3])sockets.push(await app.join(i));
 return sockets;
}
const packet=socket=>socket.received.at(-1);
const snapshot=board=>({version:1,id:board.id,snakes:board.snakes,ladders:board.ladders});
for(const id of [1,2,3,4,5])test('Free4 matchmaking, committed turn and cold resume on board '+id,async t=>{
 const f=fixture(t), app=f.controller({force:id});
 const sockets=await match(app);
 const board=getBoard(id), row=f.read();
 assert.equal(app.selections(),1);
 assert.deepEqual(row.seats.map(s=>s.uid),roster);
 assert.equal(row.game_state.map,id);
 assert.deepEqual(row.game_state.board,snapshot(board));
 assert.ok(eligibleGiftTiles(board).includes(row.game_state.gift));
 for(const [seat,ws] of sockets.entries()){
  assert.deepEqual(packet(ws),{type:'state',roomId,seat,revision:0,game:row.game_state,
   deadline:row.deadline_ms,event:{type:'start'}});
 }
 await app.handle(sockets[row.game_state.current],{type:'roll'});
 const committed=f.read();
 assert.equal(committed.revision,1);
 assert.equal(committed.game_state.gift,row.game_state.gift);
 assert.deepEqual(committed.game_state.board,row.game_state.board);
 assert.equal(packet(sockets[2]).revision,1);
 // Fresh controller, fresh seat map and none of the old process's timers.
 const reboot=f.controller({worker:uid(51)});
 assert.equal(reboot.rooms.size,0);
 assert.equal(reboot.sessions.size,0);
 const resumed=packet(await reboot.join(2));
 assert.deepEqual(resumed,{type:'state',roomId,seat:2,revision:1,game:committed.game_state,
  deadline:committed.deadline_ms,event:{type:'resume'}});
 assert.equal(reboot.selections(),0);
 assert.equal(f.read().lease_owner,uid(51));
 const d=dom();
 d.scope.onlineApplyMessage(JSON.parse(JSON.stringify(packet(sockets[2]))));
 d.scope.onlineApplyMessage(JSON.parse(JSON.stringify(resumed)));
 assert.deepEqual(d.events,['board','board']);
 assert.equal(d.scope.onlineSeat,2);
 assert.equal(d.svg.dataset.luckyBoardId,String(id));
 assert.equal(d.grid.children.length,100);
 const marked=type=>d.grid.children.filter(c=>c.children[1]?.className.endsWith(type))
  .map(c=>Number(c.children[0].textContent)).sort((a,b)=>a-b);
 assert.deepEqual(marked('small-snake'),Object.keys(board.snakes).map(Number));
 assert.deepEqual(marked('small-ladder'),Object.keys(board.ladders).map(Number));
 const gifts=d.grid.children.filter(c=>c.classList.has('gift-cell'));
 assert.deepEqual(gifts.map(c=>Number(c.children[0].textContent)),[committed.game_state.gift]);
 if(id===1){
  for(const k of d.names)assert.equal(d.groups[k].innerHTML,'original-'+k);
 }else{
  const paths=d.groups['.snake-bodies'].children.filter(x=>x.attrs.class==='snake-track');
  assert.deepEqual(Object.fromEntries(paths.map(x=>[x.attrs['data-head'],Number(x.attrs['data-tail'])])),board.snakes);
  assert.equal(d.groups['.ladder-illustrations'].children.length,Object.keys(board.ladders).length);
 }
});
test('default and Railway-marked fixtures stay on board one',async t=>{
 for(const env of [{},{...optIn,NODE_ENV:'production'},{...optIn,RAILWAY_ENVIRONMENT_NAME:'staging'},
   {...optIn,RAILWAY_ENVIRONMENT_ID:'synthetic'},{...optIn,RAILWAY_PROJECT_ID:'synthetic'}]){
  const f=fixture(t),app=f.controller({env,force:5});
  assert.equal(packet((await match(app))[0]).game.map,1);
  assert.equal(app.selections(),0);
 }
});
test('legacy board one is normalized on the wire without rewriting and a bad version fails closed',async t=>{
 const f=fixture(t);
 await match(f.controller({env:{}}));
 const legacy=f.read();
 delete legacy.game_state.board;f.write(legacy);
 const good=packet(await f.controller({worker:uid(51)}).join(0));
 assert.deepEqual(good.game.board,snapshot(getBoard(1)));
 assert.equal(Object.hasOwn(f.read().game_state,'board'),false);
 const bad=f.read();
 bad.game_state.board={...snapshot(getBoard(1)),version:2};f.write(bad);
 const reboot=f.controller({worker:uid(52)}),ws=reboot.socket();
 await assert.rejects(reboot.handle(ws,{type:'join',mode:'free',accessToken:roster[0]}),/BOARD_CHECKPOINT_MISMATCH/);
 assert.equal(reboot.rooms.size,0);
 assert.equal(reboot.sessions.size,0);
 assert.equal(reboot.timers.size,0);
 assert.equal(f.read().game_state.board.version,2);
 const d=dom();
 d.scope.onlineApplyMessage({...good,game:bad.game_state});
 assert.deepEqual(d.events,['rejected']);
 assert.equal(d.svg.dataset.luckyBoardId,undefined);
});
