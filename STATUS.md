# STATUS

One line per lane. Overwrite your own line after each task. Format: DESIGN.md Section 15.

```
Lane A | 2026-11-19 | Done: phase 2 tasks 7-11 merged to main; calibration, precheck/owner reset, owner wallet exports, Arc integration tests and README draft | Now: waiting for a live calibration run | Next: set up Derive credentials and open/fund the perp, then run calibration | Blocked: local Derive credentials and Arc rehearsal funding; vault check found 22 USDC (12 above reserve floor)
Lane B | 2026-11-19 | Done: venue adapters, strategy and smoke fixes merged to main; last smoke tests passed (Derive 9/9, Gemini 8/8) | Now: no code integration pending | Next: continue daily FED261211 sandbox check; 2026-11-19 returned Event not found (HTTP 404) | Blocked: event still unavailable in sandbox; authenticated local Derive setup is missing for private calls
Lane C | 2026-11-20 00:20 UTC | Done: Railway service `ttp` at https://ttp-production-7410ea00.up.railway.app in full real mode (volume at /app/data), health/dashboard/approve/MCP-with-bearer verified; full real-testnet rehearsal in evidence/rehearsal-2026-11-19-*; Derive flattened | Now: waiting for Gemini sandbox L3b liquidity | Next: demo:open about 10 min before the demo; Grok connector + chat export | Blocked: BTC2611302200 sandbox has no YES bids (BLOCKED.md); vault 12 USDC releasable
```
