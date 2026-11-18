# CHANGES

Two uses:
1. **Shared schema requests.** Lanes A and B propose changes to `packages/shared` here. Lane C applies them. Only new optional fields; never rename or remove.
2. **Spec deviations.** When an external API differs from DESIGN.md, follow the official docs and record the difference here.

Format:

```
## [Lane X] <title> (PROPOSED | APPLIED | NOTED)
- When: <UTC time>
- What: <field / endpoint / behavior>
- Why: <reason>
```

---

## [Setup] Preflight findings (NOTED)
- When: 2026-11-17 23:45 UTC
- What:
  - Deribit testnet lists both `BTC-PERPETUAL` and the linear `BTC_USDC-PERPETUAL`. Per Section 6.2, L2 should prefer `BTC_USDC-PERPETUAL`. Lane B confirms when wiring the adapter.
  - Gemini FED261211 terms say the FOMC meeting is **Dec 8 to 9, 2026**; the contract expires Dec 11 05:00 UTC. Copy that says "Fed on Dec 11" should say "Fed decision (Dec 9), market settles Dec 11".
  - Arc testnet RPC returns chain id 0x4cef52 (5042002); USDC at 0x3600...0000 reports 6 decimals. Matches Section 7.
- Why: avoid surprises during adapter work and in pitch copy.

## [Lane B] Quote and order conventions for venues (NOTED)
- When: 2026-11-18 00:10 UTC
- What:
  - Deribit option quotes: bid/ask are USD per 1 BTC of option, converted from BTC with the book's index price.
  - Deribit perp quotes: USD per 1 BTC.
  - Gemini quotes: the YES book in USD per contract (0..1). Buying NO costs 1 - YES bid.
  - `feeEstimateUsd`: estimated fee for one unit of quantity (1 BTC on Deribit, 1 contract on Gemini).
  - L2 uses `BTC_USDC-PERPETUAL` (linear, USDC-settled, min size 0.0001 BTC). `BTC-PERPETUAL` is the fallback if the linear perp has no quote.
  - Gemini orders: until OrderRequest has an outcome field, the instrumentId carries a suffix, `<symbol>:YES` or `<symbol>:NO`. Use `geminiOrderInstrument()` from `@ttp/venues`.
- Why: Quote and OrderRequest have no unit or outcome fields; Lane C needs one convention to build orders and display prices.

## [Lane B] Add optional `outcome` to OrderRequest (PROPOSED)
- When: 2026-11-18 00:10 UTC
- What: `outcome: z.enum(["YES", "NO"]).optional()` on `OrderRequest` in packages/shared. Gemini event orders need it; Deribit ignores it.
- Why: replaces the `:YES` / `:NO` instrumentId suffix above. Optional field, so nothing breaks.

## [Lane A] Arc testnet USDC at 0x3600...0000 mirrors the native gas balance (NOTED)
- When: 2026-11-18 01:50 UTC
- What: `balanceOf` on the ERC-20 at `ARC_USDC_ADDRESS` is not an independent ledger. It returns the
  same account's native balance rescaled from 18 to 6 decimals (confirmed: a `transfer()` call emits
  a mirrored `Transfer` event from `0xfff...ffe`, and the agent's "USDC" balance dropped by the exact
  gas cost of unrelated transactions, e.g. deploying the vault). Moving "USDC" in or out of an address
  on this chain also moves its native gas balance, and vice versa.
- Why: funding the vault (or any address) by transferring the full "USDC" balance off an EOA also
  zeroes its gas, leaving it unable to send further transactions. Keep a gas buffer when funding.
  `ThesisTreasuryVault` itself needs no change (it only ever reads `balanceOf`/`safeTransfer`), but
  anyone scripting Arc transfers should account for this before draining a balance to zero.

