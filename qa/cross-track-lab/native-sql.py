"""Optional PostgreSQL 17 SQL check in a fresh temporary single-user cluster.

Run via run.py --offline --postgres-bin /path/to/pg17/bin.
No sockets, pg driver, external requests, production data or CI.
"""
import argparse
import json
import hashlib
import os
from pathlib import Path
import re
import subprocess
import tempfile

def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('postgres_bin', 'lab_output', 'leader', 'admin'):
        p.add_argument(name, type=Path)
    args = p.parse_args()
    bindir = args.postgres_bin.resolve(strict=True)
    postgres = bindir/'postgres'
    if not re.match(r'^postgres \(PostgreSQL\) 17\.', subprocess.check_output([postgres,'--version'],text=True,timeout=10)):
        raise ValueError('PostgreSQL 17 required')
    fixture = Path(__file__).resolve().parents[1]/'item-win-lab/fenced-dialog.cjs'
    env = {'PATH':os.environ['PATH']}
    records = json.loads(subprocess.check_output(['node', '-e', '''
      const run = require(process.argv[1]).runCase;
      (async()=>console.log(JSON.stringify([
        await run('ordinary','free')(),await run('double','vip')()
      ])))().catch(e=>{console.error(e);process.exitCode=1});
    ''',fixture,args.lab_output.resolve()],env=env,timeout=30))
    result = build_sql(records,args)
    with tempfile.TemporaryDirectory(prefix='lucky-combined-pg-') as temp:
        data = Path(temp)/'data'
        setup(bindir,data,env,args.admin)
        run = subprocess.run([postgres,'--single','-D',data,'-j','lucky_qa_admin'],
                             env=env,input=result,text=True,capture_output=True,timeout=30,check=True)
        log = run.stdout+run.stderr
        markers = {'empty':'LUCKY_COMBINED_EMPTY','denied':'LUCKY_COMBINED_DENIED',
                   'free':'LUCKY_COMBINED_FREE_10','vip':'LUCKY_COMBINED_VIP_20',
                   'groups':'LUCKY_COMBINED_GROUPS','receipts':'LUCKY_COMBINED_RECEIPTS'}
        if re.search(r'\b(ERROR|FATAL|PANIC):',log) or not all(f'= "{m}"' in log for m in markers.values()):
            raise RuntimeError(log)
        print('PostgreSQL 17 single-user PASS:', ', '.join(markers))
        assert not (data/'postmaster.pid').exists()

SCHEMA_PINS = {"backend/admin/proposals/room-count-roles.sql":"d12d1c824c9191b90dff1c4a8d981a1ee42fb919","backend/supabase/001_game_private_schema.sql":"b7439dfb87b1ed4d90d0d9d2a63a5749ee5070f6","backend/supabase/002_room_lease_draft.sql":"1e0f66daf316c839ba7c92acf83bd8602802fedf","backend/supabase/003_turn_receipts_draft.sql":"bf63b6ec4c7ed916833d8a886c59bf8d199ea0af","backend/supabase/004_railway_runtime_access_PROPOSAL.sql":"1a50dd0da9b2ac2e8a2399d5cbac77dab2c141b7","backend/supabase/005_restricted_login_no_password.sql":"baa14f19ae0b2d912b6ccd96d432fdcc5787c9a7"}

def setup(bindir, data, env, admin):
    def native(database, sql):
        r = subprocess.run([bindir/'postgres','--single','-D',data,'-j',database],
                           env=env,input=sql+'\n\n',text=True,capture_output=True,timeout=30,check=True)
        if re.search(r'\b(ERROR|FATAL|PANIC):',r.stdout+r.stderr):
            raise RuntimeError(r.stdout+r.stderr)
    schema = []
    for path,expected in SCHEMA_PINS.items():
        payload = (admin/path).read_bytes()
        if hashlib.sha1(b'blob '+str(len(payload)).encode()+b'\0'+payload).hexdigest()!=expected:
            raise ValueError('schema drift: '+path)
        schema.append(payload.decode())
    subprocess.run([bindir/'initdb','-D',data,'-A','reject','--no-locale','-E','UTF8'],
                   env=env,capture_output=True,timeout=30,check=True)
    native('postgres','CREATE DATABASE lucky_qa_admin;')
    bootstrap = [
      'CREATE ROLE anon NOLOGIN;',
      'CREATE ROLE authenticated NOLOGIN;',
      'CREATE SCHEMA auth;',
      'CREATE TABLE auth.users(id uuid PRIMARY KEY);',
      """DO $advance$
DECLARE n int := 0; oid_now oid;
BEGIN
 LOOP
  CREATE TABLE public.oid_probe (id integer);
  oid_now := 'public.oid_probe'::regclass::oid;
  DROP TABLE public.oid_probe;
  EXIT WHEN oid_now >= 16384;
  n := n + 1;
  IF n > 10000 THEN RAISE EXCEPTION 'Expected normal user OID'; END IF;
 END LOOP;
END $advance$;""",
      *schema[1:],
      "SET lucky.disposable_admin_qa='on';",
      schema[0],
    ]
    native('lucky_qa_admin','\n\n'.join(bootstrap))

def literal(val):
    if val is None: return 'NULL'
    if isinstance(val,int): return str(val)
    return "'"+val.replace("'","''")+"'"

