# Thesis-to-Payoff Agent

UBC Hackathon 2026 · DeFi and Onchain Applications · Arc · Gemini Prediction Markets · Grok Bot.

Type a market view in plain English. The agent builds a small multi-leg position across Deribit testnet and Gemini Prediction Markets, then manages margin with an Arc testnet vault that enforces spending limits onchain.

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

_README sections (setup, architecture, economic design, risk assumptions, contract address, Arc usage, Grok) are filled in by Lane C. See DESIGN.md Section 17._
