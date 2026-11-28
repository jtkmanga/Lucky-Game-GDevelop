// Preserve the v12 empty state and renderer; only replace its data source in
// explicitly enabled staging. No storage, OAuth prompts or auth token redirects.
function createCurrentLeaderboardClient(repaint){
 let token=null,mode=null,rows=[],request=null;
 function cancel(){
  request?.abort();
  request=null;
 }
 function setSession(session){
  const accessToken=session?.access_token;
  const next=typeof accessToken==='string' && accessToken ? accessToken : null;
  if(next===token)return;
  cancel();
  token=next;
  mode=null;
  rows=[];
  repaint();
 }
 function rowsFor(next){
  if(mode===next)return rows;
  cancel();
  mode=next;
  rows=[];
  if(!token || mode!=='free')return rows;
  const current=new AbortController();
  request=current;
  void (async ()=>{
   try{
    const response=await fetch('/api/current-leaderboard?mode='+next,{
     cache:'no-store',mode:'same-origin',redirect:'error',signal:current.signal,
     headers:{Authorization:'Bearer '+token}
    });
    if(!response.ok)return;
    const body=await response.json();
    if(request!==current || !Array.isArray(body?.rows) || body.rows.length>50 ||
       !body.rows.every(row=>Array.isArray(row) && row.length===4 &&
        row.every(field=>typeof field==='string' && field.length<=20)))return;
    rows=body.rows;
    repaint();
   }catch{/* Network/parse failure leaves the original v12 empty state. */}
  })();
  return rows;
 }
 return {setSession,rowsFor};
}
