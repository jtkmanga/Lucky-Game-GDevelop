# Lucky Game — GDevelop import handoff (25 November 2026)

## Checkpoint
**GDevelop Desktop package prepared, NOT opened/imported/saved to GDevelop Cloud.** Existing v12 UI preserved inside the project's `OriginalUIv12` scene through a JavaScript event and an HTML iframe. This is not a native rewrite of the original multiplayer gameplay.

## Source repository
`jtkmanga/Lucky-Game-GDevelop` (`main`), separate from the older Snakes-and-Ladders project.

## Create import package in the existing Codespace
Single command (no game tests, deployment or authentication):

```bash
cd /workspaces/Lucky-Game-GDevelop && git pull --ff-only origin main && python3 tools/build_gdevelop_import.py && mkdir -p gdevelop-import && unzip -oq Lucky_Game_GDevelop_Multiplayer_Import_v3.zip -d gdevelop-import && echo "Open: /workspaces/Lucky-Game-GDevelop/gdevelop-import/LuckyGame_GDevelop_Multiplayer_Preview/LuckyGame_GDevelop_Multiplayer_Preview.json"
```

Inside GDevelop **Desktop** running in the Codespaces environment, use **File → Open** and choose that JSON file. Leave the adjacent `assets` folder in place. The project cannot be marked Cloud-imported until an authorized GDevelop editor session actually opens and saves it. GDevelop's desktop login previously stalled in the remote session; do not assume it is currently authenticated.

## WebSocket preview caveat
The embedded HTML assumes a `/ws` endpoint at its preview host unless `?lucky_ws=<URL-encoded-wss-endpoint>` is appended to the preview URL. Only use an explicitly controlled **test** endpoint (e.g., a running Codespace's port 8081 with permission). The ZIP's standalone server is still guest-only and cannot enforce payment or VIP access. It is not wired to `backend/` Firebase, D1, and coordinator modules.

## Safety / completion criteria
- No GDevelop cloud save, gd.games publish, or Production launch has been performed.
- No new test runs performed (owner paused all testing).
- The package is a preview bridge, not a native GDevelop multiplayer implementation; changing the engine architecture requires separate integration work.
- The repository is public: NEVER commit service-account keys, access tokens, or payment secrets.
- Any valid claim of actual import requires the GDevelop editor to open the JSON and show the scene, followed by confirmation that the project was saved into the intended GDevelop account.
