'use strict';
// Pure startup health response: does not query DB or start a listener.
function healthResponse(startupReady,shuttingDown){
 const ready=Boolean(startupReady)&&!shuttingDown;
 return {
  statusCode:ready?200:503,
  body:{
   ok:ready,
   status:shuttingDown?'stopping':ready?'ready':'starting',
   mode:'draft-auth-required'
  }
 };
}
module.exports={healthResponse};
