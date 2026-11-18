# Thesis-to-Payoff Agent

UBC Hackathon 2026 · DeFi and Onchain Applications · Arc · Gemini Prediction Markets · Grok Bot.

Type a market view in plain English. The agent builds a small multi-leg position across Derive testnet (onchain options and perps) and Gemini Prediction Markets, then manages margin with an Arc testnet vault that enforces spending limits onchain.

> Testnet and sandbox only. No mainnet trading or transfers.

**Agents and contributors: start at [AGENTS.md](AGENTS.md).** Full spec: [DESIGN.md](DESIGN.md).

## Quick start

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm check
pnpm demo:mock
```

## Arc testnet vault

`ThesisTreasuryVault` ([source](contracts/src/ThesisTreasuryVault.sol)) is one treasury with onchain spending rules — a single Arc testnet vault, not a shared margin pool across venues. The agent can release USDC itself up to a per-transaction cap, a daily cap, a per-strategy cap, and a reserve floor; anything over those limits needs the owner's approval, recorded onchain (`requestRelease` → `approveRequest` → `executeApproved`). A release lands in the team-controlled settlement wallet — it never funds a venue directly; crediting a venue account from that transfer is a separate, explicitly simulated step.

| | |
|---|---|
| Contract | [`0x1e9B755C7caA3d1D007d70A7cF77E93cc6A65E07`](https://explorer.testnet.arc.io/address/0x1e9B755C7caA3d1D007d70A7cF77E93cc6A65E07) |
| Network | Arc testnet, chain id `5042002` |
| Deploy tx | [`0xffce9764a01e80f1153b3c87ff0710aa9918e74044528d9749a4cae76f1009d9`](https://explorer.testnet.arc.io/tx/0xffce9764a01e80f1153b3c87ff0710aa9918e74044528d9749a4cae76f1009d9) |
| Deployed | 2026-11-18T01:44:04Z |
| Limits | per-tx 25 USDC · daily 50 USDC · reserve floor 10 USDC (see [`contracts/deployments/arc-testnet.json`](contracts/deployments/arc-testnet.json) for the full record) |

All four required onchain behaviors are demonstrated with real, signed Arc testnet transactions — not simulated — in [`evidence/arc-*.json`](evidence/):

- [`arc-allowed-release.json`](evidence/arc-allowed-release.json) — agent releases within every cap.
- [`arc-overlimit-revert.json`](evidence/arc-overlimit-revert.json) — agent attempts over the per-tx cap; a real mined revert, `ExceedsPerTxCap`.
- [`arc-request-approve-execute.json`](evidence/arc-request-approve-execute.json) — agent requests an over-cap release, the owner approves from their own wallet, the agent executes.
- [`arc-pause.json`](evidence/arc-pause.json) — the owner pauses and unpauses the vault.

Contract tests: `cd contracts && forge test` (19/19 passing, including a 1000-run fuzz test that the daily cap is never exceeded). The owner's wallet key is never held by the agent or the server — every owner-only call (`approveRequest`, `pause`, `unpause`, `setDestination`, `setStrategyCap`) was signed from the owner's own wallet.

---

_Remaining README sections (setup, architecture, economic design, risk assumptions, Grok) are filled in by Lane C. See DESIGN.md Section 17._
