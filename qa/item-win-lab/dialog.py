"""Chromium with intercepted requests and mock server messages. No listener or account."""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(sys.argv[1])
app = out / 'railway-runtime/backend/railway'
html = (app / 'public/index.html').read_text()
board = {'version':1, **json.loads((app/'board-definitions.json').read_text())['boards'][0]}
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('LUCKY_QA_CHROMIUM', '/usr/bin/chromium'),args=['--disable-background-networking'])
    def run(kind, amount, mismatch=False, seat=0):
        page=browser.new_page(service_workers='block')
        def route(req):
            url=req.request.url
            if url=='http://lucky.invalid/':
                req.fulfill(content_type='text/html',body=html)
            elif url.endswith('/api/supabase-config'):
                req.fulfill(json={'url':'https://unused.invalid','publishableKey':'fixture'})
            elif 'supabase.min.js' in url:
                req.fulfill(content_type='text/javascript',body="""window.supabase={createClient:()=>({auth:{
                  getSession:async()=>({data:{session:{access_token:'fixture'}}}),
                  onAuthStateChange:()=>({})}})};""")
            else:
                req.abort()
        page.route('**/*',route)
        page.add_init_script("""window.WebSocket=class extends EventTarget{
         static OPEN=1; static CONNECTING=0;
         constructor(){super(); this.readyState=0;window.socket=this;
          setTimeout(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));},0);}
         send(raw){window.joinMessage=JSON.parse(raw);}
         close(){this.readyState=3;}
        };""")
        page.goto('http://lucky.invalid/')
        page.evaluate("document.getElementById('matchButton').click()")
        page.wait_for_function("window.joinMessage?.type==='join'",timeout=4000)
        msg=page.evaluate("""board=>{const g=LuckyRules.create(['Po','B','C','D'],'free');
          g.board=board;g.over=true;g.winner=0;g.players[0].score=777;
          return {type:'state',roomId:'lab',revision:3,deadline:null,game:g};}""",board)
        msg.update(seat=seat,event={'type':kind})
        if kind=='roll':
            msg['event'].update(actor=0,dice=1,outcome={'gameOver':True,'reward':0})
        if amount is not None:
            msg['event']['committedWin']={'seat':0,'roomId':'lab','revision':2 if mismatch else 3,'points':amount}
        page.evaluate("msg=>socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(msg)}))",msg)
        if seat==0:
            assert page.locator('#gameResultOverlay').is_visible()
            expected=f'Po คุณชนะได้รับคะแนน +{amount} คะแนน' if amount in (10,20) and not mismatch else 'Po คุณชนะ!'
            assert page.locator('#resultMessage').inner_text()==expected
        else:
            assert not page.locator('#gameResultOverlay').is_visible()
        page.close()
        print('PASS',kind,amount,'stale' if mismatch else 'current','seat',seat)
    for case in [('roll',20),('roll',10),('resume',20),('resume',None),('roll',20,True),('roll',99),('roll',20,False,1)]:
        run(*case)
    browser.close()
