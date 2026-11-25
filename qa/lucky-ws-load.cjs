#!/usr/bin/env node
'use strict';
// Lucky Game TEST-ONLY WebSocket synthetic players.
// NO real Google login, VIP security, payments or database verification.
// No automatic remote load: loopback URL by default, external requires opt-in.
const path = require('node:path');
let WebSocket;
try { WebSocket = require('ws'); }
catch (err) {
  // The Codespaces preparer installs ws inside render-web/, not repo root.
  try { WebSocket = require(path.resolve(__dirname, '../render-web/node_modules/ws')); }
  catch { throw Error('ws package missing: prepare render-web/ and npm install first'); }
}
const {performance} = require('node:perf_hooks');

function arg(name, fallback) {
  const x = process.argv.find(a => a.startsWith('--' + name + '='));
  return x ? x.slice(name.length + 3) : fallback;
}
const count = Number(arg('players', '100'));
const mode = arg('mode', 'free');
const duration = Number(arg('seconds', '90'));
const pace = Number(arg('pace-ms', '25'));
const finishTarget = Number(arg('completed-games', '1'));
const url = arg('url', 'ws://127.0.0.1:8080/ws');
const maxErrors = Number(arg('max-errors', '25'));
if (!Number.isSafeInteger(count) || count < 1 || count > 10000)
  throw Error('players must be 1..10000');
if (!['free', 'vip'].includes(mode)) throw Error('mode must be free or vip');
if (!Number.isFinite(duration) || duration < 5 || duration > 7200)
  throw Error('seconds must be 5..7200');
if (!Number.isFinite(pace) || pace < 0 || pace > 60000)
  throw Error('pace-ms must be 0..60000');
if (!Number.isSafeInteger(finishTarget) || finishTarget < 1 || finishTarget > 100000)
  throw Error('completed-games must be 1..100000');
if (!Number.isSafeInteger(maxErrors) || maxErrors < 0)
  throw Error('max-errors must be a nonnegative integer');
const parsed = new URL(url);
if (!['ws:','wss:'].includes(parsed.protocol)) throw Error('WebSocket URL required');
const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
if (!local && process.env.ALLOW_EXTERNAL_LOAD !== 'I_ACCEPT_THE_RISK')
  throw Error('Remote load disabled. Set ALLOW_EXTERNAL_LOAD=I_ACCEPT_THE_RISK only for an authorized staging endpoint.');
if (parsed.username || parsed.password) throw Error('Do not embed credentials in URL');
const capacity = mode === 'vip' ? 2 : 4;
const targetRoomCount = Math.floor(count / capacity);
if (targetRoomCount === 0) throw Error('Need at least ' + capacity + ' bots to start a room');

const stats = {attempted:0, opened:0, joined:0, waiting:0, started:0, resumes:0,
  completed:0, errors:0, closed:0, rolls:0, rollReplies:0, timeouts:0,
  roomIds:new Set(), latencies:[], bytesReceived:0, bytesSent:0};
const connections = new Set();
let stopping = false;
let lastError = '';
let nextBot = 0;
const start = performance.now();
let stopReason = 'duration';

