'use strict';
// Production bootstrap path extracted for deterministic no-network tests.
// Never marks ready before both DB preflight and recovery have completed
// and the HTTP listener has emitted "listening".
async function beginListening({health,recover,server,port,shouldStop,onReady}){
 if(typeof health!=='function'||typeof recover!=='function'||
    !server||typeof server.listen!=='function'||typeof onReady!=='function')
   throw Error('INVALID_STARTUP_DEPENDENCIES');
 await health();
 if(shouldStop?.())return false;
 await recover();
 if(shouldStop?.())return false;
 await new Promise((resolve,reject)=>{
  let settled=false;
  const cleanup=()=>{
   server.off('listening',onListening);
   server.off('error',onError);
  };
  const onError=error=>{
   if(settled)return;
   settled=true;cleanup();reject(error);
  };
  const onListening=()=>{
   if(settled)return;
   settled=true;cleanup();resolve();
  };
  server.once('error',onError);
  server.once('listening',onListening);
  try{server.listen(port,'0.0.0.0');}catch(error){onError(error);}
 });
 if(shouldStop?.())return false;
 onReady();
 return true;
}
module.exports={beginListening};
