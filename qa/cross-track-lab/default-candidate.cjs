'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const leader=path.resolve(__dirname,'../../backend');
const admin=path.join(leader,'admin');
const {createPreviousLeaderboardHandler}=require(path.join(leader,'railway/previous-leaderboard-http-handler.cjs'));
const {previousPeriod}=require(path.join(leader,'storage/score-periods.cjs'));
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

const Rules=require(path.join(leader,'railway/multi-board-rules.cjs'));
const {requireRuleTransition}=require(path.join(leader,'railway/rule-transition-guard.cjs'));
const server=fs.readFileSync(path.join(leader,'railway/secure-server.cjs'),'utf8');
const html=fs.readFileSync(process.env.LUCKY_V12_FIXTURE_HTML ||
  path.resolve(leader,'../railway-runtime/backend/railway/public/index.html'),'utf8');
const pins=require('./default-candidate-inputs.json');
const hash=require('node:crypto').createHash;
for(const [relative,expected] of Object.entries(pins)){
  const data=fs.readFileSync(path.resolve(leader,'..',relative));
  assert.equal(hash('sha1').update('blob '+data.length+'\0').update(data).digest('hex'),expected,relative);
}
const digest=require('node:crypto').createHash('sha256').update(html).digest('hex');
assert.equal(digest,'d63ea39bc1db1796fe3f9cf268886df0f93e7ac122be1068d0c1f754dbe38975');
const skin=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*/gi,'');
assert.equal(hash('sha256').update(skin).digest('hex'),'9b780821a1e2ca569056131a52251ba6044743bbd00a82e2074a89cdab63f5c6');
function section(source,start,end){
  const i=source.indexOf(start), j=source.indexOf(end,i+start.length);
  assert.ok(i>=0 && j>i,start);
  return source.slice(i,j);
}
const controller=section(server,'function verifiedRoomSnapshot','function takeOut')+
  section(server,'async function advance','// Readiness reports');
