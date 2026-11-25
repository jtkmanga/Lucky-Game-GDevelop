#!/usr/bin/env node
'use strict';
// Lucky Game integration smoke: local loopback only. No Production or billable cloud traffic.
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const project = path.join(root, 'multiplayer-test');
const WS = require(path.join(project, 'node_modules/ws'));
const PORT = 19081;
const url = 'ws://127.0.0.1:' + PORT + '/ws';
const delay = ms => new Promise(r => setTimeout(r, ms));
function health() {
  return new Promise((resolve,reject)=>{
    const req=http.get('http://127.0.0.1:'+PORT+'/health',res=>{
      let b='';res.on('data',x=>b+=x);res.on('end',()=>{try {resolve(JSON.parse(b));}catch(e){reject(e);}});
    });req.on('error',reject);req.setTimeout(1500,()=>req.destroy(new Error('health timeout')));
  });
}
function client(name, mode, token) {
 return new Promise((resolve,reject)=>{
   const ws=new WS(url);const seen=[];const waiters=[];
   const c={name,mode,ws,seen,send:x=>ws.send(JSON.stringify(x)),wait:(pred,ms=7000)=>{
     const match=seen.find(pred);if(match)return Promise.resolve(match);
     return new Promise((res,rej)=>{const w={pred,res,rej};waiters.push(w);
       w.t=setTimeout(()=>{const i=waiters.indexOf(w);if(i>=0)waiters.splice(i,1);rej(new Error(name+' timed out waiting for state'));},ms);
     });
   }};
   ws.once('open',()=>{c.send({type:'join',name,mode,...(token?{token}:{})});resolve(c);});
   ws.on('message',raw=>{
     let msg;try{msg=JSON.parse(raw.toString());}catch{return;}
     seen.push(msg);
     for(let i=waiters.length-1;i>=0;i--){const w=waiters[i];if(w.pred(msg)){waiters.splice(i,1);clearTimeout(w.t);w.res(msg);}}
   });
   ws.once('error',reject);
 });
}
(async()=>{
 const proc=spawn(process.execPath,['server.js'],{cwd:project,env:{...process.env,PORT:String(PORT)},stdio:['ignore','pipe','pipe']});
 const clients=[];let out='';
 proc.stdout.on('data',x=>out+=x.toString());proc.stderr.on('data',x=>out+=x.toString());
 try {
   let healthy=false;
   for(let i=0;i<50;i++){if(proc.exitCode!==null)throw new Error('server exited: '+out);
     try{if((await health()).ok){healthy=true;break;}}catch{}await delay(100);
   }
   assert.ok(healthy,'server health failed: '+out);
   console.log('PASS local server health');
   const free=[];
   for(let i=0;i<4;i++){const c=await client('SmokeFree'+i,'free');free.push(c);clients.push(c);}
   const states=await Promise.all(free.map(c=>c.wait(x=>x.type==='state'&&x.event?.type==='start')));
   assert.equal(new Set(states.map(s=>s.roomId)).size,1);
   assert.deepEqual(states.map(s=>s.seat).sort(),[0,1,2,3]);
   assert.ok(states.every(s=>s.game.mode==='free'&&s.game.players.length===4));
   console.log('PASS Free 4 separate WebSocket clients / same room');
   const vip=[];
   for(let i=0;i<2;i++){const c=await client('SmokeVip'+i,'vip');vip.push(c);clients.push(c);}
   const vStates=await Promise.all(vip.map(c=>c.wait(x=>x.type==='state'&&x.event?.type==='start')));
   assert.equal(new Set(vStates.map(s=>s.roomId)).size,1);
   assert.notEqual(vStates[0].roomId,states[0].roomId);
   assert.ok(vStates.every(s=>s.game.mode==='vip'&&s.game.players.length===2));
   console.log('PASS VIP 2 separate WebSocket clients / isolated room');
   const roller=free[states.findIndex(s=>s.seat===0)];
   // The server ignores messages arriving <100ms after join; allow its per-socket guard to elapse.
   await delay(180);
   roller.send({type:'roll'});
   const rolled=await Promise.all(free.map(c=>c.wait(x=>x.type==='state'&&x.event?.type==='roll')));
   assert.equal(new Set(rolled.map(r=>r.event.dice)).size,1);
   assert.ok(rolled.every(r=>r.game.turn===2&&r.game.current===1));
   console.log('PASS server dice + synchronized next turn across four clients');
   assert.ok(vip.every(c=>!c.seen.some(x=>x.type==='state'&&x.event?.type==='roll')),'VIP room leaked FREE game event');
   console.log('PASS Free/VIP game-event isolation');
   await delay(180);
   const outsider=free[states.findIndex(s=>s.seat===2)];
   outsider.send({type:'roll',dice:6,actor:1});
   const denied=await outsider.wait(x=>x.type==='error'&&String(x.message).includes('ยังไม่ถึงตาของคุณ'));
   assert.ok(denied);
   assert.ok(free.every(c=>!c.seen.some(x=>x.type==='state'&&x.game?.turn===3)),'out-of-turn roll advanced game');
   console.log('PASS out-of-turn roll rejected, forged dice/actor ignored');
   const target=free[states.findIndex(s=>s.seat===1)];
   const idmsg=await target.wait(x=>x.type==='identity');
   const token=idmsg.token;
   assert.ok(token&&typeof token==='string');
   target.ws.close();await delay(200);
   const restored=await client('rejoining','free',token);clients.push(restored);
   const resume=await restored.wait(x=>x.type==='state'&&x.event?.type==='resume');
   assert.equal(resume.roomId,states[0].roomId);
   assert.equal(resume.seat,1);
   assert.equal(resume.game.turn,2);
   console.log('PASS reconnect resumes same seat, room, and turn');
   console.log('RESULT 7/7 integration checks PASS (local smoke; not real Google auth)');
 }catch(e){console.error('FAIL',e.stack||e);process.exitCode=1;}
 finally{for(const c of clients)try{c.ws.terminate();}catch{}proc.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
