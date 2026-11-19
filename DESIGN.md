# DESIGN.md: Thesis-to-Payoff Agent

UBC Hackathon 2026. This file is the single source of truth for the three coding agents building this project. Read all of it before writing code. If anything here conflicts with another doc, this file wins.

- **Track:** DeFi and Onchain Applications
- **Chain award:** Best use of Arc
- **Bounties:** Gemini Prediction Markets, Grok Bot
- **Deadline:** Friday, November 20, 2026, 12:00 PM CST (1:00 PM ET). Internal target: submitted by 11:00 AM ET.
- **Finalist pitch:** Saturday, November 21, in person. A human must attend to receive any prize.
- **Environment:** testnet and sandbox only. No mainnet trading or transfers, ever.

---

## 0. How three agents work without talking to each other

Read this section first. It is how you avoid waiting on each other.

1. **Contracts first, code second.** Section 5 defines every shared type. Section 4 defines every function each lane exports. Code only against those. Never import another lane's internals.
2. **Every lane ships a mock of its exports first.** Within your first 2 hours, commit `src/mock.ts` in each package you own. It implements every export in Section 4 with realistic fixed data, marked `source: "SIMULATED"`. Other lanes build against your mock immediately and switch to the real one with an env flag (`<PKG>_MODE=mock|real`).
3. **Handoff by file, not by message.** Section 4 lists "You can start X when file Y exists on main." Check `main` for that file. Do not wait for anyone to tell you.
4. **Status in files.** After each task, update your lane's line in `STATUS.md` (format in Section 15). If blocked, write `BLOCKED.md` (Section 14).
5. **Git rules.**
   - Branch per lane: `lane-a`, `lane-b`, `lane-c`. Small commits. Rebase on `main` before merging.
   - You may merge your own PR to `main` if it only touches your directories and `pnpm check` passes (typecheck, lint, tests).
   - `packages/shared` belongs to Lane C. Others propose changes in `CHANGES.md`; Lane C applies them. Changes may only add optional fields, never rename or remove.
   - `main` must always build and run `pnpm demo:mock`.

---

## 1. What we are building

A user types a market view in plain English through Grok Bot. The system turns it into a small multi-leg position across Derive (an option and a perp, onchain testnet) and Gemini Prediction Markets (event contracts), places it on testnet and sandbox, and then manages it. When the leveraged leg runs low on margin, the agent follows a fixed rescue sequence: it tries to release USDC from an Arc vault that enforces spending limits onchain, asks the owner to approve anything over the limit, and if the owner declines, trims the perp itself before the exchange would liquidate it. Everything shows on one dashboard, with every number labeled as real or simulated.

### Demo thesis (fixed)

> "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500."

### Demo legs

| Leg | Venue | Instrument (select at runtime) | Purpose | Real or simulated |
|---|---|---|---|---|
| L1 | Derive testnet, main subaccount | BTC call expiring 11 Dec 2026 (25 Dec until 11 Dec activates), strike nearest at-the-money | Bullish upside | Real testnet order |
| L2 | Derive testnet, perp subaccount | `BTC-PERP`, small long | Leveraged exposure that creates real margin pressure | Real testnet order |
| L3a | Gemini mainnet data only | `GEMI-FED261211-HIKEGT25` YES ("Hike >25bps") | Hedge against a bigger-than-expected Fed hike | Live mainnet quote; position SIMULATED |
| L3b | Gemini sandbox | NO on the `BTC2611302200` strike nearest below the BTC index (e.g. "$62,500 or above") | Binary downside hedge for the perp | Real sandbox order |

### Verified facts (Nov 17, 2026)

- Gemini **mainnet** lists `FED261211` (expires 2026-12-11 05:00 UTC). `HIKEGT25` quoted 0.02 bid / 0.07 ask. The 25bps hike traded near 0.90.
- Gemini **sandbox** does **not** list `FED261211` or any economics events. It lists short-term crypto and commodity contracts and `BTC2611302200` (expires 2026-11-30 22:00 UTC).
- **Venue change 2026-11-18:** Deribit testnet sign-up was unavailable to the team, so L1 and L2 moved to **Derive testnet** (wallet-based, Ethereum Sepolia, no exchange account). Derive lists BTC options expiring 11 Dec 2026 (active from 2026-11-20 08:00 UTC) and 25 Dec 2026 (active now), min size 0.01 BTC, plus `BTC-PERP`. Options expire 08:00 UTC, so 11 Dec lines up with the Fed decision (FOMC Dec 8-9, Gemini market settles Dec 11).
- Arc testnet: chain ID 5042002, RPC `https://rpc.testnet.arc.io`, USDC `0x3600000000000000000000000000000000000000`. Confirmed against docs.

If the sandbox later lists `FED261211`, L3a becomes a real sandbox order with no other changes. Lane B checks this daily.

---

## 2. Rules for agents