## [Lane A] Arc testnet RPC caps eth_getLogs by (block range x topic count) (NOTED)
- When: 2026-11-18 22:30 UTC
- What: a single-topic `eth_getLogs` filter (one event signature) succeeded over a ~6300-block
  range, but the same range failed with "requested range too large" once the filter's topic0
  became an OR of ~13 event signatures (viem's `getContractEvents`/`watchContractEvent` build this
  automatically when you pass a multi-event ABI without an `eventName`). A single-topic filter over
  a *wider* range (the full history since deploy, ~14k blocks) also succeeded. So the cap tracks
  something like (range x topics), not range alone.
- Why: `packages/treasury/src/real.ts`'s `watchVaultEvents` opens one `watchContractEvent` per event
  name instead of one combined multi-event watch, to stay on the side of this limit that's been
  verified to work. A continuous live watch (small per-poll range) probably wouldn't have hit this
  either way, but a one-shot historical backfill over a wide range with the full ABI will - worth
  knowing for anyone adding a backfill or an indexer against this RPC.

## [Lane B] Authenticated venue adapters: built from docs, to confirm in smoke test (NOTED)
- When: 2026-11-18 01:30 UTC
- What: `packages/venues/src/deribit.ts` and `gemini.ts` follow docs.deribit.com and developer.gemini.com as read on 2026-11-18. Unit tests replay the documented response shapes. Not yet run with keys. Items the docs leave open, which `pnpm --filter @ttp/venues smoke` will settle:
  - Deribit: `BTC_USDC-PERPETUAL` `amount`, `filled_amount` and position `size_currency` are in BTC (docs say "linear futures: base coin").
  - Deribit: `advanced: "usd"` accepts option limit prices in USD.
  - Deribit: `get_order_state_by_label` only sees orders closed in the last 30 minutes. `getOrder` for older orders returns null.
  - Gemini: the auth page says payload goes Base64 in `X-GEMINI-PAYLOAD` with an empty body. The prediction-market pages show a JSON body. The adapter follows the auth page.
  - Gemini: a NO order's `price` is the NO price (we send 0.68 when YES bids 0.32).
  - Gemini: requests have no client order id and there is no lookup by order id. The adapter maps clientOrderId to orderId in memory and searches active orders, then history. After a process restart, `getOrder` returns null for older Gemini orders, so Lane C should persist `venueOrderId` with the clientOrderId.
- Behavior: Deribit orders wait up to 30 s for a fill, then cancel. A fully unfilled order comes back `REJECTED` (reason NO_FILL); a partial fill comes back `CANCELED` with its `filledQuantity`. Gemini orders go out one at a time. The adapter refuses to trade if prediction terms are not accepted, and never accepts them itself.

## [Lane B -> Lane C] No Anthropic: Grok fills compile_thesis fields (APPLIED in Lane B; Lane C action needed)
- When: 2026-11-18
- What: decision by the team: no LLM API on our server, Grok Bot only. `@ttp/strategy` no longer depends on `@anthropic-ai/sdk`, and `LLM_API_KEY` is gone.
  - `strategy.parseThesis(text)` is unchanged in signature. In both mock and real it is now the offline keyword parser, so `/api/theses/compile` keeps working as is.
  - New exports from `@ttp/strategy`:
    - `COMPILE_THESIS_INPUT_SCHEMA`: JSON Schema for the MCP tool input.
    - `intentFromGrok(args)`: validates Grok's arguments and returns `ThesisIntent | UnsupportedThesis`. It never throws.
- **Lane C action:**
  - In `packages/mcp`, give the `compile_thesis` tool `inputSchema: COMPILE_THESIS_INPUT_SCHEMA` and call `intentFromGrok(args)` instead of `parseThesis(args.text)`. If the result is a `ThesisIntent`, continue to `buildPlan` as today.
  - Optional: accept the same fields on `POST /api/theses/compile` alongside `text`.
- Why: Grok already reads the user's message, so a second model on the server is redundant. The deterministic gate still rejects unsupported theses and any max-risk number not present in the user's text.

