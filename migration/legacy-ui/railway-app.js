'use strict';
// Railway + Supabase browser client for the original V99 visual shell.
// No Cloudflare/Firebase, guest multiplayer, bot demo or payment calls.
(function(){
const byId=id=>document.getElementById(id);
const text=(id,value)=>{const n=byId(id);if(n)n.textContent=String(value);};
const avatars=[['🐱','แมว'],['🐰','กระต่าย'],['🦊','จิ้งจอก'],['🐻','หมี'],['🐼','แพนด้า'],['🐸','กบ'],['🐧','เพนกวิน'],['🐥','ลูกเจี๊ยบ'],['🐶','สุนัข'],['🦄','ยูนิคอร์น']];
let client=null,user=null,mode='free',name='',avatar=0,socket=null,room=null,seat=-1,deadline=0,clock=null,leaving=false;
const cacheKey=uid=>'lucky-original-ui-name:'+uid;
function message(m){const n=byId('toast');if(!n)return;n.textContent=m;n.classList.add('show');setTimeout(()=>n.classList.remove('show'),3200);}
function screen(id){document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('active',x.id===id));scrollTo({top:0,behavior:'instant'});}
function applyName(v){name=String(v||'').trim().slice(0,18);if(byId('nickname'))byId('nickname').value=name;text('welcome-name',name||'ผู้เล่นของฉัน');text('nickname-hint',name?'✅ ใช้ชื่อ '+name+' กับบัญชี Google':'ตั้งชื่อครั้งแรกแล้วบันทึกไว้ ใช้ชื่อเดิมได้ทุกครั้ง');}
function accountUI(){
 const original=byId('google-btn'),status=byId('auth-status'),card=document.querySelector('.auth-card');
 if(!original||!status||!card)return;
 let bar=byId('lucky-railway-account');
 if(!bar){bar=document.createElement('div');bar.id='lucky-railway-account';bar.className='lucky-railway-account';original.before(bar);}
 if(user){
  original.style.display='none';bar.style.display='flex';
  bar.replaceChildren();
  const label=document.createElement('b');label.textContent='✅ '+(user.email||'บัญชี Google');
  const signout=document.createElement('button');signout.type='button';signout.textContent='ออกจากระบบ';signout.className='nickname-action';
  signout.addEventListener('click',async()=>{
   if(socket){leaving=true;socket.close();socket=null;}
   try{await client.auth.signOut();}catch{message('ออกจากระบบไม่สำเร็จ');}
  });
  bar.append(label,signout);
  status.textContent='✅ เข้าสู่ระบบ Google สำเร็จ';
 }else{
  original.style.display='block';bar.style.display='none';
  status.textContent='🔐 กรุณาเข้าสู่ระบบด้วย Google เพื่อเล่นออนไลน์';
 }
}
async function authChanged(next){
 const prior=user?.id;user=next||null;accountUI();
 if(!user){applyName('');if(socket){leaving=true;socket.close();socket=null;}screen('screen-auth');return;}
 const profile=user.user_metadata||{};
 let cached='';try{cached=localStorage.getItem(cacheKey(user.id))||'';}catch{}
 const candidate=profile.lucky_player_name||cached||profile.full_name||profile.name||(user.email||'').split('@')[0];
 applyName(candidate);
 if(prior&&prior!==user.id){if(socket){leaving=true;socket.close();socket=null;}screen('screen-auth');}
}
async function saveName(){
 if(!user){message('กรุณาเข้าสู่ระบบ Google ก่อน');return false;}
 const v=(byId('nickname')?.value||'').trim().slice(0,18);
 if(v.length<2){message('ชื่อผู้เล่นต้องมีอย่างน้อย 2 ตัวอักษร');return false;}
 const r=await client.auth.updateUser({data:{lucky_player_name:v}});
 if(r.error){message('บันทึกชื่อกับ Google ไม่สำเร็จ');return false;}
 try{localStorage.setItem(cacheKey(user.id),v);}catch{}
 applyName(v);message('บันทึกชื่อผู้เล่นแล้ว');return true;
}
function chooseAvatar(i){
 avatar=i;
 const wrap=byId('avatars');if(!wrap)return;
 wrap.querySelectorAll('button').forEach((b,j)=>b.classList.toggle('selected',i===j));
 text('welcome-mascot',avatars[i][0]);
}
function drawAvatars(){
 const wrap=byId('avatars');if(!wrap)return;wrap.replaceChildren();
 avatars.forEach(([emoji,label],i)=>{
  const b=document.createElement('button');b.type='button';b.className='avatar-button'+(i===avatar?' selected':'');
  const icon=document.createElement('span');icon.className='avatar-emoji';icon.textContent=emoji;
  const name=document.createElement('span');name.className='avatar-text';name.textContent=label;
  b.append(icon,name);b.addEventListener('click',()=>chooseAvatar(i));wrap.append(b);
 });
}
function selectFree(){
 mode='free';byId('server-free')?.classList.add('selected');byId('server-vip')?.classList.remove('selected');
 text('lobby-server','FREE');text('lobby-room-size','4 คน');
}
function setWaiting(m){
 text('mode-status',m);text('online-btn',m);
}
function connect(){
 if(!user){message('กรุณาเข้าสู่ระบบ Google');return;}
 if(!name||name.length<2){message('กรุณาบันทึกชื่อผู้เล่น');return;}
 if(socket && [0,1].includes(socket.readyState))return;
 leaving=false;setWaiting('กำลังเชื่อมต่อเซิร์ฟเวอร์...');
 (async()=>{
  const {data,error}=await client.auth.getSession();
  if(error||!data.session?.access_token)throw Error('กรุณาเข้าสู่ระบบ Google ใหม่');
  const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');
  socket=ws;
  ws.addEventListener('open',()=>{
   if(socket!==ws)return;
   ws.send(JSON.stringify({type:'join',token:data.session.access_token,mode:'free',name:name,avatar:avatars[avatar][0]}));
  });
  ws.addEventListener('message',event=>{
   if(socket!==ws)return;
   let m;try{m=JSON.parse(event.data);}catch{return;}
   if(m.type==='waiting'){
    setWaiting(m.preparing?'กำลังจัดเตรียมห้อง Free 4 คน':'กำลังรอผู้เล่น '+m.joined+'/'+m.needed+' · กดเพื่อยกเลิก');
   }else if(m.type==='state'){
    room=m.game;seat=m.seat;deadline=m.deadline||0;
    screen('screen-game');text('room-label','ห้อง Free · '+String(m.roomId||'').slice(0,8));
    renderGame(m.game);
   }else if(m.type==='error'){
    message(m.message||'เชื่อมต่อห้องไม่สำเร็จ');setWaiting('🌐 เริ่มจับคู่หาห้องออนไลน์ ➜');
   }else if(m.type==='cancelled'){
    setWaiting('🌐 เริ่มจับคู่หาห้องออนไลน์ ➜');
   }
  });
  ws.addEventListener('close',()=>{
   if(socket!==ws)return;
   socket=null;
   if(leaving)return;
   setWaiting('การเชื่อมต่อขาด กรุณากดเชื่อมต่ออีกครั้ง');
   message('หลุดการเชื่อมต่อ กดเริ่มจับคู่อีกครั้งเพื่อกลับห้องเดิม');
  });
  ws.addEventListener('error',()=>{if(socket===ws)message('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');});
 })().catch(e=>{setWaiting('🌐 เริ่มจับคู่หาห้องออนไลน์ ➜');message(e.message||'ไม่สามารถเชื่อมต่อได้');});
}
function cancelWaiting(){
 if(!socket)return;
 if(room){message('กำลังอยู่ในห้องเกม กรุณากลับ Lobby');return;}
 try{socket.send(JSON.stringify({type:'cancel'}));}catch{}
 leaving=true;socket.close();socket=null;setWaiting('🌐 เริ่มจับคู่หาห้องออนไลน์ ➜');
}
function boardLocation(tile){const row=Math.floor((tile-1)/10),col=(tile-1)%10;return {x:(row%2===0?col:9-col),y:9-row};}
function renderBoard(game){
 const wrap=byId('board');if(!wrap)return;wrap.replaceChildren();
 const snakes=game.board?.snakes||{},ladders=game.board?.ladders||{};
 for(let y=0;y<10;y++)for(let x=0;x<10;x++){
  const row=9-y,n=row*10+(row%2===0?x+1:10-x);
  const el=document.createElement('div');el.className='tile '+((x+y)%2?'mint':'white')+(n===100?' finish':'');
  el.textContent=n;
  if(snakes[n]!==undefined||ladders[n]!==undefined||n===game.gift&&!game.giftUsed){
   const badge=document.createElement('span');badge.className='special-icon';
   badge.textContent=n===game.gift&&!game.giftUsed?'🎁':snakes[n]!==undefined?'🐍':'🪜';el.append(badge);
  }
  wrap.append(el);
 }
 const layer=document.createElement('div');layer.className='token-layer';wrap.append(layer);
 (game.players||[]).forEach((p,i)=>{
  if(!p.pos)return;
  const spot=boardLocation(p.pos),token=document.createElement('div');token.className='token'+(game.current===i?' active':'');
  token.dataset.seat=i;token.textContent=p.avatar||avatars[i%avatars.length][0];
  token.style.left=((spot.x+.5)*10)+'%';token.style.top=((spot.y+.5)*10)+'%';layer.append(token);
 });
}
function renderGame(game){
 if(!game)return;
 renderBoard(game);
 const wrap=byId('players');if(wrap){wrap.replaceChildren();(game.players||[]).forEach((p,i)=>{
  const div=document.createElement('div');div.className='player-card'+(i===game.current?' current':'')+(game.winner===i?' winner':'');
  const ico=document.createElement('span');ico.className='player-icon';ico.textContent=p.avatar||avatars[i%avatars.length][0];
  const label=document.createElement('span');label.className='player-data';label.textContent=p.name+' · ช่อง '+p.pos;
  div.append(ico,label);wrap.append(div);
 });}
 const p=game.players?.[game.current];
 text('current-player',game.over?'🏆 ผู้ชนะ: '+(game.players?.[game.winner]?.name||''):(p?.name||'รอผู้เล่น'));
 text('dice',game.lastRoll?['','⚀','⚁','⚂','⚃','⚄','⚅'][game.lastRoll]:'🎲');
 text('roll-value',game.lastRoll?'ทอยได้ '+game.lastRoll:game.over?'จบเกม':'รอทอยลูกเต๋า');
 text('board-map-name','🗺️ แผนที่ '+(game.board?.id||game.map||1));
 text('chest-label',game.giftUsed?'🎁 เปิดแล้ว':'🎁 กล่องสุ่ม 1 กล่อง');
 const events=byId('events');if(events){events.replaceChildren();(game.events||[]).slice(-12).reverse().forEach(s=>{
  const el=document.createElement('div');el.className='event';el.textContent=s;events.append(el);
 });}
 const button=byId('roll-btn');if(button)button.disabled=game.over||game.current!==seat;
 if(clock)clearInterval(clock);
 clock=setInterval(()=>{
  const left=Math.max(0,Math.ceil((deadline-Date.now())/1000));
  text('timer',left);const fill=byId('time-fill');if(fill)fill.style.width=Math.min(100,left/20*100)+'%';
  if(button)button.disabled=game.over||game.current!==seat||left===0;
 },300);
}
function bind(){
 drawAvatars();selectFree();
 byId('google-btn')?.addEventListener('click',async()=>{
  try{const r=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}});if(r.error)throw r.error;}
  catch{message('เปิด Google Login ไม่สำเร็จ');}
 });
 byId('nickname-action')?.addEventListener('click',()=>saveName());
 byId('server-free')?.addEventListener('click',selectFree);
 byId('server-vip')?.addEventListener('click',()=>message('VIP ยังไม่เปิดให้บริการ กรุณาใช้ Free Server'));
 byId('enter-btn')?.addEventListener('click',async()=>{if(!user){message('กรุณาเข้าสู่ระบบ Google');return;}if(byId('nickname')?.value.trim()!==name){if(!await saveName())return;}screen('screen-lobby');});
 byId('online-btn')?.addEventListener('click',()=>{if(socket&&!room)cancelWaiting();else connect();});
 byId('back-lobby')?.addEventListener('click',()=>{if(socket){leaving=true;socket.close();socket=null;}room=null;screen('screen-lobby');});
 byId('roll-btn')?.addEventListener('click',()=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'roll'}));});
 byId('menu-btn')?.addEventListener('click',()=>{byId('side-menu').hidden=false;byId('menu-backdrop').hidden=false;});
 byId('close-menu')?.addEventListener('click',()=>{byId('side-menu').hidden=true;byId('menu-backdrop').hidden=true;});
 byId('menu-backdrop')?.addEventListener('click',()=>{byId('side-menu').hidden=true;byId('menu-backdrop').hidden=true;});
 document.querySelectorAll('[data-nav]').forEach(button=>button.addEventListener('click',()=>{
  byId('side-menu').hidden=true;byId('menu-backdrop').hidden=true;
  const v=button.dataset.nav;
  if(v==='auth')screen('screen-auth');else if(v==='lobby')screen('screen-lobby');
  else if(v==='shop'){screen('screen-lobby');byId('shop-section')?.scrollIntoView();}
  else if(v==='rank'){screen('screen-lobby');byId('leaderboard')?.scrollIntoView();}
  else if(v==='rules')message('ทอยลูกเต๋าภายใน 20 วินาที · งูลง บันไดขึ้น · ถึง 100 ชนะ');
 }));
}
async function boot(){
 bind();
 try{
  const response=await fetch('/api/supabase-config',{cache:'no-store'});
  if(!response.ok)throw Error('Supabase config unavailable');
  const config=await response.json();
  if(!window.supabase?.createClient)throw Error('Supabase JS unavailable');
  client=window.supabase.createClient(config.url,config.publishableKey);
  client.auth.onAuthStateChange((_event,session)=>{void authChanged(session?.user||null);});
  const {data,error}=await client.auth.getUser();
  if(error&&error.name!=='AuthSessionMissingError')throw error;
  await authChanged(data?.user||null);
 }catch{byId('google-btn').disabled=true;text('auth-status','ไม่สามารถเริ่ม Google Login ได้ กรุณารีเฟรชหน้า');}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else void boot();
})();
