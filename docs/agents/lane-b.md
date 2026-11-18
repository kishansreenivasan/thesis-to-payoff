# Lane B brief: venues, pricing, strategy

Spec: DESIGN.md Sections 1 (legs), 4 (Lane B), 5, 6, 8 (budget), 10 (unsupported theses). This brief is a checklist, not a replacement.

## You own

`packages/venues/`, `packages/strategy/`, `fixtures/b/`. Branch: `lane-b`.

## You export (signatures in `packages/shared/src/interfaces.ts`)

- `@ttp/venues` implements `VenuesApi`: `discoverGeminiEvents`, `getQuote`, `placeOrder`, `getOrder`, `cancelOrder`, `getPositions`, `getMargin`, `getIndexPrice`.
- `@ttp/strategy` implements `StrategyApi`: `parseThesis`, `buildPlan`, `payoffGrid`.

Selected by `VENUES_MODE` and `STRATEGY_MODE` (`mock` default, `real`).

## Tasks, in order

- [x] 1. `packages/venues/src/mock.ts` and `packages/strategy/src/mock.ts`. Realistic fixed data for all four legs (L1, L2, L3a, L3b), `source: "SIMULATED"`. Wire into `src/index.ts`. Merge. **Others are waiting on this.**
  - Venues mock `getMargin("perp")` should return a ratio around 2.4 so a -15% shock pushes the projection below 1.5.
- [x] 2. (Built from docs; confirm with smoke test.) Gemini adapter: mainnet read-only discovery + quotes; sandbox auth, order, status, positions, cancel.
- [x] 3. (Built from docs; confirm with smoke test.) Derive adapter (replaced Deribit 2026-11-18): instruments, book, account summary (main + perp), buy, sell with `reduce_only`, positions, cancel, index price.
- [ ] 4. (Script ready: `pnpm --filter @ttp/venues smoke`; needs keys.) Smoke tests → `evidence/gemini-smoke.json`, `evidence/derive-smoke.json` (redacted).
- [x] 5. Thesis gate (`intentFromGrok` for Grok's `compile_thesis` fields, offline `parseThesis` for dashboard text; no LLM API), `buildPlan`, `payoffGrid`, with unit tests.
- [ ] 6. Daily: does Gemini sandbox list `FED261211`? Record in `STATUS.md`.

## Start conditions

Tasks 1 and 5: now. Tasks 2 to 4: when Gemini keys and the Derive wallet values are in `.env`.

## Reminders

- **L1/L2 venue (decided 2026-11-18):** Derive testnet, not Deribit. Instruments `BTC-YYYYMMDD-STRIKE-C` and `BTC-PERP`.
- **L1 strike (decided 2026-11-18):** at-the-money if the 0.01 BTC minimum fits the L1 budget, else the lowest out-of-the-money strike that fits. Quote strikes from `listCalls()` in `@ttp/venues`.
- **L3b strike (decided 2026-11-18):** highest strike at or below BTC with a YES bid, else the lowest strike above BTC. Size capped at NO liquidity.
- **L1 expiry (decided 2026-11-17, see BLOCKED.md):** prefer Dec 11 (`20261211`); until Derive activates it, use Dec 25 (`20261225`). Select at runtime, never hardcode. Recheck daily alongside the FED261211 check.
- Verify every endpoint against official docs first. Differences go in `CHANGES.md`; missing features go in `BLOCKED.md`.
- Testnet only: cross the spread to fill; cancel after 30 s and report `REJECTED` / `NO_FILL`.
- Note in `CHANGES.md` which perp you used for L2 (linear USDC perp vs `BTC-PERPETUAL`).
- No model output sets numbers. `buildPlan` is deterministic and respects the $500 budget table.
