# Room lease / restart reconciliation — implementation contract (draft, 2026-11-26)

**Status: source-only planning, NOT deployed, not migrated, NOT tested.** Current `backend/railway/secure-server.cjs` remains a **single-process** coordinator and is **NOT SAFE to scale to multiple Railway replicas**. Do not turn on more replicas or claim 10,000 CCU.

## New committed artifacts
- `backend/supabase/002_room_lease_draft.sql`: planned `game.rooms.lease_owner`, `lease_epoch`, `lease_until`, and recovery index. **Not applied**. Requires migration 001. Check schema first, because the named CHECK constraint isn't repeat-safe.
- `backend/supabase/room-lease-store.cjs`: uncalled helper for acquiring, renewing, releasing, listing recoverable rooms and guarded state update. Its `guardedCheckpoint` demonstrates fencing but does **NOT** write score awards and MUST NOT be used as a direct replacement for production `commitTurn`.

## Correct single-writer room lifecycle (required next)
1. Generate a random Railway instance owner UUID on process start; never trust user-submitted owner identifiers.
2. On room creation, persist state and seat UIDs in a transaction. Transition to playing with an owned lease, not an unaudited in-memory reservation. On ambiguous insert errors, query the specific room ID and quarantine until proven absent.
3. On restart or periodic sweep: read at most a bounded batch of expired/unowned playing rooms. **Only one process** may acquire a room: PostgreSQL conditional UPDATE against DB clock returns a new monotonic `lease_epoch`. Failed acquirer must not run a timer or broadcast.
4. Rebuild all seats and state from the claimed checkpoint. Validate distinct verified UIDs, mode, seats and revision. Keep room claim/heartbeat alive; use a cancellation path if renewing the lease fails.
5. Apply **EVERY** roll, timeout, winner/Lucky Box award and room closure in a single DB transaction: conditional room UPDATE must match `room_id`, `lease_owner`, `lease_epoch`, `lease_until>clock_timestamp()`, `revision` and `status='playing'`; insert idempotent score events in **same transaction**, COMMIT, then broadcast. A failed/unknown commit must halt the local room and reload canonical state before retry; never roll twice to reconcile.
6. On graceful shutdown release only your own lease+epoch. A crashed process naturally expires; do not delete user rooms or edit scores merely because WebSockets disconnect.
7. On resume, verified Supabase UID can only reclaim a matching persisted seat; if it is owned by another active worker, route to that worker or use a shared message bus. A local `Map` alone cannot find a live room on another Railway replica.
8. A scheduler can sweep without players connected, but cannot silently spin indefinitely over catch-up turns after a long outage. Define explicit catch-up policy and maximum transitions: avoid awarding winner/box through timeouts; keep a full event audit.
9. Matchmaking reservations are currently process-local. Durable pending reservations/uniqueness per active UID and creation idempotency must be enforced before multi-replica launch.
10. Bounded batches and rate-limits prevent database overuse or accidental credit exhaustion. Recovered rooms must be observed in metrics.

## Migration review / verification gates
- Confirm schema version on actual Supabase project and that private `game` schema is not exposed through PostgREST.
- Review SQL locks/constraint names, `auth.users.id` FK and secure DB role permissions. No client `anon` or `authenticated` table grants.
- Run tests **only after owner explicitly lifts pause**: two concurrent room acquirers, old owner renewal after lease loss, stale epoch update rejection, crash after commit but before broadcast, crash before commit, duplicate winner/box, room recovery with all clients offline, client rejoin across process restart, dead-room sweep, timeouts crossing an outage, DB unavailable. Record logs, SHA and any credit impact.
- Only afterward wire the lease into `secure-server.cjs` and `game-store.cjs`, with a **single atomic score + room transition**. Do NOT deploy incomplete components.
- Until validated use a single Railway replica (if deployment later approved), and note single replica alone does not guarantee successful restart recovery.

## Pending other gates
Supabase Google OAuth provider setup, application schema migration, Railway service/credentials, real payment and Admin, five random boards, and 100→1K→5K→10K staging-only load measurements all remain open.

## Last source commits
- `38dcf0d19e1b4609978de24924296f7905344e8c` — lease SQL draft
- `82c2794e5bd826c2ae90a9aaef43ffc4cbe30c73` — Node lease helper draft
