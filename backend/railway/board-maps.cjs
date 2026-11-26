'use strict';
/**
 * Source-only five-board catalog. NOT activated in live play, since HTML v12
 * still hard-codes the original snake/ladder visuals and motion paths.
 * Keep all clients on the single original map until the board UI data bridge
 * has been prepared and verified. Never select an alternate map on the server
 * without sending its complete layout to the client.
 */
const ORIGINAL_SNAKES=Object.freeze({98:77,94:68,80:49,59:30,37:15});
const ORIGINAL_LADDERS=Object.freeze({4:25,11:50,28:53,43:63,62:85,71:91});
const specs=[
 {id:1,snakes:ORIGINAL_SNAKES,ladders:ORIGINAL_LADDERS},
 {id:2,snakes:{96:74,89:66,78:43,57:29,35:12},
       ladders:{3:22,13:38,26:51,42:65,61:83,72:92}},
 {id:3,snakes:{97:79,91:60,82:54,65:36,47:19},
       ladders:{5:28,16:41,24:48,39:62,58:81,70:93}},
 {id:4,snakes:{99:70,92:73,84:56,68:40,52:23},
       ladders:{6:27,14:37,32:55,45:69,63:86,75:94}},
 {id:5,snakes:{95:76,88:61,79:52,64:34,41:18},
       ladders:{2:21,17:44,31:57,46:72,60:82,74:96}}
];
function validate(spec){
 const starts=new Set(),allEntries=[];
 for(const [kind,items] of [['snake',spec.snakes],['ladder',spec.ladders]]){
  for(const [rawStart,stop] of Object.entries(items)){
   const start=Number(rawStart);
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(stop)||
      start<2||start>99||stop<2||stop>99||
      starts.has(start)|| (kind==='snake'?stop>=start:stop<=start))
    throw Error('INVALID_BOARD_LAYOUT:'+spec.id+':'+kind+':'+start);
   starts.add(start);allEntries.push([start,stop]);
  }
 }
 // A landing destination must not be a movement start; otherwise a box
 // marker and travel path become ambiguous across UI/engine versions.
 for(const [start,stop] of allEntries)
  if(starts.has(stop))throw Error('BOARD_CHAIN_NOT_SUPPORTED:'+spec.id+':'+start);
 return true;
}
for(const spec of specs)validate(spec);
const BOARDS=Object.freeze(specs.map(s=>Object.freeze({
 id:s.id,snakes:Object.freeze({...s.snakes}),ladders:Object.freeze({...s.ladders})
})));
function getBoard(id){
 if(!Number.isInteger(id)||id<1||id>BOARDS.length)
  throw Error('UNKNOWN_BOARD');
 return BOARDS[id-1];
}
function pickBoard(rng=Math.random){
 const value=rng();
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>=1)
  throw Error('INVALID_BOARD_RANDOM');
 return BOARDS[Math.floor(value*BOARDS.length)];
}
function eligibleGiftTiles(board){
 const starts=new Set([...Object.keys(board.snakes),...Object.keys(board.ladders)].map(Number));
 const destinations=new Set([...Object.values(board.snakes),...Object.values(board.ladders)]);
 const tiles=[];for(let tile=12;tile<=89;tile++)
  if(!starts.has(tile)&&!destinations.has(tile))tiles.push(tile);
 return tiles;
}
module.exports={BOARDS,getBoard,pickBoard,eligibleGiftTiles,validate};