## [Lane B -> Lane C, Lane A] L1/L2 venue is Derive testnet, not Deribit (APPLIED in Lane B; action needed)
- When: 2026-11-18
- What:
  - **Shared (small edit in Lane C's package, made with the switch):** `Venue` now includes `"DERIVE"`; `"DERIBIT"` stays for compatibility. DESIGN.md Section 5 is updated to match.
  - `buildPlan` emits L1 and L2 with `venue: "DERIVE"`. Instruments: `BTC-20261211-<strike>-C` (Dec 11 activates 2026-11-20 08:00 UTC; Dec 25 until then) and `BTC-PERP`. Accounts are still `main` and `perp` (two Derive subaccounts).
  - `@ttp/venues` treats `"DERIBIT"` as an alias for `"DERIVE"`, so the existing `getPositions("DERIBIT", "perp")`, `getQuote("DERIBIT", ...)` and `placeOrder({ venue: "DERIBIT" })` calls in `apps/api/src/app.ts` keep working.
  - Removed: `deribit.ts` and the `DERIBIT_*` env vars. Added: `derive.ts` and `DERIVE_WALLET`, `DERIVE_SIGNER_PRIVATE_KEY`, `DERIVE_MAIN_SUBACCOUNT_ID`, `DERIVE_PERP_SUBACCOUNT_ID`.
  - `listDeribitCalls` is renamed `listCalls` (old name kept as an alias). It takes `"20261211"` or `"11DEC26"`.
  - Reduce-only on Derive only works for non-resting orders, so the adapter sends reduce-only sells as IOC.
  - The Derive testnet BTC index (about 63,900) differs from Gemini's sandbox BTC price (about 65,200). Label each with its source.
- **Edit made in Lane C's file, to keep `pnpm demo:mock` green:** `apps/api/src/app.ts` found the perp with `includes("PERPETUAL")`. Derive's perp is `BTC-PERP`, so that one check is now `includes("PERP")`, which matches both names. Nothing else in `apps/` changed.
- **Lane C action:**
  - Replace the `"DERIBIT"` literals in `apps/api/src/app.ts` with `"DERIVE"`. The alias is temporary.
  - Dashboard copy should say Derive.
- **Lane A action:** none required. Treasury tests that pass `"DERIBIT"` as the venue label still type-check.
- Unconfirmed until the Derive smoke test runs:
  - Derive's `maintenance_margin` is net, so the requirement is `subaccount_value - maintenance_margin`.
  - An account made in the web app is owned by the EOA. If not, a session key is needed.

## [Lane A -> Lane B, Lane C] Rescue-band calibration tool; venues mock collateral is out of band (NOTED)
- When: 2026-11-18
- What: `pnpm --filter @ttp/risk calibrate [--shock -15] [--target 1.35] [--size 0.0166 --mm-rate 0.05]` reads `venues.getMargin("perp")` and `getPositions("DERIVE","perp")` (VENUES_MODE mock or real), prints current vs projected ratio and the test USDC to deposit or withdraw to reach the 1.35 mid-band. Read only. The maths is `calibrateRescueBand` in `packages/risk/src/calibrate.ts` (same projection as `evaluateRisk`, tested against it). It is a dev script, not exported from `@ttp/risk`; `@ttp/venues` is a devDependency of `@ttp/risk` for it.
- Confirmed: `packages/venues/src/derive.ts` converts Derive's net `maintenance_margin` to a gross requirement (`subaccount_value - maintenance_margin`), as Section 6.2 says, so `evaluateRisk`'s ratio and `topUpUsdc6` / `reduceQtyBtc` maths run on gross numbers unchanged.
- **Lane B action (optional):** the venues mock has `PERP_COLLATERAL_USD = 260` and a 7.5% maintenance rate. With the 0.0166 BTC perp that projects 1.83 after -15% (WARN, no rescue), so `pnpm demo:mock` skips the vault attempt. About 235 lands at about 1.35 with that rate. Mid-band for the real 5% rate is also about 234.
- **Heads-up for Lane C / demo script:** at mid-band collateral the top-up to reach 2.0 is about $35, not the $80 in DESIGN.md Section 8/16. It still exceeds the 25 USDC per-tx cap, so the revert still happens; only the amount in the narration differs. Read the amount from the decision, do not hardcode 80.
- Unconfirmed until the perp subaccount is funded: Derive testnet's real perp maintenance rate (5% is the mainnet value).

## [Lane A -> Lane C, humans] Vault caps across rehearsals: owner reset script, not per-run keys (DECIDED)
- When: 2026-11-18
- Decision: option (b). Option (a), keying by strategyId + run id, cannot work: `strategyCap6[key]` has no default, so a new key has cap 0 and every release reverts `ExceedsStrategyCap` until the owner calls `setStrategyCap`. The owner key stays off the server. Also `strategySpent6` / `dailySpent6` can never be lowered and both setters take absolute values, so a reset is "raise the cap to spent + headroom".
- Tool: `pnpm --filter @ttp/treasury precheck --strategy strat_xxxxxxxxxxxx` (reads `.env`; read only; exit 0 = READY, 2 = NOT READY). Prints remaining daily cap, remaining strategy cap, vault balance vs reserve floor, agent gas (Arc USDC is gas), and, when short, the exact `cast send ... setStrategyCap / setLimits ... --private-key <YOUR_OWNER_PRIVATE_KEY>` commands for the owner to run with their own wallet. Logic in `packages/treasury/src/rehearsal.ts`.
- **Lane C action:** none required for `demo:reset` (it needs no onchain hook). Optionally run `precheck` at the end of `demo:reset` and show its output. Keep `strategyId` stable across rehearsals; do not add a run id.
- **Risk to know (humans / Lane C):** `strategyId = strat_<hash of the whole ThesisIntent>`, and the intent includes `rawText` and `horizonUtc`. If Grok words the thesis differently between rehearsals, the id changes, its cap is 0, and the 20 USDC allowed release (demo step 4) reverts with `ExceedsStrategyCap`. Run `precheck` with the id the compile response actually returns; the owner provisions it with the printed `setStrategyCap` command.
- **Funding gap found by the first live run (2026-11-18):** the vault holds 22 USDC. The demo needs up to 100 USDC above the 10 USDC floor (20 allowed + an approved request). Human: send about 150 test USDC to the vault (keep gas on the sending wallet, see the gas/USDC note above).

## [Lane A -> Lane C] Owner approval page: chain, ABI and approveRequest builder (APPLIED in Lane A; Lane C action needed)
- When: 2026-11-18
- What: browser-safe exports for `/approve/:requestId`, from `@ttp/treasury/owner` (also re-exported from `@ttp/treasury`; prefer the `/owner` subpath in `apps/web` so the server-side mock/real modules stay out of the browser bundle):
  - `arcTestnet`: viem `defineChain` (id 5042002, RPC https://rpc.testnet.arc.io, explorer https://explorer.testnet.arc.io, native currency USDC with 18 decimals).
  - `vaultAbi`, `ARC_TESTNET_VAULT_ADDRESS`, `arcTxUrl(hash)`, `arcAddressUrl(addr)`.
  - `buildApproveRequestCall(requestId, vaultAddress?)`: validates the bytes32 id, returns `{ chainId, abi, address, functionName: "approveRequest", args, to, data }`. wagmi: `writeContract({ abi: c.abi, address: c.address, functionName: c.functionName, args: c.args, chainId: c.chainId })`, or `sendTransaction({ to: c.to, data: c.data })`.
- **Lane C action:** wagmi config `chains: [arcTestnet]`; the page passes the request id from `GET /api/treasury/requests/:id` (it is the onchain bytes32 id). Next.js needs `transpilePackages: ["@ttp/treasury"]` because the package ships TypeScript source. Decline stays offchain (agent cancels onchain with its own key); nothing here approves on the owner's behalf.
- Safety: the module has no env access and no key handling. The contract rejects any sender without OWNER_ROLE, so a wrong wallet's tx reverts.
