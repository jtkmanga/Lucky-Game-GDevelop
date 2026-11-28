'use strict';
/**
 * Validate each Supabase access token with Supabase Auth's /user endpoint.
 * The Auth service validates the JWT and returns the server-verified user.
 * No trust in claims/uid/roles supplied in a WebSocket message.
 *
 * Draft only: requires real Supabase project config; not executed/deployed.
 */
const PROJECT_REF_RE=/^[a-z0-9]{10,32}$/;
const SHARED_PROJECT_REF='llbkxnazkliskzcureec';
function expectedProjectRef(env=process.env){
 const ref=env.LUCKY_ISOLATED_STAGING_SUPABASE_REF;
 const pooler=env.LUCKY_ISOLATED_STAGING_POOLER_HOST;
 if(ref===undefined && pooler===undefined && env.LUCKY_FREE4_PILOT!=='true')
  return SHARED_PROJECT_REF;
 if(env.RAILWAY_ENVIRONMENT_NAME!=='staging'||env.LUCKY_FREE4_PILOT!=='true'||
    typeof ref!=='string'||!PROJECT_REF_RE.test(ref)||ref===SHARED_PROJECT_REF||
    typeof pooler!=='string'||!/^aws-[0-9]+-ap-southeast-1\.pooler\.supabase\.com$/.test(pooler))
  throw Error('Free4 acceptance requires a separate Singapore Supabase project and its Session Pooler');
 return ref;
}
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function readConfig(env=process.env){
 const ref=expectedProjectRef(env);
 const url=env.SUPABASE_URL;
 const key=env.SUPABASE_PUBLISHABLE_KEY;
 if(typeof url!=='string'||typeof key!=='string'||!key)throw Error('Supabase environment is not configured');
 let u;
 try{u=new URL(url);}catch{throw Error('SUPABASE_URL invalid');}
 const match=/^([a-z0-9]{10,32})\.supabase\.co$/.exec(u.hostname);
 if(u.protocol!=='https:'||!match||!PROJECT_REF_RE.test(match[1])||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)
   throw Error('SUPABASE_URL must be the expected public project HTTPS URL');
 if(match[1]!==ref)throw Error('Unexpected Supabase project ref');
 if(ref!==SHARED_PROJECT_REF&&!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))
  throw Error('Isolated Staging requires a Supabase publishable key');
 return {origin:u.origin,key};
}
async function requirePlayerIdentity(message){
 const token=message?.accessToken;
 if(typeof token!=='string'||token.length<40||token.length>16000||!/^[-._A-Za-z0-9]+$/.test(token))
   throw Error('UNAUTHENTICATED');
 const {origin,key}=readConfig();
 const response=await fetch(origin+'/auth/v1/user',{
   method:'GET',
   headers:{apikey:key,authorization:'Bearer '+token},
   redirect:'error',
   signal:AbortSignal.timeout(5000)
 });
 if(!response.ok)throw Error('UNAUTHENTICATED');
 const user=await response.json();
 if(typeof user?.id!=='string'||!UUID_RE.test(user.id)||!user.aud||user.aud!=='authenticated')
   throw Error('UNAUTHENTICATED');
 // Only verified Auth endpoint response can establish UID.
 return {uid:user.id,email:typeof user.email==='string'?user.email:null,emailVerified:!!user.email_confirmed_at};
}
module.exports={requirePlayerIdentity,readConfig,expectedProjectRef,SHARED_PROJECT_REF};
