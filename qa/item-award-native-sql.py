#!/usr/bin/env python3
"""Offline PostgreSQL 17 single-user SQL check; no service, sockets or DSN.

Usage: python3 qa/item-award-native-sql.py /path/to/pg17/bin backend/supabase
Checks the pinned SQL bodies, not the Node adapter or live item eligibility.
"""
import hashlib
from pathlib import Path
import re
import subprocess
import sys
import tempfile

PINS = {
    'room-lease-store.cjs': '1b48f367bee92d8777823f43607f017a234ac8fa',
    '001_game_private_schema.sql': 'b7439dfb87b1ed4d90d0d9d2a63a5749ee5070f6',
    '002_room_lease_draft.sql': '1e0f66daf316c839ba7c92acf83bd8602802fedf',
    '003_turn_receipts_draft.sql': 'bf63b6ec4c7ed916833d8a886c59bf8d199ea0af',
}

def pinned(source, name):
    data = (source / name).read_bytes()
    signature = b'blob ' + str(len(data)).encode() + b'\0'
    if hashlib.sha1(signature + data).hexdigest() != PINS[name]:
        raise ValueError(f'unexpected source: {name}')
    return data.decode()

def sql_test(source):
    store = pinned(source, 'room-lease-store.cjs')
    schema = '\n'.join(pinned(source, name) for name in PINS if name.endswith('.sql'))
    statements = []
    for name, prefix in (('finish_room', 'UPDATE game.rooms\n        SET game_state='),
                         ('score', 'INSERT INTO game.score_events'),
                         ('receipt', 'INSERT INTO game.turn_receipts')):
        matches = re.findall(r'`(' + re.escape(prefix) + r'[^\x60]*)`', store)
        if len(matches) != 1 or '${' in matches[0]:
            raise ValueError(f'unexpected template: {name}')
        statements.append(f'PREPARE {name} AS {matches[0]};')
    user = '11111111-1111-4111-8111-111111111111'
    room = '22222222-2222-4222-8222-222222222222'
    owner = '33333333-3333-4333-8333-333333333333'
    return "\n".join([
        'CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;',
        'CREATE TABLE auth.users(id uuid PRIMARY KEY);',
        schema, *statements,
        f"""
INSERT INTO auth.users VALUES ('{user}');
INSERT INTO game.players(uid,display_name,name_key) VALUES ('{user}','QA winner','qa-winner');
INSERT INTO game.rooms(room_id,mode,seats,game_state,status,lease_owner,lease_epoch,lease_until)
VALUES('{room}','free','[{{"uid":"{user}"}}]','{{"over":false}}','playing','{owner}',1,clock_timestamp()+interval '1 hour');
BEGIN;
EXECUTE finish_room('{room}','{owner}',1,0,'{{"over":true,"winner":0}}',NULL,'finished');
EXECUTE score('{room}:win','{user}','free','{room}','win',20);
EXECUTE score('{room}:lucky','{user}','free','{room}','lucky_box',3);
EXECUTE receipt('{room}',1,0,1,'roll',0,1,'{{"reward":3}}','{{"over":true,"winner":0}}',
  '[{{"eventId":"{room}:win","uid":"{user}","mode":"free","kind":"win","points":20}},{{"eventId":"{room}:lucky","uid":"{user}","mode":"free","kind":"lucky_box","points":3}}]');
COMMIT;

-- Duplicate deterministic identities must preserve the original values.
EXECUTE score('{room}:win','{user}','free','{room}','win',10);
EXECUTE receipt('{room}',1,0,1,'roll',0,2,'{{}}','{{}}','[]');

DO $check$
BEGIN
 IF NOT EXISTS (
   SELECT FROM game.rooms r
   JOIN game.turn_receipts t ON t.room_id=r.room_id AND t.revision=r.revision
   JOIN game.score_events w ON w.game_id=r.room_id AND w.kind='win'
   JOIN game.score_events b ON b.game_id=r.room_id AND b.kind='lucky_box'
   WHERE r.room_id='{room}' AND r.status='finished' AND r.revision=1
   AND t.actor_index=0 AND t.roll=1 AND t.game_state=r.game_state
   AND w.event_id='{room}:win' AND w.uid='{user}' AND w.points=20
   AND b.uid=w.uid AND b.points=3
   AND t.award_events->0->>'eventId'=w.event_id
   AND (t.award_events->0->>'points')::integer=w.points
   AND t.award_events->1->>'eventId'=b.event_id
   AND (t.award_events->1->>'points')::integer=b.points
   AND (t.outcome->>'reward')::integer=b.points
 ) OR (SELECT count(*) FROM game.score_events WHERE game_id='{room}') <> 2
   OR (SELECT count(*) FROM game.turn_receipts WHERE room_id='{room}') <> 1 THEN
   RAISE EXCEPTION 'Item award persisted incorrectly';
 END IF;
END
$check$;
SELECT 'LUCKY_ITEM_AWARD_SQL_PASS';
"""])

def main():
    bindir, source = (Path(value).resolve(strict=True) for value in sys.argv[1:])
    version = subprocess.check_output([bindir / 'postgres', '--version'], text=True)
    if not re.match(r'^postgres \(PostgreSQL\) 17\.', version):
        raise ValueError('requires PostgreSQL 17 binaries')
    sql = sql_test(source)
    with tempfile.TemporaryDirectory(prefix='lucky-item-sql-') as temp:
        data = Path(temp) / 'data'
        subprocess.run([bindir / 'initdb', '-D', data, '-A', 'reject',
                        '--no-locale', '-E', 'UTF8'], check=True, capture_output=True, timeout=30)
        result = subprocess.run(
            [bindir / 'postgres', '--single', '-D', data, '-j', 'postgres'],
            input=re.sub(r'\n[\t ]*\n', '\n', sql.strip()) + '\n\n',
            capture_output=True, text=True, check=True, timeout=30,
        )
        # Single-user mode may report SQL failures with exit code zero.
        log = result.stdout + result.stderr
        if 'LUCKY_ITEM_AWARD_SQL_PASS' not in result.stdout or re.search(r'\b(ERROR|FATAL|PANIC):', log):
            raise RuntimeError(log)
    print(version.strip() + ': +20 win, separate +3 Lucky Box, and duplicate identity SQL checks PASS')

if __name__ == '__main__':
    main()
