"""Fresh, socketless PostgreSQL 17 only. Arguments: PG_BIN SCHEMA_DIR PREDICATE_SQL RAILWAY_DIR."""
from pathlib import Path
import hashlib
import re
import shutil
import subprocess
import sys
import tempfile

pg, schema, predicate, railway = [Path(p).resolve(strict=True) for p in sys.argv[1:]]
lab = Path(__file__).resolve().parent
env = {'PATH':'/usr/bin:/bin', 'LC_ALL':'C'}
node = Path(shutil.which('node')).resolve()
def pinned(path, digest):
    data = path.read_bytes()
    if hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest() != digest:
        raise ValueError('Unexpected input: '+str(path))
    return data.decode()
schema_pins = {
 '001_game_private_schema.sql':'b7439dfb87b1ed4d90d0d9d2a63a5749ee5070f6',
 '002_room_lease_draft.sql':'1e0f66daf316c839ba7c92acf83bd8602802fedf',
 '003_turn_receipts_draft.sql':'bf63b6ec4c7ed916833d8a886c59bf8d199ea0af',
 '004_railway_runtime_access_PROPOSAL.sql':'1a50dd0da9b2ac2e8a2399d5cbac77dab2c141b7',
 '005_restricted_login_no_password.sql':'baa14f19ae0b2d912b6ccd96d432fdcc5787c9a7'}
schema_sql = [pinned(schema/k,v) for k,v in schema_pins.items()]
predicate_sql = pinned(predicate,'fc1f2bbf4882b35f777bf04e43a86b8f93a3ca23')
writer = railway/'archive-previous-candidate.cjs'
pinned(writer,'d30f9a6b5660291ee5504140882fcf666855dc47')
pinned(railway/'v12-leaderboard-rows.cjs','5154aaa260f9a77e9ebf769023c7346ecbf04888')
pinned(railway.parent/'storage/score-periods.cjs','3c305490864150a2184ab3d46a3b41fea7792796')
version=subprocess.check_output([pg/'postgres','--version'],text=True,env=env).strip()
if not version.startswith('postgres (PostgreSQL) 17.'): raise ValueError(version)
db='lucky_qa_award_period'
def sql(body, database=db, denied=None, marker=None):
    # -j terminates a backend command at a blank line. Keep compound DO bodies together.
    body=re.sub(r'\n\s*\n','\n',body.strip())
    result=subprocess.run([pg/'postgres','--single','-D',data,'-j',database],
      input=body+'\n\n',text=True,capture_output=True,env=env,timeout=30,check=True)
    log=result.stdout+result.stderr
    errs=re.findall(r'\b(?:ERROR|FATAL|PANIC):\s*(.*)',log)
    if denied:
        if len(errs)!=1 or denied not in errs[0]: raise RuntimeError(log)
    elif errs: raise RuntimeError(log)
    if marker and marker not in result.stdout: raise RuntimeError(log)
uid='aaaaaaaa-0000-4000-8000-000000000001'
reader='lucky_qa_archive_reader'
wr='lucky_qa_archive_writer'
with tempfile.TemporaryDirectory(prefix='lucky-archive-append-') as tmp:
    data=Path(tmp)/'data'
    (Path(tmp)/'archive-qa.marker').write_text('disposable archive QA')
    subprocess.run([pg/'initdb','-D',data,'-A','reject','--no-locale','-E','UTF8'],
                   env=env,capture_output=True,timeout=30,check=True)
    sql('CREATE DATABASE '+db+';',database='postgres')
    sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
DO $$ DECLARE i int; BEGIN
FOR i IN 1..10000 LOOP
 CREATE TABLE public.qa_oid(i int);
 IF 'public.qa_oid'::regclass::oid>=16384 THEN DROP TABLE public.qa_oid; RETURN; END IF;
 DROP TABLE public.qa_oid;
END LOOP; RAISE EXCEPTION 'Invalid fixture OIDs'; END $$;""")
    for body in schema_sql: sql(body)
    sql("SET lucky.disposable_award_period_qa='on';"+predicate_sql)
    proposal=(lab/'proposal.sql').read_text()
    sql(proposal,denied='Expected disposable PG17 archive QA')
    sql("SET lucky.disposable_append_qa='on';"+proposal)
    # Synthetic awards one millisecond before each mode's current lower bound.
    sql(f"""INSERT INTO auth.users VALUES('{uid}');
