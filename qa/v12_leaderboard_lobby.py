"""Generated lobby acceptance with all browser HTTP intercepted. Build the page first."""
import asyncio
import shutil
from pathlib import Path
from playwright.async_api import async_playwright, expect

PAGE = Path(__file__).resolve().parents[1] / 'railway-runtime/backend/railway/public/index.html'
ORIGIN = 'http://lobby.test'
SDK = """
let user=null, notify;
window.fixtureSession=id=>{
 user=id?{id}:null;
 notify('CHANGE',user?{user}:null);
};
window.supabase={createClient:()=>({auth:{
 onAuthStateChange(cb){notify=cb;cb('INITIAL_SESSION',null)},
 async getUser(){return {data:{user}}},
 async getSession(){return {data:{session:user?{access_token:'fixture'}:null}}}
}})};
"""

async def run():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=shutil.which('chromium'))
        for enabled in [False, True]:
            page = await browser.new_page(service_workers='block')
            requests, errors = [], []
            held = asyncio.Event()
            release = asyncio.Event()
            page.on('pageerror', lambda exc: errors.append(exc.stack))

            async def route(r):
                url = r.request.url
                if url == ORIGIN + '/':
                    await r.fulfill(content_type='text/html', body=PAGE.read_bytes())
                elif url == ORIGIN + '/api/supabase-config':
                    await r.fulfill(json={'url':'fixture', 'publishableKey':'fixture', 'leaderboardEnabled':enabled})
                elif url.endswith('/supabase.min.js'):
                    await r.fulfill(content_type='application/javascript', body=SDK)
                elif url.startswith(ORIGIN + '/api/leaderboard?'):
                    assert r.request.headers.get('authorization') == 'Bearer fixture'
                    requests.append(url)
                    if len(requests) == 2:
                        held.set()
                        await release.wait()
                    if url.endswith('mode=vip'):
                        await r.fulfill(status=403, json={'error':'forbidden'})
                    else:
                        await r.fulfill(json={'rows':[['🥇','👤','ผู้เล่น','9007199254740993']]})
                else:
                    await r.abort()
            await page.route('**/*', route)
            await page.goto(ORIGIN)
            await page.wait_for_function("typeof notify==='function'")
            await page.locator('#enterLobby').click()
            empty = page.locator('#rankRows .leaderboard-empty')
            await expect(empty).to_be_visible()
            assert requests == []
            await page.evaluate("fixtureSession('A')")
            if enabled:
                await expect(page.locator('.rank-score')).to_have_text('9007199254740993')
                await page.evaluate("fixtureSession('B')")
                await asyncio.wait_for(held.wait(), 5)
                await page.evaluate('fixtureSession(null)')
                async with page.expect_event('requestfinished', predicate=lambda r: 'leaderboard?' in r.url):
                    release.set()
                await page.evaluate('()=>new Promise(requestAnimationFrame)')
                await expect(empty).to_be_visible()
                await page.locator('.brand').click()
                await page.locator('[data-mode="vip"]').click()
                await page.evaluate("fixtureSession('A')")
                async with page.expect_response(lambda r: r.url.endswith('mode=vip') and r.status == 403):
                    await page.locator('#enterLobby').click()
                await expect(empty).to_be_visible()
                assert requests == [ORIGIN+'/api/leaderboard?mode='+m for m in ['free','free','vip']]
            else:
                await page.evaluate('()=>new Promise(requestAnimationFrame)')
                await expect(empty).to_be_visible()
                assert requests == []
            assert not errors, errors
            await page.close()
        await browser.close()
        print('PASS generated v12 lobby: disabled and signed-out empty; exact Free score; late response discarded; VIP denied')

if __name__ == '__main__':
    asyncio.run(run())
