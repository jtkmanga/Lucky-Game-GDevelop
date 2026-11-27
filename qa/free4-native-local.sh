#!/usr/bin/env bash
# Default --check does not start PostgreSQL or write to a database.
# Run only on an already-running, approved no-extra-cost development machine.
set -euo pipefail
usage() { printf 'Usage: bash qa/free4-native-local.sh --check|--run-disposable /absolute/pg17/bin\n' >&2; }
if [[ $# != 2 || ( "$1" != --check && "$1" != --run-disposable ) || "$2" != /* ]]; then
  usage; exit 64
fi
mode=$1
bin=$(realpath -- "$2")
qa=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
[[ $(id -u) != 0 ]] || { echo 'Use a non-root development account.' >&2; exit 1; }
for cmd in postgres initdb pg_ctl psql; do
  [[ -x "$bin/$cmd" ]] || { echo "Missing PostgreSQL executable: $cmd" >&2; exit 1; }
done
version=$(env -i PATH=/usr/bin:/bin "$bin/postgres" --version)
[[ "$version" =~ ^postgres\ \(PostgreSQL\)\ 17\. ]] || { echo 'PostgreSQL 17 required.' >&2; exit 1; }
node=$(command -v node)
env -i PATH=/usr/bin:/bin "$node" -e '
  const createRequire = require("node:module").createRequire;
  createRequire(process.argv[1]).resolve("pg");
' "$qa/free4-native-postgres-race.cjs"
env -i PATH=/usr/bin:/bin "$node" --check "$qa/free4-native-postgres-race.cjs"
printf 'Prerequisites: %s, Node, pg dependency, harness syntax.\n' "$version"
if [[ "$mode" == --check ]]; then
  echo 'Check only: did not start a process or verify socket availability.'
  exit 0
fi

umask 077
base=$(mktemp -d /tmp/lucky-free4-native.XXXXXXXX)
host=$base/socket
data=$base/data
log=$base/postgres.log
port=55437 # Only a name for this private Unix socket; TCP is disabled.
db=lucky_qa_free4
user=lucky_qa_owner
mkdir -- "$host"
clean() {
  status=$?
  trap - EXIT
  if [[ -e "$data/postmaster.pid" ]]; then
    if ! env -i PATH=/usr/bin:/bin HOME="$base" "$bin/pg_ctl" -D "$data" -m fast -w -t 10 stop; then
      printf 'Could not confirm PostgreSQL stopped; preserved %s\n' "$base" >&2
      exit 1
    fi
  fi
  if [[ "$status" != 0 ]]; then
    printf 'Run did not pass. Local QA files/log preserved: %s\n' "$base" >&2
  else
    rm -rf -- "$base"
  fi
  exit "$status"
}
trap clean EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
run() { env -i PATH=/usr/bin:/bin HOME="$base" "$@"; }
run "$bin/initdb" -D "$data" -U "$user" -A trust --no-locale -E UTF8 >/dev/null
# This cluster and containing directory are 0700 and owned by this OS uid.
# Empty listen_addresses means no listener on any network interface.
run "$bin/pg_ctl" -D "$data" -l "$log" -o "-c listen_addresses= -k $host -p $port -c unix_socket_permissions=0700" -w -t 10 start
run "$bin/psql" -X -v ON_ERROR_STOP=1 -h "$host" -p "$port" -U "$user" -d postgres -c "CREATE DATABASE $db;"
run "$node" "$qa/free4-native-postgres-race.cjs" "$host" "$port" "$db" "$user" "$data"
