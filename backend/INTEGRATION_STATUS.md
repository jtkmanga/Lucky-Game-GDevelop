# Authentication and VIP access integration — implementation checkpoint

Date: 2026-11-25
Status: **code drafted; NOT integrated, NOT tested, NOT deployed**

## Owner instruction
Skip all system testing for now. Do not run GitHub Actions manually, Codespaces testing, bots, load tests, or manual mobile sessions. Existing previously verified results remain historical evidence only. Do not mark new modules as tested or production ready.

## Implemented (non-invasive additions)
- `backend/auth/firebase-id-token.cjs`: verify Firebase Authentication ID token signature with Google's Firebase Secure Token public certificates, reject wrong audience/issuer, expired tokens, missing identity, and malformed tokens. Requires trusted server-side `FIREBASE_PROJECT_ID`.
- `backend/auth/room-access.cjs`: authorize Free for verified identities; require an active, unexpired VIP entitlement retrieved by a trusted server-side storage adapter for VIP. VIP access fails closed when the adapter is missing or returns an error.
- Neither file is yet imported by `Lucky_Game_Multiplayer_Test_v1.zip` / the running `server.js`, so the current WebSocket server still accepts guest players and unverified VIP users. Do **not** use its public link as a secure production lobby.

## Required wiring (still pending)
1. Recover the server sources from the ZIP into source-controlled text files. Review join and resume handlers.
2. At every online WebSocket join: obtain Firebase ID token from client SDK; call `requirePlayerIdentity({idToken}, {projectId:process.env.FIREBASE_PROJECT_ID})`; reject invalid claims; use the returned `uid` as the identity key (never trust client-supplied `uid`).
3. Before matching a VIP room call `requireRoomAccess(identity,'vip', storage)`. Provide `storage.getVipEntitlement(uid)` from trusted server-side persistent storage, not from client input. Do not infer paid access from the UI.
4. Bind resume/reconnect session to the verified `uid` and room/seat; expire tokens appropriately. Consider Firebase revocation-check strategy with Admin SDK if account disabling/revocation is required.
5. Add persistent player records, score ledger, room state snapshots, and reset jobs. No persistence exists in the current in-memory test server.
6. Ensure authentication configuration exists in the chosen host, then **separately authorize** staging deployment and verify before real player launch.

## Constraints / caveats
- Verification here is cryptographic, not an online revocation check. The module does not independently validate Firebase refresh-token revocation, Google provider identity or email-verification policy.
- Server cert retrieval needs outbound HTTPS access and a recent system clock. Certificate errors reject access.
- Verified identity does not confer VIP, ownership of purchased items, or payment settlement.
- New modules have **not** been executed or tested under the owner's pause instruction. Avoid declaring authentication or VIP complete.
- Preserve all existing UI layout/colors and keep the original Cloudflare game separate. No new costs, no production changes.
