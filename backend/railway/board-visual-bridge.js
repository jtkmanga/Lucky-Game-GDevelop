/* Source-only JavaScript visual bridge for approved v12 board artwork.
 * No CSS, no HTML component re-layout. Original board 1 artwork is kept
 * byte-for-byte in the DOM and restored after viewing another board.
 * NOT tested and not activated through random matchmaking.
 */
function luckyRenderBoardArt(board){
 const svg=document.querySelector('.board-art');
 if(!svg||!board)throw Error('Missing trusted board artwork');
 const bodies=svg.querySelector('.snake-bodies');
 const faces=svg.querySelector('.snake-faces');
 const ladderRoot=svg.querySelector('.ladder-illustrations');
 if(!bodies||!faces||!ladderRoot)throw Error('Incomplete v12 board artwork');
 if(!luckyRenderBoardArt.original){
  luckyRenderBoardArt.original={
   bodies:bodies.innerHTML,faces:faces.innerHTML,ladders:ladderRoot.innerHTML
  };
 }
 if(svg.dataset.luckyBoardId===String(board.id))return;
 if(board.id===1){
  bodies.innerHTML=luckyRenderBoardArt.original.bodies;
  faces.innerHTML=luckyRenderBoardArt.original.faces;
  ladderRoot.innerHTML=luckyRenderBoardArt.original.ladders;
  svg.dataset.luckyBoardId='1';
  return;
 }
 const NS='http://www.w3.org/2000/svg';
 const el=(tag,attrs={})=>{
  const node=document.createElementNS(NS,tag);
  for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));
  return node;
 };
 const pt=tile=>{
  const p=tilePercent(tile);
  return {x:p.left*10,y:p.top*10};
 };
 const point=(x,y)=>Number(x.toFixed(1))+','+Number(y.toFixed(1));
 const nextBodies=document.createDocumentFragment();
 const nextFaces=document.createDocumentFragment();
 const nextLadders=document.createDocumentFragment();
 for(const [rawHead,tail] of Object.entries(board.snakes)){
  const head=Number(rawHead),a=pt(head),b=pt(tail);
  const dx=b.x-a.x,dy=b.y-a.y;
  // Light curve through the centers of two cells; used also for token motion.
  const off=dx===0?48:Math.sign(dx)*Math.min(110,Math.abs(dx)*0.22);
  const d='M '+point(a.x,a.y)+' C '+point(a.x+off,a.y+dy*0.32)+
    ' '+point(b.x-off,b.y-dy*0.32)+' '+point(b.x,b.y);
  const layers=[
   {stroke:'#fff1d8',width:43},
   {stroke:'#76b8a9',width:33},
   {stroke:'#8bc9bb',width:22,opacity:'.48'}
  ];
  for(let i=0;i<layers.length;i++){
   const attrs={d,stroke:layers[i].stroke,'stroke-width':layers[i].width};
   if(i===0){attrs.class='snake-track';attrs['data-head']=head;attrs['data-tail']=tail;}
   if(layers[i].opacity)attrs.opacity=layers[i].opacity;
   nextBodies.append(el('path',attrs));
  }
  nextFaces.append(el('use',{href:'#mintSnakeFace',x:a.x,y:a.y}));
 }
 for(const [rawStart,destination] of Object.entries(board.ladders)){
  const a=pt(Number(rawStart)),b=pt(destination);
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
  const ox=-dy/length*14,oy=dx/length*14;
  const group=el('g',{class:'hand-ladder'});
  const draw=(x1,y1,x2,y2,width,stroke)=>{
   group.append(el('path',{d:'M '+point(x1,y1)+' L '+point(x2,y2),
    stroke,'stroke-width':width}));
  };
  for(const sign of [-1,1]){
   for(const layer of [[14,'#a66a2b'],[9,'#f2c775'],[3,'#ffe1a0']])
    draw(a.x+ox*sign,a.y+oy*sign,b.x+ox*sign,b.y+oy*sign,...layer);
  }
  for(let i=1;i<=4;i++){
   const t=i/5,x=a.x+dx*t,y=a.y+dy*t;
   draw(x-ox,y-oy,x+ox,y+oy,12,'#a97334');
   draw(x-ox,y-oy,x+ox,y+oy,7,'#ffdf98');
  }
  nextLadders.append(group);
 }
 bodies.replaceChildren(nextBodies);
 faces.replaceChildren(nextFaces);
 ladderRoot.replaceChildren(nextLadders);
 svg.dataset.luckyBoardId=String(board.id);
}
