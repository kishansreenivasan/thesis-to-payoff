# Lane A brief: Arc vault, treasury, risk engine

Spec: DESIGN.md Sections 4 (Lane A), 5, 7, 8. This brief is a checklist, not a replacement.

## You own

`contracts/`, `packages/treasury/`, `packages/risk/`, `fixtures/a/`. Branch: `lane-a`.

## You export (signatures in `packages/shared/src/interfaces.ts`)

- `@ttp/treasury` implements `TreasuryApi`: `getTreasuryStatus`, `releaseWithinLimits`, `requestRelease`, `getReleaseStatus`, `cancelRequest`, `watchVaultEvents`.
- `@ttp/risk` implements `RiskApi`: `evaluateRisk(input: RiskInput): RiskDecision`. Pure, no network.

Selected by `TREASURY_MODE` and `RISK_MODE` (`mock` default, `real`).

## Tasks, in order

- [x] 1. `packages/treasury/src/mock.ts` and `packages/risk/src/mock.ts`. Realistic fixed data, `source: "SIMULATED"`. Wire into `src/index.ts`. Merge. **Others are waiting on this.**
  - Treasury mock must reproduce the rescue: `releaseWithinLimits` of more than 25 USDC returns `REJECTED` with `reasonCode: "ExceedsPerTxCap"` and a fake tx hash; `requestRelease` returns `OWNER_APPROVAL_NEEDED`.
- [x] 2. `ThesisTreasuryVault` + forge tests (Section 7 required tests list, including the fuzz test). Run `forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std` first.
- [x] 3. Real `evaluateRisk` with Vitest tests for every row of the Section 8 threshold table.
- [x] 4. Deploy to Arc testnet (needs `ARC_AGENT_PRIVATE_KEY`, `ARC_OWNER_ADDRESS` in `.env`). Commit `contracts/deployments/arc-testnet.json` (address + tx hash).
- [x] 5. Real `packages/treasury` with viem.
- [x] 6. Evidence txs: allowed release, over-limit revert, request + approve + execute, pause → `evidence/arc-*.json`.

## Phase 2: protect the live demo (added 2026-11-18, in priority order)

Tasks 1 to 6 are done and merged into `main`. Phase 2 implementation tasks 7 to 11 are also merged. The remaining work is live calibration and rehearsal after the human setup items are complete.

- [x] 7. (script built and mock-tested; live calibration pending Derive credentials and an open perp) **Calibrate the -15% rescue band against Derive.** L1 and L2 moved to Derive testnet (see CHANGES.md). The demo needs the projected ratio after a -15% shock to land in [1.2, 1.5), so the agent tries the vault, reverts and requests approval, instead of jumping straight to DELEVERAGE.
  - **Rough numbers:** with the planned perp (`BTC-PERP`, about 0.0166 BTC, about $1,060 notional) and Derive's documented perp maintenance rate of 5% (mainnet value; testnet unconfirmed), maintenance is about $53 and a -15% shock loses about $159.
  - **Collateral:** $200 in the perp subaccount projects about 0.8 (too low). About $225 to $238 lands in band. Mid-band (1.35) is about $230.
  - **Build:** a script (for example `pnpm --filter @ttp/risk calibrate`) that reads the live perp margin and position through `@ttp/venues` (`getMargin("perp")`, `getPositions("DERIVE", "perp")`). It prints the current and projected ratio, and the test USDC to deposit or withdraw to hit 1.35. It must not move funds; a human deposits.
  - **Also:** re-check the Section 8 thresholds and the `topUpUsdc6` / `reduceQtyBtc` maths against Derive's margin. Derive reports net margins; `@ttp/venues` converts them to a gross requirement.
  - **Until the wallet is funded:** build and unit-test it against the venues mock.
- [x] 8. **Stop vault caps running out across rehearsals.**
  - **The problem:** with no LLM, `strategyId` is a deterministic hash of the thesis text, so every rehearsal of the demo thesis reuses one strategy. Its 150 USDC strategy cap fills up: the 20 USDC allowed release (demo step 4), plus any approved 80 USDC request. The 50 USDC daily cap resets only at the UTC day boundary.
  - **Pick one and document it:**
    - (a) The treasury keys vault calls by `strategyId` + a run id, so each `demo:reset` gets fresh strategy room. Treasury owns the onchain key; coordinate the `demo:reset` hook with Lane C.
    - (b) An owner script to reset limits, run by a human with the owner wallet. The owner key never goes on the server.
  - **Add a pre-rehearsal check:** it prints remaining daily cap, remaining strategy cap, vault balance against the reserve floor, and agent gas. Remember that Arc test USDC is also gas (CHANGES.md).
- [x] 9. **Owner approval page support for Lane C.** Export from `@ttp/treasury`:
  - the vault ABI
  - an Arc testnet `defineChain` for wagmi/viem
  - a typed helper that builds the `approveRequest(requestId)` call

  Lane C's `/approve/:requestId` page then just connects the owner wallet and sends it.
- [x] 10. **Integration tests for the Arc side** (in `tests/integration/`; Lane A may add files there):
  - revert, then request, then decline, leads to a reduce-only order
  - simulated venue credit never changes `MarginSnapshot`

  Run them in mock mode in CI, and in real mode behind `TREASURY_LIVE=1`.
- [x] 11. **README text for Lane C to paste** (README is Lane C's): vault address and deploy tx, the four evidence tx explorer links, how Arc is used (onchain spending rules, owner approval), and the Arc quirks from CHANGES.md as risk notes. Put the draft in `docs/agents/lane-a-readme-draft.md`.

## Start conditions

Tasks 1 to 3: now. Task 4+: when the env vars above exist. If not, keep going on 1 to 3 and note it in `STATUS.md`.
Phase 2: tasks 8 to 11 now. Task 7 builds against the venues mock now and is verified once the Derive perp subaccount is funded (human item 3).

## Key numbers

Chain 5042002 · RPC `https://rpc.testnet.arc.io` · USDC `0x3600000000000000000000000000000000000000` (6 decimals).
Demo limits: per-tx 25 USDC, daily 50, reserve floor 10, strategy cap 150.

## Current handoff (2026-11-19)

All Lane A code is included in `main`. Before live calibration/rehearsal, the human needs to configure authenticated Derive credentials and ensure the perp is open, then replenish the Arc vault: the last read-only check found 22 USDC total, 12 USDC releasable above the reserve floor, while the rehearsal can require up to 100 USDC (funding roughly 150 USDC is the current recommendation).
