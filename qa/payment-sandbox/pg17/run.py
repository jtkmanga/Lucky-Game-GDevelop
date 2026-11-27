"""Run the synthetic ledger in a fresh PG17 standalone cluster. Only input: binary directory."""
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent

def main():
    if len(sys.argv) != 2:
        raise SystemExit('usage: python3 run.py PG17_BIN_DIR')
    binaries = Path(sys.argv[1]).resolve(strict=True)
    postgres = binaries / 'postgres'
    env = {k:v for k,v in os.environ.items() if not k.startswith('PG')}
    version = subprocess.check_output([postgres, '--version'], env=env, text=True).strip()
    if not version.startswith('postgres (PostgreSQL) 17.'):
        raise ValueError(version)
    with tempfile.TemporaryDirectory(prefix='lucky-standalone-ledger-') as tmp:
        data = Path(tmp) / 'data'
        subprocess.run([binaries / 'initdb','-D',data,'-A','reject','--no-locale','-E','UTF8'],
                       env=env, capture_output=True, check=True, timeout=30)
        def single(db, sql, *, enabled=True, expected=None):
            args=[postgres,'--single','-D',data,'-j']
            if enabled:
                args.extend(['-c','lucky.disposable_ledger=on'])
            batch=re.sub(r'\n[ \t]*\n','\n',sql.strip())+'\n\n'
            out=subprocess.run([*args,db],input=batch,text=True,capture_output=True,
                               check=True,env=env,timeout=30)
            errors=re.findall(r'\b(?:ERROR|FATAL|PANIC):\s*([^\n]+)',out.stderr)
            if errors != ([expected] if expected else []):
                raise RuntimeError(str(errors))
            return out.stdout
        lab='lucky_qa_item_ledger'
        single('postgres','CREATE DATABASE '+lab)
        # Standalone bootstrap can allocate reserved OIDs below 16384 where RLS is inactive.
        single(lab,"""DO $$ BEGIN EXECUTE (SELECT 'CREATE TYPE oid_pad AS ENUM (' ||
          string_agg(quote_literal(n::text),',') || ')' FROM generate_series(1,3000) n);
          END $$; DROP TYPE oid_pad;""")
        ddl=(ROOT/'ledger.sql').read_text()
        single(lab,ddl,enabled=False,expected='requires disposable PG17 standalone ledger')
        single(lab,ddl)
        for phase in (ROOT/'cases.sql').read_text().split('-- next backend'):
            result=single(lab,phase)
        if 'LEDGER_CHECKS_PASSED' not in result:
            raise RuntimeError('missing completion marker')
    print(version+' synthetic ledger PASS')

if __name__ == '__main__':
    main()
