"""Build into a new lab directory. Never modify the source tree or existing output."""
import shutil
import subprocess
import sys
from pathlib import Path

src = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1]).resolve()
if out.is_relative_to(src):
    raise ValueError('output must be outside source')
out.mkdir(exist_ok=False)
for name in ('backend', 'tools'):
    shutil.copytree(src / name, out / name)
for name in ('prod-ca-2021.crt', 'Lucky_Game_Multiplayer_Test_v1.zip'):
    shutil.copy2(src / name, out / name)

def build():
    subprocess.run([sys.executable, out / 'tools/prepare_railway_secure.py'], check=True)
def once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('candidate anchor drift: ' + old)
    return text.replace(old, new)

build()
runtime = out / 'railway-runtime'
runtime.rename(out / 'baseline')
subprocess.run(['git', 'apply', src / 'qa/fixtures/item-turn-candidate.patch'], cwd=out, check=True)
build()
app = runtime / 'backend/railway'
shutil.copy2(out / 'backend/railway/match-item-effects.cjs', app)
server = app / 'secure-server.cjs'
s = server.read_text()
# Rules.turn and requireRuleTransition validate the server-owned item snapshot.
s = once(s, "uid:target.uid,kind:'win',points:10", """uid:target.uid,kind:'win',
     points:old.matchItems ? 10*old.matchItems.players[actor].winMultiplier : 10""")
s = once(s, "if(Object.hasOwn(room.game,'board'))return room.game;", """const {matchItems,...publicGame}=room.game;
 if(Object.hasOwn(publicGame,'board'))return publicGame;""")
s = once(s, "return {...room.game,board:", "return {...publicGame,board:")
s = once(s, "deadline:room.deadline,event});", "deadline:room.deadline,revision:room.revision,event});")
s = once(s, '  schedule(room);transmit(room,event);', """  // The fenced write returned the committed revision. Publish only the winning
  // award from that transaction. A lost acknowledgement never reaches here.
  const win=awards.find(a=>a.kind==='win');
  if(next.over && win && [10,20].includes(win.points) && win.uid===room.seats[next.winner]?.uid){
   event.committedWin={roomId:room.id,revision,seat:next.winner,points:win.points};
  }
  schedule(room);transmit(room,event);""")
server.write_text(s)
page = app / 'public/index.html'
html = page.read_text()
html = once(html, 'function onlineApplyMessage(msg){', """function onlineWinPoints(msg){
 const w=msg.event?.committedWin;
 if(msg.game?.over!==true || !w || !Number.isSafeInteger(msg.revision) || msg.revision<1 ||
    w.roomId!==msg.roomId || w.revision!==msg.revision || w.seat!==msg.game.winner ||
    w.seat!==msg.seat || ![10,20].includes(w.points))return null;
 return w.points;
}
function onlineApplyMessage(msg){""")
html = once(html, "if(ev.outcome?.gameOver&&onlineSeat===ev.actor)showResult('win',localGame.players[ev.actor],10);",
    "if(!wasOver && localGame.over && ev.outcome?.gameOver && onlineSeat===ev.actor && ev.actor===localGame.winner)showResult('win',localGame.players[ev.actor],onlineWinPoints(msg));")
html = once(html, "showResult('win',localGame.players[localGame.winner],10);",
    "showResult('win',localGame.players[localGame.winner],onlineWinPoints(msg));")
html = once(html, '? `${player.name} คุณชนะได้รับคะแนน +${points} คะแนน`',
    '? (points===null ? `${player.name} คุณชนะ!` : `${player.name} คุณชนะได้รับคะแนน +${points} คะแนน`)')
page.write_text(html)
