'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const html=fs.readFileSync('railway-runtime/backend/railway/public/index.html','utf8');
const boot=html.split('supabase.min.js"></script>\n<script>')[1].split('</script>')[0];
function tab({pilot=true,storage=new Map(),opener=null,href='https://pilot.invalid/game',broken=false}={}){
  const calls=[],oauth=[];
  const window={opener,crypto,sessionStorage:{
    getItem:k=>storage.get(k)??null,
    setItem(k,v){if(broken)throw Error('storage blocked');storage.set(k,v);},
    removeItem:k=>storage.delete(k)
  }};
  window.top=window.self=window;
  const client={auth:{
    async getSession(){return {data:{session:null}};},
    async signInWithOAuth(options){oauth.push(JSON.parse(JSON.stringify(options)));return {};}
  }};
  window.supabase={createClient(...args){calls.push(args);return client;}};
  const ctx={window,URL,location:new URL(href),document:{readyState:'loading',addEventListener(){}},
    fetch:async()=>({ok:true,json:async()=>({url:'fixture',publishableKey:'fixture',...(pilot?{pilotTabIsolation:true}:{})})})};
  vm.runInNewContext(boot,ctx);
  return {window,calls,oauth,storage,ready:()=>vm.runInNewContext('luckyClientPromise',ctx)};
}
test('four pilot tabs, reload and Google chooser on generated auth path',async()=>{
  const all=Array.from({length:4},()=>tab());
  await Promise.all(all.map(t=>t.ready()));
  const keys=all.map(t=>t.calls[0][2].auth.storageKey);
  assert.equal(new Set(keys).size,4);
  for(const [i,t] of all.entries()){
    const store=t.calls[0][2].auth.storage;
    store.setItem(keys[i],'synthetic-'+i);
    for(const [j,key] of keys.entries())assert.equal(store.getItem(key),i===j?'synthetic-'+i:null);
  }
  const [a,b]=all;
  const aa=a.calls[0][2].auth,bb=b.calls[0][2].auth;
  assert.notEqual(aa.storageKey,bb.storageKey);assert.equal(aa.storage,a.window.sessionStorage);
  assert.equal(aa.flowType,'pkce');
  aa.storage.setItem(aa.storageKey,'synthetic-a');bb.storage.setItem(bb.storageKey,'synthetic-b');
  const reload=tab({storage:a.storage,href:'https://pilot.invalid/game?code=synthetic'});await reload.ready();
  const ra=reload.calls[0][2].auth;
  assert.equal(ra.storageKey,aa.storageKey);assert.equal(ra.storage.getItem(aa.storageKey),'synthetic-a');
  assert.equal(bb.storage.getItem(aa.storageKey),null);
  await assert.rejects(a.window.luckyGetAccessToken(),/OAuth redirect started/);
  assert.deepEqual(a.oauth,[{provider:'google',options:{redirectTo:'https://pilot.invalid/game',queryParams:{prompt:'select_account'}}}]);
  assert.equal((boot.match(/options:luckyGoogleOptions\(\)/g)||[]).length,2);
});
test('copied opener storage, lost callback and blocked storage fail before client creation',async()=>{
  const a=tab();await a.ready();
  const copy=tab({storage:new Map(a.storage),opener:{}});
  const detached=()=>tab({storage:copy.storage});
  for(const t of [copy,tab({broken:true}),tab({href:'https://pilot.invalid/game?code=x'})]){
    await assert.rejects(t.ready());assert.equal(t.calls.length,0);
  }
  await assert.rejects(detached().ready());
  await tab({storage:a.storage}).ready();
});
test('default client keeps two arguments and original OAuth options',async()=>{
  const t=tab({pilot:false,opener:{},broken:true});await t.ready();
  assert.deepEqual(t.calls[0],['fixture','fixture']);
  await assert.rejects(t.window.luckyGetAccessToken(),/OAuth redirect started/);
  assert.deepEqual(t.oauth,[{provider:'google',options:{redirectTo:'https://pilot.invalid/game'}}]);
});
