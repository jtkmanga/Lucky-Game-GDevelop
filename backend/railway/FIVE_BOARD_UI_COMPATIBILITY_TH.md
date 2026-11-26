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


## 2026-11-26 — Five-board server adapter wired, random selection intentionally OFF
- Added `backend/railway/multi-board-rules.cjs` in `df5081d51099555f01832cf810137cd809ea0895`. It retains original `Legacy.turn` for map 1, computes snake/ladder movements with the selected immutable map for IDs 2–5, chooses gift candidates based on the selected map, and persists `game.map` and versioned `game.board`. `create()` **defaults explicitly to map 1**. `selectRandomBoard()` is only a helper and is NOT called from matchmaking.
- Updated `backend/railway/rule-transition-guard.cjs` to validate against the room's selected and canonical map, not legacy map-1 constants, commit `08945c7bcf6d77df3795de0115b5b51581ab2ae9`.
- Railway `secure-server.cjs` now imports the adapter but keeps map 1 because dispatch invokes create without an alternate map ID (`14152907a85257f9f19016395cedcc1b9a026a22`).
- Build `tools/prepare_railway_secure.py` includes the board map catalog, adapter and guard (`6fac2d02225e96be9e76381f330f67afab74cace`).
- Created `qa/multi-board-rules.test.cjs` to cover all five board layouts, map-1 compatibility, movement, timeout, and invalid map checkpoints (commit `119ea5aa2fe15867633d94e60c83bed6472bd23c`). **NOT EXECUTED**.
- **Still blocked:** Original ZIP's `public/index.html` hardcodes snake and ladder rendering. A reviewed JS-only client bridge must consume `game.board` for `renderBoard()` and `animateTurn()`, and be validated before random selection can be enabled. Existing HTML/CSS layout remains unchanged, no tests/deploy/migrations or new spending.


## 2026-11-26 — JS-only client marker, animation and SVG drawing bridge (NOT TESTED)
- Inspected **exact** `Lucky_Game_Multiplayer_Test_v1.zip` / `public/index.html` mounted source. The v12 board has not only `snakeStart`/`ladderStart` hardcoded in `renderBoard()`, but also static SVG `.snake-bodies`, `.snake-faces`, `.ladder-illustrations` and `travelSnakeBody()` which follows `snake-track[data-head][data-tail]`.
- `tools/prepare_railway_secure.py` now injects a script-only `luckyBoardLayout(game)` guard (validates `game.map`, `game.board`, ID, version, movement direction and map 1 original positions) into the generated HTML. `renderBoard()` uses the selected board's snake/ladder starting tiles; `animateTurn()` uses the same map to decide snake motion. For unknown/invalid online board states, `onlineApplyMessage()` refuses the update and closes the socket. No original ZIP HTML or CSS file was modified. Commit `6039b43c0f2e77bbc23cf5672e1d64bf45e4d08c`.
- Added `backend/railway/board-visual-bridge.js` (commit `9fb3848980bff21f72d5bf00fe2cc2ec3d27a27b`) to redraw only existing SVG groups for boards 2–5. It uses current v12 palette and existing group/container elements, regenerates one snake `snake-track` per mapped snake for token motion, keeps ladders aligned, and restores the untouched original group markup for board 1.
- The Railway build script injects this visual helper alongside the layout guard (commit `b9851041ea556c9b58ccbc2834dab182e0d63d2d`). **No runtime build, HTML output generation or browser execution was performed.**
- `qa/v12-board-visual-bridge.test.cjs` (commit `dcec43ba64761d33c106972d1f43aed45b4eba0f`) authored **only**, with virtual SVG DOM cases for maps 1–5 and restoration of original v12 SVG art. Does not validate real rendering or motion, and was NOT executed.
- **Still NOT activated:** Railway matchmaking continues to create map 1. Even after source bridge code is prepared, turning on random maps must wait for authorized build and browser/multiplayer checks covering room start, reconnect and all clients seeing identical map visual and state. The owner has NOT lifted testing/deploy pause; no SQL or paid changes.
