'use strict';
// Railway PostgreSQL connection: fail closed before opening any socket.
// SOURCE ONLY. Requires separately approved staging setup and test.
const fs=require('node:fs');
const crypto=require('node:crypto');
const USER='lucky_game_server_login.llbkxnazkliskzcureec';
const HOST='aws-1-ap-southeast-1.pooler.supabase.com';
function poolConnectionOptions(connectionString,caPath=process.env.PG_SSL_ROOT_CERT_PATH){
 if(typeof connectionString!=='string'||!connectionString)throw Error('DATABASE_URL required');
 let url;
 try{url=new URL(connectionString);}catch{throw Error('DATABASE_URL invalid');}
 if(!['postgresql:','postgres:'].includes(url.protocol)||
    url.hostname!==HOST||url.port!=='5432'||url.pathname!=='/postgres'||
    decodeURIComponent(url.username)!==USER||!url.password||
    url.search||url.hash)throw Error('DATABASE_URL must use the approved restricted Session Pooler without query parameters');
 // pg's URI SSL parameters can override the explicit SSL object; forbid URI query.
 if(typeof caPath!=='string'||!caPath.trim())throw Error('PG_SSL_ROOT_CERT_PATH required');
 let cert;
 try{
  cert=fs.readFileSync(caPath);
  const x509=new crypto.X509Certificate(cert);
  const now=Date.now();
  if(!x509.ca||Date.parse(x509.validFrom)>now||Date.parse(x509.validTo)<now)
   throw Error('invalid certificate');
 }catch{throw Error('PostgreSQL trusted CA certificate missing or invalid');}
 return {connectionString,ssl:{ca:cert,rejectUnauthorized:true},
  max:8,connectionTimeoutMillis:5000,idleTimeoutMillis:30000};
}
module.exports={poolConnectionOptions};
