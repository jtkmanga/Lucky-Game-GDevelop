'use strict';
// Build and install railway-runtime first. This is local transport evidence,
// not a Railway, browser OAuth, or database acceptance run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const use = createRequire(path.resolve(__dirname, '../railway-runtime/backend/railway/secure-server.cjs'));
const host = '127.0.0.1';
async function listen(server) {
  server.listen(0, host);
  await once(server, 'listening');
  return server.address().port;
}
function close(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

test('locked WebSocket heartbeat crosses a verified TLS upgrade proxy', {timeout:10000}, async t => {
  const { WebSocket, WebSocketServer } = use('ws');
  const manifest = use('../../package.json');
  assert.equal(use('ws/package.json').version, manifest.dependencies.ws);
  const { startSocketHeartbeat } = use('./socket-heartbeat.cjs');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lucky-wss-proxy-'));
  t.after(() => fs.rmSync(folder, {recursive:true,force:true}));
  const out = spawnSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes',
    '-days','1','-subj','/CN='+host,'-addext','subjectAltName=IP:'+host,
    '-keyout',path.join(folder,'key.pem'),'-out',path.join(folder,'cert.pem')],
    {encoding:'utf8',timeout:5000});
  assert.ifError(out.error);
  assert.equal(out.status,0,out.stderr);
  const cert = fs.readFileSync(path.join(folder,'cert.pem'));
  const app = http.createServer();
  const wss = new WebSocketServer({server:app,path:'/ws',maxPayload:16384,perMessageDeflate:false});
  let tick;
  const heartbeat = startSocketHeartbeat({wss,open:WebSocket.OPEN,
    startInterval(fn){tick=fn;return {};},stopInterval(){}});
  const edge = https.createServer({cert,key:fs.readFileSync(path.join(folder,'key.pem'))});
  const outgoing = new Set(), accepted = [], browser = [];
  let upgrades = 0;
  t.after(async () => {
    heartbeat.stop();
    for (const ws of browser) ws.terminate();
    for (const ws of wss.clients) ws.terminate();
    for (const socket of outgoing) socket.destroy();
    await Promise.all([close(edge),close(app),new Promise(resolve=>wss.close(()=>resolve()))]);
  });
  wss.on('connection',ws=>{
    accepted.push(ws);
    ws.on('message',raw=>ws.send(raw.toString()));
  });
  const upstreamPort = await listen(app);
  edge.on('upgrade',(req,client,head)=>{
    upgrades++;
    const upstream = net.createConnection({host,port:upstreamPort});
    outgoing.add(upstream);
    client.once('close',()=>upstream.destroy());
    upstream.once('close',()=>{outgoing.delete(upstream);client.destroy();});
    client.once('error',()=>upstream.destroy());
    upstream.once('error',()=>client.destroy());
    upstream.once('connect',()=>{
      if (client.destroyed) {upstream.destroy();return;}
      const headers = [];
      for (let i=0;i<req.rawHeaders.length;i+=2)
        headers.push(req.rawHeaders[i]+': '+req.rawHeaders[i+1]);
      upstream.write(req.method+' '+req.url+' HTTP/'+req.httpVersion+'\r\n'+headers.join('\r\n')+'\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
  });
  const url = 'wss://'+host+':'+await listen(edge)+'/ws';
  const noTrust = new WebSocket(url);
  browser.push(noTrust);
  const [err] = await once(noTrust,'error');
  assert.equal(err.code,'DEPTH_ZERO_SELF_SIGNED_CERT');
  assert.equal(upgrades,0,'untrusted TLS connection must not reach the WebSocket upgrade');

  async function connect(autoPong){
    const ws = new WebSocket(url,{ca:cert,autoPong});
    browser.push(ws);
    await once(ws,'open');
    const peer = accepted.at(-1);
    assert.equal(ws._socket.authorized,true);
    return {ws,peer};
  }
  const responsive = await connect(true), silent = await connect(false);
  assert.equal(upgrades,2);
  const pong1 = once(responsive.peer,'pong'), firstPing = once(silent.ws,'ping');
  tick();
  const [[response],[ping]] = await Promise.all([pong1,firstPing]);
  assert.equal(response.length,8);
  assert.equal(ping.length,8);
  assert.equal(silent.ws.readyState,WebSocket.OPEN);
  const silentClose = once(silent.ws,'close'), serverClose = once(silent.peer,'close');
  const pong2 = once(responsive.peer,'pong');
  tick();
  const [[closeCode]] = await Promise.all([silentClose,serverClose,pong2]);
  assert.equal(closeCode,1006);
  assert.equal(wss.clients.size,1);
  const received = once(responsive.ws,'message');
  responsive.ws.send('transport fixture');
  assert.equal((await received)[0].toString(),'transport fixture');
});
