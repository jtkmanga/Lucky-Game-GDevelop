'use strict';
/**
 * Draft Railway single-instance authoritative multiplayer listener.
 * Requires DATABASE_URL and FIREBASE_PROJECT_ID; no unauthenticated fallback.
 * NOT tested, deployed, or production-ready. Web UI must send Firebase ID Token.
 *
 * This server cannot safely scale to multiple replicas without a shared
 * room coordinator / routing strategy; reconnect across restarts is not yet
 * implemented. Payment/VIP grants and admin API are deliberately absent.
 */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {WebSocket,WebSocketServer}=require('ws');
const Rules=require('./rules.js');
const {requirePlayerIdentity}=require('../auth/firebase-id-token.cjs');
const {requireRoomAccess}=require('../auth/room-access.cjs');
const {createRailwayStore}=require('./postgres-store.cjs');

if(!process.env.FIREBASE_PROJECT_ID)throw Error('FIREBASE_PROJECT_ID required');
const store=createRailwayStore(process.env.DATABASE_URL);
const PORT=Number(process.env.PORT||8080);
const WEB=path.resolve(__dirname,'public');
const MAX_CONNECTIONS=500; // conservative until authorized capacity validation
const TURN_MS=20000;
const waiting={free:[],vip:[]}, rooms=new Map(), sessions=new Map();
const clients=new Set(), dispatchBusy={free:false,vip:false};
const send=(ws,obj)=>{
 if(ws?.readyState===WebSocket.OPEN && ws.bufferedAmount<262144)
   ws.send(JSON.stringify(obj));
};
function capacity(mode){return mode==='vip'?2:4;}
function transmit(room,event){
 for(let i=0;i<room.seats.length;i++){
  const s=room.seats[i];
  send(s.ws,{type:'state',roomId:room.id,seat:i,game:room.game,
    deadline:room.deadline,event});
 }
}
function takeOut(queue,session){
 const i=queue.indexOf(session);if(i>=0)queue.splice(i,1);
}
function reportWaiting(mode){
 waiting[mode].forEach((s,i)=>send(s.ws,
  {type:'waiting',mode,joined:i+1,needed:capacity(mode)}));
}
async function dispatch(mode){
 if(dispatchBusy[mode])return;
 dispatchBusy[mode]=true;
 try{
  const q=waiting[mode];
  while(q.length>=capacity(mode)){
   const seats=q.splice(0,capacity(mode));
   if(seats.some(s=>s.ws?.readyState!==WebSocket.OPEN)){ // lost queue member
    for(const s of seats)if(s.ws?.readyState===WebSocket.OPEN)q.unshift(s);
    continue;
   }
   const id=crypto.randomUUID(), game=Rules.create(seats.map(s=>s.name),mode);
   seats.forEach((s,i)=>{s.index=i;game.players[i].avatar=s.avatar;});
   const deadline=Date.now()+TURN_MS;
   try{
    await store.initializeRoom({
      roomId:id,mode,game,
      seats:seats.map(s=>({uid:s.uid,name:s.name})),deadlineMs:deadline
    });
   }catch(err){
    console.error('Room persistence failed',err.code||err.message);
    for(const s of seats){send(s.ws,{type:'error',message:'สร้างห้องไม่สำเร็จ'});q.push(s);}
    break;
   }
   const room={id,mode,seats,game,deadline,revision:0,timer:null,busy:false};
   rooms.set(id,room);
   for(const s of seats)s.roomId=id;
   schedule(room);
   transmit(room,{type:'start'});
  }
  reportWaiting(mode);
 }finally{dispatchBusy[mode]=false;}
}
function schedule(room){
 if(room.timer)clearTimeout(room.timer);
 if(room.game.over){room.deadline=null;return;}
 const revision=room.revision, delay=Math.max(0,room.deadline-Date.now());
 room.timer=setTimeout(()=>{
  if(room.revision!==revision||room.game.over)return;
  advance(room,null).catch(err=>console.error('Timeout transition failed',err.code||err.message));
 },delay+1);
 room.timer.unref?.();
}
async function advance(room,roll){
 if(room.busy||room.game.over)return;
 room.busy=true;
 try{
  const now=Date.now();
  if(roll===null && now<room.deadline)return;
  if(roll!==null && now>=room.deadline)return;
  const old=room.game;
  const next=structuredClone(old);
  const actor=next.current;
  let event, awards=[];
  if(roll===null){
   Rules.timeout(next);event={type:'timeout'};
  }else{
   const outcome=Rules.turn(next,roll,()=>{
     const b=crypto.randomBytes(4).readUInt32BE(0);
     return b/0x100000000;
   });
   event={type:'roll',actor,dice:roll,outcome};
   const target=room.seats[actor];
   if(outcome.reward>0)awards.push({
     eventId:room.id+':lucky',gameId:room.id,mode:room.mode,
     uid:target.uid,kind:'lucky_box',points:outcome.reward
   });
   if(next.over)awards.push({
     eventId:room.id+':win',gameId:room.id,mode:room.mode,
     uid:target.uid,kind:'win',points:10
   });
  }
  const nextDeadline=next.over?null:Date.now()+TURN_MS;
  const revision=await store.commitTurn({
    roomId:room.id,expectedRevision:room.revision,game:next,
    deadlineMs:nextDeadline,awards
  });
  room.game=next;room.deadline=nextDeadline;room.revision=revision;
  schedule(room);transmit(room,event);
 }catch(e){
  console.error('Turn commit failed',e.code||e.message);
  // Fail closed: do not broadcast an unpersisted turn.
  if(room.timer)clearTimeout(room.timer);
  for(const s of room.seats)send(s.ws,{type:'error',message:'บันทึกสถานะห้องไม่สำเร็จ'});
 }finally{room.busy=false;}
}
async function handle(ws,msg){
 if(!msg||typeof msg!=='object'||Array.isArray(msg))return;
 if(msg.type==='join'){
  if(ws.session)return send(ws,{type:'error',message:'อยู่ในคิวหรือห้องแล้ว'});
  const mode=msg.mode;
  if(mode!=='free'&&mode!=='vip')return send(ws,{type:'error',message:'โหมดไม่ถูกต้อง'});
  // Every join and resume must supply a fresh Firebase ID token.
  const auth=await requirePlayerIdentity(msg,{projectId:process.env.FIREBASE_PROJECT_ID});
  await requireRoomAccess(auth,mode,store);
  const uid=auth.uid;
  let existing=sessions.get(uid);
  if(existing){
   if(existing.mode!==mode && existing.roomId)
     return send(ws,{type:'error',message:'กำลังอยู่ในห้องอื่น'});
   if(existing.mode!==mode){
     takeOut(waiting[existing.mode],existing);existing=null;
   }
  }
  if(existing){
   // No unverified bearer-token resume; the verified UID owns this seat.
   const last=existing.ws;
   if(last&&last!==ws){last.session=null;last.close(4000,'duplicate session');}
   existing.ws=ws;ws.session=existing;
   const room=rooms.get(existing.roomId);
   if(room){
     send(ws,{type:'state',roomId:room.id,seat:existing.index,
       game:room.game,deadline:room.deadline,event:{type:'resume'}});
   }else{reportWaiting(mode);}
   return;
  }
  const name=String(msg.name||'Player').trim().slice(0,20)||'Player';
  const avatar=typeof msg.avatar==='string' && msg.avatar.length<=12?msg.avatar:'🐱';
  await store.player(uid,name);
  const session={uid,mode,name,avatar,ws,roomId:null,index:null};
  ws.session=session;sessions.set(uid,session);
  waiting[mode].push(session);
  await dispatch(mode);
  return;
 }
 const s=ws.session;
 if(!s||s.ws!==ws)return;
 if(msg.type==='cancel'&&!s.roomId){
  takeOut(waiting[s.mode],s);sessions.delete(s.uid);ws.session=null;
  send(ws,{type:'cancelled'});reportWaiting(s.mode);return;
 }
 if(msg.type==='roll'){
  const room=rooms.get(s.roomId);
  if(!room||room.game.over)return send(ws,{type:'error',message:'ห้องไม่พร้อม'});
  if(room.game.current!==s.index)return send(ws,{type:'error',message:'ยังไม่ถึงตา'});
  if(Date.now()>=room.deadline)return send(ws,{type:'error',message:'หมดเวลา'});
  await advance(room,crypto.randomInt(1,7));
 }
}
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/firebase-config'){
  const config={
   apiKey:process.env.FIREBASE_API_KEY||'',
   authDomain:process.env.FIREBASE_AUTH_DOMAIN||'',
   projectId:process.env.FIREBASE_PROJECT_ID
  };
  if(!config.apiKey||!config.authDomain){res.writeHead(503);res.end('Firebase web config missing');return;}
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(config));return;
 }
 if(u.pathname==='/health'){
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify({ok:true,mode:'draft-auth-required'}));return;
 }
 let filename;
 try{
  filename=path.resolve(WEB,'.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(filename!==WEB&&!filename.startsWith(WEB+path.sep))throw Error('invalid');
  if(!fs.existsSync(filename)||!fs.statSync(filename).isFile())throw Error('not found');
 }catch{
  res.writeHead(404);res.end('Not Found');return;
 }
 res.writeHead(200,{'content-type':filename.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream',
  'cache-control':'no-store','x-content-type-options':'nosniff'});
 fs.createReadStream(filename).pipe(res);
});
const wss=new WebSocketServer({server,path:'/ws',maxPayload:16384,perMessageDeflate:false});
wss.on('connection',ws=>{
 if(clients.size>=MAX_CONNECTIONS){ws.close(1013,'Server capacity gate');return;}
 clients.add(ws);
 let last=0,processing=false;
 ws.on('message',async raw=>{
  if(processing)return;
  const now=Date.now();
  if(now-last<100)return;last=now;
  processing=true;
  try{await handle(ws,JSON.parse(raw.toString()));}
  catch(e){
   console.error('WS action rejected',e.code||e.message);
   send(ws,{type:'error',message:'ไม่สามารถยืนยันตัวตนหรือทำคำสั่งนี้ได้'});
  }finally{processing=false;}
 });
 ws.on('close',()=>{
  clients.delete(ws);
  const s=ws.session;
  if(s&&s.ws===ws){
   s.ws=null;
   if(!s.roomId){takeOut(waiting[s.mode],s);sessions.delete(s.uid);reportWaiting(s.mode);}
  }
 });
});
server.listen(PORT,'0.0.0.0',()=>console.log('Lucky Game secured draft listening on '+PORT));
process.on('SIGTERM',()=>{
 for(const room of rooms.values())clearTimeout(room.timer);
 wss.close();server.close(()=>store.close().finally(()=>process.exit(0)));
});
