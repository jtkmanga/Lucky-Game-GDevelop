#!/usr/bin/env bash
# Prepare an offline GDevelop Desktop project in the existing Codespace.
# This does not run tests, launch the editor, connect to accounts or deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
python3 tools/build_gdevelop_import.py
DEST="$ROOT/gdevelop-import"
mkdir -p "$DEST"
python3 - "$ROOT/Lucky_Game_GDevelop_Multiplayer_Import_v3.zip" "$DEST" <<'PY'
import pathlib, sys, zipfile
archive = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(archive) as z:
    for info in z.infolist():
        path = (target / info.filename).resolve()
        if not path.is_relative_to(target):
            raise ValueError("Unsafe archive entry")
    z.extractall(target)
p = target / "LuckyGame_GDevelop_Multiplayer_Preview" / "LuckyGame_GDevelop_Multiplayer_Preview.json"
if not p.is_file():
    raise FileNotFoundError(p)
print("GDevelop Desktop project ready at:")
print(p)
print("Open File > Open in your authorized GDevelop Desktop session.")
print("Not imported into GDevelop Cloud. No tests/deploy were performed.")
PY
