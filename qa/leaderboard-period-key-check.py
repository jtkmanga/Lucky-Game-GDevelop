"""Compare the proposal's SQL keys to score-periods.cjs, using a socketless PG backend."""
from hashlib import sha1
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
env = {'PATH': '/usr/bin:/bin'}
if len(sys.argv) != 2 or not Path(sys.argv[1]).is_absolute():
    raise SystemExit('Usage: python3 qa/leaderboard-period-key-check.py /absolute/pg17/bin')
pg = Path(sys.argv[1]).resolve(strict=True)
version = subprocess.check_output([pg/'postgres', '--version'], text=True, timeout=5, env=env)
if not version.startswith('postgres (PostgreSQL) 17.'):
    raise SystemExit('This offline check requires PostgreSQL 17')
blob = (root/'backend/storage/score-periods.cjs').read_bytes()
if sha1(f'blob {len(blob)}\0'.encode()+blob).hexdigest() != '3c305490864150a2184ab3d46a3b41fea7792796':
    raise SystemExit('Calendar source differs from the reviewed commit')
js = """
const { getPeriod } = require('./backend/storage/score-periods.cjs');
const rows = [];
for (const boundary of ['2026-11-21T17:00:00Z','2026-11-22T17:00:00Z',
    '2038-01-19T03:14:08Z','2040-02-28T17:00:00Z','2040-02-29T17:00:00Z','2100-01-02T17:00:00Z']) {
  for (const offset of [-1,0,1]) for (const mode of ['free','vip']) {
    const ms = Date.parse(boundary)+offset;
    const {startMs,endMs} = getPeriod(mode,ms);
    rows.push([mode,new Date(ms).toISOString(),startMs,endMs]);
  }
}
console.log(JSON.stringify(rows));
"""
node = shutil.which('node')
if node is None:
    raise SystemExit('Node.js is required')
rows = json.loads(subprocess.check_output(
    [Path(node).resolve(), '-e', js], cwd=root, timeout=5, env=env))
values = ','.join("('%s','%s'::timestamptz,%d::bigint,%d::bigint)" % tuple(row) for row in rows)
sql = f"""
WITH input(mode,t,lo,hi) AS (VALUES {values}),
days AS (SELECT *, (t AT TIME ZONE 'Asia/Bangkok')::date AS d FROM input),
starts AS (SELECT *, CASE mode WHEN 'free' THEN d-extract(dow FROM d)::integer ELSE d END AS s FROM days),
keys AS (SELECT *, CASE mode WHEN 'free' THEN 1279739393 ELSE 1279739394 END AS ns,
 s-DATE '1970-01-01' AS k, s+CASE mode WHEN 'free' THEN 7 ELSE 1 END AS e FROM starts)
SELECT CASE WHEN count(*)={len(rows)} AND
 bool_and(lo=extract(epoch FROM (s::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000
 AND hi=extract(epoch FROM (e::timestamp AT TIME ZONE 'Asia/Bangkok'))*1000
 AND pg_typeof(k)='integer'::regtype AND k>=0)
 AND count(DISTINCT (mode,s))=count(DISTINCT (ns,k))
 THEN 'PERIOD_KEYS_PASS' ELSE 'FAIL' END FROM keys;
"""
with tempfile.TemporaryDirectory() as tmp:
    data = Path(tmp)/'data'
    subprocess.run([pg/'initdb','-D',data,'-A','reject','--no-locale'],check=True,
                   stdout=subprocess.DEVNULL, timeout=30, env=env)
    time_zones = ('UTC', 'America/New_York', 'Asia/Bangkok')
    statements = '\n\n'.join(f"SET TIME ZONE '{zone}';\n\n"+sql.strip() for zone in time_zones)
    result = subprocess.run([pg/'postgres','--single','-D',data,'-j','postgres'],
                            input=statements+'\n\n',text=True,capture_output=True,
                            check=True,timeout=30,env=env)
    log = result.stdout + result.stderr
    if re.search(r'\b(ERROR|FATAL|PANIC):',log) or result.stdout.count('"PERIOD_KEYS_PASS"') != len(time_zones):
        raise RuntimeError(log)
    if (data/'postmaster.pid').exists():
        raise RuntimeError('Unexpected postmaster process')
print(f'PASS {len(rows)*len(time_zones)} SQL/helper comparisons across {len(time_zones)} zones; no locks')
