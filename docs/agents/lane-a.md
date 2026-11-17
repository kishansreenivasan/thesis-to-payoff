# Lane A brief: Arc vault, treasury, risk engine

Spec: DESIGN.md Sections 4 (Lane A), 5, 7, 8. This brief is a checklist, not a replacement.

## You own

`contracts/`, `packages/treasury/`, `packages/risk/`, `fixtures/a/`. Branch: `lane-a`.

## You export (signatures in `packages/shared/src/interfaces.ts`)

- `@ttp/treasury` implements `TreasuryApi`: `getTreasuryStatus`, `releaseWithinLimits`, `requestRelease`, `getReleaseStatus`, `cancelRequest`, `watchVaultEvents`.
- `@ttp/risk` implements `RiskApi`: `evaluateRisk(input: RiskInput): RiskDecision`. Pure, no network.

Selected by `TREASURY_MODE` and `RISK_MODE` (`mock` default, `real`).

## Tasks, in order

- [ ] 1. `packages/treasury/src/mock.ts` and `packages/risk/src/mock.ts`. Realistic fixed data, `source: "SIMULATED"`. Wire into `src/index.ts`. Merge. **Others are waiting on this.**
  - Treasury mock must reproduce the rescue: `releaseWithinLimits` of more than 25 USDC returns `REJECTED` with `reasonCode: "ExceedsPerTxCap"` and a fake tx hash; `requestRelease` returns `OWNER_APPROVAL_NEEDED`.
- [ ] 2. `ThesisTreasuryVault` + forge tests (Section 7 required tests list, including the fuzz test). Run `forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std` first.
- [ ] 3. Real `evaluateRisk` with Vitest tests for every row of the Section 8 threshold table.
- [ ] 4. Deploy to Arc testnet (needs `ARC_AGENT_PRIVATE_KEY`, `ARC_OWNER_ADDRESS` in `.env`). Commit `contracts/deployments/arc-testnet.json` (address + tx hash).
- [ ] 5. Real `packages/treasury` with viem.
- [ ] 6. Evidence txs: allowed release, over-limit revert, request + approve + execute, pause → `evidence/arc-*.json`.

## Start conditions

Tasks 1 to 3: now. Task 4+: when the env vars above exist. If not, keep going on 1 to 3 and note it in `STATUS.md`.

## Key numbers

Chain 5042002 · RPC `https://rpc.testnet.arc.io` · USDC `0x3600000000000000000000000000000000000000` (6 decimals).
Demo limits: per-tx 25 USDC, daily 50, reserve floor 10, strategy cap 150.