1. **Stop when blocked.** If an external service does not behave as described here, stop that task and write a `BLOCKED.md` entry (Section 14). Do not substitute a mock, a different instrument, or a skipped leg on your own. You may continue other tasks in your lane that do not depend on the blocked one. The human team reviews `BLOCKED.md` several times a day.
2. **Never create accounts, handle passwords, or request API keys.** Humans do that (Section 13). Read secrets only from environment variables.
3. **Never commit secrets.** `.env` is gitignored. Only `.env.example` with placeholders is committed.
4. **Never trade or transfer on mainnet.** Reading public Gemini mainnet market data without keys is allowed.
5. **Label everything.** Every external number, order and transaction carries a `source` field (Section 5).
6. **Stay in your directories** (Section 0, rule 5).
7. **Model output never sets numbers.** Grok Bot only supplies the thesis fields that become `ThesisIntent` (Section 10). There is no LLM on our server. Deterministic code selects instruments, prices, sizes and checks limits.
8. **Do not claim** anything in Section 12.

---

## 3. Architecture

```
Grok Bot ──(remote MCP, HTTPS + bearer)──┐
Web dashboard ───────────(REST/SSE)──────┤
                                         ▼
                              Orchestrator (Fastify, Lane C)
              ┌──────────────┬───────────┴───────┬───────────────┐
              ▼              ▼                   ▼               ▼
        Strategy/pricing   Venue adapters     Risk engine     Treasury
           (Lane B)          (Lane B)          (Lane A)        (Lane A)
                                                                  │
                                                         Arc testnet vault
```

Only the orchestrator composes packages. Packages import only `packages/shared`.

### Stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere except Solidity |
| Monorepo | pnpm workspaces |
| Frontend | Next.js, Tailwind, Recharts, wagmi + viem for the owner wallet page |
| Backend | Node.js, Fastify |
| Validation | Zod |
| Money math | decimal.js; USDC onchain in 6-decimal integer units |
| Chain client | viem |
| Contracts | Solidity, Foundry |
| Tests | Vitest, forge test |
| State | SQLite (better-sqlite3) with an append-only events table |
| Language understanding | Grok Bot only. Grok fills the `compile_thesis` MCP tool fields; our code validates them into `ThesisIntent`. No LLM API on the server. |
| Hosting | Railway or Render, one service for API + MCP + web |

No other languages, queues, Redis, or microservices.

### Repository layout

```
thesis-to-payoff/
├── apps/
│   ├── web/                  # Lane C
│   └── api/                  # Lane C (orchestrator, routes, state, events)
├── packages/
│   ├── shared/               # Lane C (Section 5)
│   ├── strategy/             # Lane B
│   ├── venues/               # Lane B
│   ├── risk/                 # Lane A
│   ├── treasury/             # Lane A
│   └── mcp/                  # Lane C
├── contracts/                # Lane A
├── fixtures/                 # each lane, own subfolder
├── evidence/                 # real redacted responses and tx receipts only
├── tests/integration/        # Lane C owns; others may add files
├── scripts/                  # Lane C: smoke.ts, demo-reset.ts
├── STATUS.md
├── BLOCKED.md
├── CHANGES.md
├── .env.example
└── README.md
```

---

## 4. Lanes, exports, and handoffs

### Lane A: Arc vault, treasury, risk engine

**Owns:** `contracts/`, `packages/treasury/`, `packages/risk/`, `fixtures/a/`.

**Exports:**

```ts
// packages/treasury
getTreasuryStatus(): Promise<TreasuryStatus>
releaseWithinLimits(strategyId: string, venue: Venue, amountUsdc6: string): Promise<TransferRequest>
  // returns state ARC_FINALIZED on success, or REJECTED with reasonCode and the reverted txHash
requestRelease(strategyId: string, venue: Venue, amountUsdc6: string, ttlSec: number): Promise<TransferRequest>
getReleaseStatus(requestId: string): Promise<TransferRequest>
cancelRequest(requestId: string): Promise<TransferRequest>
watchVaultEvents(onEvent: (e: ActivityEvent) => void): () => void

// packages/risk
evaluateRisk(input: RiskInput): RiskDecision
```

`RiskInput` and `RiskDecision` are defined in Section 5. `evaluateRisk` is pure: no network calls. The orchestrator gathers inputs and executes the decision.

**Tasks in order:**
1. `src/mock.ts` for treasury and risk. Merge.
2. Vault contract and tests (Section 7). All pass.
3. `evaluateRisk` with unit tests for every row of the threshold table (Section 8).
4. Deploy vault to Arc testnet (needs human items 4 and 5). Commit `contracts/deployments/arc-testnet.json` with address and tx hash.
5. Real `packages/treasury` with viem.
6. Evidence transactions: allowed release, over-limit revert, request + owner approve + execute, pause. Save receipts to `evidence/arc-*.json`.

**Starts when:** immediately for tasks 1 to 3. Task 4 when `.env` has `ARC_AGENT_PRIVATE_KEY` and `ARC_OWNER_ADDRESS`.

### Lane B: venues, pricing, strategy

**Owns:** `packages/venues/`, `packages/strategy/`, `fixtures/b/`.

**Exports:**

