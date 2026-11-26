'use strict';
// Close player sockets on shutdown before waiting for HTTP to drain.
// This helper contains no database access or process.exit. The caller owns
// shutdown flags, room timers and store.close/exit.
function beginSocketShutdown({clients,wss,server,graceMs=3000}){
 if(!clients||!wss||!server)throw Error('INVALID_SHUTDOWN_DEPENDENCIES');
 if(!Number.isInteger(graceMs)||graceMs<1||graceMs>30000)throw Error('INVALID_SHUTDOWN_GRACE');
 let completed=false;
 let timer;
 const finish=()=>{if(completed)return;completed=true;clearTimeout(timer);};
 const drained=new Promise(resolve=>{
  let resolved=false;
  const settle=()=>{if(resolved)return;resolved=true;finish();resolve();};
  // A stuck upgraded WebSocket may prevent server.close from finishing.
  timer=setTimeout(()=>{
   for(const ws of clients){
    try{ws.terminate();}catch{}
   }
   settle();
  },graceMs);
  // Do not open a new connection. Close clients before closing listeners.
  for(const ws of clients){
   try{ws.close(1001,'Server shutting down');}catch{
    try{ws.terminate();}catch{}
   }
  }
  try{wss.close();}catch{}
  if(server.listening){
   try{server.close(()=>settle());}
   catch{settle();}
  }else{
   settle();
  }
 });
 return drained;
}
module.exports={beginSocketShutdown};
