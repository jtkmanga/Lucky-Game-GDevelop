# VIP2 native ordering harness

Integration base `3208ee7b3925fd784152e3f6a7d23da71d530976`, status `737dc7f7114d65add18f4c44c7a56461045b2ac0`. Copy the two harness files into qa/ of that checkout. The worker checks eight Git blob IDs before connecting: the integrated game store, room lease store, schemas 001–005, and qa/vip-lock-lab/proposal.sql. The dedicated private database meets the proposal's opt-in and private-schema guards. Only the pool/host configuration is injected. PostgreSQL executes the pinned store's actual initializeRoom transaction and the unchanged gate.

On the eligible machine, with the existing pg dependency accessible from qa/ or railway-runtime/ and PG17 binaries including psql, run:

    bash qa/vip2-native-local.sh --check /absolute/pg17/bin
    bash qa/vip2-native-local.sh --run-disposable /absolute/pg17/bin

The first command validates prerequisites offline. The second creates a private throwaway cluster for both cases. Random fixture UUIDs, socket-only local auth, no listener on TCP, and the exact restricted gameplay login are used. The harness bootstrap role seeds rows, performs the synthetic revocation, observes blockers and reads committed state. A separate table lock serves only as a deterministic barrier before the candidate's INSERT. Bounded polling matches actual backend PIDs and query text through pg_blocking_pids; elapsed sleep does not establish ordering. The SQL gate and room INSERT run under the restricted gameplay login on its checked-out session.

Revoke-first must block the gate behind the revoker, then report confirmed denial, zero rooms, one revoked entitlement and one active entitlement. Admit-first must show the candidate blocked at INSERT and the revoker blocked behind the candidate. After releasing the INSERT barrier the reader must see the room while the revocation remains uncommitted. Final readback checks exactly one room with the original ordered seats, game, revision, owner and lease epoch, plus the independently committed revocation. The runner attempts fast shutdown, then immediate shutdown on failure, before deleting its private directory on success. Failed runs retain diagnostics.

Native readiness is **0/2 run** in this workspace. Syntax, the eight pins, CLI guardrails and the installed offline pg transaction-status API were checked. The fixture supplies a synthetic current reservation. WebSocket authentication, hosted pooler behavior, real billing/entitlements, and restart reconciliation are outside these two races.
