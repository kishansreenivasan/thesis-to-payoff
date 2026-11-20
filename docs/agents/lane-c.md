# Lane C brief: shared types, orchestrator, MCP, dashboard, submission

Spec: DESIGN.md Sections 4 (Lane C), 5, 8 (monitoring loop), 9, 10, 11, 16, 17. This brief is a checklist, not a replacement.

## You own

`packages/shared/`, `packages/mcp/`, `apps/`, `scripts/`, `tests/integration/`, `fixtures/c/`, `README.md`, root config. Branch: `lane-c`.

## Current status

**Owner: Sid. Product: Convex.** Lane A/B implementation and Lane C hosting/demo-readiness work are merged through PR #28. `lane-c` has been brought up to the current `main` baseline. Product naming does not rename existing workspace packages, repository URLs or deployed contracts.

- C1-C8: implemented and merged; required local credentials are populated, and the real testnet/sandbox rehearsal is recorded.
- C9: Railway dashboard/API/MCP are deployed at https://ttp-production-7410ea00.up.railway.app. Health and authenticated MCP tool listing are verified. Grok thesis/status acceptance and the Markdown chat transcript are complete: [GROK-HANDOFF.md](../GROK-HANDOFF.md). No Grok/xAI API key is needed.
- C10: rehearsal and calibration evidence exists in `evidence/rehearsal-2026-11-19-*`. Repeat readiness is still conditional: the checked Gemini BTC books lack YES bids, and the last Arc read left 12 USDC releasable above reserve. The recorded Derive position was flattened afterward.

Remaining: liquidity/funding for a fresh staged demo, final screenshots/video and submission. The Grok acceptance returned no open position; showing a pending request in that chat remains a staged-demo check. Historical Lane A/B status lines may still mention missing credentials; use the current evidence and [HUMAN-TODO.md](../HUMAN-TODO.md).

Do follow-up work on a branch based on the latest `main`.

## Tasks, in order

- [x] 1. Repo skeleton, pnpm workspace, `pnpm check`, `STATUS.md`, `BLOCKED.md`, `CHANGES.md`, `packages/shared` verbatim from Section 5, lane interfaces in `packages/shared/src/interfaces.ts`. (Done in the initial commit.)
- [x] 2. Orchestrator + REST routes (Section 10) in `apps/api` against Lane A/B mocks. `pnpm demo:mock` runs the mock rescue flow; real quote reads are integrated.
- [x] 3. Execution coordinator, 10 s monitoring loop and SQLite activity log are merged; mock integration and recorded real testnet/sandbox rehearsal evidence exist.
- [x] 4. Dashboard and `/approve/:requestId` owner wallet page are implemented. The page uses Wagmi and inline styling; polish beyond the required handoff remains optional.
- [x] 5. Stateless MCP HTTP transport and bearer auth are hosted; authenticated tool listing is verified. Grok thesis/status calls and a Markdown UI transcript are now recorded.
- [x] 6. Real quotes and authenticated testnet/sandbox fills are recorded, alongside mock integration tests. Fresh execution depends on available liquidity.
- [x] 7. README, demo runbook and video script (`docs/DEMO-SCRIPT.md`), Devpost draft (`docs/DEVPOST.md`). Grok UI transcript is recorded in `evidence/grok-chat-2026-11-19.md`.
- [ ] 8. Extra after Thu 2 PM: Telegram alerts.

## Hand-offs from Lanes A and B (added 2026-11-18, in priority order)

Lane B's venues pass live smoke tests on Derive testnet and the Gemini sandbox (`evidence/derive-smoke.json`, `evidence/gemini-smoke.json`). Lane A's phase 2 is done. Details are in the last entries of `CHANGES.md`.

- [x] C1. **Real venue/strategy integration.** Required local credentials and IDs are populated. Earlier Lane B smoke tests and the recorded coordinated rehearsal demonstrate authenticated calls. Rehearsal accounts were main `88265` and perp `88268`; use current environment settings. Before `buildPlan`, quote:
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
- [x] C9. **Deploy.** Dockerfile, Railway service and persistent data configuration are in place; dashboard/health and authenticated MCP tools have been verified. Grok conversational acceptance and transcript are complete via [the handoff](../GROK-HANDOFF.md).
- [x] C10. **Initial rehearsal checks.** Calibration and open/rescue recordings are committed. Before each new run, repeat treasury precheck and risk calibration on the actual strategy/position. Prior calibration projected 1.3226 under a simulated -15% shock; the last vault read found only 12 USDC releasable. Fresh opening is currently blocked by sandbox liquidity.

## Also yours

- Apply `CHANGES.md` requests to `packages/shared` (optional fields only).
- Keep `main` green: `pnpm check` and `pnpm demo:mock`.
- `demo:open` and `demo:reset` are implemented. Follow the liquidity warning in `docs/DEMO-SCRIPT.md`; do not reset an already-open demo unnecessarily.
