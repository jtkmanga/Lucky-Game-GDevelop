#!/usr/bin/env python3
"""Prepare Render's Node.js runtime from the committed test archive.

Build-only extraction. No game testing, deployment or network calls.
Legacy guest WebSocket joins are disabled by default on Render.
The output render-web/ is generated during Render build and not committed.
"""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "Lucky_Game_Multiplayer_Test_v1.zip"
DEST = ROOT / "render-web"
REQUIRED = ("server.js", "rules.js", "package.json", "public/index.html")
MARKER = "wss.on('connection',ws=>{"
GUARD = """wss.on('connection',ws=>{
 // Draft Render deployment MUST NOT expose the unauthenticated VIP/guest
 // test lobby without an explicit and knowingly unsafe opt-in.
 if(process.env.ENABLE_INSECURE_GUEST_WS!=='true'){
  ws.close(1008,'Unverified multiplayer preview is disabled');
  return;
 }
"""

with zipfile.ZipFile(SOURCE) as archive:
    missing = [name for name in REQUIRED if name not in archive.namelist()]
    if missing:
        raise RuntimeError("Missing source files: " + ", ".join(missing))
    for name in REQUIRED:
        destination = DEST / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(archive.read(name))

server = DEST / "server.js"
text = server.read_text(encoding="utf-8")
if text.count(MARKER) != 1:
    raise RuntimeError("Server WebSocket hook changed; fail closed, review manually")
server.write_text(text.replace(MARKER, GUARD, 1), encoding="utf-8")
print("Render Node.js sources prepared from repository ZIP (guest WS disabled by default).")
