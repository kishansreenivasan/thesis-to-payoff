# Demo runbook (DESIGN.md Section 16)

**For the video now:** use the six-screen `/replay` walkthrough and the [2:30 narration/capture guide](VIDEO.md). It reads the saved real testnet/sandbox evidence, with modeling explanations and the run date visible. It needs no fresh positions, wallet, token, funding or liquidity. The live-run instructions below are for a future fresh execution.

Testnet and sandbox only. Read amounts off the screen; do not quote fixed numbers (the top-up is
computed live, about $35 to $80).

## T-30 min: checks

Run the scripts with `DEMO_BASE_URL=https://<domain>` (or `PUBLIC_BASE_URL` in `.env`) so they drive the hosted server the dashboard shows.

1. `curl -s $PUBLIC_BASE_URL/api/health` shows the expected modes and `"demoMode":true`.
2. `pnpm demo:reset --flatten` (closes the Derive call and perp with reduce-only IOC orders, clears demo state, starts a new client-order-id run). Wait about 30 s; Derive reads lag.
3. `cd packages/risk && VENUES_MODE=real npx tsx --env-file=../../.env scripts/calibrate.ts`: the projected ratio after -15% must be in [1.2, 1.5). If not, a human moves the printed amount of test USDC in the Derive perp subaccount.
4. Open the dashboard, expand "Operator token", paste the MCP bearer token, Save.
5. Grok: the connector is listed and `position_status` answers.

## T-10 min: open positions

**Gemini sandbox liquidity is scarce** (BLOCKED.md, 2026-11-20): every open buys NO and uses up the sandbox YES bids. If positions are already open on the hosted server (dashboard "Venues and margin" shows OPEN), **skip `demo:reset --flatten` and step 6**. Just re-run calibrate; if the projected ratio has left [1.2, 1.5), a human moves the printed amount of test USDC in the Derive perp subaccount.

6. `pnpm demo:open --evidence evidence/rehearsal-<date>-open.json`. It must print `OPEN`, with real venue order ids for L3b (Gemini sandbox), L1 and L2 (Derive testnet).
7. `pnpm --filter @ttp/treasury precheck --strategy <strategyId printed above>`. It must say READY. If not, the owner runs the printed `cast send` commands from their own wallet.

## Live (5 minutes)

1. **Grok:** type "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500." Grok calls `compile_thesis`, then `quote_payoff`, and replies with the plan and the payoff by Fed outcome.
2. **Dashboard, top:** the Fed card (LIVE DATA, position SIMULATED), the BTC strike card (REAL sandbox), and the payoff grid split by Fed outcome.
3. **Venues panel:** the positions opened before the demo, with real venue order ids and green REAL badges.
4. **Arc panel:** the vault, its caps, and the earlier allowed 20 USDC release (explorer link in the README evidence table).
5. Press **Shock BTC -15%**. The orange projected marker falls below 1.5.
6. The activity log shows `RELEASE_REVERTED · ExceedsPerTxCap` (open it on the Arc explorer), then `RELEASE_REQUESTED` and an approval request.
7. **Grok:** "what's my status?" Grok calls `position_status` and shows the pending request and its approval link.
8. Open the link and press **Decline**. The page reports the real reduce-only order on the Derive perp and its venue order id. Back on the dashboard, the gauge shows the recovered real ratio.
9. **Activity log:** walk the steps with their source badges. Close: "One thesis. Event-aware execution. Onchain spending discipline."

## Never say

- That Arc USDC funds Gemini or Derive, or that venues share margin. Say "one treasury with onchain spending rules".
- That the Fed hedge is a real order. It uses live prices and a simulated position.
- That the system prevents all liquidations or guarantees max loss.
- That a Gemini binary is an option, or that anything is arbitrage.
- That Grok moves funds. The owner's wallet signature does.

## Video (2 to 3 minutes)

| Time | Show | Say |
|---|---|---|
| 0:00 | Grok chat, type the thesis | "I describe a view the way I would to a friend, with my max risk." |
| 0:15 | Grok's plan reply | "Grok extracts the fields. Our code, not the model, picks the instruments, sizes and limits, and refuses anything unsupported." |
| 0:35 | Dashboard top: legs, Fed and BTC-strike cards, payoff grid | "Four legs: a Derive call and perp on testnet, a real Gemini sandbox NO, and a Fed-hike hedge priced live from Gemini mainnet but simulated. Every number has a source badge." |
| 0:55 | `pnpm demo:open` terminal, then the venues panel | "Approve and execute: real orders, real venue order ids." |
| 1:15 | Arc panel and explorer | "Margin top-ups come from one Arc vault with onchain spending rules: per-tx cap, daily cap, reserve floor, allowlisted destination." |
| 1:30 | Shock -15%, gauge, log | "BTC drops 15%. The projected ratio falls below 1.5, so the agent asks the vault, and the contract reverts onchain because the amount is over the cap." |
| 1:50 | Explorer revert, then the approval page | "The agent files an approval request. Only the owner's wallet can approve it." |
| 2:05 | Grok "what's my status?" | "Grok can see the request but cannot approve it." |
| 2:15 | Decline, reduce-only order id, gauge recovers | "The owner declines, so the agent trims the perp with a real reduce-only order before the exchange would liquidate it." |
| 2:35 | Activity log | "One thesis. Event-aware execution. Onchain spending discipline." |