INSERT INTO game.players(uid,display_name,name_key) VALUES('{uid}','QA','qa');
INSERT INTO game.rooms(room_id,mode,seats,game_state,status) VALUES('{uid}','free','[]','{{}}','finished'),('aaaaaaaa-0000-4000-8000-000000000002','vip','[]','{{}}','finished');
WITH x AS (SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date AS d)
INSERT INTO game.score_events(event_id,uid,mode,game_id,kind,points,created_at)
SELECT 'fixture-'||mode,'{uid}',mode,(CASE mode WHEN 'free' THEN '{uid}' ELSE 'aaaaaaaa-0000-4000-8000-000000000002' END)::uuid,'admin',n,
 (e::timestamp AT TIME ZONE 'Asia/Bangkok')-interval '1 millisecond'
FROM x CROSS JOIN LATERAL (VALUES ('vip',20,d),('free',10,d-extract(dow FROM d)::int)) v(mode,n,e);""")
    subprocess.run([node,lab/'writer.cjs',pg/'postgres',data,writer],check=True,timeout=15,env=env)
    def as_role(role, statement, **kwargs):
        sql(f'SET SESSION AUTHORIZATION {role}; '+statement,**kwargs)
    as_role(reader,"""SELECT count(*)=2 AND bool_and(snapshot=jsonb_build_array(jsonb_build_array('🥇','👤','ผู้เล่น',CASE mode WHEN 'vip' THEN '20' ELSE '10' END))) AS ok FROM (SELECT mode,snapshot FROM game.leaderboard_archives) a;""",marker='ok = "t"')
    # The old predicate still sees the current VIP period as open under its real caller role.
    as_role('lucky_game_server_login',"""BEGIN;
SELECT pg_advisory_lock_shared(1279739394,(now() AT TIME ZONE 'Asia/Bangkok')::date-date '1970-01-01');
WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date d)
SELECT game.award_period_is_open('vip',(extract(epoch FROM (d::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint,
 (extract(epoch FROM ((d+1)::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000)::bigint) AS ok FROM t; COMMIT;""",marker='ok = "t"')
    negative=0
    for role in [reader,wr]:
        for stmt in ["UPDATE game.leaderboard_archives SET snapshot='[]'","DELETE FROM game.leaderboard_archives","TRUNCATE game.leaderboard_archives","UPDATE game.score_events SET points=1"]:
            as_role(role,stmt+';',denied='permission denied');negative+=1
    for role,stmt in [(reader,'SELECT points FROM game.score_events'),(reader,'SELECT uid FROM game.players'),
      (reader,"INSERT INTO game.leaderboard_archives(mode,period_start_ms,period_end_ms,snapshot) VALUES('vip',1,2,'[]')"),
      (wr,'SELECT name_key FROM game.players'),(wr,'SELECT event_id FROM game.score_events'),
      ('lucky_game_server_login','SELECT snapshot FROM game.leaderboard_archives'),
      ('lucky_archive_period_probe','SELECT snapshot FROM game.leaderboard_archives')]:
        as_role(role,stmt+';',denied='permission denied');negative+=1
    as_role(wr,"INSERT INTO game.leaderboard_archives(mode,period_start_ms,period_end_ms,snapshot) VALUES('vip',1,2,'[]');",denied='Expected locked previous period');negative+=1
    # Valid historical key, no exclusive gate, including a duplicate DO NOTHING attempt.
    as_role(wr,"INSERT INTO game.leaderboard_archives(mode,period_start_ms,period_end_ms,snapshot) SELECT mode,period_start_ms,period_end_ms,snapshot FROM game.leaderboard_archives WHERE mode='vip' ON CONFLICT DO NOTHING;",denied='Expected locked previous period');negative+=1
    for stmt in ["UPDATE game.leaderboard_archives SET snapshot='[]'","DELETE FROM game.leaderboard_archives","TRUNCATE game.leaderboard_archives"]:
        sql(stmt+';',denied='Archive is append only');negative+=1
    as_role(reader,'SELECT count(mode)=2 AS ok FROM game.leaderboard_archives;',marker='ok = "t"')
    print(f'{version} PASS: 4 writer calls, exact reader snapshots, current-period predicate, {negative} denied operations, opt-in guard, final row count')
