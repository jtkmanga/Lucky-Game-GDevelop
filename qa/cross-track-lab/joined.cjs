'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { runCase } = require('../item-win-lab/fenced-dialog.cjs');
const { projectTerminalWin } = require('../item-win-lab/terminal-win.cjs');
const leader = path.resolve(process.argv[3], 'backend');
const admin = path.resolve(process.argv[4], 'backend/admin');
const { createPreviousLeaderboardHandler } = require(path.join(leader, 'railway/previous-leaderboard-http-handler.cjs'));
const { createPooledAdminRoomCounts } = require(path.join(admin, 'pooled-room-counts.cjs'));

const cutoff = Date.parse('2026-11-28T17:00:00Z'); // Sunday 00:00 Bangkok
const uid = n => 'aaaaaaaa-0000-4000-8000-' + String(n).padStart(12,'0');
const identities = new Map([['free-player',uid(3)], ['vip-player',uid(2)], ['auditor',uid(7)]]);
const verifyIdentity = async ({accessToken}) => ({uid:identities.get(accessToken)});

function committedRows({update, ledger, receipt, seats, at}) {
  const [roomId, , epoch, , snapshot, deadline, status] = update;
  const [event_id, winnerUid, mode, game_id, kind, points] = ledger;
  const [room_id, revision, previous_revision, lease_epoch, event_type, actor_index, roll, outcome, game, awards] = receipt;
  assert.equal(game_id,roomId);
  return {
    room:{room_id:roomId,revision,lease_epoch:epoch,game_state:JSON.parse(snapshot),deadline_ms:deadline,status,mode,seats},
    receipts:[{room_id,revision,previous_revision,lease_epoch,event_type,actor_index,roll,
      outcome:JSON.parse(outcome),game_state:JSON.parse(game),award_events:JSON.parse(awards)}],
    ledger:[{event_id,uid:winnerUid,mode,game_id,kind,points,created_at:at}]
  };
}

function publicOnly(value) {
  const wire = JSON.stringify(value);
  for (const id of [1,2,3,4,7,8].map(uid)) assert.ok(!wire.includes(id),'private identity leaked');
  assert.doesNotMatch(wire,/"(?:uid|verifiedUid|matchItems|shieldRemaining|winMultiplier|award_events|receipts|ledger|accessToken)"\s*:/);
}

