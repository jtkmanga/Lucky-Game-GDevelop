#!/usr/bin/env python3
"""Rebuild an offline GDevelop Desktop import package from committed ZIP sources.
Creates a scene that embeds existing Lucky Game v12 Multiplayer preview HTML.
This does not publish, authenticate, test, or migrate the game to native events.
"""
import json
import pathlib
import zipfile
import shutil
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[1]
OUT = REPO / "Lucky_Game_GDevelop_Multiplayer_Import_v3.zip"
BRIDGE_ZIP = REPO / "Lucky_Game_GDevelop_Full_UI_Bridge_v1.zip"
MULTI_ZIP = REPO / "Lucky_Game_Multiplayer_Test_v1.zip"

with tempfile.TemporaryDirectory() as d:
    temp = pathlib.Path(d)
    with zipfile.ZipFile(BRIDGE_ZIP) as z:
        z.extractall(temp / "bridge")
    with zipfile.ZipFile(MULTI_ZIP) as z:
        z.extractall(temp / "multi")
    original = temp / "bridge/LuckyGame_Full_UI_Bridge"
    multi = temp / "multi"
    output = temp / "LuckyGame_GDevelop_Multiplayer_Preview"
    output.mkdir()
    shutil.copytree(original / "assets", output / "assets")
    for name, source in (
        ("Lucky_Game_v12_Multiplayer_Preview.html", multi / "public/index.html"),
        ("server.js", multi / "server.js"),
        ("rules.js", multi / "rules.js"),
        ("package.json", multi / "package.json")
    ):
        shutil.copy2(source, output / name)
    game = json.loads((original / "LuckyGame_Full_UI_Bridge.json").read_text(encoding="utf8"))
    html = (multi / "public/index.html").read_text(encoding="utf8")
    old = "const socket=new WebSocket(protocol+'//'+location.host+'/ws');onlineSocket=socket;"
    new = "const endpoint=window.LUCKY_GDEVELOP_TEST_WS||protocol+'//'+location.host+'/ws';const socket=new WebSocket(endpoint);onlineSocket=socket;"
    if html.count(old) != 1:
        raise RuntimeError("Multiplayer adapter source changed: review before rebuild")
    html = html.replace(old, new)
    code = """// Lucky Game: HTML v12 bridge for GDevelop preview, NOT a native conversion.
(function(){
  if(typeof document==='undefined'||document.getElementById('lucky-full-ui-bridge'))return;
  let html=__HTML__;
  const raw=new URLSearchParams(window.location.search).get('lucky_ws')||'';
  let endpoint='';
  try{
    if(raw.length<2048){
      const u=new URL(raw);
      if((u.protocol==='wss:'||(u.protocol==='ws:'&&location.protocol==='http:'))
          &&!u.username&&!u.password)endpoint=u.href;
    }
  }catch(_){}
  html=html.replace('</head>',
    '<script>window.LUCKY_GDEVELOP_TEST_WS='+JSON.stringify(endpoint)+';<'+'/script></head>');
  const frame=document.createElement('iframe');
  frame.id='lucky-full-ui-bridge';
  frame.title='Lucky Game v12 Multiplayer Preview';
  frame.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483000;background:#f6e7cd;';
  frame.srcdoc=html;
  document.body.appendChild(frame);
})();
""".replace("__HTML__", json.dumps(html, ensure_ascii=False))
    layout = next(s for s in game["layouts"] if s["name"] == "OriginalUIv12")
    layout["events"][0]["inlineCode"] = code
    game["properties"]["name"] = "Lucky Game v12 Multiplayer GDevelop Preview"
    (output / "LuckyGame_GDevelop_Multiplayer_Preview.json").write_text(
        json.dumps(game, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    (output / "README_TH.md").write_text(
        "# Lucky Game GDevelop Preview Bridge v3\n\n"
        "เปิด LuckyGame_GDevelop_Multiplayer_Preview.json ด้วย GDevelop Desktop "
        "หลังแตก ZIP ให้ assets อยู่ในโฟลเดอร์เดิม\n\n"
        "นี่คือ HTML iframe preview ไม่ใช่ Native GDevelop Multiplayer\n"
        "ยังไม่ได้เปิด/นำเข้าบัญชี GDevelop Cloud ไม่ได้ Deploy ไม่ได้ทดสอบ\n"
        "server.js เป็น guest/VIP test server ไม่ปลอดภัยต่อการเปิดสาธารณะ\n"
        "โค้ด backend/ ใน GitHub ยังไม่เชื่อมกับเซิร์ฟเวอร์นี้\n",
        encoding="utf8"
    )
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(output.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(temp))
print(OUT)
