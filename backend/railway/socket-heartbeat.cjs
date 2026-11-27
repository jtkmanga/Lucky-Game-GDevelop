'use strict';
const {randomBytes}=require('node:crypto');

// One interval per listener, not a second game clock or a per-player timer.
// Only a pong echoing this connection's latest challenge counts as live.
function startSocketHeartbeat({wss,open,intervalMs=25000,
 startInterval=setInterval,stopInterval=clearInterval}){
 const peers=new Map();
 let stopped=false;
 function terminate(ws,state){
  if(stopped||peers.get(ws)!==state||state.terminating)return;
  state.terminating=true;
  ws.terminate(); // existing WebSocket close handler owns queue/seat cleanup
 }
 function track(ws){
  const state={pending:null,terminating:false};
  peers.set(ws,state);
  const onPong=payload=>{
   if(state.pending && Buffer.isBuffer(payload) && payload.equals(state.pending))
    state.pending=null;
  };
  // Treat socket transport errors like a closed peer, not a process failure.
  const onError=()=>terminate(ws,state);
  ws.on('pong',onPong);
  ws.on('error',onError);
  ws.once('close',()=>{
   peers.delete(ws);
   ws.off('pong',onPong);
   ws.off('error',onError);
  });
 }
 wss.on('connection',track);
 const timer=startInterval(()=>{
  if(stopped)return;
  for(const [ws,state] of peers){
   if(ws.readyState!==open||state.terminating)continue;
   if(state.pending){terminate(ws,state);continue;}
   const challenge=randomBytes(8);
   state.pending=challenge;
   try{
    ws.ping(challenge,error=>{
     if(error&&state.pending===challenge)terminate(ws,state);
    });
   }catch{terminate(ws,state);}
  }
 },intervalMs);
 timer.unref?.();
 function stop(){
  if(stopped)return;
  stopped=true;
  stopInterval(timer);
  wss.off('connection',track);
  wss.off('close',stop);
  peers.clear();
 }
 wss.once('close',stop);
 return {stop};
}
module.exports={startSocketHeartbeat};
