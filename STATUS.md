# STATUS

One line per lane. Overwrite your own line after each task. Format: DESIGN.md Section 15.

```
Lane A | 2026-11-18 21:35 UTC | Done: all 4 required evidence txs real on Arc testnet (allowed release, over-limit revert, request+approve+execute, pause/unpause) - evidence/arc-*.json | Now: real packages/treasury with viem | Next: README needs vault address + tx hashes (Lane C, Section 17); recheck strategyId once real parseThesis lands (hash is over the LLM intent, not fixed) | Blocked: none
Lane B | 2026-11-18 01:30 UTC | Done: authenticated Deribit + Gemini adapters from docs (19 adapter tests), smoke script | Now: waiting on keys (human items 1-3) | Next: run `pnpm --filter @ttp/venues smoke`, fix anything it finds | Blocked: none. Daily: 11DEC26 not listed; FED261211 not in sandbox
Lane C | 2026-11-18 | Owner: Sid | Done: repo skeleton, shared schemas, lane interfaces, compile/quote routes, version-bound approval, ordered mock execution, risk shock and treasury approval/reduce-only rescue flow | Now: persistent events, monitoring and dashboard integration | Next: real adapters after credentials | Blocked: none for mock flow
```
