# BLOCKED

Append new entries at the top. Format: DESIGN.md Section 14. Humans fill in "Decision".

```
## [Lane X] Short title (OPEN | RESOLVED)
- When: <UTC time>
- Task: <what you were doing>
- Expected: <what this doc said would happen>
- Actual: <exact error or response, secrets redacted>
- Evidence: <file in evidence/>
- Options I see: <2-3 options>
- Meanwhile: <other unblocked task, or "waiting">
- Decision (filled by humans): <decision and date>
```

---

## [Lane B] No 11 Dec 2026 BTC option expiry on Deribit testnet (OPEN)
- When: 2026-11-17 23:45 UTC
- Task: preflight check for L1 (setup, before any lane started)
- Expected: DESIGN.md Section 1/6.2: "BTC call expiring 11 Dec 2026" on Deribit testnet
- Actual: `public/get_instruments?currency=BTC&kind=option` lists 18/19/20/21/27 NOV, 4 DEC, 25 DEC 2026, then 2027 expiries. No 11DEC26.
- Evidence: evidence/preflight-2026-11-17.json
- Options I see:
  1. Wait. Deribit usually lists Friday weeklies a few weeks ahead, so 11DEC26 may appear within days. Recheck daily.
  2. Use 25DEC26 (expires after the Fed decision; covers the event; costs more premium).
  3. Use 4DEC26 (cheaper, but expires before the Fed decision and breaks the thesis).
- Meanwhile: Lane B mocks and strategy code can use `BTC-11DEC26-<strike>-C` as a placeholder and select expiry at runtime.
- Decision (filled by humans):

## [Lane B] FED261211 not in Gemini sandbox (RESOLVED)
- When: 2026-11-17 22:00 UTC
- Actual: sandbox lists no economics events; mainnet lists FED261211 with HIKEGT25 at 0.02/0.07
- Decision: 2026-11-17. L3 split into L3a (Fed hedge, live mainnet quote, simulated position)
  and L3b (real sandbox NO on BTC2611302200 strike). See Section 1. Recheck sandbox daily.
