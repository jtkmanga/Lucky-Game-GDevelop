"""Run only an ephemeral PostgreSQL 17 standalone backend. Arguments: PG bin, schema dir."""
import hashlib
from pathlib import Path
import re
import shutil
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

DB = 'lucky_qa_item_read'
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
        raise SystemExit('Usage: python3 qa/item-reader/run.py /absolute/pg17/bin /absolute/schema-dir')
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

    with tempfile.TemporaryDirectory(prefix='lucky-item-reader-single-') as temp:
        data = Path(temp) / 'data'
        subprocess.run([binaries / 'initdb', '-D', data, '-A', 'reject', '--no-locale', '-E', 'UTF8'],
            env=ENV, capture_output=True, check=True, timeout=30)
        native(data, 'postgres', 'CREATE DATABASE ' + DB + ';')
        native(data, DB, BOOTSTRAP)
        for migration in migrations:
            native(data, DB, migration)
        native(data, DB, "SET lucky.disposable_item_qa='on';" + (ROOT / 'proposal.sql').read_text())
        native(data, DB, """
CREATE ROLE lucky_item_read_login LOGIN PASSWORD NULL NOSUPERUSER NOBYPASSRLS;
GRANT lucky_item_reader TO lucky_item_read_login WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
INSERT INTO auth.users(id) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000000'),('bbbbbbbb-0000-4000-8000-000000000000'),
 ('cccccccc-0000-4000-8000-000000000000'),('dddddddd-0000-4000-8000-000000000000');
INSERT INTO game.players(uid,display_name,name_key) SELECT id,'Player '||id,id::text FROM auth.users;
INSERT INTO game.item_entitlement_current(uid,item,starts_at,expires_at,revoked_at) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000000','shield',now()-interval '1 day',now()+interval '1 day',NULL),
 ('aaaaaaaa-0000-4000-8000-000000000000','double_win',now()-interval '1 day',now(),NULL),
 ('bbbbbbbb-0000-4000-8000-000000000000','shield',now()+interval '1 day',now()+interval '2 days',NULL),
 ('bbbbbbbb-0000-4000-8000-000000000000','double_win',now()-interval '1 day',now()+interval '1 day',NULL),
 ('cccccccc-0000-4000-8000-000000000000','shield',now()-interval '1 day',now()+interval '1 day',now());
INSERT INTO game.vip_entitlements(uid,status,expires_at,grant_ref) VALUES
 ('dddddddd-0000-4000-8000-000000000000','active',now()+interval '1 day','synthetic-vip');
DO $priv$ BEGIN
 IF has_any_column_privilege('lucky_game_server_login','game.item_entitlement_current','SELECT')
    OR has_any_column_privilege('lucky_item_read_login','game.item_entitlement_current','UPDATE')
    OR has_any_column_privilege('lucky_item_read_login','game.rooms','INSERT')
    OR has_any_column_privilege('authenticated','game.item_entitlement_current','SELECT')
 THEN RAISE EXCEPTION 'Unexpected item privilege'; END IF;
END $priv$;
""")
        node = shutil.which('node')
        if node is None:
            raise RuntimeError('Node.js is required')
        module = ROOT.parents[1] / 'backend/railway/pg-item-entitlements.cjs'
        query = subprocess.check_output([Path(node).resolve(), '-e',
            'process.stdout.write(require(process.argv[1]).READ_SQL)', module], env=ENV, text=True, timeout=5)
        ids = "ARRAY['aaaaaaaa-0000-4000-8000-000000000000','bbbbbbbb-0000-4000-8000-000000000000','cccccccc-0000-4000-8000-000000000000','dddddddd-0000-4000-8000-000000000000']::uuid[]"
        out = native(data, DB, "SET SESSION AUTHORIZATION lucky_item_read_login;\n"
            + "PREPARE item_read(uuid[]) AS "+query+";\n"
            + "CREATE TEMP TABLE observed AS EXECUTE item_read("+ids+");\n"
            + """SELECT CASE WHEN
  row_security_active('game.item_entitlement_current')
  AND (SELECT count(*)=4 AND count(*) FILTER (WHERE shield)=1 AND count(*) FILTER (WHERE "doubleWin")=1
       AND bool_and(shield=(uid='aaaaaaaa-0000-4000-8000-000000000000'::uuid))
       AND bool_and("doubleWin"=(uid='bbbbbbbb-0000-4000-8000-000000000000'::uuid)) FROM observed)
 THEN 'ITEM_READER_PASS' ELSE 'FAIL' END AS result;""")
        if '"ITEM_READER_PASS"' not in out or (data/'postmaster.pid').exists():
            raise RuntimeError('Item reader verification failed')
    print(version + ' — exact item reader SQL and privileges PASS; no socket')



if __name__ == '__main__':
    main()
