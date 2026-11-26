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

for name in ('secure-server.cjs','health-readiness.cjs','health-http-handler.cjs','startup-lifecycle.cjs','socket-shutdown.cjs','postgres-store.cjs','rules.js',
             'board-maps.cjs','board-definitions.json','multi-board-rules.cjs',
             'rule-transition-guard.cjs','current-leaderboard.cjs',
             'leaderboard-http-handler.cjs','v12-leaderboard-rows.cjs'):
    shutil.copy2(ROOT/'backend/railway'/name,APP/name)
for name in ('supabase-access-token.cjs','room-access.cjs'):
    shutil.copy2(ROOT/'backend/auth'/name,AUTH/name)
(API/'storage').mkdir(exist_ok=True)
shutil.copy2(ROOT/'backend/storage/score-periods.cjs',API/'storage'/'score-periods.cjs')
shutil.copytree(ROOT/'backend/supabase',API/'supabase',dirs_exist_ok=True)
# Supabase's public 2021 root CA (owner-downloaded from project dashboard).
# Bundled only for PostgreSQL TLS trust; it is NOT a credential or private key.
# Fail closed if absent, rather than relying on disabled certificate checking.
ca_source=ROOT/'prod-ca-2021.crt'
if not ca_source.is_file() or b'-----BEGIN CERTIFICATE-----' not in ca_source.read_bytes():
    raise RuntimeError('Supabase root CA file missing or invalid')
shutil.copy2(ca_source,API/'supabase'/'prod-ca-2021.crt')


