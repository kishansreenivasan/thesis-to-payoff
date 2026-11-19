# Lane C brief: shared types, orchestrator, MCP, dashboard, submission

Spec: DESIGN.md Sections 4 (Lane C), 5, 8 (monitoring loop), 9, 10, 11, 16, 17. This brief is a checklist, not a replacement.

## You own

`packages/shared/`, `packages/mcp/`, `apps/`, `scripts/`, `tests/integration/`, `fixtures/c/`, `README.md`, root config. Branch: `lane-c`.

## Current status (2026-11-19)

Lane A and Lane B work is in `main`. Lane C's coordinator, monitoring/event log, and MCP HTTP transport are merged in [PR #26](https://github.com/kishansreenivasan/thesis-to-payoff/pull/26); its CI checks passed.

- C1-C8: implemented and merged. Live venue validation used public/read-only quotes; authenticated Derive trading is not configured locally.
- C9: transport and bearer auth are implemented and merged; hosting, public URL, and Grok connector setup remain.
- C10: partially complete. Arc precheck on 2026-11-19 found 22 USDC balance (12 above reserve), 50 USDC daily-cap room, and 119 USDC strategy-cap room; vault balance is short of the up-to-100-USDC rehearsal need. Live calibration needs Derive signing credentials and an open perp.

Remaining work is hosting, live testnet setup/rehearsal, and submission materials; optional Telegram alerts remain out of scope until credentials are available.

Do any follow-up work on a branch based on the latest `main`.

## Tasks, in order

- [x] 1. Repo skeleton, pnpm workspace, `pnpm check`, `STATUS.md`, `BLOCKED.md`, `CHANGES.md`, `packages/shared` verbatim from Section 5, lane interfaces in `packages/shared/src/interfaces.ts`. (Done in the initial commit.)
- [x] 2. Orchestrator + REST routes (Section 10) in `apps/api` against Lane A/B mocks. `pnpm demo:mock` runs the mock rescue flow; real quote reads are integrated.
- [x] 3. Execution coordinator and 10 s monitoring loop, with SQLite append-only activity events, are implemented and merged; the mock integration flow passes. Live execution still needs Derive credentials and careful rehearsal.
- [x] 4. Dashboard and `/approve/:requestId` owner wallet page are implemented. The page uses Wagmi and inline styling; polish beyond the required handoff remains optional.
- [x] 5. Stateless MCP HTTP transport and bearer auth are implemented and merged; mock tool flow passes. Hosting configuration and deployment at `PUBLIC_BASE_URL` remain open.
- [x] 6. Real read-only quote integration and mock-mode integration tests are in place. Authenticated live order execution remains blocked on credentials.
- [x] 7. README and mock demo script are updated.
- [ ] 8. Video script, Devpost text and Grok chat export.
- [ ] 9. Extra: Telegram alerts, if time and credentials are available.

## Hand-offs from Lanes A and B (added 2026-11-18, in priority order)

Lane B's venues pass live smoke tests on Derive testnet and the Gemini sandbox (`evidence/derive-smoke.json`, `evidence/gemini-smoke.json`). Lane A's phase 2 is done. Details are in the last entries of `CHANGES.md`.

- [x] C1. **Flip `VENUES_MODE=real` and `STRATEGY_MODE=real`.** Live read-only quotes were verified for Derive testnet and both Gemini environments. Private Derive credentials are missing locally, so order execution remains disabled. Lane B previously funded test subaccounts (main `88265`, perp `88268`), but the local `.env` still needs the current Derive credentials/IDs before authenticated calls work. Before `buildPlan`, quote these:
  - the L1 strikes from `listCalls(L1_EXPIRY_PREFERENCE)` (`@ttp/venues`, `@ttp/strategy`)
  - `BTC-PERP`
  - `GEMI-FED261211-HIKEGT25` on **mainnet**
  - the `BTC2611302200` contracts on the **sandbox** (`discoverGeminiEvents("sandbox", "BTC2611302200")`)
- [x] C2. **Wire `compile_thesis` to Grok's fields.** In `packages/mcp`, set the tool's `inputSchema` to `COMPILE_THESIS_INPUT_SCHEMA` and call `intentFromGrok(args)`, both from `@ttp/strategy`. No LLM on the server.
- [x] C3. **Replace the `"DERIBIT"` literals in `apps/api/src/app.ts` with `"DERIVE"`.** The venues alias is temporary.
- [x] C4. **Persist `venueOrderId` with each `clientOrderId`.** SQLite stores order requests and responses, including both IDs, and recovers saved positions after restart. Gemini has no client-id lookup, and Derive's read API lags writes. Use the stored id after a restart.
- [x] C5. **Owner approval page.** Use Lane A's browser-safe exports from `@ttp/treasury/owner`: `arcTestnet`, `vaultAbi`, `buildApproveRequestCall`.
- [x] C6. **README.** Paste `docs/agents/lane-a-readme-draft.md` (vault address, Arc tx links, Arc quirks). Add a venues section covering:
  - Derive testnet for L1/L2 (replaced Deribit; see BLOCKED.md)
  - Gemini sandbox for L3b, plus the live mainnet Fed quote for L3a
  - links to both smoke evidence files
- [x] C7. **Price labels.** Derive's testnet BTC index (about 62,500) differs from Gemini's sandbox BTC price. Show each with its source badge.
- [x] C8. **Housekeeping.** Delete `apps/web/tsconfig.tsbuildinfo` and add `*.tsbuildinfo` to `.gitignore`. It changes on every typecheck and causes merge conflicts.
- [ ] C9. **Deploy.** Configure a hosting project with `PUBLIC_BASE_URL` and `MCP_BEARER_TOKEN`, deploy API + MCP + web, and tell the team to add the connector in Grok. The HTTP transport and bearer auth are implemented and locally validated.
- [ ] C10. **Rehearsal checks** (before each run-through):
  - `pnpm --filter @ttp/treasury precheck --strategy <strategyId>`: vault caps and balance
  - re-run `pnpm --filter @ttp/risk calibrate` once the perp is open: rescue band, with `--env-file` or `.env` loaded

  Latest precheck (2026-11-19): vault has 22 USDC, leaving 12 USDC above its reserve floor; current rehearsal expects up to 100 USDC. Calibration awaits Derive credentials and an open perp.

## Also yours

- Apply `CHANGES.md` requests to `packages/shared` (optional fields only).
- Keep `main` green: `pnpm check` and `pnpm demo:mock`.
- Add `demo:open` and `demo:reset` scripts (Section 9, 17).
