'use strict';
// Optional ACTUAL Chromium/Playwright test against localhost-only source preview.
// Supabase identity and WebSocket are STUBS, not a Google-4-account real E2E test.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../migration/legacy-ui');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/supabase-config'){
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({url:'https://mock.invalid',publishableKey:'mock-test-key'}));return;
 }
 const name=url.pathname==='/'?'index.html':path.basename(url.pathname);
 if(!['index.html','style.css','railway-app.js'].includes(name)){res.writeHead(404);res.end('Not Found');return;}
 res.writeHead(200,{'Content-Type':types[path.extname(name)]||'text/plain','Cache-Control':'no-store'});
 fs.createReadStream(path.join(root,name)).pipe(res);
});
async function main(){
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 let browser;
 try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({status:200,contentType:'text/javascript',body:''}));
  await context.addInitScript(()=>{
   const user={id:'11111111-1111-4111-8111-111111111111',email:'test@example.invalid',user_metadata:{lucky_player_name:'TestPlayer'}};
   window.__wsMessages=[];
   window.supabase={createClient:()=>({auth:{
    getUser:async()=>({data:{user},error:null}),
    getSession:async()=>({data:{session:{access_token:'local-mock-token'}},error:null}),
    onAuthStateChange:fn=>{Promise.resolve().then(()=>fn('SIGNED_IN',{user}));return {data:{subscription:{unsubscribe(){}}}};},
    updateUser:async()=>({data:{user},error:null}),
    signInWithOAuth:async()=>({data:{},error:null}),signOut:async()=>({error:null})
   }})};
   window.WebSocket=class{
    static OPEN=1;
    constructor(){this.readyState=0;this.callbacks={};setTimeout(()=>{this.readyState=1;this.emit('open',{});},10);}
    addEventListener(event,fn){(this.callbacks[event]??=[]).push(fn);}
    emit(event,payload){for(const fn of this.callbacks[event]||[])fn(payload);}
    send(payload){
     const msg=JSON.parse(payload);window.__wsMessages.push(msg);
     if(msg.type==='join')setTimeout(()=>this.emit('message',{data:JSON.stringify({type:'waiting',joined:1,needed:4})}),10);
    }
    close(){this.readyState=3;this.emit('close',{});}
   };
  });
  const page=await context.newPage();
  const url='http://127.0.0.1:'+server.address().port;
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.locator('#lucky-railway-account').waitFor({state:'visible',timeout:8000});
  assert.equal(await page.locator('#nickname').inputValue(),'TestPlayer');
  assert.match(await page.locator('.welcome-sticker').innerText(),/Free 4 คน/);
  await page.locator('#enter-btn').click();
  await page.locator('#screen-lobby.active').waitFor();
  assert.match(await page.locator('#welcome-name').innerText(),/TestPlayer/);
  assert.equal((await page.locator('#avatars button').count()),10);
  assert.match(await page.locator('#lobby-room-size').innerText(),/4 คน/);
  await page.locator('#online-btn').click();
  await page.waitForFunction(()=>window.__wsMessages.some(x=>x.type==='join'),null,{timeout:4000});
  const wsMessage=await page.evaluate(()=>window.__wsMessages.find(x=>x.type==='join'));
  assert.equal(wsMessage.mode,'free');assert.equal(wsMessage.name,'TestPlayer');assert.equal(wsMessage.token,'local-mock-token');
  await page.locator('#mode-status').filter({hasText:'1/4'}).waitFor({timeout:3000});
  assert.equal(await page.locator('#demo-btn').count(),0);
  assert.equal(await page.locator('#payment-panel').count(),0);
  await page.close();await context.close();
  process.stdout.write('BROWSER_STUB_PASS: actual Chromium rendered original V99 UI, Google account mock, nickname, 10 avatars and WS Free 1/4 mock on loopback. NOT real OAuth or E2E.\n');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
