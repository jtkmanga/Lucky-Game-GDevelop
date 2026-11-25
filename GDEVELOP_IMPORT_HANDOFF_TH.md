# Lucky Game — GDevelop import handoff (25 November 2026)

## Checkpoint
**GDevelop Desktop package prepared, NOT opened/imported/saved to GDevelop Cloud.** Existing v12 UI preserved inside the project's `OriginalUIv12` scene through a JavaScript event and an HTML iframe. This is not a native rewrite of the original multiplayer gameplay.

## Source repository
`jtkmanga/Lucky-Game-GDevelop` (`main`), separate from the older Snakes-and-Ladders project.

## Prepare the import project in the existing Codespace
One command (prepares files only; no tests, deployments, GDevelop login or game execution):

```bash
cd /workspaces/Lucky-Game-GDevelop && git pull --ff-only origin main && bash tools/prepare_gdevelop_import.sh
```

The script generates and extracts the v3 archive and prints the exact path to the GDevelop Desktop JSON project. Expected path:

```
/workspaces/Lucky-Game-GDevelop/gdevelop-import/LuckyGame_GDevelop_Multiplayer_Preview/LuckyGame_GDevelop_Multiplayer_Preview.json
```

In an **authorized GDevelop Desktop** session, select File → Open and choose that JSON. Keep the adjacent `assets` directory. Opening and saving in GDevelop Cloud is **not accomplished by this script**, and no Cloud API is available through the current integrations.

## WebSocket preview caveat
The embedded HTML assumes a `/ws` endpoint at its preview host unless `?lucky_ws=<URL-encoded-wss-endpoint>` is appended to the preview URL. Only use an explicitly controlled **test** endpoint (e.g., a running Codespace's port 8081 with permission). The ZIP's standalone server is still guest-only and cannot enforce payment or VIP access. It is not wired to `backend/` Firebase, D1, and coordinator modules.

## Safety / completion criteria
- No GDevelop cloud save, gd.games publish, or Production launch has been performed.
- No new test runs performed (owner paused all testing).
- The package is a preview bridge, not a native GDevelop multiplayer implementation; changing the engine architecture requires separate integration work.
- The repository is public: NEVER commit service-account keys, access tokens, or payment secrets.
- Any valid claim of actual import requires the GDevelop editor to open the JSON and show the scene, followed by confirmation that the project was saved into the intended GDevelop account.
