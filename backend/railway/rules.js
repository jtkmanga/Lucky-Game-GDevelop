(function(root,factory){ const api=factory(); if(typeof module==='object'&&module.exports)module.exports=api; root.LuckyRules=api; })(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const SNAKES=Object.freeze({98:77,94:68,80:49,59:30,37:15});
const LADDERS=Object.freeze({4:25,11:50,28:53,43:63,62:85,71:91});
const REWARDS=Object.freeze([{points:10,weight:500},{points:50,weight:300},{points:100,weight:190},{points:500,weight:9},{points:1000,weight:1}]);
function randomInt(max,rng=Math.random){const v=rng(); if(!Number.isFinite(v)||v<0||v>=1)throw Error('invalid random');return Math.floor(v*max);}
function chooseGift(rng=Math.random){const used=new Set([...Object.keys(SNAKES),...Object.keys(LADDERS),...Object.values(SNAKES),...Object.values(LADDERS)].map(Number));const tiles=[];for(let i=12;i<=89;i++)if(!used.has(i))tiles.push(i);return tiles[randomInt(tiles.length,rng)];}
function pickReward(rng=Math.random){let x=randomInt(1000,rng);for(const r of REWARDS){x-=r.weight;if(x<0)return r.points;}throw Error('reward selection failed');}
function create(names,mode='free',rng=Math.random){const capacity=mode==='vip'?2:4;if(!Array.isArray(names)||names.length!==capacity)throw Error('invalid players');const clean=names.map((x,i)=>{const n=String(x||'').trim().slice(0,20);return n||`ผู้เล่น ${i+1}`});return {mode,players:clean.map((name,id)=>({id,name,pos:0,score:0,luckyEarned:0,avatar:['🐱','🐰','🦊','🐼'][id]})),current:0,gift:chooseGift(rng),giftUsed:false,over:false,winner:null,turn:1,lastRoll:null,events:[`เริ่มเกม ${mode.toUpperCase()} · ${capacity} คน`],map:1};}
function turn(game,roll,rng=Math.random){if(game.over)throw Error('game over');if(!Number.isInteger(roll)||roll<1||roll>6)throw Error('invalid dice');const p=game.players[game.current];const from=p.pos;const landing=from+roll;const events=[`${p.name} ทอยได้ ${roll} · จากช่อง ${from} ไปช่อง ${Math.min(100,landing)}`];p.pos=Math.min(100,landing);let type='normal',reward=0;
if(landing>=100){game.over=true;game.winner=p.id;type='win';p.score+=10;events.push(`🏆 ${p.name} ชนะ! ได้ 10 คะแนน`);}
else if(Object.hasOwn(SNAKES,landing)){p.pos=SNAKES[landing];type='snake';events.push(`🐍 ตกงูช่อง ${landing} ลงช่อง ${p.pos}`);}
else if(Object.hasOwn(LADDERS,landing)){p.pos=LADDERS[landing];type='ladder';events.push(`🪜 ขึ้นบันไดช่อง ${landing} ไปช่อง ${p.pos}`);}
if(!game.giftUsed&&p.pos===game.gift){game.giftUsed=true;reward=pickReward(rng);p.score+=reward;p.luckyEarned+=reward;events.push(`🎁 ${p.name} เปิด Lucky Box ได้ ${reward} คะแนน`);}
game.lastRoll=roll;game.events.push(...events);if(!game.over){game.current=(game.current+1)%game.players.length;game.turn++;}return {type,from,landing,position:p.pos,reward,events,gameOver:game.over};}
function timeout(game){if(game.over)return null;const p=game.players[game.current];const event=`⏳ ${p.name} หมดเวลา 20 วินาที ข้ามตา (ไม่ทอยอัตโนมัติ)`;game.events.push(event);game.current=(game.current+1)%game.players.length;game.turn++;game.lastRoll=null;return event;}
return {SNAKES,LADDERS,REWARDS,create,turn,timeout,chooseGift,pickReward};
});

