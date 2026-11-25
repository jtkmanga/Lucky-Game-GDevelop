#!/usr/bin/env python3
"""Build a fail-closed Firebase-auth Railway runtime from the original ZIP.
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
for name in ('firebase-id-token.cjs','room-access.cjs'):
    shutil.copy2(ROOT/'backend/auth'/name,AUTH/name)

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
html=html.replace(connect, """async function onlineConnect(){
 let authenticatedIdToken;
 try{authenticatedIdToken=await window.luckyGetIdToken();}
 catch(error){toast('กรุณาเข้าสู่ระบบ Google ก่อนเล่นออนไลน์');return;}
""",1)
legacy="""let token=null;try{token=localStorage.getItem('lucky-online-test-token')}catch{}
  onlineSend({type:'join',mode:state.mode,name:state.name,avatar:CHARACTERS[state.character][0],token});"""
secure="""onlineSend({type:'join',mode:state.mode,name:state.name,avatar:CHARACTERS[state.character][0],idToken:authenticatedIdToken});"""
if html.count(legacy)!=1:
    raise RuntimeError('Legacy join token code changed; manual review required')
html=html.replace(legacy,secure,1)
# Remove storage of unverified bearer resume token without changing UI layout.
old="""try{localStorage.setItem('lucky-online-test-token',msg.token)}catch{}"""
html=html.replace(old,"/* UID verification replaces guest resume bearer token. */")
bootstrap="""<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
<script>
'use strict';
let luckyConfigPromise = fetch('/api/firebase-config',{cache:'no-store'})
 .then(async r=>{if(!r.ok)throw Error('Firebase config unavailable');return r.json();})
 .then(config=>{
   if(!window.firebase)throw Error('Firebase SDK unavailable');
   if(!firebase.apps.length)firebase.initializeApp(config);
   return firebase.auth();
 });
window.luckyGetIdToken=async ()=>{
 const auth=await luckyConfigPromise;
 let user=auth.currentUser;
 if(!user){
   const result=await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
   user=result.user;
 }
 if(!user)throw Error('Google account missing');
 return user.getIdToken(true);
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
print('Not tested, not deployed. No Firebase login or DB provisioned.')
