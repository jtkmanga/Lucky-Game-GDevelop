'use strict';
// Build railway-runtime first. Uses real ws loopback frames, fake clock and store.
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {once}=require('node:events');
const {setTimeout:sleep}=require('node:timers/promises');
const {createRequire}=require('node:module');
const runtime=path.resolve(__dirname,'../railway-runtime/backend/railway');
const use=createRequire(path.join(runtime,'secure-server.cjs'));
const uid=n=>'aaaaaaaa-0000-4000-8000-'+String(n).padStart(12,'0');
const roomId=uid(9);
function section(s,start,end) {
 const a=s.indexOf(start),b=s.indexOf(end,a+start.length);
 assert.ok(a>=0 && b>a,start);
 return s.slice(a,b);
}
async function until(read){
 const until=Date.now()+2000;
 do {const value=read();if(value)return value;await sleep(10);}while(Date.now()<until);
 assert.fail('timed out waiting for a socket, packet or controller state');
}

test('protocol heartbeat clears a silent Free4 queue seat and preserves verified room resume',
 {timeout:10000},async t=>{
  const {WebSocket,WebSocketServer}=use('ws');
  const {startSocketHeartbeat}=use('./socket-heartbeat.cjs');
  const Rules=use('./multi-board-rules.cjs');
  const {requireRuleTransition}=use('./rule-transition-guard.cjs');
  const {requireRoomAccess}=use('../auth/room-access.cjs');
  const source=fs.readFileSync(path.join(runtime,'secure-server.cjs'),'utf8');
  const code=section(source,'const TURN_MS=','// Readiness reports')+
   section(source,"wss.on('connection'",'beginListening({');
  const build=section(source,'const wss=new WebSocketServer','wss.on(\'connection\'');
  assert.match(build,/startSocketHeartbeat\(\{wss,open:WebSocket.OPEN\}\)/);
  assert.match(source,/shuttingDown=true;startupReady=false;\s*socketHeartbeat.stop\(\);/);
  const server=http.createServer();
  const wss=new WebSocketServer({server,path:'/ws',maxPayload:16384,perMessageDeflate:false});
  const browserPeers=[],serverPeers=[],timers=new Map(),errors=[];
  let tick, interval, clearCount=0, unrefCount=0;
  const timer={unref(){unrefCount++;}};
  const heartbeat=startSocketHeartbeat({wss,open:WebSocket.OPEN,
   startInterval(fn,ms){tick=fn;interval=ms;return timer;},
   stopInterval(id){assert.equal(id,timer);clearCount++;}});
  wss.on('connection',ws=>serverPeers.push(ws));
  t.after(async()=>{
   heartbeat.stop();
   for(const ws of browserPeers)ws.terminate();
   for(const ws of wss.clients)ws.terminate();
   await Promise.all([new Promise(resolve=>wss.close(()=>resolve())),
    new Promise(resolve=>server.close(()=>resolve()))]);
  });
  assert.equal(interval,25000);
  assert.equal(unrefCount,1);
  let now=1900000000000,uuidCount=0,createCount=0,commits=0;
  const store={
   player(){},findResumableRoomForUid(){return null;},
   async initializeRoom(x){assert.equal(x.roomId,roomId);createCount++;return 1;},
   async commitFencedTurn(x){
    assert.equal(x.expectedRevision,0);
    assert.equal(x.receipt.type,'roll');
    assert.deepEqual(x.awards,[]);
    commits++;return 1;
   }
  };
  const deps={requireRuleTransition,Date:{now:()=>now},shuttingDown:false,Rules,
   store,pilot:null,wss,MAX_CONNECTIONS:4,WebSocket,requireRoomAccess,
   requirePlayerIdentity:async msg=>{
    const i=/^fixture-([1-9])$/.exec(msg.accessToken)?.[1];
    assert.ok(i);return {uid:uid(Number(i))};
   },
   crypto:{randomUUID:()=>++uuidCount===1?uid(8):roomId,randomInt:()=>1},
   setTimeout(fn,ms){const id={};timers.set(id,{fn,ms});return id;},
   clearTimeout:id=>timers.delete(id),console:{error:(...args)=>errors.push(args)}};
  const app=Function(...Object.keys(deps),code+'\nreturn {rooms,sessions,waiting,clients};')(...Object.values(deps));
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  async function connect(autoPong=true){
   const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/ws',{autoPong});
   browserPeers.push(ws);
   ws.on('error',()=>{});
   const packets=[];
   ws.on('message',raw=>packets.push(JSON.parse(raw.toString())));
   await once(ws,'open');
   const peer=serverPeers.at(-1);
   return {ws,peer,packets,send(msg){now+=101;ws.send(JSON.stringify(msg));}};
  }
  async function joined(id,respond=true) {
   const c=await connect(respond);
   c.send({type:'join',mode:'free',name:'Fixture '+id,accessToken:'fixture-'+id});
   await until(()=>c.packets.find(p=>p.type==='waiting'||p.type==='state'));
   return c;
  }
  async function heartbeatTick(...healthy) {
   const replies=healthy.map(socket=>once(socket.peer,'pong'));
   tick();
   await Promise.all(replies);
  }
  const healthy=await joined(1);
  const lobby=await joined(9,false);
  assert.equal(app.waiting.free.length,2);
  const lobbyPing=once(lobby.ws,'ping');
  await heartbeatTick(healthy);
  const [token]=await lobbyPing;
  assert.equal(token.length,8);
  assert.equal(lobby.ws.readyState,WebSocket.OPEN,'silent peer still holds an open TCP connection');
  const wrongPong=once(lobby.peer,'pong');
  const wrong=Buffer.from(token);wrong[0]^=255;
  lobby.ws.pong(wrong);
  await wrongPong;
  const lobbyServerClosed=once(lobby.peer,'close');
  await heartbeatTick(healthy);
  await lobbyServerClosed;
  assert.equal(app.clients.size,1);
  assert.equal(app.sessions.has(uid(9)),false);
  assert.deepEqual(app.waiting.free.map(s=>s.uid),[uid(1)]);

  const silent=await joined(2,false),three=await joined(3),four=await joined(4);
  for(const [i,entry] of [healthy,silent,three,four].entries()){
   const start=await until(()=>entry.packets.find(p=>p.event?.type==='start'));
   assert.equal(start.roomId,roomId);assert.equal(start.seat,i);assert.equal(start.revision,0);
  }
  const room=app.rooms.get(roomId);
  assert.equal(createCount,1);
  const silencePing=once(silent.ws,'ping');
  await heartbeatTick(healthy,three,four);
  await silencePing;
  const closed=once(silent.peer,'close');
  await heartbeatTick(healthy,three,four);
  await closed;
  assert.equal(app.clients.size,3);
  assert.equal(room.seats[1].uid,uid(2));
  assert.equal(room.seats[1].ws,null);
  assert.equal(room.revision,0);
  const recovered=await joined(2);
  const restored=recovered.packets.find(p=>p.event?.type==='resume');
  assert.equal(restored.roomId,roomId);
  assert.equal(restored.seat,1);assert.equal(restored.revision,0);
  assert.equal(room.seats[1].ws,recovered.peer);
  assert.equal(createCount,1);assert.equal(commits,0);

  // Force the older client's protocol-close ACK to arrive after resume.
  // Free one unrelated capacity slot first, so takeover passes the normal gate.
  const otherClosed=once(four.peer,'close');four.ws.close();await otherClosed;
  recovered.ws._socket.pause();
  const oldClosed=once(recovered.peer,'close');
  const replacement=await joined(2);
  const newer=replacement.packets.find(p=>p.event?.type==='resume');
  assert.equal(newer.roomId,roomId);
  assert.equal(newer.seat,1);assert.equal(newer.revision,0);
  assert.equal(recovered.peer.readyState,WebSocket.CLOSING);
  recovered.ws._socket.resume();
  await oldClosed;
  assert.equal(room.seats[1].ws,replacement.peer);
  assert.equal(app.sessions.get(uid(2)).ws,replacement.peer);
  assert.equal(app.clients.has(healthy.peer),true);
  assert.equal(createCount,1);assert.equal(commits,0);
  assert.deepEqual(errors,[]);
  heartbeat.stop();heartbeat.stop();
  assert.equal(clearCount,1);
  let afterStopFrames=0;
  healthy.ws.on('ping',()=>afterStopFrames++);
  tick();await sleep(20);
  assert.equal(afterStopFrames,0);
 });
