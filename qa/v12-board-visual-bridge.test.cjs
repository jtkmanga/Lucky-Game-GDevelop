'use strict';
/** PREPARED ONLY. DO NOT RUN while game test pause D06 is active.
 * Mock DOM verifies that map one keeps the original SVG artwork and
 * alternate map SVG paths match the authoritative catalog. Does not prove
 * real browser geometry or cross-device animation.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {getBoard}=require('../backend/railway/board-maps.cjs');
function mockDom(){
 const groups={
  '.snake-bodies':element('original-snake'),
  '.snake-faces':element('original-faces'),
  '.ladder-illustrations':element('original-ladders')
 };
 function element(html=''){
  return {innerHTML:html,children:[],attrs:{},
   setAttribute(k,v){this.attrs[k]=v;},
   append(node){this.children.push(node);},
   replaceChildren(){this.children=[];this.innerHTML='';}
  };
 }
 const svg={dataset:{},querySelector:k=>groups[k]};
 const doc={querySelector:k=>k==='.board-art'?svg:null,
  createElementNS(_ns,name){const e=element();e.name=name;return e;}};
 const original=Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.innerHTML]));
 const code=fs.readFileSync(path.join(__dirname,'../backend/railway/board-visual-bridge.js'),'utf8');
 const scope={document:doc,tilePercent(n){
  const r=Math.floor((n-1)/10),c=r%2===0?(n-1)%10:9-(n-1)%10;
  return {left:(c+.5)*10,top:(9-r+.5)*10};
 }};
 vm.runInNewContext(code,scope);
 return {paint:scope.luckyRenderBoardArt,groups,svg,original};
}
test('map 1 preserves original art and no new group children are inserted',()=>{
 const dom=mockDom();
 dom.paint(getBoard(1));
 assert.equal(dom.svg.dataset.luckyBoardId,'1');
 for(const [key,group] of Object.entries(dom.groups))
  assert.equal(group.innerHTML,dom.original[key]);
});
test('other map has one drawable snake track per mapped snake',()=>{
 const dom=mockDom();
 for(let id=2;id<=5;id++){
  dom.paint(getBoard(id));
  const tracks=dom.groups['.snake-bodies'].children.filter(
   child=>child.attrs.class==='snake-track');
  assert.equal(tracks.length,Object.keys(getBoard(id).snakes).length);
  for(const path of tracks)
   assert.equal(getBoard(id).snakes[path.attrs['data-head']],path.attrs['data-tail']);
  assert.equal(dom.groups['.ladder-illustrations'].children.length,
   Object.keys(getBoard(id).ladders).length);
 }
});
test('rendering original map after alternate board restores existing SVG artwork',()=>{
 const dom=mockDom();
 dom.paint(getBoard(4));
 dom.paint(getBoard(1));
 for(const [key,group] of Object.entries(dom.groups))
  assert.equal(group.innerHTML,dom.original[key]);
});
