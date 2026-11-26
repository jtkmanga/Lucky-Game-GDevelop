"""Six local-only acceptance cases. Requires built railway-runtime, aiohttp, Playwright and Chromium."""
import asyncio
import copy
import json
import shutil
import subprocess
from pathlib import Path
from html.parser import HTMLParser

from aiohttp import web
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / 'railway-runtime/backend/railway/public/index.html'


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.inline = False
        self.blocks = []

    def handle_starttag(self, tag, attrs):
        self.inline = tag == 'script' and 'src' not in dict(attrs)

    def handle_endtag(self, tag):
        if tag == 'script':
            self.inline = False

    def handle_data(self, data):
        if self.inline:
            self.blocks.append(data)


def snapshot(board):
    js = ("const R=require('./backend/railway/multi-board-rules.cjs');"
          "console.log(JSON.stringify(R.create(['A','B','C','D'],'free',()=>0.4,"
          + str(board) + ")))")
    return json.loads(subprocess.check_output(['node', '-e', js], cwd=ROOT))


async def run():
    scripts = Scripts()
    scripts.feed(PAGE.read_text())
    assert scripts.blocks
    for script in scripts.blocks:
        subprocess.run(['node', '--check'], input=script, text=True, check=True)
    print('PASS generated JS syntax', len(scripts.blocks), flush=True)
    games = {i: snapshot(i) for i in (1, 2)}
    sockets, joins, commands, errors = [], [], [], []
    async def page_handler(request):
        return web.FileResponse(PAGE)
    async def config(request):
        return web.json_response({'url': 'fixture', 'publishableKey': 'fixture'})
    async def websocket(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        sockets.append(ws)
        async for raw in ws:
            msg = json.loads(raw.data)
            commands.append(msg['type'])
            if msg['type'] == 'join':
                joins.append((ws, msg['accessToken']))
                await ws.send_json(dict(type='waiting', joined=1, needed=4, mode='free'))
            if msg['type'] == 'cancel':
                await ws.send_json(dict(type='cancelled'))
        return ws
    app = web.Application()
    app.add_routes([web.get('/', page_handler), web.get('/ws', websocket),
                    web.get('/api/supabase-config', config)])
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0)
    await site.start()
    origin = 'http://127.0.0.1:' + str(runner.addresses[0][1])
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=shutil.which('chromium'))
        context = await browser.new_context()
        async def route(req):
            if req.request.url.startswith(origin + '/'):
                await req.continue_()
            elif 'supabase.min.js' in req.request.url:
                await req.fulfill(body='window.supabase={createClient:()=>({})}')
            else:
                await req.abort()
        await context.route('**/*', route)
        async def page(uid):
            p = await context.new_page()
            p.on('pageerror', lambda err: errors.append(str(err)))
            await p.goto(origin)
            await p.evaluate('(uid)=>{window.luckyGetAccessToken=async()=>uid}', uid)
            return p
        async def click(p, id):
            await p.locator('#' + id).dispatch_event('click')
        async def connect(p):
            await click(p, 'matchButton')
            await p.wait_for_function("document.querySelector('#matchButton').textContent.includes('กำลังรอผู้เล่น')")
        async def state(ws, game, seat=0):
            await ws.send_json(dict(type='state', roomId='room-fixture', seat=seat,
                                    deadline=4102444800000, revision=1, game=game))
        async def board(p, id):
            await p.wait_for_function("id=>document.body.classList.contains('show-board') && document.querySelector('.board-art').dataset.luckyBoardId===String(id)", arg=id)
        async def lobby(p):
            await p.wait_for_function("!onlineActive && !localGame && document.querySelector('#lobby').classList.contains('active') && document.querySelector('#rollDice').disabled")
        try:
            p = await page('A')
            await p.evaluate("()=>{window.authCalls=0;window.luckyGetAccessToken=()=>{authCalls++;return new Promise(r=>window.finishAuth=r)}}")
            await click(p, 'matchButton')
            await click(p, 'matchButton')
            await click(p, 'startLocalGame')
            await p.evaluate("()=>finishAuth('A')")
            await board(p, 1)
            assert await p.evaluate("authCalls===1 && !onlineSocket && timerHandle!==null")
            assert not sockets
            print('PASS 1 delayed auth / local', flush=True)

            await p.evaluate("()=>{window.luckyGetAccessToken=async()=>'A'; turnEnd=Date.now()+300}")
            players = [p] + [await page(x) for x in 'BCD']
            for player in players:
                await connect(player)
            assert [uid for ws, uid in joins] == list('ABCD')
            for seat, (ws, _) in enumerate(joins):
                await state(ws, games[2], seat)
            await p.wait_for_timeout(450)
            for seat, player in enumerate(players):
                await board(player, 2)
                assert await player.evaluate('timerHandle===null && localGame.turn===1 && localGame.current===0')
                assert await player.evaluate('onlineSeat') == seat
                for kind in ['snakes', 'ladders']:
                    css = '.small-snake' if kind == 'snakes' else '.small-ladder'
                    markers = await player.locator(css).evaluate_all("els=>els.map(e=>e.previousElementSibling.textContent)")
                    assert set(markers) == set(games[2]['board'][kind])
            print('PASS 2 four views / local clock / board markers', flush=True)

            q = await page('Q')
            await connect(q)
            await q.evaluate('window.oldSocket=onlineSocket')
            await click(q, 'matchButton')
            await lobby(q)
            await click(q, 'startLocalGame')
            await q.evaluate("()=>oldSocket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'room_closed'})}))")
            await board(q, 1)
            assert await q.evaluate('!!localGame && timerHandle!==null')
            print('PASS 3 queue cancel / stale callback', flush=True)

            await joins[0][0].close()
            await lobby(p)
            await p.wait_for_timeout(350)
            assert await p.locator('#rollDice').is_disabled()
            await connect(p)
            ws, uid = joins[-1]
            assert uid == 'A'
            await state(ws, games[2], 0)
            await board(p, 2)
            assert await p.evaluate('onlineSeat===0')
            assert 'roll' not in commands
            await click(p, 'rollDice')
            for _ in range(20):
                if 'roll' in commands:
                    break
                await asyncio.sleep(.025)
            assert commands.count('roll') == 1
            print('PASS 4 disconnect / fixture identity resume / roll', flush=True)

            await state(ws, games[1])
            await lobby(p)
            await connect(p)
            await p.evaluate("document.querySelector('.snake-faces').remove()")
            await state(joins[-1][0], games[2])
            await lobby(p)
            await p.reload()
            await click(p, 'startLocalGame')
            await board(p, 1)
            print('PASS 5 invalid room map / missing artwork / clean fixture', flush=True)

            ended = copy.deepcopy(games[2])
            ended.update(over=True, winner=0)
            ended['players'][0].update(pos=100, score=10)
            for seat in [1, 2]:
                await state(joins[seat][0], ended, seat)
                await players[seat].wait_for_function('localGame.over')
            await click(players[1], 'startLocalGame')
            await board(players[1], 1)
            assert await players[1].evaluate('!onlineActive && timerHandle!==null && !localGame.over')
            count = len(sockets)
            await connect(players[2])
            assert len(sockets) == count + 1 and joins[-1][1] == 'C'
            assert not errors, errors
            print('PASS 6 post-game local / rematch', flush=True)
        finally:
            await browser.close()
            await runner.cleanup()


if __name__ == '__main__':
    asyncio.run(run())
