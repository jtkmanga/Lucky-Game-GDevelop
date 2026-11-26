'use strict';
// Explicitly owner-run, bounded read-only pg connectivity preflight.
// SOURCE ONLY: not run by ChatGPT and not a Railway deployment.
const readline=require('node:readline');
const {Writable}=require('node:stream');
const path=require('node:path');
const {poolConnectionOptions}=require('../backend/supabase/pg-tls-config.cjs');
const {Pool}=require('../railway-runtime/node_modules/pg');
const USER='lucky_game_server_login.llbkxnazkliskzcureec';
const HOST='aws-1-ap-southeast-1.pooler.supabase.com';
const CA=path.resolve(__dirname,'../prod-ca-2021.crt');
function readHiddenPassword(){
 return new Promise((resolve,reject)=>{
  if(!process.stdin.isTTY||!process.stdout.isTTY){
   reject(Error('INTERACTIVE_TTY_REQUIRED'));return;
  }
  let hide=false;
  const masked=new Writable({write(chunk,encoding,cb){
   if(!hide)process.stdout.write(chunk);
   cb();
  }});
  const rl=readline.createInterface({input:process.stdin,output:masked,terminal:true});
  process.stdout.write('Restricted DB password (hidden, not saved): ');
  hide=true;
  rl.question('',password=>{
   hide=false;
   process.stdout.write('\n');
   rl.close();
   if(!password)reject(Error('EMPTY_PASSWORD'));
   else resolve(password);
  });
  rl.once('SIGINT',()=>{hide=false;rl.close();reject(Error('CANCELLED'));});
 });
}
async function main(){
 let secret=await readHiddenPassword();
 // URL setters percent-encode special characters: no plaintext credential in argv.
 const url=new URL('postgresql://'+USER+'@'+HOST+':5432/postgres');
 url.password=secret;
 secret=null;
 const opts=poolConnectionOptions(url.toString(),CA);
 const pool=new Pool({...opts,max:1,connectionTimeoutMillis:7000,
  idleTimeoutMillis:1000,query_timeout:7000});
 try {
  const result=await pool.query(`
   SELECT current_user AS db_role,
          session_user AS session_role,
          current_database() AS db_name,
          has_schema_privilege(current_user,'game','USAGE') AS game_usage,
          has_table_privilege(current_user,'game.rooms','SELECT') AS rooms_read,
          has_table_privilege(current_user,'game.orders','SELECT') AS orders_read
  `);
  const r=result.rows[0];
  if(result.rowCount!==1||
     r.db_role!=='lucky_game_server_login'||
     r.session_role!=='lucky_game_server_login'||
     r.db_name!=='postgres'||r.game_usage!==true||
     r.rooms_read!==true||r.orders_read!==false)
   throw Error('DB_IDENTITY_OR_PRIVILEGE_CHECK_FAILED');
  console.log('NODE_PG_READONLY_TLS_AUTH_PASS');
  console.log('verified: restricted role, game schema access, rooms SELECT, orders denied');
 } finally {await pool.end();}
}
main().catch(error=>{
 // Never log the error object or connection string: driver errors may expose URI.
 const safeCodes=new Set(['28P01','28000','3D000','42501','ETIMEDOUT','ECONNREFUSED','ENOTFOUND','EHOSTUNREACH']);
 if(safeCodes.has(error.code)) console.error('NODE_PG_CHECK_FAILED_CODE:',error.code);
 else console.error('NODE_PG_CHECK_FAILED: see sanitized status only');
 process.exitCode=1;
});
