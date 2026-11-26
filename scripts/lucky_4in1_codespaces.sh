#!/usr/bin/env bash
# Lucky Game: one command, 4 workstreams, safe on existing Codespaces.
# Does NOT deploy, contact Supabase DB, open public ports, authenticate real Google accounts or enable payments.
set -uo pipefail
cd "$(dirname "$0")/.."
EXPECTED_BRANCH="feature/legacy-ui-railway-free4"
CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
 echo "STOP: must run on $EXPECTED_BRANCH; current=$CURRENT_BRANCH"; exit 2
fi
if ! command -v node >/dev/null || ! command -v python3 >/dev/null; then
 echo "STOP: Node.js and Python 3 are required"; exit 2
fi
BASE_SHA="$(git rev-parse HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_DIR="qa/reports/legacy-migration"
mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/$STAMP.md"
LOG="$REPORT_DIR/$STAMP.log"
printf "# Lucky Game V99 → Railway: single-run evidence\n\n- UTC: %s\n- Base SHA: \`%s\`\n- Branch: \`%s\`\n- No deploy / no Supabase writes / no Cloudflare runtime\n\n" "$STAMP" "$BASE_SHA" "$CURRENT_BRANCH" > "$REPORT"
printf "RUN %s at %s\n" "$CURRENT_BRANCH" "$BASE_SHA" > "$LOG"
PASS=0;FAIL=0;BLOCKED=0
run_step() {
 local name="$1"; shift
 echo "=== $name ===" | tee -a "$LOG"
 if "$@" >>"$LOG" 2>&1; then
  printf -- "- **PASS** — %s\n" "$name" >> "$REPORT"
  echo "PASS: $name"; PASS=$((PASS+1))
 else
  local status=$?
  printf -- "- **FAIL** (exit %s) — %s\n" "$status" "$name" >> "$REPORT"
  echo "FAIL: $name (exit=$status)"; FAIL=$((FAIL+1))
 fi
}
blocked() {
 printf -- "- **BLOCKED / NOT TESTED** — %s\n" "$1" >> "$REPORT"
 echo "BLOCKED: $1"; BLOCKED=$((BLOCKED+1))
}

echo "WORKSTREAM 1 — Source adapter, syntax and migration build"
run_step "Node syntax: Railway browser adapter" node --check migration/legacy-ui/railway-app.js
run_step "Node syntax: authoritative Railway server" node --check backend/railway/secure-server.cjs
run_step "Original UI DOM, Free4 and no public demo/payment source" node --test qa/legacy-ui-free4-source.test.cjs

echo "WORKSTREAM 2 — Five original V99 maps, rules, gifts and turn skip"
run_step "V99 5 maps + 4 players + snake/ladder/Lucky Box/timeout contract" node --test qa/legacy-v99-five-map.test.cjs
run_step "Board persistence and reconnect rule contract (local only)" node --test qa/room-board-reconnect-contract.test.cjs
# Do not silently claim full item parity: winner x2, snake shield and purchase entitlements
# require dedicated server authority and real end-to-end tests.
blocked "Original V99 win-x2 / snake-shield item parity: not yet migrated or end-to-end proven"

echo "WORKSTREAM 3 — Browser preview (real Chromium if already installed)"
# This is a LOCALHOST-ONLY compiled runtime, NOT the deployed public Staging.
run_step "Generate existing Railway runtime source and overlay original V99 frontend" bash -c '
  set -e
  python3 tools/prepare_railway_secure.py
  dest=railway-runtime/backend/railway/public
  test -d "$dest"
  cp migration/legacy-ui/index.html "$dest/index.html"
  cp migration/legacy-ui/style.css "$dest/style.css"
  cp migration/legacy-ui/railway-app.js "$dest/railway-app.js"
  test -s "$dest/index.html" && test -s "$dest/railway-app.js"
  node --check "$dest/railway-app.js"
'
if node -e "require.resolve('playwright')" >/dev/null 2>&1; then
 run_step "Real Chromium localhost browser render (mock Google/WS; NOT E2E)" node qa/legacy-ui-browser-smoke.cjs
else
 blocked "Chromium browser smoke: installed Playwright module unavailable (no new package installed)"
fi

echo "WORKSTREAM 4 — Real Google + 4 players + disconnect/rejoin + deploy gates"
blocked "Four DISTINCT actual Google accounts + true Supabase OAuth + Free 4/4 + turn sync: branch not deployed, human browser sessions required"
blocked "Actual disconnect/reconnect of 4 Google players and winner/score in Railway/Supabase: not executed"
blocked "Railway staging deploy: intentionally NOT performed; requires verified browser/E2E, item parity and cost check"
{
 printf "\n## Required live acceptance (owner's real browser; not a simulation)\n"
 printf '%s\n' '1. Open approved Railway Staging built from this branch only after controlled approval; no Cloudflare hosting.'
 printf '%s\n' '2. Login using 4 different Google accounts in 4 independent browser sessions. Verify the account email and persistent nickname after refresh.'
 printf '%s\n' '3. Free: all four join SAME room, exactly 4 unique seats, 4/4 state, same map/turn/dice for all.'
 printf '%s\n' '4. Exercise snake, ladder, Lucky Box, win and item entitlements with live server receipts; verify V99 parity.'
 printf '%s\n' '5. Disconnect and reconnect at least one Google session; verify same UID/seat/room/turn. Finish match and verify scores.'
 printf '%s\n' '6. Check Railway Trial usage and service resource consumption, then approve promotion or keep current deployment unchanged.'
 printf "\n## Summary\n"
 printf -- "- Automated PASS: %s\n- Automated FAIL: %s\n- BLOCKED / NOT TESTED: %s\n" "$PASS" "$FAIL" "$BLOCKED"
 printf -- "- Result: %s\n" "$([[ "$FAIL" -eq 0 && "$BLOCKED" -eq 0 ]] && echo 'FULL_PASS' || echo 'INCOMPLETE_DO_NOT_DEPLOY')"
} >> "$REPORT"
echo "=== SUMMARY ==="
echo "PASS=$PASS FAIL=$FAIL BLOCKED=$BLOCKED"
echo "REPORT=$REPORT LOG=$LOG"
echo "NO DEPLOY; NO GENUINE GOOGLE 4-PLAYER CLAIM."
# Upload only generated report/log; never stage source changes or secrets.
if git diff --cached --quiet && [[ -z "$(git status --porcelain --untracked-files=normal | grep -v "^?? qa/reports/legacy-migration/" || true)" ]]; then
 git add -- "$REPORT" "$LOG"
 if git diff --cached --quiet; then
  echo "REPORT_NOT_COMMITTED: ignored or unchanged"; exit 0
 fi
 if git commit -m "test(migration): record 4-in-1 Codespaces gates $STAMP"; then
  if git push origin "$EXPECTED_BRANCH"; then
   echo "GITHUB_EVIDENCE_PUSHED_SHA=$(git rev-parse HEAD)"
  else
   echo "GITHUB_PUSH_FAILED: commit exists locally. Check authentication; do not reset."
  fi
 else
  echo "GITHUB_COMMIT_FAILED: report retained locally"
 fi
else
 echo "GITHUB_UPLOAD_SKIPPED: existing local changes detected; no automatic staging to protect your work."
fi
