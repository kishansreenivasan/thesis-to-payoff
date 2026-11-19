# STATUS

One line per lane. Overwrite your own line after each task. Format: DESIGN.md Section 15.

```
Lane A | 2026-11-19 | Done: phase 2 tasks 7-11 merged to main; calibration, precheck/owner reset, owner wallet exports and Arc integration tests | Now: waiting for a live calibration run | Next: configure Derive credentials and open the perp, then calibrate | Blocked: authenticated Derive setup; Arc vault has 22 USDC, with 12 USDC above its reserve floor
Lane B | 2026-11-19 | Done: venue adapters, strategy and smoke fixes merged to main; last smoke tests passed (Derive 9/9, Gemini 8/8) | Now: no code integration pending | Next: continue the daily FED261211 sandbox check | Blocked: event returned HTTP 404 on 2026-11-19; authenticated Derive setup is needed for private calls
Lane C | 2026-11-19 | Owner: Sid | Done: PR #26 merged; execution coordinator, 10 s monitoring/event log and authenticated stateless MCP transport pass mock checks; CI passed | Now: hosting, live testnet configuration and rehearsal | Next: configure host URL/token and Derive credentials; fund Arc vault; run calibration and rehearsal | Blocked: hosted deployment needs project URL/token; rehearsal needs authenticated Derive access and more Arc test USDC
```