def build_sql(records,args):
    def extract(path,pattern):
        (result,) = re.findall(pattern,path.read_text(),re.S)
        return result
    store = args.lab_output/'railway-runtime/backend/supabase/room-lease-store.cjs'
    leader = args.leader/'backend/supabase/game-store.cjs'
    admin = args.admin/'backend/admin/pg-room-counts.cjs'
    statements = [("finish",store,r'`(UPDATE game.rooms\s+SET game_state=[^`]+)`'),
                  ("score",store,r'`(INSERT INTO game.score_events[^`]+)`'),
                  ("receipt",store,r'`(INSERT INTO game.turn_receipts[^`]+)`'),
                  ("rank",leader,r"'(SELECT p.uid,p.display_name,sum\(e.points\).*?LIMIT \$4)'"),
                  ("counts",admin,r'ROOM_COUNTS_SQL = `([^`]+)`')]
    blocks = ["BEGIN;", """DO $guard$ BEGIN
IF current_database()<>'lucky_qa_admin' OR inet_server_addr() IS NOT NULL
 OR 'game.rooms'::regclass::oid < 16384
 OR (SELECT count(*) FROM game.rooms) <> 0
 OR (SELECT count(*) FROM game.score_events) <> 0 THEN
 RAISE EXCEPTION 'Requires fresh disposable Admin QA seed';
END IF;
END $guard$;"""]
    blocks += [f'PREPARE {name} AS {extract(file,pattern)};' for name,file,pattern in statements]
    auditor = 'aaaaaaaa-0000-4000-8000-000000000007'
    blocks += [f"INSERT INTO auth.users(id) VALUES('{auditor}');",
               f"INSERT INTO game.room_count_grants(uid) VALUES('{auditor}');",
               'SET ROLE lucky_count_reader;',
               """DO $rls$ BEGIN
IF NOT row_security_active('game.rooms') THEN RAISE EXCEPTION 'Expected RLS'; END IF;
END $rls$;""",
               f"CREATE TEMP TABLE combined_counts_empty AS EXECUTE counts('{auditor}');"]
    def expect(flag, condition):
        blocks.append(f"SELECT CASE WHEN {condition} THEN 'LUCKY_COMBINED_{flag}' ELSE 'FAIL' END AS check_result;")
    expect('EMPTY',"""(SELECT counts='[]'::jsonb FROM combined_counts_empty)""")
    blocks.append('RESET ROLE;')
    identities = sorted({seat['uid'] for record in records for seat in record['seats']})
    for i,uid in enumerate(identities):
        blocks += [f"INSERT INTO auth.users(id) VALUES('{uid}');",
                   f"INSERT INTO game.players(uid,display_name,name_key) VALUES('{uid}','Fixture {i}','fixture-{i}');"]
    for entry in records:
        room, owner, epoch, rev, *_ = entry['update']
        mode = entry['ledger'][2]
        blocks.append(f"""INSERT INTO game.rooms(room_id,mode,seats,game_state,revision,status,lease_owner,lease_epoch,lease_until)
VALUES('{room}','{mode}',{literal(json.dumps(entry['seats']))},'{{"over":false}}',{rev},'playing','{owner}',{epoch},clock_timestamp()+interval '1 hour');""")
        blocks += ['SET ROLE lucky_game_runtime;',
                   "DO $writer$ BEGIN IF NOT row_security_active('game.rooms') "
                   "OR NOT row_security_active('game.score_events') "
                   "OR NOT row_security_active('game.turn_receipts') THEN "
                   "RAISE EXCEPTION 'Expected writer RLS'; END IF; END $writer$;"]
        blocks += [f"EXECUTE {verb}("+','.join(literal(x) for x in entry[key])+');'
                   for verb,key in [('finish','update'),('score','ledger'),('receipt','receipt')]]
        blocks += ['RESET ROLE;']
    # Synthetic clock. This update is restricted to disposable fixtures and does not
    # suggest changing the runtime DEFAULT now() or the existing period semantics.
    blocks.append("UPDATE game.score_events SET created_at='2026-11-28 16:59:59+00';")
    expect('RECEIPTS',"""(SELECT count(*)=2 FROM game.rooms r JOIN game.turn_receipts t
 ON r.room_id=t.room_id AND r.revision=t.revision
 JOIN game.score_events e ON r.room_id=e.game_id AND r.mode=e.mode
 WHERE r.status='finished' AND r.game_state=t.game_state
 AND t.award_events->0->>'eventId'=e.event_id AND (t.award_events->0->>'points')::int=e.points)""")
    blocks.append('SET ROLE lucky_game_runtime;')
    for mode,days,amount in [('free',7,10),('vip',1,20)]:
        blocks += [f"""CREATE TEMP TABLE combined_{mode} AS EXECUTE rank('{mode}',
extract(epoch FROM ('2026-11-28 17:00:00+00'::timestamptz-interval '{days} days'))*1000,
extract(epoch FROM '2026-11-28 17:00:00+00'::timestamptz)*1000,50);"""]
        expect(mode.upper()+'_'+str(amount),f'(SELECT count(*)=1 AND min(score)={amount} FROM combined_{mode})')
    blocks += ['RESET ROLE;', 'SET ROLE lucky_count_reader;',
               f"CREATE TEMP TABLE combined_denied AS EXECUTE counts('{identities[0]}');",
               f"CREATE TEMP TABLE combined_groups AS EXECUTE counts('{auditor}');"]
    expect('DENIED','(SELECT counts IS NULL FROM combined_denied)')
    expect('GROUPS',"""(SELECT counts='[{"mode":"free","status":"finished","count":"1"},{"mode":"vip","status":"finished","count":"1"}]'::jsonb FROM combined_groups)""")
    blocks += ['RESET ROLE;','ROLLBACK;']
    return '\n\n'.join(blocks)+'\n\n'

if __name__ == '__main__':
    main()
