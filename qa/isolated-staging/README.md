# Free4 hosted acceptance: isolated Supabase

**Not applied or deployed. Do not run on the existing shared project.**
The candidate keeps the default legacy connection pinned. When Free4 pilot is
enabled, it requires a separate Singapore Supabase project for both Auth and
PostgreSQL. The isolated project must not hold copied player data. Environment
separation in Railway alone is not sufficient.

## Provisioning and acceptance

1. Confirm a zero-cost standalone project in the existing Supabase organization
   and verify its exact reference and Singapore Session Pooler host from the
   provider. Do not enable paid add-ons, duplicate Railway, clone player data,
   or change production. Use a dedicated Google OAuth test client or a verified
   approved test configuration; callback and redirect allowlists should be
   exact. Only owner-approved test Google accounts participate.
2. With the target independently checked against the provider, bootstrap the
   game schema on the empty project using the reviewed 001–005 migrations.
   Keep `game` out of the Data API. Prepare a new restricted login secret in
   Railway, never in code/logs. Use `bind-acceptance.sql` on that empty game
   schema only (it uses psql substitutions; it cannot be pasted verbatim into
   the SQL editor). Bind the one pilot room and the exact cutoff in epoch ms.
   The runtime login gets read-only access to that binding.
3. Configure only the approved existing Railway Staging service with both the
   regular pilot settings and `LUCKY_ISOLATED_STAGING_SUPABASE_REF` /
   `LUCKY_ISOLATED_STAGING_POOLER_HOST`. `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY` and `DATABASE_URL` all come from that same
   new project. Use the restricted login and certificate-verified Session
   Pooler on 5432; no query parameters on the URL. Confirm binding and the
   actual limited role before bringing up the listener. Keep the old
   configuration isolated for rollback; never mix new code and old pilot vars.
4. Use approved Google test identities to populate the exact four-UID roster,
   without copying auth tables or issuing fake tokens. Exercise one Free4 room
   through a real reconnect and verify room/seat/revision server-side, then
   verify a Lucky Box award has exactly one corresponding receipt and score row
   when that event occurs. Log only synthetic/test-run identifiers with no
   credentials. Use a read-only separate operator check for the evidence.
5. End the pilot at the configured cutoff, restore the previously verified
   Staging configuration and revision together, verify readiness again,
   and record the exact commit, deployment, result and any remaining gate.
   Production and real payments remain off.

The startup and packaging tests are local checks, not hosted OAuth,
PostgreSQL or Railway evidence. The binding attests to the operator's actual
environment selection; it does not by itself prove that a project is clean.