// Use the pinned game-store method and its actual positional bindings. Only its
// three bootstrap dependencies are replaced. There is no pg driver or transport.
function ledgerStore(evidence, reads) {
  const events = evidence.flatMap(e => e.ledger);
  class Pool {
    async query(sql, values) {
      if (sql.startsWith('SELECT uid,status,expires_at FROM game.vip_entitlements')) {
        assert.equal(values.length,1);
        const rows = values[0]===uid(2) ? [{uid:uid(2),status:'active',expires_at:cutoff+60000}] : [];
        return {rows,rowCount:rows.length};
      }
      assert.match(sql,/FROM game.players p JOIN game.score_events e ON e.uid=p.uid WHERE e.mode=\$1/);
      assert.match(sql,/e.created_at >= to_timestamp\(\$2.*e.created_at < to_timestamp\(\$3/);
      assert.match(sql,/GROUP BY p.uid,p.display_name ORDER BY score DESC,p.uid LIMIT \$4/);
      const [mode,start,end,limit] = values;
      reads.push(values);
      const scores = new Map();
      for (const e of events.filter(e => e.mode===mode && start<=e.created_at && e.created_at<end))
        scores.set(e.uid,(scores.get(e.uid)||0)+e.points);
      return {rows:[...scores].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,limit)
        .map(([uid,score])=>({uid,display_name:'private synthetic name',score:String(score)}))};
    }
  }
  const deps = new Map([['pg',{Pool}],['./pg-tls-config.cjs',{poolConnectionOptions:()=>({})}],
    ['./room-lease-store.cjs',{createRoomLeaseStore:()=>({})}]]);
  const mod = {exports:{}};
  Function('require','module',fs.readFileSync(path.join(leader,'supabase/game-store.cjs'),'utf8'))(
    key=>{ assert.ok(deps.has(key),key); return deps.get(key); },mod);
  return mod.exports.createRailwayStore('offline-fixture');
}

function countsReader(evidence, checkedUids) {
  const login = 'qa_dedicated_count_login';
  return createPooledAdminRoomCounts({verifyIdentity,readerLogin:login,connectionMode:'verified-direct',
    readerPool:{options:{user:login,connectionTimeoutMillis:100,statement_timeout:100},async connect(){
      const sequence=[];
      return {async query({text,values}) {
        if (text.includes(' AS ready')) {
          assert.deepEqual(sequence,['BEGIN READ ONLY','SET LOCAL search_path = pg_catalog, pg_temp','SET LOCAL ROLE lucky_count_reader']);
          assert.deepEqual(values,[login,2000]); sequence.push('preflight');
          return {rows:[{ready:true}]}; // scripted PostgreSQL session attestation
        }
        if (text.includes('game.can_read_room_counts($1::uuid)')) {
          assert.match(text,/FROM game.rooms\s+GROUP BY mode, status/);
          assert.equal(sequence.at(-1),'preflight');
          assert.equal(values.length,1); checkedUids.push(values[0]); sequence.push('count');
          const groups=new Map();
          for(const {room} of evidence) {
            const key=room.mode+'/'+room.status; groups.set(key,(groups.get(key)||0)+1);
          }
          const rows=[...groups].sort().map(([key,n])=>{
            const [mode,status]=key.split('/');return {mode,status,count:String(n)};
          });
          return {rows:[{counts:values[0]===uid(7)?rows:null}]};
        }
        sequence.push(text);
        return {rows:[]};
      },release(discard){ assert.equal(discard,false); assert.deepEqual(sequence.slice(-2),['count','COMMIT']); }};
    }}});
}

async function readBoard(handler,mode,token) {
  let status,body;
  await handler({method:'GET',url:'/previous?mode='+mode+'&uid='+uid(7)+'&vip=true',
    headers:{authorization:'Bearer '+token}},{
    writeHead(code){status=code;},end(json){body=JSON.parse(json);}
  });
  publicOnly(body);
  assert.ok(!JSON.stringify(body).includes('private synthetic name'));
  return {status,body};
}

test('two acknowledged v12 wins feed the protected historical and Admin reads',async t=>{
  t.mock.method(Date,'now',()=>cutoff-1000);
  const evidence=[];
  for(const [mode,kind,points] of [['free','ordinary',10],['vip','double',20]]) {
    const captured=await runCase(kind,mode)();
    const e=committedRows(captured);
    const seat=e.receipts[0].actor_index;
    const context={roomId:e.room.room_id,revision:8,mode,seat,verifiedUid:e.room.seats[seat].uid};
    const expected={roomId:context.roomId,revision:8,seat,points};
    assert.deepEqual(projectTerminalWin(context,e),expected);
    assert.equal(projectTerminalWin(context,{...e,ledger:[]}),null);
    assert.equal(e.ledger[0].points,points);
    assert.equal(e.receipts[0].award_events[0].points,points);
    for (const packet of captured.packets) { publicOnly(packet); assert.deepEqual(packet.event.committedWin,expected); }
    evidence.push(e);
  }
  Date.now.mock.mockImplementation(()=>cutoff+1000);
  const reads=[];
  const handler=createPreviousLeaderboardHandler({verifyIdentity,store:ledgerStore(evidence,reads),clock:Date.now});
  assert.equal((await readBoard(handler,'vip','free-player')).status,403);
  assert.equal((await readBoard(handler,'free','unknown')).status,401);
  assert.deepEqual(reads,[]);
  for (const [mode,token,days,points] of [['free','free-player',7,'10'],['vip','vip-player',1,'20']]) {
    const startMs=cutoff-days*86400000;
    assert.deepEqual(await readBoard(handler,mode,token),{status:200,body:{provisional:true,
      period:{mode,startMs,endMs:cutoff},rows:[['🥇','👤','ผู้เล่น',points]]}});
    assert.deepEqual(reads.at(-1),[mode,startMs,cutoff,50]);
  }
  const checked=[];
  const counts=countsReader(evidence,checked);
  await assert.rejects(counts({accessToken:'unknown',uid:uid(7),admin:true}),/ADMIN_ACCESS_DENIED/);
  for(const token of ['free-player','vip-player'])
    await assert.rejects(counts({accessToken:token,uid:uid(7),admin:true}),/ADMIN_ACCESS_DENIED/);
  const result=await counts({accessToken:'auditor'});
  assert.deepEqual(result,[{mode:'free',status:'finished',count:'1'},{mode:'vip',status:'finished',count:'1'}]);
  publicOnly(result);
  assert.deepEqual(checked,[uid(3),uid(2),uid(7)]);
});
