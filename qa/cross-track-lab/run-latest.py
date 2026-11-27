"""Build a temporary offline projection from pinned Lucky Game source trees."""
import argparse
from hashlib import sha1, sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
V12_HASH = '2f3e23aeb338c202a198b54aca4f7b30006ad2472aebc0a6aad47c9daeedef97'


def replace_once(path, before, after):
    text = path.read_text(encoding='utf-8')
    if text.count(before) != 1:
        raise ValueError('offline fixture anchor drift: ' + str(path))
    path.write_text(text.replace(before, after), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', required=True)
    for track in ('pilot', 'item', 'leader', 'admin', 'suite'):
        parser.add_argument(track, type=Path)
    args = parser.parse_args()
    manifest = json.loads((HERE / 'latest-source-blobs.json').read_text())
    node = shutil.which('node')
    if node is None:
        raise SystemExit('Node.js is required')
    env = {'PATH': os.environ['PATH'], 'GIT_CONFIG_NOSYSTEM': '1',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'PYTHONDONTWRITEBYTECODE': '1'}
    with tempfile.TemporaryDirectory(prefix='lucky-latest-combined-') as tmp:
        root = Path(tmp)
        for name, expected in manifest['pins'].items():
            track, relative = name.split('/', 1)
            data = (getattr(args, track) / relative).read_bytes()
            actual = sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()
            if actual != expected:
                raise ValueError('source drift: ' + name)
            # Only item fixtures are overlaid on the clean pilot source.
            target = root / ('pilot' if track in {'item', 'suite'} else track) / relative
            if target.exists():
                raise ValueError('duplicate overlay input: ' + name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        lab = root / 'pilot/qa/item-win-lab'
        replace_once(lab / 'build.py',
            's = once(s, "deadline:room.deadline,event});", "deadline:room.deadline,revision:room.revision,event});")',
            """if s.count('revision:room.revision,seat:') != 2:
    raise ValueError('latest controller must already emit revision on both paths')""")
        replace_once(lab / 'fenced-dialog.cjs',
            'const deps={Rules,requireRuleTransition,store,OWNER_ID:owner,rooms:new Map([[id,room]]),',
            'const deps={Rules,requireRuleTransition,store,OWNER_ID:owner,rooms:new Map([[id,room]]),\n'
            '   pilot:null,clearTimeout() {},')
        copy = root / 'pilot/qa/cross-track-lab'
        copy.mkdir()
        shutil.copy2(HERE / 'joined.cjs', copy)
        out = root / 'build'
        subprocess.run([sys.executable, lab / 'build.py', out], cwd=root, env=env, timeout=20, check=True)
        baseline = out / 'baseline/backend/railway/public/index.html'
        if sha256(baseline.read_bytes()).hexdigest() != V12_HASH:
            raise ValueError('default v12 UI changed')
        ctrl = out / 'railway-runtime/backend/railway/secure-server.cjs'
        subprocess.run([node, '--check', ctrl], cwd=root, env=env, timeout=10, check=True)
        print(f"{len(manifest['pins'])} verified source blobs. Default v12 HTML: {V12_HASH}", flush=True)
        subprocess.run([node, copy / 'joined.cjs', out, root / 'leader', root / 'admin'],
                       cwd=root, env=env, timeout=20, check=True)


if __name__ == '__main__':
    main()
