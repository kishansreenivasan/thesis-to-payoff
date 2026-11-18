# Lane A README draft (for Lane C to paste into README.md)

Sections below follow DESIGN.md Section 17. Wording follows Section 12: one treasury with onchain spending rules; Arc never funds a venue; simulated is never called real. Hashes and links are copied from `evidence/arc-*.json` and `contracts/deployments/arc-testnet.json`.

---

## How Arc is used

One treasury with onchain spending rules. `ThesisTreasuryVault` is a single vault on Arc testnet. It holds test USDC and lets the agent release it to one team-controlled settlement wallet, but only inside limits the contract enforces itself:

| Rule | Demo value |
|---|---|
| Per-transaction cap | 25 USDC |
| Daily cap (resets at the UTC day boundary) | 50 USDC |
| Per-strategy cap | 150 USDC |
| Reserve floor (the vault never drops below) | 10 USDC |
| Destination | allowlisted settlement wallet only |
| Pause | guardian or owner stops every release path; only the owner unpauses |

Inside the limits the agent acts alone (`releaseWithinLimits`). Over a limit the call reverts onchain with a named error (for example `ExceedsPerTxCap`), the agent files a request (`requestRelease`), and only the owner's wallet signature can approve it (`approveRequest`). The agent then executes once, before expiry (`executeApproved`). The owner's key never touches the server. A Grok reply cannot move funds; the owner's wallet signature does.

**What Arc does not do.** Arc USDC does not fund Gemini or Derive, and the venues do not share margin. A release lands in the settlement wallet. The app then logs a separate `VENUE_CREDIT_SIMULATED` event, labelled SIMULATED, and that event never changes the real margin read from Derive. If margin is still short, the agent reduces the perp itself with a real reduce-only order.

## Arc testnet vault

| | |
|---|---|
| Contract | [`0x1e9B755C7caA3d1D007d70A7cF77E93cc6A65E07`](https://explorer.testnet.arc.io/address/0x1e9B755C7caA3d1D007d70A7cF77E93cc6A65E07) |
| Network | Arc testnet, chain id 5042002 |
| Deploy tx | [`0xffce9764…1009d9`](https://explorer.testnet.arc.io/tx/0xffce9764a01e80f1153b3c87ff0710aa9918e74044528d9749a4cae76f1009d9) (2026-11-18T01:44:04Z) |
| Settlement wallet | `0x47D9A12bBC0c9EA77D2f9202b256e01A4eF9e618` |
| Tests | `cd contracts && forge test` (19 passing, including a 1000-run fuzz that daily releases never exceed the daily cap) |

## Onchain evidence (real, signed Arc testnet transactions)

| Behaviour | Transaction | File |
|---|---|---|
| Allowed release inside every cap | [`0xc8183e39…78e1c3`](https://explorer.testnet.arc.io/tx/0xc8183e39b6579785685170a0194191ebee53e3e3d223c99a759c54cb3978e1c3) | [`evidence/arc-allowed-release.json`](evidence/arc-allowed-release.json) |
| Over-limit revert (`ExceedsPerTxCap`, 30 USDC vs 25 USDC cap) | [`0x2bd64a73…0599d7`](https://explorer.testnet.arc.io/tx/0x2bd64a73237eadea49a4cb227f7e2b3a039da2171e335bcc43c7696bef0599d7) | [`evidence/arc-overlimit-revert.json`](evidence/arc-overlimit-revert.json) |
| Request, owner approval, execute | request [`0x3c2d1c71…beafe2d`](https://explorer.testnet.arc.io/tx/0x3c2d1c714a1c09b1747acc6d44861f32c01651cff369fa926db39ff87beafe2d), approve [`0x52b29943…b8bd`](https://explorer.testnet.arc.io/tx/0x52b2994339ae784d1fb6dffe0ad573e59bebd561365f0588177b01810cb9b8bd), execute [`0x02dbebb3…224e4`](https://explorer.testnet.arc.io/tx/0x02dbebb3d88a443252b188fa5e71fb76eb01b122c3dc87422c19c92583c224e4) | [`evidence/arc-request-approve-execute.json`](evidence/arc-request-approve-execute.json) |
| Owner pause and unpause | pause [`0x3072f14a…f29df`](https://explorer.testnet.arc.io/tx/0x3072f14a5b8f41f9eed043ac2e1cee78610b38637935074e8379d560128f29df), unpause [`0xb9af89ce…719f`](https://explorer.testnet.arc.io/tx/0xb9af89ce354465398b10b51a91e8bd1bc6fd0284f346034c2610e5208e6b719f) | [`evidence/arc-pause.json`](evidence/arc-pause.json) |

## Risk notes (Arc quirks, from CHANGES.md)

- **Test USDC is also gas.** On Arc testnet the ERC-20 at `0x3600…0000` is a 6-decimal view of the same account's native 18-decimal balance. Moving "USDC" off an address also moves its gas. Sending an account's full balance leaves it unable to transact, so keep a buffer on any wallet that signs.
- **The RPC caps `eth_getLogs` by block range times topic count.** A single-event filter works over a wide range; a 13-event filter fails on a much smaller one. The app watches vault events with one subscription per event name. Anyone adding a historical backfill should do the same.
- **Caps only move one way.** A vault's spent-today and per-strategy spent counters cannot be lowered. Between rehearsals the owner raises the caps with their own wallet; `pnpm --filter @ttp/treasury precheck --strategy <id>` prints the exact commands (no keys). An unseen strategy id has a cap of 0, so a reworded thesis that changes the id needs its cap set first.
- **Owner-only actions are owner-signed.** `approveRequest`, `pause`/`unpause`, `setDestination`, `setStrategyCap` and `setLimits` need the owner's wallet. The agent key can release within limits, request, execute once approved, and cancel. A compromised agent key is bounded by the caps and the reserve floor, and the owner can pause or revoke it.
- **Demo policy, not a safety guarantee.** The margin thresholds (2.0 / 1.5 / 1.2) and the -15% shock are demo settings. The system does not prevent liquidations or guarantee the modeled max loss, and a gap move can exceed it. The projected ratio is always SIMULATED; the real margin comes from Derive.
- **Testnet only.** Arc testnet USDC has no value. No mainnet transfers are made.