```ts
// packages/venues
discoverGeminiEvents(env: "mainnet" | "sandbox", search?: string): Promise<GeminiEvent[]>
getQuote(venue: Venue, instrumentId: string, env?: "mainnet" | "sandbox" | "testnet"): Promise<Quote>
placeOrder(req: OrderRequest): Promise<Order>
getOrder(venue: Venue, clientOrderId: string): Promise<Order | null>
cancelOrder(venue: Venue, clientOrderId: string): Promise<Order>
getPositions(venue: Venue, account: "main" | "perp"): Promise<VenuePosition[]>
getMargin(account: "main" | "perp"): Promise<MarginSnapshot>   // Derive subaccounts
getIndexPrice(): Promise<{ priceUsd: string; source: Source; timestamp: string }>

// packages/strategy
parseThesis(text: string): Promise<ThesisIntent | UnsupportedThesis>
buildPlan(intent: ThesisIntent, quotes: Quote[]): StrategyPlan
payoffGrid(plan: StrategyPlan, quotes: Quote[]): PayoffGrid
```

**Tasks in order:**
1. `src/mock.ts` for venues and strategy. Merge.
2. Gemini adapter: mainnet read-only discovery and quotes, sandbox auth, order, status, positions, cancel.
3. Derive adapter: instruments, tickers, subaccount margin for main and perp subaccounts, signed orders (EIP-712), reduce-only sells, positions, cancel, index price.
4. Smoke tests (Section 6). Save to `evidence/gemini-smoke.json`, `evidence/derive-smoke.json`.
5. `parseThesis`, `buildPlan`, `payoffGrid` with unit tests.
6. Daily check: does sandbox list `FED261211`? Note result in `STATUS.md`.

**Starts when:** immediately for tasks 1 and 5. Tasks 2 to 4 when `.env` has Gemini keys and the Derive wallet values.

### Lane C: shared types, orchestrator, MCP, dashboard, submission

**Owns:** `packages/shared/`, `packages/mcp/`, `apps/`, `scripts/`, `tests/integration/`, `README.md`, `STATUS.md` format.

**Tasks in order:**
1. **Within 1 hour:** repo skeleton, pnpm workspace, `pnpm check`, empty `STATUS.md`, `BLOCKED.md`, `CHANGES.md`, and `packages/shared` exactly as Section 5. Merge. This unblocks everyone.
2. Orchestrator and routes (Section 10) against Lane A and B mocks. `pnpm demo:mock` runs the full demo script with mocks.
3. Execution coordinator (Section 9) and monitoring loop (Section 8) in the orchestrator.
4. Dashboard (Section 11), including the owner approval page.
5. MCP server (Section 10), deployed at `PUBLIC_BASE_URL` with bearer auth.
6. Switch to real packages as `*_MODE=real` becomes available. Run integration tests.
7. README, demo script, video script, Devpost text, Grok chat export.
8. Extra if time: margin alerts (Section 8, alerts).

**Starts when:** immediately.

### Gates (ET)

| When | Gate |
|---|---|
| Tue night | Shared schemas and all mocks on main. `pnpm demo:mock` runs. Human setup items 1 to 6 done. |
| Wed 2 PM | Vault deployed with evidence. Both venue adapters placed a real test order. MCP server live. |
| **Wed night** | **Full demo runs end to end on real testnet and sandbox, rough UI acceptable.** |
| Thu 2 PM | Feature freeze. Polish and bug fixes only. |
| Thu night | Video recorded. README and Devpost text final. Grok chat export saved. |
| Fri 11 AM | Submitted on Devpost. |

---

## 5. Shared schemas (Lane C commits verbatim)

The committed copy lives in `packages/shared/src/schemas.ts`.

