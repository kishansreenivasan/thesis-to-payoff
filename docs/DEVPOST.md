# Devpost submission draft

**Track:** DeFi and Onchain Applications · **Chain award:** Arc · **Bounties:** Gemini Prediction Markets, Grok

**Links:** repo https://github.com/kishansreenivasan/thesis-to-payoff · live app `<PUBLIC_BASE_URL>` · video `<link>` · vault [`0x1e9B…5E07` on Arc testnet](https://explorer.testnet.arc.io/address/0x1e9B755C7caA3d1D007d70A7cF77E93cc6A65E07)

## Tagline

Type a market view in plain English. Get a bounded multi-venue position, managed by an agent whose spending is limited onchain.

## Inspiration

Retail traders think in theses ("bullish BTC, but worried about the Fed"), not in option chains, perps and event contracts across three venues. Agents that trade for you are only safe if their access to money is bounded by something stronger than a prompt.

## What it does

You tell Grok your view and your max risk. Our MCP server validates the fields Grok extracts, and deterministic code builds a four-leg plan: a BTC call and a small perp on Derive testnet, a real NO contract on a Gemini sandbox BTC market as a downside hedge, and a Fed-hike hedge priced live from Gemini's mainnet prediction market (simulated position, since the sandbox does not list it). You see the payoff by Fed outcome, approve the exact plan version, and the agent places real testnet and sandbox orders.

Then it manages the risk. When a price shock pushes the perp's projected margin ratio below 1.5, the agent asks an Arc testnet vault for a top-up. The vault enforces its own rules: per-transaction cap, daily cap, per-strategy cap, reserve floor, allowlisted destination, guardian pause. An over-cap release reverts onchain and becomes an approval request that only the owner's wallet can sign. If the owner declines, the agent trims the perp with a real reduce-only order. Every number on the dashboard carries a source badge: real testnet, sandbox, live read-only, or simulated.

## How we built it

- TypeScript pnpm monorepo, three parallel lanes with a shared Zod schema contract.
- **Arc:** a Solidity `ThesisTreasuryVault` (Foundry, 19 tests including a 1000-run fuzz of the daily cap), deployed on Arc testnet, driven with viem. The owner approval page uses wagmi; the owner key never touches the server.
- **Gemini:** prediction-market discovery, live mainnet quotes, and signed sandbox orders (lossless parsing of order ids above 2^53).
- **Derive testnet:** EIP-712-signed option and perp orders, net-to-gross margin conversion, and recovery from read-after-write lag.
- **Grok:** a remote MCP server (Streamable HTTP, bearer auth) exposing `compile_thesis`, `quote_payoff`, `approve_strategy`, `execute_strategy`, `position_status` and `transfer_request_status`. No LLM runs on our server; model output never sets a number.
- Fastify orchestrator with an append-only SQLite order and event log, a 10-second risk monitor, and a Next.js dashboard, all served from one Railway service.

## Challenges

- Deribit testnet sign-up was unavailable to us, so we moved the option and perp legs to Derive testnet two days in.
- The Fed contract is not listed in Gemini's sandbox, so we split the hedge into a live-priced simulated leg and a real sandbox BTC leg, and labelled both honestly.
- Arc test USDC is also the gas token, so moving it moves gas; the vault and scripts keep buffers.
- Testnet books are thin: orders are sized to displayed liquidity and unfilled remainders are cancelled.

## Accomplishments

Real orders on two venues plus real onchain reverts, requests and owner approvals, all in one flow where an AI agent can act alone only inside limits a smart contract enforces.

## What we learned

Spending rules belong onchain, not in the prompt. And honest labelling of real versus simulated values made the demo more convincing, not less.

## What's next

List the Fed market in the Gemini sandbox for a fully real hedge, real cross-venue funding once venues accept onchain deposits, and Telegram alerts for approval requests.

## Written answers

- **How is Arc used?** One vault holds the treasury and enforces per-tx, daily, per-strategy and reserve limits, an allowlist and a pause onchain. The agent releases within limits by itself; anything over reverts and needs the owner's wallet signature. Arc USDC does not fund the venues: releases go to a settlement wallet, and venue credit is shown as simulated.
- **How are Gemini Prediction Markets used?** Live mainnet Fed-decision prices drive the hedge sizing and payoff (simulated position), and a real sandbox order buys NO on a BTC price market as a downside hedge.
- **How is Grok used?** Grok is the user interface through our hosted MCP server. It extracts thesis fields and reports status and approval links; it cannot approve transfers or sign.
