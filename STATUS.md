# STATUS

One line per lane. Overwrite your own line after each task. Format: DESIGN.md Section 15.

```
Lane A | 2026-11-19 | Done: phase 2 tasks 7-11 merged to main; calibration, precheck/owner reset, owner wallet exports, Arc integration tests and README draft | Now: waiting for a live calibration run | Next: set up Derive credentials and open/fund the perp, then run calibration | Blocked: local Derive credentials and Arc rehearsal funding; vault check found 22 USDC (12 above reserve floor)
Lane B | 2026-11-19 | Done: venue adapters, strategy and smoke fixes merged to main; last smoke tests passed (Derive 9/9, Gemini 8/8) | Now: no code integration pending | Next: continue daily FED261211 sandbox check; 2026-11-19 returned Event not found (HTTP 404) | Blocked: event still unavailable in sandbox; authenticated local Derive setup is missing for private calls
Lane C | 2026-11-20 00:39 UTC | Owner: Sid | Done: PR #28 hosting and real rehearsal integrated; Convex dashboard/logo and README; updated Devpost, status and teammate Grok handoff | Now: teammate Grok acceptance/export and final demo assets | Next: teammate confirms Grok tools and supplies chat export; screenshots/video; fresh demo only when ready | Blocked: checked Gemini BTC sandbox books lack YES bids; last vault read left 12 USDC above reserve
```