```ts
// packages/shared/src/schemas.ts
import { z } from "zod";

export const Source = z.enum([
  "LIVE_MAINNET_READONLY", // public market data from mainnet, no keys
  "SANDBOX",               // Gemini sandbox
  "TESTNET",               // Derive testnet (Deribit before 2026-11-18)
  "ONCHAIN_TESTNET",       // Arc testnet transaction
  "SIMULATED",             // computed or mocked by us
  "UNVERIFIED",
]);

export const Venue = z.enum(["GEMINI", "DERIBIT", "ARC", "DERIVE"]); // DERIBIT kept for compatibility; L1/L2 use DERIVE
export const Dec = z.string().regex(/^-?\d+(\.\d+)?$/); // decimal as string

export const ThesisIntent = z.object({
  underlying: z.literal("BTC"),
  direction: z.literal("BULLISH"),
  horizonUtc: z.string().datetime(),
  maxRiskUsd: Dec,
  eventConcern: z.enum(["FED_HIKE_GT25", "NONE"]),
  rawText: z.string(),
});

export const UnsupportedThesis = z.object({
  supported: z.literal(false),
  reason: z.string(),          // shown to the user
  supportedExamples: z.array(z.string()),
});

export const LegType = z.enum(["CALL", "PERP", "EVENT_YES", "EVENT_NO"]);

export const Leg = z.object({
  legId: z.enum(["L1", "L2", "L3a", "L3b"]),
  venue: Venue,
  account: z.enum(["main", "perp", "sandbox", "none"]),
  instrumentId: z.string(),
  type: LegType,
  side: z.enum(["BUY", "SELL"]),
  quantity: Dec,
  quantityUnit: z.string(),
  limitPrice: Dec,
  expiryUtc: z.string().datetime().nullable(),
  maxCostUsd: Dec,
  definedRisk: z.boolean(),
  executionMode: z.enum(["REAL", "SIMULATED"]), // L3a is SIMULATED
  settlementNote: z.string(),
});

export const StrategyPlan = z.object({
  strategyId: z.string(),
  revision: z.number().int(),
  intent: ThesisIntent,
  legs: z.array(Leg),
  premiumBudgetUsd: Dec,
  perpStopLossUsd: Dec,
  feeReserveUsd: Dec,
  modeledMaxLossUsd: Dec,
  assumptions: z.array(z.string()),
  versionHash: z.string(),
});

export const Quote = z.object({
  venue: Venue,
  instrumentId: z.string(),
  bid: Dec.nullable(),
  ask: Dec.nullable(),
  bidSize: Dec.nullable(),
  askSize: Dec.nullable(),
  feeEstimateUsd: Dec,
  timestamp: z.string().datetime(),
  source: Source,
});

export const GeminiEvent = z.object({
  eventTicker: z.string(),
  title: z.string(),
  expiryUtc: z.string().datetime(),
  contracts: z.array(z.object({
    instrumentSymbol: z.string(),
    label: z.string(),
    bestBid: Dec.nullable(),
    bestAsk: Dec.nullable(),
  })),
  termsUrl: z.string().nullable(),
  source: Source,
});

export const OrderRequest = z.object({
  clientOrderId: z.string(),
  strategyId: z.string(),
  legId: z.string(),
  venue: Venue,
  account: z.enum(["main", "perp", "sandbox"]),
  instrumentId: z.string(),
  side: z.enum(["BUY", "SELL"]),
  quantity: Dec,
  limitPrice: Dec,
  reduceOnly: z.boolean(),
});

export const OrderState = z.enum([
  "SUBMITTING", "ACKNOWLEDGED", "PARTIAL", "FILLED", "CANCELED", "REJECTED", "UNKNOWN",
]);

export const Order = OrderRequest.extend({
  venueOrderId: z.string().nullable(),
  filledQuantity: Dec,
  avgPrice: Dec.nullable(),
  state: OrderState,
  source: Source,
  updatedAt: z.string().datetime(),
});

export const VenuePosition = z.object({
  venue: Venue,
  account: z.string(),
  instrumentId: z.string(),
  quantity: Dec,
  avgPrice: Dec.nullable(),
  markPrice: Dec.nullable(),     // null if no executable exit price
  unrealizedPnlUsd: Dec.nullable(),
  source: Source,
  timestamp: z.string().datetime(),
});

export const MarginSnapshot = z.object({
  account: z.enum(["main", "perp"]),
  equityUsd: Dec,
  maintenanceMarginUsd: Dec,
  initialMarginUsd: Dec,
  marginRatio: Dec,               // equity / maintenance
  perpSizeBtc: Dec,
  indexPriceUsd: Dec,
  source: Source,                 // TESTNET
  timestamp: z.string().datetime(),
});

export const RiskState = z.enum([
  "NORMAL", "WARN", "FUNDING_ELIGIBLE", "APPROVAL_PENDING",
  "DELEVERAGE_REQUIRED", "RECOVERED", "CLOSING", "FAILED_SAFE",
]);

export const RiskInput = z.object({
  margin: MarginSnapshot,
  shockPct: Dec,                  // e.g. "-8" default, demo can set "-15"
  perpUnrealizedPnlUsd: Dec,
  perpStopLossUsd: Dec,
  treasury: z.object({
    perTxCapUsdc6: z.string(),
    remainingDailyUsdc6: z.string(),
    balanceUsdc6: z.string(),
  }),
  openRequest: z.object({
    requestId: z.string(),
    state: z.string(),
    expiresAtUtc: z.string().datetime(),
  }).nullable(),
  currentState: RiskState,
});

export const RiskDecision = z.object({
  projectedRatio: Dec,
  projectedSource: z.literal("SIMULATED"),
  nextState: RiskState,
  action: z.enum([
    "NONE", "ALERT", "RELEASE_WITHIN_LIMITS", "REQUEST_APPROVAL",
    "REDUCE_PERP", "CLOSE_PERP",
  ]),
  topUpUsdc6: z.string().nullable(),
  reduceQtyBtc: Dec.nullable(),
  reasonCode: z.string(),
  explanation: z.string(),        // one plain-English sentence for the log
});

export const PositionState = z.enum([
  "DRAFT", "QUOTED", "APPROVED", "EXECUTING", "OPEN", "PARTIAL", "FAILED", "REDUCING", "CLOSED",
]);

export const PositionSnapshot = z.object({
  positionId: z.string(),
  strategyId: z.string(),
  state: PositionState,
  riskState: RiskState,
  orders: z.array(Order),
  positions: z.array(VenuePosition),
  margins: z.array(MarginSnapshot),
  estimatedPnlUsd: Dec,
  updatedAt: z.string().datetime(),
});

export const ReleaseState = z.enum([
  "REQUESTED", "OWNER_APPROVAL_NEEDED", "OWNER_APPROVED", "SUBMITTED",
  "ARC_FINALIZED", "VENUE_CREDIT_SIMULATED", "REJECTED", "EXPIRED", "FAILED",
]);

export const TransferRequest = z.object({
  requestId: z.string(),          // bytes32 hex, matches onchain id
  strategyId: z.string(),
  venue: Venue,
  amountUsdc6: z.string(),
  destination: z.string(),
  expiresAtUtc: z.string().datetime().nullable(),
  state: ReleaseState,
  reasonCode: z.string().nullable(),
  txHash: z.string().nullable(),
  source: Source,
});

export const TreasuryStatus = z.object({
  vaultAddress: z.string(),
  balanceUsdc6: z.string(),
  perTxCapUsdc6: z.string(),
  dailyCapUsdc6: z.string(),
  spentTodayUsdc6: z.string(),
  reserveFloorUsdc6: z.string(),
  paused: z.boolean(),
  allowlist: z.array(z.string()),
  source: Source,
});

export const PayoffGrid = z.object({
  btcPrices: z.array(Dec),
  pnlIfBigHike: z.array(Dec),
  pnlIfNoBigHike: z.array(Dec),
  maxLossLineUsd: Dec,
  notes: z.array(z.string()),     // must include the perp stop annotation
});

export const ActivityEvent = z.object({
  seq: z.number().int(),
  timestamp: z.string().datetime(),
  positionId: z.string().nullable(),
  type: z.string(),
  reasonCode: z.string().nullable(),
  details: z.record(z.unknown()),
  source: Source,
});
```

