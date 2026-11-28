'use strict';
// Linux loopback only. Actual generated launcher and handler; synthetic store
// (no external DSN, players or OAuth). Run after building railway-runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname,'..');
const runtime = path.join(root,'railway-runtime');
const use = createRequire(path.join(runtime,'backend/railway/secure-server.cjs'));
const { WebSocket } = use('ws');

function processExit(child) {
 return new Promise((resolve,reject) => {
  child.once('error',reject);
  child.once('exit',(code,signal)=>resolve({code,signal}));
 });
}
async function within(promise, ms, label) {
 const ctrl = new AbortController();
 try {
  return await Promise.race([promise,delay(ms,null,{signal:ctrl.signal}).then(()=>{throw Error(label);})]);
 } finally { ctrl.abort(); }
}

async function launch(t, command){
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'lucky-signal-'));
 const hook = path.join(tmp,'fixture.cjs');
 fs.writeFileSync(hook,`
const http = require('node:http');
const fs = require('node:fs');
const filename = ${JSON.stringify(path.join(runtime,'backend/supabase/game-store.cjs'))};
require.cache[filename] = {id:filename,filename,loaded:true,exports:{
 createRailwayStore: () => ({
  health: async()=>true, listRecoverableRooms: async()=>[],
  close: async()=>fs.writeSync(1,'FIXTURE_POOL_CLOSED\\n')
 })
}};
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function(port, host) {
 if(port !== 0 || host !== '0.0.0.0') throw Error('Test needs an ephemeral loopback listener');
 this.once('listening',()=>fs.writeSync(1,'FIXTURE_PORT='+this.address().port+'\\n'));
 return listen.call(this, 0, '127.0.0.1');
};
`);
 const child = spawn('/bin/sh',['-c',command],{cwd:root,detached:true,
  env:{PATH:process.env.PATH,HOME:tmp,NODE_OPTIONS:'--require='+hook,PORT:'0',
    SUPABASE_URL:'https://llbkxnazkliskzcureec.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture-not-a-key'},
  stdio:['ignore','pipe','pipe']});
 const done = processExit(child);
 let logs = '', streamPort;
 const gotPort = new Promise(resolve=>{streamPort = resolve;});
 const data = chunk => {
  logs += chunk.toString();
  const m = logs.match(/FIXTURE_PORT=(\d+)\n/);
  if(m) streamPort(Number(m[1]));
 };
 child.stdout.on('data',data); child.stderr.on('data',data);
 let peer;
 t.after(async()=>{
  try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  peer?.terminate();
  await done.catch(()=>{});
  fs.rmSync(tmp,{recursive:true,force:true});
 });
 const port = await within(Promise.race([gotPort,done.then(()=>{throw Error('exit before listen: '+logs);})]),4000,'listener startup timed out');
 const health = await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(1200)});
 assert.deepEqual(await health.json(),{ok:true,status:'ready',mode:'draft-auth-required'});
 peer = new WebSocket('ws://127.0.0.1:'+port+'/ws');
 peer.on('error',()=>{});
 await within(once(peer,'open'),1200,'socket open timed out');
 const closed = once(peer,'close');
 return {child,done,closed,logs:()=>logs};
}

test('configured launcher delivers SIGTERM to the packaged server', {skip:process.platform!=='linux',timeout:10000},async t=>{
 const command = require('../railway.json').deploy.startCommand;
 const a = await launch(t,command);
 const start = performance.now();
 assert.equal(a.child.kill('SIGTERM'),true);
 const [code,reason] = await within(a.closed,3800,'WebSocket did not drain after direct launcher SIGTERM');
 assert.equal(code,1001);
 assert.equal(reason.toString(),'Server shutting down');
 assert.deepEqual(await within(a.done,1500,'launcher did not exit after socket close'),{code:0,signal:null});
 assert.match(a.logs(),/FIXTURE_POOL_CLOSED/);
 t.diagnostic('SIGTERM to socket close and process exit: '+Math.round(performance.now()-start)+' ms');
});

test('abrupt launcher kill closes transport without a graceful handshake', {skip:process.platform!=='linux',timeout:10000},async t=>{
 const command = require('../railway.json').deploy.startCommand;
 const a = await launch(t,command);
 assert.equal(a.child.kill('SIGKILL'),true);
 assert.equal((await within(a.closed,1800,'socket stayed open after launcher SIGKILL'))[0],1006);
 assert.deepEqual(await a.done,{code:null,signal:'SIGKILL'});
 assert.doesNotMatch(a.logs(),/FIXTURE_POOL_CLOSED/);
});