with zipfile.ZipFile(SOURCE) as z:
    # Fail closed on source drift. The tracked rules.js was copied unchanged
    # from the original archive; future rules edits need an explicit review
    # rather than silently overwriting or splitting game logic.
    if z.read('rules.js') != (ROOT/'backend/railway/rules.js').read_bytes():
        raise RuntimeError('Tracked rules differ from original ZIP; review rules migration explicitly')
    path=APP/'public/index.html'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(z.read('public/index.html'))

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
html=html.replace(check,check+"""\n if(luckyAuthPending || movementRunning)return;\n const attempt=++luckyConnectAttempt;\n luckyAuthPending=true;\n let authenticatedAccessToken;\n try{authenticatedAccessToken=await window.luckyGetAccessToken();}\n catch(error){if(attempt===luckyConnectAttempt)toast('กรุณาเข้าสู่ระบบ Google ก่อนเล่นออนไลน์');return;}\n finally{if(attempt===luckyConnectAttempt)luckyAuthPending=false;}\n if(attempt!==luckyConnectAttempt || movementRunning)return;""",1)
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
let luckyNameUid=null;
// A nickname is display data only. The authenticated UID controls the profile scope.
function luckyRenderSavedName(value){
 const name=String(value||'').trim().slice(0,20);
 if(name.length<2)return false;
 state.name=name;
 $('playerName').value=name;
 $('welcomeName').textContent=name;
 if($('localPlayer0'))$('localPlayer0').value=name;
 renderPlayerSlots();
 return true;
}
function luckyUseNameForAccount(user){
 if(!user){
  if(luckyNameUid!==null){
   luckyNameUid=null;
   luckyRenderSavedName('Po');
   $('playerName').value='';
  }
  return;
 }
 if(luckyNameUid===user.id)return;
 luckyNameUid=user.id;
 let cached='';
 try{cached=localStorage.getItem('lucky-player-name:'+user.id)||'';}catch{}
 const data=user.user_metadata||{};
 const candidate=data.lucky_player_name||cached||data.full_name||data.name||
   (user.email||'').split('@')[0];
 if(!luckyRenderSavedName(candidate))luckyRenderSavedName('Po');
}
async function luckyPersistPlayerName(name){
 const clean=String(name||'').trim().slice(0,20);
 if(!luckyRenderSavedName(clean))return false;
 try{
  const client=await luckyClientPromise;
  const {data,error}=await client.auth.getUser();
  if(error && error.name!=='AuthSessionMissingError')throw error;
  const user=data?.user;
  if(user){
   luckyNameUid=user.id;
   try{localStorage.setItem('lucky-player-name:'+user.id,clean);}catch{}
   const saved=await client.auth.updateUser({data:{lucky_player_name:clean}});
   if(saved.error)throw saved.error;
   toast('บันทึกชื่อกับบัญชี Google แล้ว');
  }else{
   try{localStorage.setItem('lucky-new-ui-name',clean);}catch{}
   toast('บันทึกชื่อในเครื่องแล้ว กรุณาเข้าสู่ระบบ Google เพื่อซิงก์');
  }
  return true;
 }catch{
  if(luckyNameUid){
   try{localStorage.setItem('lucky-player-name:'+luckyNameUid,clean);}catch{}
  }
  toast('เปลี่ยนชื่อในเครื่องแล้ว แต่ซิงก์ Google ไม่สำเร็จ');
  return false;
 }
}
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
// Welcome card Google auth controls: match owner's existing Workers UI reference.
// Preserve the v12 HTML layout, server selection, game logic and payment restrictions.
function luckyMountGoogleControls(){
 const leaf=[...document.querySelectorAll('body *')].find(el=>
   el.children.length===0 &&
   el.textContent?.includes('ระบบเข้าสู่ระบบ Google ยังไม่เปิดใช้งาน'));
 if(!leaf)return;
 const strip=leaf.parentElement||leaf;
 if(strip.dataset.luckyAuthMounted)return;
 strip.dataset.luckyAuthMounted='1';
 strip.style.cssText+=';display:block;width:100%;box-sizing:border-box;border-radius:10px;background:#fff1d5;color:#885f23;padding:9px 12px;margin:8px 0 12px';
 leaf.textContent='กำลังตรวจสอบบัญชี Google...';
 leaf.setAttribute('role','status');
 leaf.setAttribute('aria-live','polite');
 const parent=strip.parentElement;
 if(!parent)return;
 const accountBar=document.createElement('div');
 accountBar.style.cssText='display:flex;gap:8px;align-items:center;justify-content:space-between;width:100%;box-sizing:border-box;background:#fff;border:1px solid #e8ddc9;border-radius:12px;box-shadow:0 3px 0 rgba(122,90,60,.12);padding:9px 12px;margin:8px 0;min-width:0';
 accountBar.style.display='none';
 const identity=document.createElement('span');
 identity.style.cssText='min-width:0;overflow-wrap:anywhere;font-weight:700;color:#4c3a2e';
 accountBar.appendChild(identity);
 const login=document.createElement('button');
 login.type='button';
 login.textContent='G เข้าสู่ระบบด้วย Google';
 login.style.cssText='display:block;width:100%;box-sizing:border-box;border:2px solid #e4d8c5;border-radius:17px;background:#fff;padding:15px 12px;margin:12px 0 10px;box-shadow:0 4px 0 rgba(122,90,60,.14);color:#4d3b31;font:inherit;font-size:1.07em;font-weight:800;cursor:pointer';
 const logout=document.createElement('button');
 logout.type='button';
 logout.textContent='ออกจากระบบ';
 logout.style.cssText='flex:none;border:0;background:transparent;color:#5c493c;font:inherit;font-weight:700;text-decoration:underline;cursor:pointer';
 accountBar.appendChild(logout);
 parent.insertBefore(login,strip);
 parent.insertBefore(accountBar,strip);
 function show(user){
  luckyUseNameForAccount(user);
  const signed=!!user;
  login.style.display=signed?'none':'block';
  accountBar.style.display=signed?'flex':'none';
  if(signed){
   identity.textContent='✅ '+(user.email||user.user_metadata?.full_name||'บัญชี Google');
   leaf.textContent='✅ เข้าสู่ระบบ Google สำเร็จ';
  }else{
   identity.textContent='';
   leaf.textContent='🔐 กรุณาเข้าสู่ระบบด้วย Google เพื่อเล่นออนไลน์';
  }
 }
 login.addEventListener('click',async()=>{
  login.disabled=true;
  leaf.textContent='กำลังเปิดหน้าล็อกอิน Google...';
  try{
   const client=await luckyClientPromise;
   const {error}=await client.auth.signInWithOAuth({
    provider:'google',options:{redirectTo:location.origin+location.pathname}
   });
   if(error)throw error;
  }catch{
   leaf.textContent='ไม่สามารถเข้าสู่ระบบ Google ได้ กรุณาลองใหม่';
  }finally{login.disabled=false;}
 });
 logout.addEventListener('click',async()=>{
  logout.disabled=true;
  try{
   const client=await luckyClientPromise;
   const {error}=await client.auth.signOut();
   if(error)throw error;
   show(null);
  }catch{leaf.textContent='ออกจากระบบไม่สำเร็จ กรุณาลองใหม่';}
  finally{logout.disabled=false;}
 });
 luckyClientPromise.then(async client=>{
  client.auth.onAuthStateChange((_event,session)=>show(session?.user||null));
  const {data,error}=await client.auth.getUser();
  if(error && error.name!=='AuthSessionMissingError')throw error;
  show(data?.user||null);
 }).catch(()=>{
  leaf.textContent='ไม่สามารถตรวจสอบ Google Login ได้ กรุณารีเฟรชหน้า';
 });
}
if(document.readyState==='loading'){
 document.addEventListener('DOMContentLoaded',luckyMountGoogleControls,{once:true});
}else{luckyMountGoogleControls();}
</script>
"""
anchor="<script>/* Lucky Game pure turn rules:"
if html.count(anchor)!=1:
    raise RuntimeError('Script injection anchor changed; manual review required')
html=html.replace(anchor,bootstrap+anchor,1)
# JS-only board bridge, based on exact inspected original ZIP v12 hooks.
# Preserve all visible HTML/CSS/DOM positions, tile classes and color rules.
# Only the source of snake/ladder data changes.
catalog=json.loads((ROOT/'backend/railway/board-definitions.json').read_text(encoding='utf8'))
if catalog.get('version')!=1 or [b.get('id') for b in catalog['boards']]!=[1,2,3,4,5]:
    raise RuntimeError('Invalid versioned board catalog')
# Inject the SAME source definitions used by Node into the generated client.
board_helper='const luckyKnownBoards='+json.dumps(
 catalog,ensure_ascii=False,separators=(',',':'))+';'+chr(10)
board_helper+="""let luckySeenRoomBoard=null;
function luckyBoardLayout(game){
 const catalog=luckyKnownBoards;
 const id=game?.map??1;
 if(!Number.isInteger(id)||id<1||id>5||catalog.version!==1)
  return null;
 const expected=catalog.boards[id-1];
 if(!expected||expected.id!==id)return null;
 if(!game?.board){
  // Only map one supports legacy local play without a board snapshot.
  return id===1?{id:1,version:1,snakes:expected.snakes,
   ladders:expected.ladders}:null;
 }
 const board=game.board;
 if(!board||board.version!==1||board.id!==id||
    !board.snakes||!board.ladders||
    typeof board.snakes!=='object'||Array.isArray(board.snakes)||
    typeof board.ladders!=='object'||Array.isArray(board.ladders))
  return null;
 const sameLinks=(actual,canonical)=>{
  const keys=Object.keys(actual),expectedKeys=Object.keys(canonical);
  return keys.length===expectedKeys.length&&
   expectedKeys.every(k=>Object.hasOwn(actual,k)&&actual[k]===canonical[k]);
 };
 if(!sameLinks(board.snakes,expected.snakes)||
    !sameLinks(board.ladders,expected.ladders))
  return null;
 return expected;
}
"""

render_marker="function renderBoard(){"
if html.count(render_marker)!=1:
    raise RuntimeError('Original v12 renderBoard hook drifted; review manually')
visual_helper=(ROOT/'backend/railway/board-visual-bridge.js').read_text(encoding='utf8')
html=html.replace(render_marker,board_helper+'\n'+visual_helper+'\n'+render_marker,1)
old_special="const snakeStart=[98,94,80,59,37], ladderStart=[4,11,28,43,62,71];"
new_special="""const board=luckyBoardLayout(localGame);
  if(!board)throw Error('Invalid server board; refuse to render');
  const snakeStart=Object.keys(board.snakes).map(Number);
  const ladderStart=Object.keys(board.ladders).map(Number);
  luckyRenderBoardArt(board);"""
if html.count(old_special)!=1:
    raise RuntimeError('Original v12 board marker hook drifted')
html=html.replace(old_special,new_special,1)
old_animation="Object.hasOwn(LuckyRules.SNAKES,ordinaryEnd)"
new_animation="Object.hasOwn(luckyBoardLayout(localGame)?.snakes||{},ordinaryEnd)"
if html.count(old_animation)!=1:
    raise RuntimeError('Original v12 snake animation hook drifted')
html=html.replace(old_animation,new_animation,1)
old_state="  localGame=msg.game;"
new_state="""  // Never show a board different from the authoritative room snapshot.
  // Online room snapshots must include a canonical versioned board even
  // for map 1. The map-one no-board exception is LOCAL legacy play only.
  const acceptedBoard=msg.game?.board&&luckyBoardLayout(msg.game);
  if(typeof msg.roomId!=='string' || !msg.roomId || !acceptedBoard||
     (luckySeenRoomBoard?.roomId===msg.roomId &&
      luckySeenRoomBoard.mapId!==acceptedBoard.id)){
   toast('ข้อมูลกระดานจากเซิร์ฟเวอร์ไม่ตรงกัน');
   luckyEndOnline();return;
  }
  luckyRenderBoardArt(acceptedBoard);
  luckySeenRoomBoard={roomId:msg.roomId,mapId:acceptedBoard.id};
  localGame=msg.game;"""
if html.count(old_state)!=1:
    raise RuntimeError('Original v12 online state hook drifted')
html=html.replace(old_state,new_state,1)

# Patch the inspected v12 adapter only. Reject archive drift at each hook.
def replace_hook(source, replacement):
    global html
    if html.count(source) != 1:
        raise RuntimeError('Expected exactly one v12 hook: ' + source[:70])
    html = html.replace(source, replacement, 1)

# Replace the v12 local-only nickname handler, keeping the original name field/button.
replace_hook("$('saveName').addEventListener('click',()=>{const name=$('playerName').value.trim(); if(name.length<2){toast('กรุณาใส่ชื่ออย่างน้อย 2 ตัวอักษร'); return;} state.name=name; try{localStorage.setItem('lucky-new-ui-name',name)}catch{} $('welcomeName').textContent=name; if($('localPlayer0'))$('localPlayer0').value=name; toast('บันทึกชื่อบนอุปกรณ์นี้แล้ว'); renderPlayerSlots();});",
 """$('saveName').addEventListener('click',()=>{const name=$('playerName').value.trim().slice(0,20);if(name.length<2){toast('กรุณาใส่ชื่ออย่างน้อย 2 ตัวอักษร');return;}luckyPersistPlayerName(name);});""")
# On the way into the lobby, never leave a typed but unsaved nickname as stale Po.
replace_hook("$('enterLobby').addEventListener('click',()=>{$('welcomeName').textContent=state.name; navigate('lobby');});",
 """$('enterLobby').addEventListener('click',()=>{const typed=$('playerName').value.trim();if(typed.length>=2&&typed!==state.name)luckyPersistPlayerName(typed);$('welcomeName').textContent=state.name;navigate('lobby');});""")
# Retain the existing legacy local saved-name behavior for signed-out offline local play.
# Signed-in users are restored by UID from their Google profile and per-account fallback.

replace_hook("function onlineSend(message){", """let luckyConnectAttempt=0;
let luckyAuthPending=false;
function luckyEndOnline(){
 const previous=onlineSocket;
 onlineSocket=null;
 previous?.close();
 onlineActive=false;
 onlineRoomId=null;
 onlineSeat=null;
 onlineDeadline=null;
 stopClock();
 localGame=null;
 $('gameResultOverlay').hidden=true;
 resultVisible=false;
 refreshLocal();
 $('matchButton').textContent='🌐 เชื่อมต่อใหม่ / จับคู่ใหม่ ➜';
 navigate('lobby');
}
function onlineSend(message){""")
replace_hook("onlineSocket?.close();onlineSocket=null;onlineActive=false;onlineSeat=null;",
             "luckyEndOnline();")
replace_hook("onlineActive=false;toast('ห้องทดสอบปิดแล้ว')",
             "luckyEndOnline();toast('ห้องทดสอบปิดแล้ว')")
replace_hook("if(onlineSocket&&onlineSocket.readyState===WebSocket.CONNECTING)return;",
             """if(onlineSocket && onlineSocket.readyState<=WebSocket.OPEN){
  if(!localGame?.over)return;
  luckyEndOnline();
 }""")
replace_hook("onlineActive=true;onlineSeat=null;onlineRoomId=null;", """stopClock();
 localGame=null;
 $('gameResultOverlay').hidden=true;
 resultVisible=false;
 onlineDeadline=null;
 onlineActive=true;onlineSeat=null;onlineRoomId=null;""")
replace_hook("else if(msg.type==='error')toast(msg.message||'เซิร์ฟเวอร์ปฏิเสธคำสั่ง');",
             "else if(msg.type==='error'){if(!onlineRoomId)luckyEndOnline();toast(msg.message||'เซิร์ฟเวอร์ปฏิเสธคำสั่ง');}")
replace_hook(src, """let socket;
 try{socket=new WebSocket(protocol+'//'+location.host+'/ws');}
 catch{luckyEndOnline();toast('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');return;}
 onlineSocket=socket;""")
replace_hook("socket.addEventListener('open',()=>{",
             "socket.addEventListener('open',()=>{if(onlineSocket!==socket)return;")
replace_hook("try{onlineApplyMessage(JSON.parse(e.data))}catch(err){console.error('online message',err)}",
             """if(onlineSocket!==socket || socket.readyState!==WebSocket.OPEN)return;
  try{onlineApplyMessage(JSON.parse(e.data));}
  catch{luckyEndOnline();toast('ไม่สามารถแสดงข้อมูลห้องออนไลน์ได้');}""")
replace_hook("if(onlineActive){toast('การเชื่อมต่อหลุด กดจับคู่เพื่อเชื่อมต่อใหม่');$('rollDice').disabled=true;}",
             "luckyEndOnline();toast('การเชื่อมต่อหลุด กดจับคู่เพื่อเชื่อมต่อใหม่');")
replace_hook("()=>toast('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้')",
             "()=>{if(onlineSocket===socket)toast('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');}")
replace_hook("""if(!onlineActive)return;
 e.stopImmediatePropagation();toast('กำลังอยู่ในโหมดออนไลน์ กดออก/รีเฟรชก่อนเล่นบนเครื่องเดียว');""",
             """if(onlineActive && localGame?.over)luckyEndOnline();
 if(onlineActive){
  e.stopImmediatePropagation();toast('กำลังอยู่ในโหมดออนไลน์ กดออก/รีเฟรชก่อนเล่นบนเครื่องเดียว');return;
 }
 ++luckyConnectAttempt;
 luckyAuthPending=false;""")

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