Units: dollar values are decimal strings. USDC sent to contracts is an integer string in 6-decimal units. All times are UTC ISO strings.

---

## 6. Venue integration (Lane B)

Verify every endpoint against the official docs before coding. If something differs, follow the docs and note it in `CHANGES.md`. If something is missing, stop and write `BLOCKED.md`.

### 6.1 Gemini

- Sandbox REST `https://api.sandbox.gemini.com`, WS `wss://ws.sandbox.gemini.com`. Mainnet public REST `https://api.gemini.com` (read-only, no keys).
- Docs: https://developer.gemini.com/prediction-markets-spec and https://developer.gemini.com/get-started/sandbox
- Use: list events, get event, terms status, place order, order status, positions, cancel.
- Predictions use the account's USD balance. Arc USDC never funds Gemini in this build.
- One order at a time. Do not accept terms on the user's behalf.

**L3b selection:** from sandbox event `BTC2611302200`, take the "or above" contract with the highest strike at or below the current BTC index. Buy **NO** (pays if BTC finishes below that strike). Size so cost ≤ L3b budget.

**L3a:** quote `GEMI-FED261211-HIKEGT25` from mainnet at the ask. Record a simulated position at that price, labeled `SIMULATED`, with the quote labeled `LIVE_MAINNET_READONLY`.

**Smoke test:** list sandbox events; quote the L3b contract; place a 1-contract limit buy of NO; read status; cancel. List mainnet `FED261211` and quote `HIKEGT25`. Save redacted responses to `evidence/gemini-smoke.json`.

### 6.2 Derive testnet (replaced Deribit on 2026-11-18)

- App `https://testnet.app.derive.xyz`. API `https://testnet.api.derive.xyz/v3` (POST JSON-RPC). Docs: https://docs.derive.xyz
- Chain: Ethereum Sepolia (11155111). Accounts are wallet-based; test USDC is minted in the testnet app. No real funds, ever.
- Use: `public/get_all_instruments`, `public/get_instrument`, `public/get_ticker`, `private/order`, `private/get_order`, `private/get_open_orders`, `private/cancel`, `private/get_subaccount`.
- Every order is an EIP-712 signed `Action` (domain `Matching` v1.0, testnet DOMAIN_SEPARATOR `0x24d6...3e85`). Private calls carry `X-DeriveWallet`, `X-DeriveTimestamp`, `X-DeriveSignature`.
- **L1:** main subaccount. BTC call expiring 11 Dec 2026 if active, else 25 Dec 2026; strike nearest the index. Min size 0.01 BTC.
- **L2:** perp subaccount. `BTC-PERP`, min 0.01 BTC. Reduce-only orders must be IOC or market on Derive.
- `marginRatio = equity / maintenance requirement`, from `private/get_subaccount` on the perp subaccount. Derive reports net margins (value minus requirement), so requirement = `subaccount_value - maintenance_margin`.
- Derive's testnet BTC index differs from Gemini's sandbox price; label each with its source.

**Testnet fills:** testnet books are thin. On testnet only, set limit prices to cross the spread (buy at ask, sell at bid) so orders fill. If an order is not filled within 30 seconds, cancel and report `REJECTED` with reason `NO_FILL`.

**Smoke test:** list Dec 11 options and the perp; read both account summaries; place and cancel a small order in each account. Save to `evidence/derive-smoke.json`.

---

## 7. Arc vault (Lane A)

### Network (confirmed Nov 17 against https://docs.arc.io)

| Item | Value |
|---|---|
| Chain ID | 5042002 |
| RPC | https://rpc.testnet.arc.io |
| Explorer | https://explorer.testnet.arc.io |
| Faucet | https://faucet.circle.com |
| USDC ERC-20 | 0x3600000000000000000000000000000000000000 (6 decimals) |

Native gas uses 18 decimals. Vault accounting uses only the ERC-20 interface at 6 decimals.

### Contract: `ThesisTreasuryVault`

OpenZeppelin `AccessControl`, `Pausable`, `ReentrancyGuard`, `SafeERC20`.

**Roles:** `OWNER_ROLE`, `AGENT_ROLE`, `GUARDIAN_ROLE` (pause only).

**State:** `perTxCap6`, `dailyCap6` (resets at UTC day boundary), `reserveFloor6`, per-strategy cap and spent, destination allowlist, requests by id (`strategyId, destination, amount6, expiresAt, ownerApproved, executed`).

