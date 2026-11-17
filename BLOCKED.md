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

## [Lane B] FED261211 not in Gemini sandbox (RESOLVED)
- When: 2026-11-17 22:00 UTC
- Actual: sandbox lists no economics events; mainnet lists FED261211 with HIKEGT25 at 0.02/0.07
- Decision: 2026-11-17. L3 split into L3a (Fed hedge, live mainnet quote, simulated position)
  and L3b (real sandbox NO on BTC2611302200 strike). See Section 1. Recheck sandbox daily.