const click=section(html,"$('rollDice').addEventListener('click',e=>","$('restartGame').addEventListener");
function openStore(pool){
  const mod={exports:{}};
  const deps=new Map([['pg',{Pool:function(){return pool;}}],
    ['./pg-tls-config.cjs',{poolConnectionOptions:()=>({})}],
    ['./room-lease-store.cjs',require(path.join(leader,'supabase/room-lease-store.cjs'))]]);
  Function('require','module',fs.readFileSync(path.join(leader,'supabase/game-store.cjs'),'utf8'))(
    key=>{assert.ok(deps.has(key),key);return deps.get(key);},mod);
  return mod.exports.createRailwayStore('offline'); // real default factory, no options
}
test('default Free and VIP roll commits feed provisional standings and protected Admin counts',async t=>{
  t.mock.method(Date,'now',()=>cutoff-1000);
  const evidence=[];
  for(const mode of ['free','vip']){
    const names=mode==='free'?['A','B','C','D']:['A','B'];
    const id=uid(mode==='free'?9:10), owner=uid(8), actor=names.length-1;
    const seats=names.map((name,index)=>({uid:uid(index+1),index,name,verified:true,ws:{},roomId:id}));
    for(const seat of seats)seat.ws.session=seat;
    const roster=seats.map(({uid,name})=>({uid,name}));
    const game=Rules.create(names,mode,()=>0.5);
    game.players[actor].pos=99;game.current=actor;
    const deadline=Date.now()+20000, ops=[], packets=[];
    let update,ledger,receipt;
    const pool={
      async query(sql,values){
        assert.match(sql,/INSERT INTO game.rooms/);
        assert.equal(ops.length,0);ops.push('room');
        assert.deepEqual(values,[id,mode,JSON.stringify(roster),JSON.stringify(game),deadline,owner]);
        return {rowCount:1,rows:[{lease_epoch:'1'}]};
      },
      async connect(){
        assert.deepEqual(ops,['room']);ops.push('checkout');
        return {async query(sql,values){
          const op=sql.trim().split(/\s+/).slice(0,3).join(' ');ops.push(op);
          if(op==='UPDATE game.rooms SET'){
            update=values;return {rowCount:1,rows:[{revision:'1',mode,seats:roster}]};
          }
          if(op.startsWith('INSERT INTO game.score_events(')){ledger=values;return {rowCount:1};}
          if(op==='INSERT INTO game.turn_receipts'){receipt=values;return {rowCount:1};}
          assert.ok(['BEGIN','COMMIT'].includes(op),op);
        },release(discard){assert.equal(discard,false);ops.push('release');}};
      }
    };
    const store=openStore(pool);
    const leaseEpoch=await store.initializeRoom({roomId:id,ownerId:owner,seats,mode,game,deadlineMs:deadline});
    const room={id,mode,seats,game,deadline,leaseEpoch,revision:0};
    const deps={Rules,store,requireRuleTransition,rooms:new Map([[id,room]]),pilot:null,OWNER_ID:owner,
      crypto:{randomInt:()=>1},schedule(){},send(ws,p){assert.equal(ops.at(-1),'release');packets.push(structuredClone(p));}};
    const handle=Function(...Object.keys(deps),controller+'\nreturn handle;')(...Object.values(deps));
    const button=new EventTarget();let pending;
    Function('$','onlineActive','onlineSend',click)(()=>button,true,msg=>{
      assert.deepEqual(msg,{type:'roll'});pending=handle(seats[actor].ws,msg);
    });
    button.dispatchEvent(new Event('click'));await pending;
    assert.deepEqual(ops,['room','checkout','BEGIN','UPDATE game.rooms SET',
      'INSERT INTO game.score_events(event_id,uid,mode,game_id,kind,points)','INSERT INTO game.turn_receipts','COMMIT','release']);
    assert.deepEqual(update.slice(0,4),[id,owner,1,0]);
    assert.deepEqual(receipt.slice(0,7),[id,1,0,1,'roll',actor,1]);
    assert.deepEqual(JSON.parse(receipt[8]),JSON.parse(update[4]));
    assert.deepEqual(ledger,[id+':win',roster[actor].uid,mode,id,'win',10]);
    assert.deepEqual(JSON.parse(receipt[9]),[{eventId:ledger[0],uid:ledger[1],mode,kind:'win',points:10}]);
    assert.equal(packets.length,seats.length);
    for(const [index,packet] of packets.entries()){
      assert.deepEqual([packet.seat,packet.revision,packet.event.type,packet.game.winner],[index,1,'roll',actor]);
      publicOnly(packet);
    }
    evidence.push(committedRows({update,ledger,receipt,seats:roster,at:Date.now()}));
  }
  Date.now.mock.mockImplementation(()=>cutoff+1000);
  async function request(handle,url,token,method='GET'){
    let code,headers;
    const res={writeHead(c,h){code=c;headers=h;},end(body){this.body=JSON.parse(body);}};
    await handle({method,url,headers:{authorization:token?'Bearer '+token:undefined}},res);
    assert.equal(headers['Cache-Control'],'private, no-store');
    return {code,body:res.body};
  }
  for(const e of evidence){
    const {mode}=e.room,period=previousPeriod(mode,Date.now());
    let rankingReads=0;
    const store=openStore({connect(){assert.fail("unexpected leaderboard checkout");},async query(sql,values){
      if(sql.includes('FROM game.vip_entitlements')){
        assert.equal(mode,'vip'); assert.equal(values.length,1);
        return values[0]===uid(2)?{rowCount:1,rows:[{uid:uid(2),status:'active',expires_at:new Date(Date.now()+10000)}]}:{rowCount:0,rows:[]};
      }
      rankingReads++;
      assert.match(sql,/FROM game.players p JOIN game.score_events/);
      assert.deepEqual(values,[mode,period.startMs,period.endMs,50]);
      const events=evidence.flatMap(row=>row.ledger).filter(x=>x.mode===mode && x.created_at>=values[1] && x.created_at<values[2]);
      assert.equal(events.length,1);return {rows:[{score:String(events[0].points)}]};
    }});
    const handle=createPreviousLeaderboardHandler({verifyIdentity,store});
    const url='/api/previous-leaderboard?mode='+mode+'&startMs=0';
    assert.equal((await request(handle,url,undefined)).code,401);
    assert.equal((await request(handle,url,mode+'-player','POST')).code,405);
    assert.equal((await request(handle,url+'&mode=vip',mode+'-player')).code,400);
    if(mode==='vip')assert.equal((await request(handle,url,'free-player')).code,403);
    assert.equal(rankingReads,0);
    const response=await request(handle,url,mode+'-player');
    assert.deepEqual(response,{code:200,body:{period,provisional:true,rows:[['🥇','👤','ผู้เล่น','10']]}});
    assert.equal(rankingReads,1);publicOnly(response.body);
  }
  const seen=[],read=countsReader(evidence,seen);
  await assert.rejects(read({accessToken:'free-player',admin:true}),/ADMIN_ACCESS_DENIED/);
  assert.deepEqual(await read({accessToken:'auditor'}),['free','vip'].map(mode=>({mode,status:'finished',count:'1'})));
});
