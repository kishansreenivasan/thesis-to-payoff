// packages/shared/src/schemas.ts
import { z } from "zod";

export const Source = z.enum([
  "LIVE_MAINNET_READONLY", // public market data from mainnet, no keys
  "SANDBOX",               // Gemini sandbox
  "TESTNET",               // Deribit testnet
  "ONCHAIN_TESTNET",       // Arc testnet transaction
  "SIMULATED",             // computed or mocked by us
  "UNVERIFIED",
]);

export const Venue = z.enum(["GEMINI", "DERIBIT", "ARC"]);
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
