"""Run only an ephemeral PostgreSQL 17 standalone backend. Arguments: PG bin, schema dir."""
import hashlib
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
PINS = {
    '001_game_private_schema.sql': 'b7439dfb87b1ed4d90d0d9d2a63a5749ee5070f6',
    '002_room_lease_draft.sql': '1e0f66daf316c839ba7c92acf83bd8602802fedf',
    '003_turn_receipts_draft.sql': 'bf63b6ec4c7ed916833d8a886c59bf8d199ea0af',
    '004_railway_runtime_access_PROPOSAL.sql': '1a50dd0da9b2ac2e8a2399d5cbac77dab2c141b7',
    '005_restricted_login_no_password.sql': 'baa14f19ae0b2d912b6ccd96d432fdcc5787c9a7',
}

DB = 'lucky_qa_vip_pair'
ENV = {'PATH': '/usr/bin:/bin'}
BOOTSTRAP = """
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
-- Standalone bootstrap can assign reserved object OIDs. Real RLS assertions
-- require ordinary OIDs, so advance before applying the pinned migrations.
DO $probe$ DECLARE n integer := 0; observed oid; BEGIN
  LOOP
    CREATE TABLE public.oid_probe(id integer);
    observed := 'public.oid_probe'::regclass::oid;
    DROP TABLE public.oid_probe;
    EXIT WHEN observed >= 16384;
    n := n + 1;
    IF n > 10000 THEN RAISE EXCEPTION 'Expected normal user OID'; END IF;
  END LOOP;
END $probe$;
"""


def main():
    if len(sys.argv) != 3 or not all(Path(arg).is_absolute() for arg in sys.argv[1:]):
        raise SystemExit('Usage: python3 qa/vip-lock-lab/run.py /absolute/pg17/bin /absolute/schema-dir')
    binaries, schema = (Path(arg).resolve(strict=True) for arg in sys.argv[1:])
    postgres = binaries / 'postgres'
    version = subprocess.check_output([postgres, '--version'], text=True, env=ENV, timeout=5).strip()
    if not version.startswith('postgres (PostgreSQL) 17.'):
        raise ValueError(version)
    migrations = []
    for name, digest in PINS.items():
        body = (schema / name).read_bytes()
        if hashlib.sha1(b'blob %d\0' % len(body) + body).hexdigest() != digest:
            raise ValueError('Schema input drift: ' + name)
        migrations.append(body.decode())

    def native(data, database, group):
        batch = re.sub(r'\n[ \t]*\n', '\n', group.strip()) + '\n\n'
        result = subprocess.run([postgres, '--single', '-D', data, '-j', database],
            input=batch, text=True, capture_output=True, env=ENV, check=True, timeout=25)
        log = result.stderr + result.stdout
        if re.search(r'\b(ERROR|FATAL|PANIC):', log):
            raise RuntimeError(log[:5500])
        return result.stdout

    with tempfile.TemporaryDirectory(prefix='vip-pair-single-') as temp:
        data = Path(temp) / 'data'
        subprocess.run([binaries / 'initdb', '-D', data, '-A', 'reject', '--no-locale', '-E', 'UTF8'],
            env=ENV, capture_output=True, check=True, timeout=30)
        native(data, 'postgres', 'CREATE DATABASE ' + DB + ';')
        native(data, DB, BOOTSTRAP)
        for migration in migrations:
            native(data, DB, migration)
        option = "SET lucky.disposable_vip_qa='on';\n"
        native(data, DB, option + (ROOT / 'proposal.sql').read_text())
        for group in (ROOT / 'cases.sql').read_text().split('-- next backend'):
            result = native(data, DB, option + group)
        if 'VIP_PAIR_LAB_PASS' not in result or (data / 'postmaster.pid').exists():
            raise RuntimeError('missing completion marker or unexpected postmaster')
    print(version + ' — VIP pair sequential SQL checks PASS; no socket')


if __name__ == '__main__':
    main()
