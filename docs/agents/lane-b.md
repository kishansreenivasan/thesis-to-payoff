# Lane B brief: venues, pricing, strategy

Spec: DESIGN.md Sections 1 (legs), 4 (Lane B), 5, 6, 8 (budget), 10 (unsupported theses). This brief is a checklist, not a replacement.

## You own

`packages/venues/`, `packages/strategy/`, `fixtures/b/`. Branch: `lane-b`.

## You export (signatures in `packages/shared/src/interfaces.ts`)

- `@ttp/venues` implements `VenuesApi`: `discoverGeminiEvents`, `getQuote`, `placeOrder`, `getOrder`, `cancelOrder`, `getPositions`, `getMargin`, `getIndexPrice`.
- `@ttp/strategy` implements `StrategyApi`: `parseThesis`, `buildPlan`, `payoffGrid`.

Selected by `VENUES_MODE` and `STRATEGY_MODE` (`mock` default, `real`).

## Tasks, in order

- [ ] 1. `packages/venues/src/mock.ts` and `packages/strategy/src/mock.ts`. Realistic fixed data for all four legs (L1, L2, L3a, L3b), `source: "SIMULATED"`. Wire into `src/index.ts`. Merge. **Others are waiting on this.**
  - Venues mock `getMargin("perp")` should return a ratio around 2.4 so a -15% shock pushes the projection below 1.5.
- [ ] 2. Gemini adapter: mainnet read-only discovery + quotes; sandbox auth, order, status, positions, cancel.
- [ ] 3. Deribit adapter: instruments, book, account summary (main + perp), buy, sell with `reduce_only`, positions, cancel, index price.
- [ ] 4. Smoke tests → `evidence/gemini-smoke.json`, `evidence/deribit-smoke.json` (redacted).
- [ ] 5. `parseThesis` (Anthropic API, structured output into `ThesisIntent` only), `buildPlan`, `payoffGrid`, with unit tests.
- [ ] 6. Daily: does Gemini sandbox list `FED261211`? Record in `STATUS.md`.

## Start conditions

Tasks 1 and 5: now. Tasks 2 to 4: when Gemini and Deribit keys are in `.env`.

## Reminders

- Verify every endpoint against official docs first. Differences go in `CHANGES.md`; missing features go in `BLOCKED.md`.
- Testnet only: cross the spread to fill; cancel after 30 s and report `REJECTED` / `NO_FILL`.
- Note in `CHANGES.md` which perp you used for L2 (linear USDC perp vs `BTC-PERPETUAL`).
- The LLM never sets numbers. `buildPlan` is deterministic and respects the $500 budget table.
