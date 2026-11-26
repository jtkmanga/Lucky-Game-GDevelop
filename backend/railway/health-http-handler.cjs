'use strict';
// This handler is shared by the draft Railway HTTP server and the isolated
// loopback HTTP test. It never invokes the database or authentication system.
const {healthResponse}=require('./health-readiness.cjs');
function respondHealth(req,res,state){
 const response=healthResponse(Boolean(state?.startupReady),Boolean(state?.shuttingDown));
 res.writeHead(response.statusCode,{
  'content-type':'application/json',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff'
 });
 res.end(JSON.stringify(response.body));
}
module.exports={respondHealth};