**Functions:**
- `releaseWithinLimits(strategyId, destination, amount6)`: agent only. Checks pause, allowlist, per-tx cap, daily cap, strategy cap, reserve floor. Reverts with a custom error naming the failed check (`ExceedsPerTxCap`, `ExceedsDailyCap`, etc.).
- `requestRelease(strategyId, destination, amount6, expiresAt) returns (bytes32)`: agent only.
- `approveRequest(requestId)`: owner only.
- `executeApproved(requestId)`: agent only, once, before expiry. Still checks pause, allowlist, strategy cap, reserve floor (not per-tx or daily cap).
- `cancelRequest(requestId)`: owner or agent.
- `setLimits`, `setDestination`, `setStrategyCap`: owner only.
- `pause` (guardian or owner), `unpause` (owner only), `revokeAgent` (owner only).

Request id = `keccak256(abi.encode(block.chainid, address(this), nonce, strategyId, destination, amount6))`.

**Events:** `StrategyCapSet`, `DestinationSet`, `LimitsSet`, `ReleaseRequested`, `ReleaseApproved`, `Released`, `RequestCanceled`, `Paused`, `Unpaused`, `AgentRevoked`.

Mark executed before transferring. No arbitrary call, no delegatecall, no unlimited approvals.

**Demo defaults:** per-tx cap 25 USDC, daily cap 50 USDC, reserve floor 10 USDC, strategy cap 150 USDC. Fund with about 150 testnet USDC.

**Required tests:** wrong caller reverts; non-allowlisted destination reverts; exact cap succeeds and cap+1 reverts; daily rollover; strategy cap; reserve floor; pause blocks all release paths; revoked agent blocked; double execute reverts; expired request reverts; unapproved request cannot execute; fuzz that daily releases never exceed the daily cap.

**Destination:** the team-controlled Arc settlement wallet. It is not an exchange address. After a release, the orchestrator logs a separate `VENUE_CREDIT_SIMULATED` event labeled `SIMULATED`. Simulated credit never changes `MarginSnapshot`.

CCTP is out of scope.

---

## 8. Risk engine and margin rescue

### Monitoring loop (Lane C runs it, Lane A's `evaluateRisk` decides)

Every 10 seconds and on demand:
1. `getMargin("perp")` (TESTNET).
2. `getTreasuryStatus()`.
3. Build `RiskInput` with the active shock (default -8%, demo can set -15%).
4. `evaluateRisk(input)` returns a `RiskDecision`.
5. Execute the action, log an `ActivityEvent` with the decision's `explanation`.

`projectedRatio` = equity after applying the shock to the perp's PnL, divided by maintenance margin. It is always labeled `SIMULATED`. The shock only moves the projection. The real margin read from Derive stays as reported.

### Thresholds (demo policy, not safety guarantees)

| Condition | Next state | Action |
|---|---|---|
| projected ≥ 2.0 | NORMAL or RECOVERED | NONE |
| 1.5 ≤ projected < 2.0 | WARN | ALERT |
| 1.2 ≤ projected < 1.5, no open request | FUNDING_ELIGIBLE | RELEASE_WITHIN_LIMITS, then REQUEST_APPROVAL if it reverts |
| open request pending, not expired | APPROVAL_PENDING | NONE (wait) |
| projected < 1.2, or request declined or expired | DELEVERAGE_REQUIRED | REDUCE_PERP |
| perp loss ≥ perp stop | CLOSING | CLOSE_PERP |

`topUpUsdc6` = USDC needed to bring projected ratio back to 2.0. `reduceQtyBtc` = perp size to sell (reduce-only) to bring projected ratio back to 2.0.

### Rescue sequence (this exact order, all logged)

1. Simulated shock moves the projected ratio below 1.5.
2. Agent calls `releaseWithinLimits` for the full top-up (e.g. 80 USDC). **Real onchain revert** (`ExceedsPerTxCap`). Log the reverted tx hash.
3. Agent calls `requestRelease` for the same amount with a 2-minute expiry. Real onchain request.
4. Owner approval request appears on the dashboard and approval page. Grok shows it when asked for status.
5. Owner declines, or it expires. Agent cancels the request onchain.
6. Agent places a **real reduce-only sell** on the Derive testnet perp. Projected ratio recovers.
7. If approved instead, agent calls `executeApproved`. Real release to the settlement wallet, then a `VENUE_CREDIT_SIMULATED` event. The projected ratio does not change from simulated credit, so the agent still reduces the perp if needed.

Never wait on a pending transfer when the state is DELEVERAGE_REQUIRED.

### Budget for $500

| Item | Limit |
|---|---|
| L1 Derive call premium + fees | ≤ $230 |
| L3a Fed hedge (simulated) | ≤ $40 |
| L3b Gemini NO (real) | ≤ $40 |
| Fee and slippage reserve | $30 |
| Perp stop loss | $160 |
| **Modeled max loss** | **≤ $500** |

Size the perp so a -15% shock alone does not reach Derive liquidation before the stop.

The UI states plainly: the perp is closed at its stop and is not held to Dec 11, and a gap move can exceed the modeled max loss.

### Alerts (extra, Lane C, only after the Thu 2 PM gate)

