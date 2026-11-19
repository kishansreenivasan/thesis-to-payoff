# STATUS

One line per lane. Overwrite your own line after each task. Format: DESIGN.md Section 15.

```
Lane A | 2026-11-19 | Done: phase 2 tasks 7-11 merged to main; calibration, precheck/owner reset, owner wallet exports, Arc integration tests and README draft | Now: waiting for a live calibration run | Next: set up Derive credentials and open/fund the perp, then run calibration | Blocked: local Derive credentials and Arc rehearsal funding; vault check found 22 USDC (12 above reserve floor)
Lane B | 2026-11-19 | Done: venue adapters, strategy and smoke fixes merged to main; last smoke tests passed (Derive 9/9, Gemini 8/8) | Now: no code integration pending | Next: continue daily FED261211 sandbox check; 2026-11-19 returned Event not found (HTTP 404) | Blocked: event still unavailable in sandbox; authenticated local Derive setup is missing for private calls
Lane C | 2026-11-19 | Done: hosting config (Dockerfile, railway.json, one-process API+MCP+web), live demo controls with bearer, demo:open/demo:reset, dashboard panels 4-6, README/demo runbook/Devpost draft (PR from lane-b) | Now: waiting on Railway domain and Arc agent key | Next: verify hosted /api/health + MCP, full real-testnet rehearsal into evidence/ | Blocked: ARC_AGENT_PRIVATE_KEY missing from local .env; Railway domain/variables
```