function message(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN || stopping) return;
  const data = JSON.stringify(payload);
  stats.bytesSent += Buffer.byteLength(data);
  ws.send(data);
}
function percentile(q) {
  if (!stats.latencies.length) return null;
  const sorted = stats.latencies.toSorted((a,b)=>a-b);
  return Math.round(sorted[Math.min(sorted.length-1,Math.ceil(q*sorted.length)-1)]*100)/100;
}
function report() {
  return {
    testType:'UNAUTHENTICATED TEST PROTOTYPE (NOT PRODUCTION READINESS)',
    target:parsed.host, mode, requestedPlayers:count, capacity,
    seconds:Math.round((performance.now()-start)/1000*100)/100,
    attempted:stats.attempted, opened:stats.opened, joined:stats.joined,
    roomsStarted:stats.roomIds.size, possibleFullRooms:targetRoomCount,
    completedGames:stats.completed, rollsSent:stats.rolls,
    rollReplies:stats.rollReplies, timeoutEvents:stats.timeouts,
    errors:stats.errors, closedSockets:stats.closed,
    latencyMs:{p50:percentile(0.50),p95:percentile(0.95),p99:percentile(0.99)},
    bytesSent:stats.bytesSent, bytesReceived:stats.bytesReceived,
    outboundBytesPerPlayer:stats.opened ? Math.round(stats.bytesReceived/stats.opened):null,
    stopReason,lastError
  };
}
function finish(reason) {
  if (stopping) return;
  stopping = true; stopReason = reason;
  for (const ws of connections) {
    try {ws.terminate();} catch {}
  }
  console.log(JSON.stringify(report(), null, 2));
  if (stats.errors > maxErrors) process.exitCode = 2;
  else if (stats.completed < finishTarget) process.exitCode = 3;
  else process.exitCode = 0;
}
function bad(err) {
  stats.errors++;
  lastError = String(err?.message || err).slice(0,180);
  if (stats.errors > maxErrors) finish('error-threshold');
}
function createBot() {
  if (stopping) return;
  const id = ++nextBot;
  stats.attempted++;
  const ws = new WebSocket(url, {handshakeTimeout:10000, perMessageDeflate:false});
  connections.add(ws);
  let seat = -1, room = '', outstanding = false, sentAt = 0, wasJoined = false;
  let lastTurn = -1, roomFinished = false;
  ws.on('open', () => {
    stats.opened++;
    message(ws,{type:'join',mode,name:'load-bot-'+String(id),avatar:'🐱'});
  });
  ws.on('message', raw => {
    if (stopping) return;
    stats.bytesReceived += raw.length;
    let msg;
    try {msg=JSON.parse(raw.toString());} catch(e) {bad(e);return;}
    if (msg.type === 'error') {bad('server: '+msg.message);return;}
    if (msg.type === 'waiting') {
      stats.waiting++;
      if(!wasJoined) {wasJoined=true;stats.joined++;}
      return;
    }
    if (msg.type !== 'state') return;
    if (!wasJoined) {wasJoined=true;stats.joined++;}
    seat = msg.seat; room = msg.roomId;
    if (room) stats.roomIds.add(room);
    if (outstanding && msg.event?.type === 'roll' && msg.event.actor===seat) {
      stats.latencies.push(performance.now()-sentAt);
      stats.rollReplies++;outstanding=false;
    }
    if (msg.event?.type === 'timeout') stats.timeouts++;
    if (msg.game?.over) {
      if (!roomFinished) {
        roomFinished=true;
        // Count each room only once: winning seat is uniquely identifiable.
        if (msg.game.winner === seat) {
          stats.completed++;
          if(stats.completed >= finishTarget) finish('completed-target');
        }
      }
      return;
    }
    // Trigger exactly once per turn for the seat that owns it.
    if (msg.game?.current !== seat || msg.game.turn === lastTurn) return;
    lastTurn = msg.game.turn;
    // Existing TEST server drops commands <100ms apart on a socket.
    setTimeout(() => {
      if (stopping || ws.readyState !== WebSocket.OPEN) return;
      if (!Number.isFinite(msg.deadline) || Date.now() >= msg.deadline) return;
      if (outstanding) return;
      outstanding=true; sentAt=performance.now();
      stats.rolls++; message(ws,{type:'roll'});
    },150);
  });
  ws.on('error',bad);
  ws.on('close', () => {connections.delete(ws);stats.closed++;});
}
console.error('TEST-ONLY load; no real login, VIP checks, payment, persistence or cross-instance validation.');
console.error('Target:',url,'players:',count,'mode:',mode,'duration:',duration,'seconds');
const deadline=setTimeout(()=>finish('duration'), duration*1000);
deadline.unref?.();
const launcher=setInterval(()=>{
  if (stopping) {clearInterval(launcher);return;}
  if(stats.attempted >= count) {clearInterval(launcher);return;}
  createBot();
}, Math.max(1,pace));
process.on('SIGINT',()=>finish('operator-interrupt'));
process.on('SIGTERM',()=>finish('termination-signal'));
