"""Apply to a fresh local PG17 single-user cluster; never connects to a server."""
from pathlib import Path
import hashlib
import re
import subprocess
import sys
import tempfile

if len(sys.argv) != 3 or not all(Path(arg).is_absolute() for arg in sys.argv[1:]):
    raise SystemExit('Usage: verify.py /absolute/pg17/bin /absolute/schema-dir')
INIT, PG = [Path(sys.argv[1]).resolve() / f for f in ('initdb', 'postgres')]
BASE = Path(sys.argv[2]).resolve()
LAB = Path(__file__).resolve().parent
ENV = {'PATH':'/usr/bin:/bin', 'LC_ALL':'C'}
assert subprocess.check_output([PG,'--version'],text=True,env=ENV,timeout=5).startswith('postgres (PostgreSQL) 17.')
PINS = {
    '001_game_private_schema.sql':'b7439dfb87b1ed4d90d0d9d2a63a5749ee5070f6',
    '002_room_lease_draft.sql':'1e0f66daf316c839ba7c92acf83bd8602802fedf',
    '003_turn_receipts_draft.sql':'bf63b6ec4c7ed916833d8a886c59bf8d199ea0af',
    '004_railway_runtime_access_PROPOSAL.sql':'1a50dd0da9b2ac2e8a2399d5cbac77dab2c141b7',
    '005_restricted_login_no_password.sql':'baa14f19ae0b2d912b6ccd96d432fdcc5787c9a7'
}
BOOTSTRAP = """
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
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
CONFIG = """
  SELECT set_config('fixture.kind','vip',true);
"""
QUERY = """
  WITH d AS (SELECT (transaction_timestamp() AT TIME ZONE 'Asia/Bangkok')::date AS today,
                   current_setting('fixture.kind') AS mode),
  bounds AS (SELECT mode,CASE WHEN mode='free' THEN today-extract(dow FROM today)::int ELSE today END AS s,
                   CASE WHEN mode='free' THEN 7 ELSE 1 END AS span,
                   CASE WHEN mode='free' THEN 1279739393 ELSE 1279739394 END AS ns FROM d)
  SELECT game.award_period_is_open(mode,
      (extract(epoch FROM (s::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint+__OFFSET__,
      (extract(epoch FROM ((s+span)::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint) AS is_open
    FROM bounds;
"""
ACQUIRE = """
  SELECT pg_advisory_lock_shared(
    CASE WHEN current_setting('fixture.kind')='free' THEN 1279739393 ELSE 1279739394 END,
    (CASE WHEN current_setting('fixture.kind')='free' THEN d-extract(dow FROM d)::int ELSE d END)-date '1970-01-01')
  FROM (SELECT (transaction_timestamp() AT TIME ZONE 'Asia/Bangkok')::date AS d) x;
"""
ARCHIVE = """
  INSERT INTO game.leaderboard_archives(mode,period_start_ms,period_end_ms,snapshot)
  SELECT 'vip',(extract(epoch FROM (d::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint,
  (extract(epoch FROM ((d+1)::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint,'[]'::jsonb
  FROM (SELECT (transaction_timestamp() AT TIME ZONE 'Asia/Bangkok')::date AS d) x;
"""
def sql(instructions, db='lucky_qa_award_period', *, expect_error=None):
    segments = [instructions] if isinstance(instructions, str) else instructions
    result = subprocess.run([PG,'--single','-D',data,'-j',db],
                            input='\n\n'.join(s.strip() for s in segments)+'\n\n',
                            text=True,capture_output=True,check=True,env=ENV,timeout=15)
    combined = result.stdout + result.stderr
    statuses = re.findall(r'(?:ERROR|FATAL|PANIC):\s*(.*)',combined)
    if expect_error:
        assert len(statuses) == 1 and expect_error in statuses[0], combined
    else:
        assert not statuses, combined
    return combined

def probe(answer, *, acquire=True, shifted=False, mode='vip', caller='lucky_game_server_login'):
    strings = [f'SET SESSION AUTHORIZATION {caller};','BEGIN;', CONFIG.replace("'vip'",f"'{mode}'")]
    if acquire:
        strings.append(ACQUIRE)
    strings.extend([QUERY.replace('__OFFSET__',str(int(shifted))),'COMMIT;'])
    result = sql(strings)
    assert f'is_open = "{answer}"' in result, result

with tempfile.TemporaryDirectory(prefix='lucky-disposable-award-period-') as tmp:
    data = Path(tmp)/'db'
    subprocess.run([INIT,'-D',data,'-A','trust','--no-locale'],check=True,capture_output=True,env=ENV,timeout=25)
    sql('CREATE DATABASE lucky_qa_award_period;', 'postgres')
    sql(BOOTSTRAP)
    for name, digest in PINS.items():
        body = (BASE / name).read_bytes()
        assert hashlib.sha1(b'blob %d\0' % len(body) + body).hexdigest() == digest, name
        sql(body.decode())
    sql(["SET lucky.disposable_award_period_qa='on';",(LAB/'proposal.sql').read_text()])
    probe('t')
    probe('t', mode='free')
    probe('f', acquire=False)
    probe('f', shifted=True)
    sql('CREATE ROLE fixture_other_login LOGIN; GRANT lucky_game_runtime TO fixture_other_login;')
    probe('f', caller='fixture_other_login')
    sql(['SET SESSION AUTHORIZATION anon;',"SELECT game.award_period_is_open('vip',0,1);"],
        expect_error='permission denied for schema game')
    sql("ALTER POLICY lucky_archive_period_probe_select ON game.leaderboard_archives USING (false);")
    probe('f')
    sql("ALTER POLICY lucky_archive_period_probe_select ON game.leaderboard_archives USING (true);")
    sql("CREATE POLICY fixture_hide_archive ON game.leaderboard_archives AS RESTRICTIVE FOR SELECT USING (false);")
    probe('f')
    sql("DROP POLICY fixture_hide_archive ON game.leaderboard_archives;")
    sql(ARCHIVE)
    probe('f')
    probe('t', mode='free')
    sql("UPDATE game.leaderboard_archives SET period_start_ms=period_start_ms+1 WHERE mode='vip';")
    probe('f')
    sql(['SET SESSION AUTHORIZATION lucky_archive_period_probe;',
         'SELECT snapshot FROM game.leaderboard_archives;'],expect_error='permission denied')
    sql(['SET SESSION AUTHORIZATION lucky_archive_period_probe;',
         'UPDATE game.leaderboard_archives SET period_end_ms=period_end_ms+1;'],expect_error='permission denied')
    print('PASS: 13 native single-user probe cases (privilege, lock, canonical bounds, RLS, archive and mode)')