Grok cannot receive pushes from our app. Alerts go two ways:
- **Telegram bot:** the app sends a message when the projected ratio crosses 2.0, 1.5 or 1.2 downward, when an approval request opens, and when the perp is reduced or closed. No repeat until the ratio recovers above 2.0. Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- **Grok routine:** the README documents a Grok Bot routine that calls `position_status` every few minutes and messages the user if the risk state is not NORMAL. Humans set it up.

---

## 9. Execution rules (Lane C coordinator, Lane B adapters)

- Execute only with an approval record matching the plan's `versionHash`.
- Refresh quotes before sending. If any quote is older than 10 seconds or lacks size, block and re-quote.
- Order sequence: L3b Gemini NO, then L1 call, then L2 perp. Record L3a as simulated after L1 fills. If any real leg fails, open no later legs and report `PARTIAL`.
- Every order gets a unique `clientOrderId` saved before sending.
- On timeout, call `getOrder`. Resubmit only if the order is confirmed absent.
- A position is `OPEN` only after venue-confirmed fills.

**Before a live demo:** open the positions 10 minutes ahead with `pnpm demo:open`, so stage time is spent on the rescue. The video can show a fresh open.

---

## 10. API and MCP (Lane C)

### REST

```
POST /api/theses/compile              -> StrategyPlan or UnsupportedThesis
POST /api/strategies/quote            -> StrategyPlan + Quote[] + PayoffGrid
POST /api/strategies/:id/approve      -> approval record (versionHash bound)
POST /api/strategies/:id/execute      -> PositionSnapshot
GET  /api/positions/:id               -> PositionSnapshot
GET  /api/positions/:id/events        -> SSE stream of ActivityEvent
GET  /api/treasury                    -> TreasuryStatus + open TransferRequests
GET  /api/treasury/requests/:id       -> TransferRequest
POST /api/demo/:id/shock              -> set shockPct (DEMO_MODE only)
POST /api/demo/reset                  -> reset (DEMO_MODE only)
GET  /api/health
```

### MCP tools (remote, HTTPS, bearer token)

| Tool | Effect |
|---|---|
| `compile_thesis` | Grok sends the user's text plus the fields it extracted (`COMPILE_THESIS_INPUT_SCHEMA` in `@ttp/strategy`); returns a draft plan or a clear "not supported" reply |
| `discover_events` | live Gemini events relevant to the thesis |
| `quote_payoff` | prices, legs, payoff by Fed outcome |
| `approve_strategy` | records approval for a versionHash |
| `execute_strategy` | places orders (requires approval record) |
| `position_status` | position, margin, risk state, open approval requests with link |
| `transfer_request_status` | request state and owner approval link; cannot approve |

MCP tools call orchestrator functions only. No financial logic in MCP.

### Unsupported theses

Grok's fields go through `intentFromGrok`; text typed into the dashboard goes through `parseThesis` (an offline keyword parser). Both apply the same deterministic gate. It supports only bullish BTC with an optional Fed-hike concern and a max risk, and rejects a max risk that does not appear in the user's text. Anything else returns `UnsupportedThesis` with a friendly reason and two example theses that work. The app never invents a plan for an unsupported thesis.

---

## 11. Dashboard (Lane C)

**Main page, six panels:**
1. **Thesis and plan:** text, parsed intent, legs with one-line reasons.
2. **Gemini cards:** Fed contract (LIVE DATA badge, position SIMULATED) and the BTC strike contract (REAL sandbox order).
3. **Payoff chart:** P&L at Dec 11 across BTC price, two lines (bigger hike / not), max loss line, annotation that the perp exits at its stop.
4. **Venues:** positions and orders per venue, perp margin gauge showing real ratio and projected ratio with thresholds.
5. **Arc vault:** balance, caps, spent today, allowlist, requests with explorer links, including reverted txs.
6. **Activity log:** every event in order with a source badge and the plain-English explanation.

**Approval page** `/approve/:requestId`: shows amount, destination, reason, expiry. "Connect wallet" (wagmi), then "Approve" (sends `approveRequest` from the owner wallet) or "Decline" (records decline offchain; agent cancels onchain).

**Badges:** green REAL (`SANDBOX`, `TESTNET`, `ONCHAIN_TESTNET`), blue LIVE DATA (`LIVE_MAINNET_READONLY`), orange SIMULATED, gray UNVERIFIED.

**Demo controls** (DEMO_MODE only): "Shock BTC -8%", "Shock BTC -15%", "Reset".

---

## 12. Never claim

- That Arc USDC funds Gemini or Derive.
- That the system prevents all liquidations or guarantees max loss.
- That a Gemini binary equals an option, or that anything is arbitrage.
- That venues share margin. Say "one treasury with onchain spending rules".
- That the Fed hedge was a real order (it is simulated with live prices).
- That a simulated value is real.
- That a Grok reply moves funds. The owner wallet signature does.

---

## 13. Human setup checklist

Agents cannot do these. Values go in `.env` on the host and locally.

