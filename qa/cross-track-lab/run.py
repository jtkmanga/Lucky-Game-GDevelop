"""Usage: python3 run.py --offline ITEM_ROOT LEADER_ROOT ADMIN_ROOT (Node 24, Git, Python 3)."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
import shutil
import subprocess
import tempfile


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', required=True)
    for track in ('item', 'leader', 'admin'):
        parser.add_argument(track, type=Path)
    args = parser.parse_args()
    pins = json.loads(Path(__file__).with_name('source-blobs.json').read_text())
    with tempfile.TemporaryDirectory(prefix='lucky-joined-') as tmp:
        root = Path(tmp)
        # Copy only the identified source inputs into clean, non-repository trees.
        for name, expected in pins.items():
            track, relative = name.split('/', 1)
            data = (getattr(args, track) / relative).read_bytes()
            if name == 'item/qa/item-win-lab/fenced-dialog.cjs':
                expected = 'd16fa5bf0b2ad45f72100499143fc4878f383005'
            if blob(data) != expected:
                raise ValueError('source drift: ' + name)
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        lab = root / 'item/qa/cross-track-lab'
        lab.mkdir()
        shutil.copy2(Path(__file__).with_name('joined.cjs'), lab)
        env = {'PATH': os.environ['PATH'], 'GIT_CONFIG_NOSYSTEM': '1',
               'GIT_CONFIG_GLOBAL': '/dev/null', 'PYTHONDONTWRITEBYTECODE': '1'}
        out = root / 'output'
        subprocess.run([sys.executable, root/'item/qa/item-win-lab/build.py', out],
                       cwd=root, env=env, check=True)
        baseline = out/'baseline/backend/railway/public/index.html'
        digest = hashlib.sha256(baseline.read_bytes()).hexdigest()
        if digest != '2f3e23aeb338c202a198b54aca4f7b30006ad2472aebc0a6aad47c9daeedef97':
            raise ValueError('default generated v12 changed: ' + digest)
        print(f'{len(pins)} source inputs verified. Default generated v12 HTML sha256 {digest}', flush=True)
        subprocess.run(['node', lab/'joined.cjs', out, root/'leader', root/'admin'],
                       cwd=root, env=env, check=True)


if __name__ == '__main__':
    main()
