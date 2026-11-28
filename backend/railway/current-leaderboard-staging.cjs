'use strict';
const {createProtectedLeaderboardRead}=require('./leaderboard-http-handler.cjs');
const {currentLeaderboard}=require('./current-leaderboard.cjs');
const {v12LeaderboardRows}=require('./v12-leaderboard-rows.cjs');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
function createStagingCurrentLeaderboard({env,pilot,verifyIdentity,store,clock=Date.now}){
 if(env.LUCKY_CURRENT_LEADERBOARD===undefined||env.LUCKY_CURRENT_LEADERBOARD==='false')return null;
 const roster=(env.LUCKY_FREE4_PILOT_UIDS||'').split(',').map(x=>x.trim());
 const rooms=(env.LUCKY_CURRENT_LEADERBOARD_ROOMS||'').split(',');
 if(env.LUCKY_CURRENT_LEADERBOARD!=='true'||env.RAILWAY_ENVIRONMENT_NAME!=='staging'||
    env.LUCKY_ISOLATED_STAGING_SUPABASE_REF!=='tpwmcozkzlvolehozzri'||!pilot||
    new Set(roster).size!==4||roster.length!==4||roster.some(uid=>!pilot.admits(uid,'free'))||
    rooms.length!==2||new Set(rooms).size!==2||rooms.some(room=>!UUID.test(room))||
    env.LUCKY_PILOT_LUCKY_BOX_FIXTURE==='true')
  throw Error('Invalid isolated leaderboard acceptance configuration');
 const scoped={leaderboard:(mode,start,end,limit)=>store.scopedFreeLeaderboard(roster,rooms,start,end,limit)};
 const handler=createProtectedLeaderboardRead({
  store,verifyIdentity:async message=>{
   const identity=await verifyIdentity(message);
   return pilot.admits(identity?.uid,'free')?identity:null;
  },read:async mode=>({rows:v12LeaderboardRows(await currentLeaderboard(scoped,mode,50,clock))})
 });
 return (req,res)=>{
  const modes=new URLSearchParams(req.url.split('?').slice(1).join('?')).getAll('mode');
  if(clock()>=pilot.cutoffMs||modes.length!==1||modes[0]!=='free'){
   res.writeHead(404,{'Cache-Control':'private, no-store'});res.end('Not Found');return;
  }
  return handler(req,res);
 };
}
module.exports={createStagingCurrentLeaderboard};
