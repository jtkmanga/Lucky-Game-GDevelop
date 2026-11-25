#!/usr/bin/env python3
"""Build a fail-closed Supabase-auth Railway runtime from the original ZIP.
No tests, deployments, database creation or credentials involved.
The v12 visual layout, styles and board remain unmodified.
"""
from pathlib import Path
import json
import shutil
import zipfile

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'Lucky_Game_Multiplayer_Test_v1.zip'
OUT=ROOT/'railway-runtime'
API=OUT/'backend'
APP=API/'railway'
AUTH=API/'auth'
APP.mkdir(parents=True, exist_ok=True)
AUTH.mkdir(parents=True, exist_ok=True)

for name in ('secure-server.cjs','postgres-store.cjs'):
    shutil.copy2(ROOT/'backend/railway'/name,APP/name)
for name in ('supabase-access-token.cjs','room-access.cjs'):
    shutil.copy2(ROOT/'backend/auth'/name,AUTH/name)
shutil.copytree(ROOT/'backend/supabase',API/'supabase',dirs_exist_ok=True)

with zipfile.ZipFile(SOURCE) as z:
    for name in ('rules.js','public/index.html'):
        path=APP/name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(z.read(name))

page=APP/'public/index.html'
html=page.read_text(encoding='utf8')
src="""const socket=new WebSocket(protocol+'//'+location.host+'/ws');onlineSocket=socket;"""
if html.count(src)!=1:
    raise RuntimeError('Original WebSocket bridge changed; manual review required')
# The existing click handler is preserved; Google provider prompt occurs before
# creating WS to avoid sending unverified room joins.
connect="""function onlineConnect(){"""
if html.count(connect)!=1:
    raise RuntimeError('Online Connect entry changed; manual review required')
html=html.replace(connect,"async function onlineConnect(){",1)
check=""" if(!/^https?:$/.test(location.protocol)){toast('ต้องเปิดผ่าน http หรือ https');return;}"""
if html.count(check)!=1:
    raise RuntimeError('Online Connect guard changed; manual review required')
html=html.replace(check,check+"""\n let authenticatedAccessToken;\n try{authenticatedAccessToken=await window.luckyGetAccessToken();}\n catch(error){toast('กรุณาเข้าสู่ระบบ Google ก่อนเล่นออนไลน์');return;}""",1)
legacy="""let token=null;try{token=localStorage.getItem('lucky-online-test-token')}catch{}
  onlineSend({type:'join',mode:state.mode,name:state.name,avatar:CHARACTERS[state.character][0],token});"""
secure="""onlineSend({type:'join',mode:state.mode,name:state.name,avatar:CHARACTERS[state.character][0],accessToken:authenticatedAccessToken});"""
if html.count(legacy)!=1:
    raise RuntimeError('Legacy join token code changed; manual review required')
html=html.replace(legacy,secure,1)
# Remove storage of unverified bearer resume token without changing UI layout.
old="""try{localStorage.setItem('lucky-online-test-token',msg.token)}catch{}"""
html=html.replace(old,"/* Supabase UID verification replaces guest resume bearer token. */")
bootstrap="""<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.48.1/dist/umd/supabase.min.js"></script>
<script>
'use strict';
// Authentication wiring only; original Lucky Game layout and styles unchanged.
let luckyClientPromise = fetch('/api/supabase-config',{cache:'no-store'})
 .then(async response=>{
   if(!response.ok)throw Error('Supabase configuration unavailable');
   return response.json();
 })
 .then(config=>{
   if(!window.supabase || !window.supabase.createClient)throw Error('Supabase JS unavailable');
   if(!config.url || !config.publishableKey)throw Error('Missing Supabase public config');
   return window.supabase.createClient(config.url,config.publishableKey);
 });
window.luckyGetAccessToken=async ()=>{
 const client=await luckyClientPromise;
 const {data,error}=await client.auth.getSession();
 if(error)throw error;
 if(data.session?.access_token)return data.session.access_token;
 // Browser navigates to Supabase/Google OAuth; the user returns to the same
 // page and clicks the existing Online button again to join a room.
 const result=await client.auth.signInWithOAuth({
   provider:'google',
   options:{redirectTo:location.origin+location.pathname}
 });
 if(result.error)throw result.error;
 throw Error('OAuth redirect started; connect again after returning');
};
</script>
"""
anchor="<script>/* Lucky Game pure turn rules:"
if html.count(anchor)!=1:
    raise RuntimeError('Script injection anchor changed; manual review required')
html=html.replace(anchor,bootstrap+anchor,1)
page.write_text(html,encoding='utf8')
(OUT/'package.json').write_text(json.dumps({
 "name":"lucky-game-railway-auth-preview",
 "version":"0.0.1",
 "private":True,
 "scripts":{"start":"node backend/railway/secure-server.cjs"},
 "dependencies":{"pg":"^8.13.1","ws":"^8.18.3"},
 "engines":{"node":">=20"}
},indent=2)+'\n',encoding='utf8')
print('Generated Railway draft runtime at',OUT)
print('Not tested, not deployed. No Supabase OAuth login flow tested and no game SQL migrated.')
