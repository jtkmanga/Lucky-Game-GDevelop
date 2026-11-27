# D14 Codespaces QA: 27 พ.ย. 2026

- Candidate checkout: `b03757c5b3c8ea82d96fba72a4baa671b2db99dd`, isolated temporary clone on existing GitHub Codespaces **2 Core**. No files from the original dirty worktree changed.
- PostgreSQL server 17.12, psql client 16 (used only to create the disposable test DB), Node 24.22.2, pg 8.23.1. Installed into scratch; local Unix socket only, no network listener and no live database. Seven input store/schema blobs verified before the run.
- Initial attempt stopped before the races: the Codespace created the socket directory mode 0756 although the wrapper set umask 077. Kept the ownership/mode check and explicitly created the isolated directory at mode 0700. Re-run exit code 0; disposable DB stopped.
  - **PASS blocked-turn:** closed, revision 1, 0 receipts, 0 awards.
  - **PASS win-first:** finished, revision 1, 1 receipt, 1 award.
  - **PASS close-first:** closed, revision 1, 0 receipts, 0 awards.
- Additional checks: **87/87 Node** (Free4/VIP controller/store, items, Admin command/adapter, previous standings, cross-track and SQLite sandbox); **PASS** native single-user SQL for VIP, item-reader roles, archived standings (4 calls and 20 denials), award period predicate (13 cases), and synthetic order ledger. VIP revoke/admit concurrency, authenticated pool/TLS, and real Google/hosted acceptance are not proven by those suites. No cash or provider.
- Build succeeded. HTML v12 SHA-256 `2f3e23aeb338c202a198b54aca4f7b30006ad2472aebc0a6aad47c9daeedef97` unchanged. Logs captured in test scratch: Free4 `319b9812dba76246a4907b8c7628faab6203c83683857d0c88fea50bdce007e8`; suites `9af911c48b9d74c464020281f10dd24116ede8ecc13e36215452b7c02104b0bc`.
- Billing before Resume: repository-only Codespaces hard-stop budget **$5**, separate from the existing account budget. Rate **$0.18/h** compute for 2 Core; **$0.07/GB-month** for storage. GitHub confirmed **Codespace stopped**; meter immediately after stop showed **$0.00/$5.00** and may lag; not a final invoice nor a statement that retained storage is free. No new Codespace or deployment.
