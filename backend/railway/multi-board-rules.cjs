'use strict';
/**
 * Reviewed source adapter for 5 authoritative maps (UNTESTED).
 * The V99 original five maps are carried in board-definitions.json.
 * Every new room stores its selected map snapshot. Existing rooms retain their snapshot.
 * Use only with the new V99 Railway browser adapter and verified migrations.
 */
const Legacy=require('./rules.js');
const {getBoard,eligibleGiftTiles,pickBoard}=require('./board-maps.cjs');
function selectRandomBoard(rng=Math.random){return pickBoard(rng).id;}
function gameBoard(game){
 if(!game||typeof game!=='object')throw Error('INVALID_GAME_BOARD');
 const id=game.map;
 const canonical=getBoard(id);
 if(Object.hasOwn(game,'board')){
  if(!game.board||game.board.version!==1||game.board.id!==id||
     JSON.stringify(game.board.snakes)!==JSON.stringify(canonical.snakes)||
     JSON.stringify(game.board.ladders)!==JSON.stringify(canonical.ladders))
   throw Error('BOARD_CHECKPOINT_MISMATCH');
 }else if(id!==1)throw Error('MISSING_BOARD_CHECKPOINT');
 return canonical;
}
function assertRoomBoard(game){
 const board=gameBoard(game);
 if(!Number.isSafeInteger(game.gift)||
    !eligibleGiftTiles(board).includes(game.gift)||
    typeof game.giftUsed!=='boolean')
  throw Error('INVALID_ROOM_GIFT_FOR_BOARD');
 return board;
}
function randomChoice(max,rng){
 const v=rng();
 if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>=1)
  throw Error('INVALID_BOARD_RANDOM');
 return Math.floor(v*max);
}
function create(names,mode='free',rng=Math.random,boardId=1){
 const board=getBoard(boardId);
 const game=Legacy.create(names,mode,rng);
 const giftTiles=eligibleGiftTiles(board);
 if(!giftTiles.length)throw Error('NO_GIFT_TILES');
 game.map=board.id;
 game.board={version:1,id:board.id,
  snakes:{...board.snakes},ladders:{...board.ladders}};
 game.gift=giftTiles[randomChoice(giftTiles.length,rng)];
 return game;
}
function turn(game,roll,rng=Math.random){
 const board=assertRoomBoard(game);
 if(game.over)throw Error('game over');
 if(!Number.isInteger(roll)||roll<1||roll>6)throw Error('invalid dice');
 const p=game.players[game.current];
 if(!p)throw Error('invalid current player');
 const from=p.pos,landing=from+roll;
 const events=[`${p.name} ทอยได้ ${roll} · จากช่อง ${from} ไปช่อง ${Math.min(100,landing)}`];
 p.pos=Math.min(100,landing);
 let type='normal',reward=0;
 if(landing>=100){
  game.over=true;game.winner=p.id;type='win';p.score+=10;
  events.push(`🏆 ${p.name} ชนะ! ได้ 10 คะแนน`);
 }else if(Object.hasOwn(board.snakes,landing)){
  p.pos=board.snakes[landing];type='snake';
  events.push(`🐍 ตกงูช่อง ${landing} ลงช่อง ${p.pos}`);
 }else if(Object.hasOwn(board.ladders,landing)){
  p.pos=board.ladders[landing];type='ladder';
  events.push(`🪜 ขึ้นบันไดช่อง ${landing} ไปช่อง ${p.pos}`);
 }
 if(!game.giftUsed&&p.pos===game.gift){
  game.giftUsed=true;reward=Legacy.pickReward(rng);
  p.score+=reward;p.luckyEarned+=reward;
  events.push(`🎁 ${p.name} เปิด Lucky Box ได้ ${reward} คะแนน`);
 }
 game.lastRoll=roll;game.events.push(...events);
 if(!game.over){game.current=(game.current+1)%game.players.length;game.turn++;}
 return {type,from,landing,position:p.pos,reward,events,gameOver:game.over};
}
function timeout(game){assertRoomBoard(game);return Legacy.timeout(game);}
module.exports={create,turn,timeout,selectRandomBoard,gameBoard,assertRoomBoard};
