'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'migration/legacy-ui/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'migration/legacy-ui/style.css'),'utf8');
const server=fs.readFileSync(path.join(root,'backend/railway/secure-server.cjs'),'utf8');
const rules=fs.readFileSync(path.join(root,'backend/railway/rules.js'),'utf8');
test('original UI layout and assets retained',()=>{
 for(const id of ['screen-auth','screen-lobby','screen-game','google-btn','nickname','enter-btn','online-btn'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(css,/\.auth-grid/);
 assert.match(css,/\.showcase-board/);
});
test('Free is four seats through UI, authoritative matcher and rules',()=>{
 assert.match(html,/Free 4 คน \/ ห้อง/);
 assert.match(html,/จับคู่ห้องละ 4 คน/);
 assert.doesNotMatch(html,/Free 3 คน|จับคู่ห้องละ 3 คน/);
 assert.match(server,/function capacity\(mode\)\{return mode==='vip'\?2:4;\}/);
 assert.match(rules,/const capacity=mode==='vip'\?2:4;/);
});
test('legacy prototype does not expose Cloudflare test UI or payment entry',()=>{
 assert.doesNotMatch(html,/id="demo-btn"|เล่นทดลองกับบอท|STAGING|id="payment-panel"/);
 assert.doesNotMatch(html,/src="\.\/game\.js/);
 assert.doesNotMatch(html,/workers\.dev|cloudflare\.com/);
 assert.match(html,/id="vip-buy"[^>]+disabled/);
});
test('Railway-only Supabase client is mounted and cryptographic random map choice enabled',()=>{
 assert.match(html,/src="\.\/railway-app\.js"/);
 const js=fs.readFileSync(path.join(root,'migration/legacy-ui/railway-app.js'),'utf8');
 assert.match(js,/auth\.signInWithOAuth/);
 assert.match(js,/type:'join'/);
 assert.match(js,/location\.host\+'\/ws'/);
 assert.match(server,/crypto\.randomInt\(1,6\)/);
 assert.doesNotMatch(js,/firebase|workers\.dev|cloudflare/i);
});
test('browser UI staged as a source reference only (no fake online success)',()=>{
 assert.match(html,/Railway/);
 assert.doesNotMatch(html,/ผู้เล่น 4\/4 ออนไลน์แล้ว/);
});