| # | Task | Env vars | Unblocks |
|---|---|---|---|
| 1 | Gemini sandbox account, accept prediction terms, trading API key, fund test USD | `GEMINI_SANDBOX_KEY`, `GEMINI_SANDBOX_SECRET` | Lane B |
| 2 | Derive testnet: a fresh test-only EVM wallet, Sepolia ETH from a faucet, connect at testnet.app.derive.xyz, mint test USDC, deposit about $300 into a main subaccount | `DERIVE_WALLET`, `DERIVE_SIGNER_PRIVATE_KEY`, `DERIVE_MAIN_SUBACCOUNT_ID` | Lane B |
| 3 | Derive testnet second subaccount for the perp, about $230 test USDC (Lane A's calibration script gives the exact amount for the -15% rescue band) | `DERIVE_PERP_SUBACCOUNT_ID` | Lane B |
| 4 | Arc testnet wallets: owner, agent, guardian, settlement. Faucet USDC for gas and vault | `ARC_AGENT_PRIVATE_KEY`, `ARC_OWNER_ADDRESS`, `ARC_GUARDIAN_ADDRESS`, `ARC_SETTLEMENT_ADDRESS` | Lane A |
| 5 | Owner wallet in a browser wallet. Owner key never on the server | none | Lane A deploy, approval page |
| 6 | Railway or Render project with a public HTTPS URL | `PUBLIC_BASE_URL`, `MCP_BEARER_TOKEN` | Lane C |
| 7 | Grok Bot access; add our MCP server as a custom connector | none | Lane C testing |
| 8 | (Removed 2026-11-18: no Anthropic API. Grok Bot does the language understanding.) | none | none |
| 9 | Public GitHub repo created this week; agents get push access | none | all |
| 10 | Ask Gemini (office hours or dev team) whether `FED261211` can be listed in sandbox | none | L3a upgrade |
| 11 | (Extra) Telegram bot token and chat id | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | alerts |

Other env vars: `ARC_RPC_URL`, `ARC_CHAIN_ID=5042002`, `ARC_USDC_ADDRESS`, `VAULT_ADDRESS`, `DEMO_MODE`, `DATABASE_PATH`, `TREASURY_MODE`, `RISK_MODE`, `VENUES_MODE`, `STRATEGY_MODE`.

---

## 14. BLOCKED.md

```
## [Lane X] Short title (OPEN | RESOLVED)
- When: <UTC time>
- Task: <what you were doing>
- Expected: <what this doc said would happen>
- Actual: <exact error or response, secrets redacted>
- Evidence: <file in evidence/>
- Options I see: <2-3 options>
- Meanwhile: <other unblocked task, or "waiting">
- Decision (filled by humans): <decision and date>
```

Pre-filled entry:

```
## [Lane B] FED261211 not in Gemini sandbox (RESOLVED)
- When: 2026-11-17 22:00 UTC
- Actual: sandbox lists no economics events; mainnet lists FED261211 with HIKEGT25 at 0.02/0.07
- Decision: 2026-11-17. L3 split into L3a (Fed hedge, live mainnet quote, simulated position)
  and L3b (real sandbox NO on BTC2611302200 strike). See Section 1. Recheck sandbox daily.
```

---

## 15. STATUS.md format

One line per lane, overwritten after each task:

```
Lane A | 2026-11-18 14:05 UTC | Done: vault tests (24 pass) | Now: Arc deploy | Next: real treasury | Blocked: none
Lane B | ...
Lane C | ...
```

---

## 16. Demo script

**Live (5 minutes):**
1. In Grok: type the thesis. Grok returns the plan and payoff summary.
2. Dashboard: Fed card (live price, simulated position), BTC strike card (real sandbox order), payoff chart split by Fed outcome.
3. Show the positions opened before the demo with real venue order ids.
4. Arc panel: an earlier allowed 20 USDC release with explorer link.
5. Press "Shock BTC -15%". Projected ratio falls below 1.5.
6. Agent tries to release 80 USDC: real onchain revert on the explorer. Agent files an approval request.
7. Ask Grok "what's my status?". Grok shows the pending request and link.
8. Decline on the approval page. Agent places a real reduce-only order on the Derive testnet perp. Gauge recovers.
9. Activity log: every step with source badges. Close: "One thesis. Event-aware execution. Onchain spending discipline."

**Video (2 to 3 minutes):** same flow, opening the positions fresh, with explorer and venue order ids visible.

---

## 17. Definition of done

- [ ] Vault tests pass. Vault deployed, address and tx hashes in README.
- [ ] Real Gemini sandbox order (L3b) and real Derive testnet orders (L1, L2, reduce-only), with evidence files.
- [ ] Real onchain revert, request, cancel or approve, and release, with evidence files.
- [ ] `pnpm demo:reset` then `pnpm demo:open` then the script runs with no manual edits.
- [ ] Every number on screen has a source badge.
- [ ] Unsupported thesis returns a clear reply.
- [ ] Grok invokes `compile_thesis` and `position_status` through the hosted MCP server.
- [ ] Integration tests: happy path; revert then request then decline leads to reduce-only order; failed real leg never shows as filled; simulated credit never changes margin.
- [ ] README: setup, architecture, economic design, risk assumptions, contract address, how Arc is used, Grok section (3 to 4 sentences).
- [ ] Grok chat export file in the repo.
- [ ] Devpost: description, written answers, repo link, 2 to 3 minute video, track DeFi, chain award Arc, bounties Gemini and Grok.
- [ ] A team member confirmed for in-person judging on Nov 21.
