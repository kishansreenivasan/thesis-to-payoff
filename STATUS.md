# STATUS

One line per lane. Overwrite your own line after each task. Format: DESIGN.md Section 15.

```
Lane A | 2026-11-19 | Done: phase 2 tasks 7-11 merged to main; calibration, precheck/owner reset, owner wallet exports, Arc integration tests and README draft | Now: waiting for a live calibration run | Next: set up Derive credentials and open/fund the perp, then run calibration | Blocked: local Derive credentials and Arc rehearsal funding; vault check found 22 USDC (12 above reserve floor)
Lane B | 2026-11-19 | Done: venue adapters, strategy and smoke fixes merged to main; last smoke tests passed (Derive 9/9, Gemini 8/8) | Now: no code integration pending | Next: continue daily FED261211 sandbox check; 2026-11-19 returned Event not found (HTTP 404) | Blocked: event still unavailable in sandbox; authenticated local Derive setup is missing for private calls
Lane C | 2026-11-19 | Owner: Sid | Done: handoff C1-C8 merged to main in PR #23; read-only live quotes, MCP thesis schema/handler, Derive IDs, SQLite persistence, owner approval page, dashboard labels and README | Now: execution coordinator/real order integration, 10 s monitoring loop/event log, hosted MCP HTTP transport/deployment | Next: build the unblocked monitoring and order work; configure host URL/token and Derive credentials; fund Arc vault; run calibration and rehearsal | Blocked: hosted transport needs a host URL/token; live calls need local Derive credentials; rehearsal needs Arc test USDC
```
