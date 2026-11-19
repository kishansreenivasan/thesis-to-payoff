# Lane C brief: shared types, orchestrator, MCP, dashboard, submission

Spec: DESIGN.md Sections 4 (Lane C), 5, 8 (monitoring loop), 9, 10, 11, 16, 17. This brief is a checklist, not a replacement.

## You own

`packages/shared/`, `packages/mcp/`, `apps/`, `scripts/`, `tests/integration/`, `fixtures/c/`, `README.md`, root config. Branch: `lane-c`.

## Tasks, in order

- [x] 1. Repo skeleton, pnpm workspace, `pnpm check`, `STATUS.md`, `BLOCKED.md`, `CHANGES.md`, `packages/shared` verbatim from Section 5, lane interfaces in `packages/shared/src/interfaces.ts`. (Done in the initial commit.)
- [ ] 2. Orchestrator + REST routes (Section 10) in `apps/api` against Lane A/B mocks. Make `pnpm demo:mock` (`scripts/demo-mock.ts`) run the full Section 16 script with mocks.
- [ ] 3. Execution coordinator (Section 9) and 10 s monitoring loop (Section 8). SQLite append-only events table.
- [ ] 4. Dashboard (Section 11) in `apps/web`, incl. `/approve/:requestId` with wagmi. Tailwind, Recharts, wagmi are not installed yet; add them.
- [ ] 5. MCP server in `packages/mcp` (tools in Section 10), bearer auth, deployed at `PUBLIC_BASE_URL`.
- [ ] 6. Flip `*_MODE=real` as lanes land. Integration tests in `tests/integration/` (Section 17 list).
- [ ] 7. README, demo script, video script, Devpost text, Grok chat export.
- [ ] 8. Extra after Thu 2 PM: Telegram alerts.

## Hand-offs from Lanes A and B (added 2026-11-18, in priority order)

Lane B's venues pass live smoke tests on Derive testnet and the Gemini sandbox (`evidence/derive-smoke.json`, `evidence/gemini-smoke.json`). Lane A's phase 2 is done. Details are in the last entries of `CHANGES.md`.

- [x] C1. **Flip `VENUES_MODE=real` and `STRATEGY_MODE=real`.** Live read-only quotes were verified for Derive testnet and both Gemini environments. Private Derive credentials are missing locally, so order execution remains disabled. `.env` has the Derive wallet, both subaccount IDs (main `88265`, perp `88268`) and the Gemini sandbox key. Before `buildPlan`, quote these:
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
- [ ] C9. **Deploy.** Blocked until a hosting project provides `PUBLIC_BASE_URL` and `MCP_BEARER_TOKEN`. Put API + MCP + web at `PUBLIC_BASE_URL` with `MCP_BEARER_TOKEN` once the humans create the host. Then tell them to add the connector in Grok.
- [ ] C10. **Rehearsal checks** (before each run-through):
  - `pnpm --filter @ttp/treasury precheck --strategy <strategyId>`: vault caps and balance
  - re-run `pnpm --filter @ttp/risk calibrate` once the perp is open: rescue band, with `--env-file` or `.env` loaded

  Latest precheck (2026-11-19): vault has 22 USDC, leaving 12 USDC above its reserve floor; current rehearsal expects up to 100 USDC. Calibration awaits Derive credentials and an open perp.

## Also yours

- Apply `CHANGES.md` requests to `packages/shared` (optional fields only).
- Keep `main` green: `pnpm check` and `pnpm demo:mock`.
- Add `demo:open` and `demo:reset` scripts (Section 9, 17).
