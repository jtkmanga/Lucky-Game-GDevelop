# Lucky Game — Five-board source catalog and UI v12 compatibility gate
Updated: 2026-11-26 (Asia/Bangkok)
**SOURCE ONLY / NOT TESTED / NOT ACTIVATED / NO UI REDESIGN**

## Board definitions
- `backend/railway/board-maps.cjs` includes five board definitions (IDs 1–5). Board 1 is the unmodified legacy `Rules.SNAKES`/`Rules.LADDERS` mapping; maps 2–5 have independently defined entries and exits. Data is immutable in code, with functions `getBoard(id)`, `pickBoard(rng)`, `eligibleGiftTiles(board)`, `validate(board)`.
- Catalog introduced `5e747d5a7c9d8bc4afa0b191fd2c0b57efe57e15`, collision adjustment `1e76b24802a54ce36e236e176939778a852c1c9d`.
- `qa/five-board-catalog.test.cjs` added in `b3f02a47be4bcc0b70d5d62e56466c89b3063974`; authored, NOT RUN.
- **Do not assume maps work in multiplayer yet.** The selected `secure-server.cjs` still uses the original `Rules.create/turn` and `rule-transition-guard.cjs` still refers to original snake/ladder maps. No random map is selected or enforced at runtime.

## Exact v12 UI compatibility findings from original ZIP `public/index.html`
1. `renderBoard()` currently hardcodes `snakeStart=[98,94,80,59,37]` and `ladderStart=[4,11,28,43,62,71]`; changing game-state `map` alone would render the wrong board.
2. `animateTurn()` checks `LuckyRules.SNAKES` (fixed legacy mapping) to distinguish snake travel. It must use the same map selected by the server.
3. `onlineApplyMessage()` receives `msg.game`, assigns `localGame=msg.game`, calls `renderBoard()`; this is the existing same-board-for-all-clients path. The game state must carry map ID plus the full server-approved snake/ladder mapping (or a strictly versioned catalog hash), and client must reject unknown mappings instead of assuming map 1.
4. The v12 online UI and local test mode both use the same board drawing functions. Updating the internal source bridge must not change visual layout/colors/positions of components, only the content of special tile markers and movement tracks.
5. Original rules module `backend/railway/rules.js` remains byte-equivalent to baseline ZIP and the current Railway build script checks equality; preserve this guard until an explicit reviewed migration of server/client rules. Do not silently overwrite original ZIP or UI.

## Safe source integration order (not yet executed)
1. Add a versioned map ID + board definition to initial persisted room state. Choose one map once, with server random, not on every turn. Gift tile selection must use the selected map's starts AND destinations.
2. Introduce an authoritative multi-board rules wrapper or reviewed rules-engine refactor: use the selected map for snake/ladder traversal and reward; keep overshoot win +10, one gift, Free 4/VIP 2 and skip timer. Rule-transition guard must use the selected map from the same trusted room checkpoint.
3. Apply a minimal JavaScript-only bridge to the generated v12 HTML so `renderBoard()` and `animateTurn()` both consume that map. Keep visual markup and CSS unchanged.
4. Persist selected board in PostgreSQL `game_state` and every room resume event. Verify original map 1 remains visually identical; ensure all sockets in a room see the same definition, and reject mismatches.
5. After owner separately unpauses tests, verify all five boards, cross-device synchronization, reconnect, snake/ladder animation and Lucky Box placement against the authoritative server state. Only then mark the five-board P2 item done.
6. Never activate server-only random maps before client compatibility is ready. No DB migration or deploy from this plan alone.

## Remaining blocked gates
UI v12 frozen; no SQL 001–003 installed, no tests permitted, no Railway deployed, no live Google auth, no Admin/payments, no 10K CCU evidence. Overall reported estimate remains **18%** according to `PROJECT_PROGRESS_METHOD_TH.md`.
