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
