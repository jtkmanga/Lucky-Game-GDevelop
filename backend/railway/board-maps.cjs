'use strict';
/**
 * Source-only five-board catalog. NOT activated in live play, since HTML v12
 * still hard-codes the original snake/ladder visuals and motion paths.
 * Keep all clients on the single original map until the board UI data bridge
 * has been prepared and verified. Never select an alternate map on the server
 * without sending its complete layout to the client.
 */
// One canonical catalog is consumed by both Node server and the generated
// v12 JavaScript client; never maintain two independent board tables.
const definitions=require('./board-definitions.json');
if(definitions.version!==1||!Array.isArray(definitions.boards)||
   definitions.boards.length!==5||definitions.boards.some((b,i)=>b.id!==i+1))
 throw Error('INVALID_BOARD_CATALOG');
const specs=definitions.boards;
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
 id:s.id,name:s.name,snakes:Object.freeze({...s.snakes}),ladders:Object.freeze({...s.ladders})
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
