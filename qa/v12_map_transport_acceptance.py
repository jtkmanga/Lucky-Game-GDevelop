"""Local acceptance for maps 3–5. Requires the generated v12 page and Playwright."""
import asyncio
import json
import shutil
import subprocess

from playwright.async_api import async_playwright
from v12_mode_acceptance import PAGE, ROOT

# Exercise one deterministic roll onto each transport in the real server rules.
SERVER_CASES = """
const rules = require('./backend/railway/multi-board-rules.cjs');
const catalog = require('./backend/railway/board-definitions.json');
const cases = [];
for (const board of catalog.boards.filter(b => [3, 4, 5].includes(b.id))) {
  for (const [kind, links] of [['snake', board.snakes], ['ladder', board.ladders]]) {
    for (const [start, end] of Object.entries(links)) {
      const game = rules.create(['A', 'B', 'C', 'D'], 'free', () => 0.4, board.id);
      game.players[0].pos = Number(start) - 1;
      const outcome = rules.turn(game, 1, () => 0.4);
      if (outcome.type !== kind || outcome.landing !== Number(start) ||
          outcome.position !== end || game.players[0].pos !== end)
        throw Error(JSON.stringify({map: board.id, start, end, outcome}));
      cases.push({map: board.id, kind, start: Number(start), end, game});
    }
  }
}
console.log(JSON.stringify(cases));
"""

# Read the endpoints of the drawn paths, independent of their data attributes.
GEOMETRY = """
() => {
  const svg = document.querySelector('.board-art');
  const box = svg.viewBox.baseVal;
  const tiles = [...document.querySelectorAll('#boardGrid .tile .cell-num')];
  function tile(point) {
    const col = Math.floor((point.x - box.x) * 10 / box.width);
    const row = Math.floor((point.y - box.y) * 10 / box.height);
    if (col < 0 || col > 9 || row < 0 || row > 9) throw Error('Off-board artwork');
    return Number(tiles[10 * row + col].textContent);
  }
  function endpoints(path) {
    return [path.getPointAtLength(0), path.getPointAtLength(path.getTotalLength())];
  }
  const snakes = [...svg.querySelectorAll('.snake-track')].map(p => endpoints(p).map(tile));
  const ladders = [...svg.querySelectorAll('.hand-ladder')].map(group => {
    const rails = [...group.querySelectorAll('path[stroke-width="14"]')];
    if (rails.length !== 2) throw Error('Expected two ladder rails');
    const [left, right] = rails.map(endpoints);
    return left.map((p, i) => tile({x:(p.x+right[i].x)/2, y:(p.y+right[i].y)/2}));
  });
  return {map: Number(svg.dataset.luckyBoardId), snake: snakes, ladder: ladders};
}
"""


async def run():
    cases = json.loads(subprocess.check_output(['node', '-e', SERVER_CASES], cwd=ROOT))
    html = PAGE.read_text()
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=shutil.which('chromium'))
        try:
            for board in [3, 4, 5]:
                page = await browser.new_page()
                async def fixture(route):
                    if route.request.url == 'http://fixture.invalid/':
                        await route.fulfill(content_type='text/html', body=html)
                    elif route.request.url.endswith('/api/supabase-config'):
                        await route.fulfill(json={'url':'fixture','publishableKey':'fixture'})
                    elif route.request.url.endswith('/supabase.min.js'):
                        await route.fulfill(body='window.supabase={createClient:()=>({})}')
                    else:
                        await route.abort()
                await page.route('**/*', fixture)
                await page.goto('http://fixture.invalid/')
                selected = [case for case in cases if case['map'] == board]
                assert selected, f'No cases for map {board}'
                for case in selected:
                    await page.evaluate("""game => onlineApplyMessage({
                        type:'state', roomId:'fixture-'+game.map, seat:0,
                        deadline:4102444800000, game
                    })""", case['game'])
                    token = page.locator('#gameTokens [data-player-id="0"]')
                    title = await token.get_attribute('title')
                    assert title.split()[:3] == ['A', 'ช่อง', str(case['end'])], case
                actual = await page.evaluate(GEOMETRY)
                assert actual['map'] == board, actual
                for kind in ['snake', 'ladder']:
                    expected = [[c['start'], c['end']] for c in selected if c['kind'] == kind]
                    assert sorted(actual[kind]) == sorted(expected), (board, kind, actual, expected)
                print(f'PASS map {board}: {len(selected)} server turns and SVG endpoints', flush=True)
                await page.close()
        finally:
            await browser.close()


if __name__ == '__main__':
    asyncio.run(run())
