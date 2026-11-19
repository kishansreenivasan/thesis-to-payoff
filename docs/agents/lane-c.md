# Lane C brief: shared types, orchestrator, MCP, dashboard, submission

Spec: DESIGN.md Sections 4 (Lane C), 5, 8 (monitoring loop), 9, 10, 11, 16, 17. This brief is a checklist, not a replacement.

## You own

`packages/shared/`, `packages/mcp/`, `apps/`, `scripts/`, `tests/integration/`, `fixtures/c/`, `README.md`, root config. Branch: `lane-c`.

## Current status (2026-11-19)

The Lane C handoff work C1-C8 is merged into `main` in [PR #23](https://github.com/kishansreenivasan/thesis-to-payoff/pull/23). Lane A and Lane B implementation branches are already ancestors of `main`; no additional code from those branches needs to be cherry-picked.

- C1-C8: implemented and merged. Live venue validation used public/read-only quotes; authenticated Derive trading is not configured locally.
- C9: open. The compile-thesis tool schema/handler exists, but the MCP HTTP transport and deployment remain to be built/configured. Needs a host URL and bearer token.
- C10: partially complete. Arc precheck ran on 2026-11-19: 22 USDC balance, 12 USDC above reserve floor, versus up to 100 USDC needed for the rehearsal. Live calibration still needs Derive signing credentials and an open perp.

Other Lane C scope still open: the 10-second monitoring/event loop and authenticated order coordination. These can be built against mocks while live credentials and hosting are pending.

Do any follow-up work on a branch based on the latest `main`.

## Tasks, in order

- [x] 1. Repo skeleton, pnpm workspace, `pnpm check`, `STATUS.md`, `BLOCKED.md`, `CHANGES.md`, `packages/shared` verbatim from Section 5, lane interfaces in `packages/shared/src/interfaces.ts`. (Done in the initial commit.)
- [x] 2. Orchestrator + REST routes (Section 10) in `apps/api` against Lane A/B mocks. `pnpm demo:mock` runs the mock rescue flow; real quote reads are integrated.
- [x] 3. Execution coordinator and 10 s monitoring loop, with SQLite append-only activity events, are implemented locally and pass the mock integration flow. Live execution still needs Derive credentials and careful rehearsal.
- [x] 4. Dashboard and `/approve/:requestId` owner wallet page are implemented. The page uses Wagmi and inline styling; polish beyond the required handoff remains optional.
- [x] 5. Stateless MCP HTTP transport and bearer auth are implemented locally; mock tool flow passes. Hosting configuration and deployment at `PUBLIC_BASE_URL` remain open.
- [x] 6. Real read-only quote integration and mock-mode integration tests are in place. Authenticated live order execution remains blocked on credentials.
- [x] 7. README, demo runbook and video script (`docs/DEMO-SCRIPT.md`), Devpost draft (`docs/DEVPOST.md`). Grok chat export remains (human, after the connector works).
- [ ] 8. Extra after Thu 2 PM: Telegram alerts.

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
- [ ] C9. **Deploy.** Config done (Dockerfile, railway.json, `apps/api/src/hosted.ts`); waiting on the Railway domain and variables. Configure a hosting project with `PUBLIC_BASE_URL` and `MCP_BEARER_TOKEN`, deploy API + MCP + web, and tell the team to add the connector in Grok. The HTTP transport and bearer auth are implemented and locally validated.
- [ ] C10. **Rehearsal checks** (before each run-through):
  - `pnpm --filter @ttp/treasury precheck --strategy <strategyId>`: vault caps and balance
  - re-run `pnpm --filter @ttp/risk calibrate` once the perp is open: rescue band, with `--env-file` or `.env` loaded

  Latest precheck (2026-11-19): vault has 22 USDC, leaving 12 USDC above its reserve floor; current rehearsal expects up to 100 USDC. Calibration awaits Derive credentials and an open perp.

## Also yours

- Apply `CHANGES.md` requests to `packages/shared` (optional fields only).
- Keep `main` green: `pnpm check` and `pnpm demo:mock`.
- Add `demo:open` and `demo:reset` scripts (Section 9, 17).
