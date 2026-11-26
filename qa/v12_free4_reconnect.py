"""Run the optional seventh v12 acceptance case directly with Python."""
import asyncio
import json
import shutil
import subprocess

from aiohttp import web
from playwright.async_api import async_playwright
from v12_mode_acceptance import PAGE, ROOT, snapshot


async def run():
    identities = ('A', 'B', 'C', 'D')
    game = snapshot(1)
    revision = 0
    sockets, joins, rolls, errors = {}, [], [], []
    room = 'fixture-free4'

    async def send(uid, event=None):
        await sockets[uid].send_json(dict(type='state', roomId=room,
            seat=identities.index(uid), revision=revision, game=game,
            deadline=4102444800000, event=event))

    async def websocket(request):
        nonlocal revision, game
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        uid = None
        try:
            async for raw in ws:
                msg = json.loads(raw.data)
                if msg['type'] == 'join':
                    identity = msg['accessToken']
                    if uid or identity not in identities or identity in sockets or msg['mode'] != 'free':
                        raise ValueError('Invalid fixture join')
                    uid = identity
                    sockets[uid] = ws
                    joins.append(uid)
                    if len(sockets) < 4:
                        await ws.send_json(dict(type='waiting', joined=len(sockets), needed=4, mode='free'))
                    elif revision:
                        await send(uid)
                    else:
                        for member in identities:
                            await send(member)
                elif msg['type'] == 'roll':
                    rolls.append(uid)
                    if len(sockets) != 4 or uid != identities[game['current']] or revision:
                        raise ValueError('Unexpected roll')
                    js = """const R=require('./backend/railway/multi-board-rules.cjs');
                    const g=JSON.parse(require('fs').readFileSync(0,'utf8'));
                    console.log(JSON.stringify([g,R.turn(g,3,()=>0)]));"""
                    game, outcome = json.loads(subprocess.check_output(
                        ['node', '-e', js], input=json.dumps(game).encode(), cwd=ROOT))
                    revision += 1
                    for member in identities:
                        await send(member, dict(type='roll', actor=0, dice=3, outcome=outcome))
                else:
                    raise ValueError('Unexpected command ' + msg['type'])
        except Exception as exc:
            errors.append(str(exc))
            raise
        finally:
            if sockets.get(uid) is ws:
                del sockets[uid]
        return ws

    async def index(request):
        return web.FileResponse(PAGE, headers={'Content-Security-Policy':
            "connect-src 'self' ws://" + request.host + "; worker-src 'none'"})

    async def config(request):
        return web.json_response(dict(url='fixture', publishableKey='fixture'))

    app = web.Application()
    app.add_routes([web.get('/', index), web.get('/ws', websocket),
                    web.get('/api/supabase-config', config)])
    runner = web.AppRunner(app)
    await runner.setup()
    try:
        await web.TCPSite(runner, '127.0.0.1', 0).start()
        origin = 'http://127.0.0.1:' + str(runner.addresses[0][1])

        async def route(request):
            url = request.request.url
            if url.startswith(origin + '/'):
                await request.continue_()
            elif url.endswith('/supabase.min.js'):
                await request.fulfill(body='window.supabase={createClient:()=>({})}')
            else:
                await request.abort()

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(executable_path=shutil.which('chromium'))
            pages, latest = [], {}

            def record(uid, data):
                frame = json.loads(data)
                if frame['type'] == 'state':
                    latest[uid] = frame

            async def verify(expected_revision, positions, current):
                for seat, page in enumerate(pages):
                    await page.wait_for_function("""([seat,pos,current,room]) =>
                        document.body.classList.contains('show-board') && onlineRoomId===room &&
                        onlineSeat===seat && localGame?.current===current &&
                        localGame.players.every((p,i)=>p.pos===pos[i]) &&
                        document.querySelector('#turnPlayerName').textContent==='ABCD'[current] &&
                        document.querySelector('#rollDice').disabled===(seat!==current)""",
                        arg=[seat, positions, current, room])
                    labels = await page.locator('#playerSlots .player-card small').all_text_contents()
                    assert labels == [f'ช่อง {pos} · 0 คะแนน' for pos in positions], labels
                    frame = latest[identities[seat]]
                    assert (frame['roomId'], frame['seat'], frame['revision'], frame['game']) == (
                        room, seat, expected_revision, game)

            try:
                for uid in identities:
                    ctx = await browser.new_context(service_workers='block')
                    await ctx.route('**/*', route)
                    page = await ctx.new_page()
                    pages.append(page)
                    page.on('pageerror', lambda err: errors.append(str(err)))
                    page.on('websocket', lambda ws, u=uid: ws.on(
                        'framereceived', lambda data: record(u, data)))
                    await page.goto(origin)
                    await page.evaluate('(u)=>{window.luckyGetAccessToken=async()=>u}', uid)
                    await page.locator('#enterLobby').click()
                    await page.locator('#matchButton').click()
                await verify(0, [0, 0, 0, 0], 0)
                await pages[0].locator('#rollDice').click()
                await verify(1, [3, 0, 0, 0], 1)
                assert all(f['event']['dice'] == 3 for f in latest.values())
                await sockets['B'].close()
                await pages[1].wait_for_function("!onlineActive && document.querySelector('#lobby').classList.contains('active')")
                del latest['B']
                await pages[1].locator('#matchButton').click()
                await verify(1, [3, 0, 0, 0], 1)
                assert latest['B']['event'] is None
                assert joins == ['A', 'B', 'C', 'D', 'B'] and rolls == ['A'] and revision == 1
                assert not errors, errors
                print('PASS 7 Free4: A rolled 3 once; four views at revision 1; B resumed seat 1 with roll enabled')
            finally:
                await browser.close()
    finally:
        await runner.cleanup()


if __name__ == '__main__':
    asyncio.run(run())
