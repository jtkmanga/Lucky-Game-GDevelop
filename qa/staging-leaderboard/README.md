# Current leaderboard: isolated QA reader

This proposal is **not** a live migration or a route. It must not be applied
to Production, the existing shared/unknown score database, or the Supabase
migration runner. The Railway dispatcher and runtime packaging are unchanged.

Run the native, socketless test against local PostgreSQL 17 binaries (it
initializes and cleans up a private temporary cluster, without network or
provider credentials):

```sh
LUCKY_PG17_BIN=/absolute/path/to/pg17/bin node --test qa/isolated-test-leaderboard-pg17.test.cjs
```

The test operator alone registers exact (room, scorer, mode) combinations.
The output contains only anonymous score totals. The dedicated reader may
execute the function but may not query source tables or change the registry.
The non-login definer uses column grants and a matching RLS policy. The
application adapter keeps the normal verified identity and VIP checks;
it never uses the normal game store for rank reads. A missing or failed
dedicated pool returns HTTP 503 after access checks.

The optional TCP rehearsal needs a local copy of `pg` (or an absolute path to
the installed driver in `LUCKY_PG17_DRIVER`) and uses a fresh cluster bound only
to 127.0.0.1 with generated SCRAM credentials and no Unix sockets:

```sh
LUCKY_PG17_BIN=/absolute/path/to/pg17/bin node --test qa/isolated-test-leaderboard-pg17-tcp.test.cjs
```

The rehearsal uses a non-superuser installer. In this fixture the installer
can create roles and a schema, owns the score table and has reference grants
for the registry's foreign keys plus grantable usage on the game schema.
Ownership transfer needs temporary SET ROLE capability and schema CREATE
for the new owner; the proposal revokes both before commit and restricts
EXECUTE to the dedicated login. This is a tested fixture, not proof of the
managed provider's migration privileges. The TCP test makes a separate real
SCRAM connection through `pg.Pool` as that login. It does not use TLS or a
managed connection pooler.

Hosted follow-up remains on hold until there is evidence of a dedicated
Staging database/corpus, with exact target identity and synthetic-only rows.
Before enabling anything, independently verify the live reader's role and
effective memberships/ACLs/RLS, the role used by its dedicated connection,
the operator-only registry, a default-off routing gate plus authorized
tester allowlist, and behavior when the reader cannot be reached. No broad
query fallback or previous-period archives. TLS/pool, OAuth, role grants on
a hosted database and deploy wiring are not proven by the local test.
