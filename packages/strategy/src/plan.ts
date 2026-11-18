// buildPlan (Lane B): deterministic instrument selection, sizing and budget checks.
// The LLM never touches anything in this file (DESIGN.md Section 2, rule 7).
import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { Leg, Quote, StrategyPlan, ThesisIntent } from "@ttp/shared";
import { isDeribitPerp, isLinearPerp, parseDeribitOption, parseGeminiStrike } from "./instruments";

/** Budget split for a $500 max risk (DESIGN.md Section 8). Scaled linearly for other amounts. */
export const BUDGET_SHARES = {
  L1: new Decimal(230).div(500),
  L3a: new Decimal(40).div(500),
  L3b: new Decimal(40).div(500),
  feeReserve: new Decimal(30).div(500),
  perpStop: new Decimal(160).div(500),
};

/** Shock the perp stop is sized against: a -15% move alone takes the perp to its stop. */
export const PERP_STOP_MOVE = new Decimal("0.15");

/** L1 expiry preference (decision 2026-11-17, BLOCKED.md): 11DEC26 if listed, else 25DEC26. */
export const L1_EXPIRY_PREFERENCE = ["11DEC26", "25DEC26"];

export const FED_HEDGE_SYMBOL = "GEMI-FED261211-HIKEGT25";
export const L3B_EVENT = "BTC2611302200";

const DERIBIT_OPTION_STEP = new Decimal("0.1"); // min and increment, BTC
const DERIBIT_PERP_STEP = new Decimal("0.0001"); // BTC_USDC-PERPETUAL min and increment
const GEMINI_STEP = new Decimal(1); // whole contracts

export class PlanError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "PlanError";
  }
}

const usd = (d: Decimal) => d.toFixed(2);
const floorTo = (x: Decimal, step: Decimal) => x.div(step).floor().mul(step);

function requireAsk(q: Quote): Decimal {
  if (!q.ask) throw new PlanError("NO_ASK", `${q.venue} ${q.instrumentId} has no ask`);
  return new Decimal(q.ask);
}
function requireBid(q: Quote): Decimal {
  if (!q.bid) throw new PlanError("NO_BID", `${q.venue} ${q.instrumentId} has no bid`);
  return new Decimal(q.bid);
}

/** BTC reference price = mid of the perp quote. */
function referencePrice(perp: Quote): Decimal {
  return requireBid(perp).add(requireAsk(perp)).div(2);
}

function pickPerp(quotes: Quote[]): Quote {
  const perps = quotes.filter((q) => q.venue === "DERIBIT" && isDeribitPerp(q.instrumentId));
  const p = perps.find((q) => isLinearPerp(q.instrumentId)) ?? perps[0];
  if (!p) throw new PlanError("NO_PERP_QUOTE", "need a Deribit BTC perpetual quote");
  return p;
}

function pickCall(quotes: Quote[], ref: Decimal) {
  const calls = quotes
    .filter((q) => q.venue === "DERIBIT")
    .map((q) => ({ q, o: parseDeribitOption(q.instrumentId) }))
    .filter((x): x is { q: Quote; o: NonNullable<typeof x.o> } => x.o?.kind === "C");
  for (const code of L1_EXPIRY_PREFERENCE) {
    const at = calls.filter((c) => c.o.expiryCode === code);
    if (at.length === 0) continue;
    at.sort((a, b) => a.o.strike.sub(ref).abs().cmp(b.o.strike.sub(ref).abs()) || a.o.strike.cmp(b.o.strike));
    return at[0]!;
  }
  throw new PlanError("NO_L1_EXPIRY", `need Deribit call quotes for one of ${L1_EXPIRY_PREFERENCE.join(", ")}`);
}

function pickL3b(quotes: Quote[], ref: Decimal) {
  const strikes = quotes
    .filter((q) => q.venue === "GEMINI")
    .map((q) => ({ q, s: parseGeminiStrike(q.instrumentId) }))
    .filter((x): x is { q: Quote; s: NonNullable<typeof x.s> } => x.s?.eventTicker === L3B_EVENT)
    .filter((x) => x.s.strike.lte(ref))
    .sort((a, b) => b.s.strike.cmp(a.s.strike));
  const best = strikes[0];
  if (!best) {
    throw new PlanError(
      "NO_L3B_STRIKE",
      `no ${L3B_EVENT} "or above" strike at or below BTC ${usd(ref)} (DESIGN.md Section 6.1)`,
    );
  }
  return best;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildPlan(intent: ThesisIntent, quotes: Quote[], revision = 1): StrategyPlan {
  const maxRisk = new Decimal(intent.maxRiskUsd);
  if (maxRisk.lte(0)) throw new PlanError("BAD_MAX_RISK", "maxRiskUsd must be positive");

  const budget = {
    L1: maxRisk.mul(BUDGET_SHARES.L1),
    L3a: maxRisk.mul(BUDGET_SHARES.L3a),
    L3b: maxRisk.mul(BUDGET_SHARES.L3b),
    fee: maxRisk.mul(BUDGET_SHARES.feeReserve),
    stop: maxRisk.mul(BUDGET_SHARES.perpStop),
  };

  const perpQ = pickPerp(quotes);
  const ref = referencePrice(perpQ);
  const legs: Leg[] = [];
  const assumptions: string[] = [
    `BTC reference price ${usd(ref)} = mid of ${perpQ.instrumentId} (${perpQ.source}).`,
    "Limit prices cross the spread (buy at ask) so thin testnet books fill (DESIGN.md Section 6.2).",
  ];

  // ---- L1: Deribit call, strike nearest the reference price ----
  const call = pickCall(quotes, ref);
  const callUnit = requireAsk(call.q).add(call.q.feeEstimateUsd);
  const callQty = floorTo(budget.L1.div(callUnit), DERIBIT_OPTION_STEP);
  if (callQty.lt(DERIBIT_OPTION_STEP)) {
    throw new PlanError(
      "L1_BUDGET_BELOW_MIN_SIZE",
      `${call.q.instrumentId} costs ${usd(callUnit.mul(DERIBIT_OPTION_STEP))} for the 0.1 BTC minimum; L1 budget is ${usd(budget.L1)}`,
    );
  }
  const callCost = callUnit.mul(callQty);
  legs.push({
    legId: "L1",
    venue: "DERIBIT",
    account: "main",
    instrumentId: call.q.instrumentId,
    type: "CALL",
    side: "BUY",
    quantity: callQty.toString(),
    quantityUnit: "BTC",
    limitPrice: usd(requireAsk(call.q)),
    expiryUtc: call.o.expiryUtc,
    maxCostUsd: usd(callCost),
    definedRisk: true,
    executionMode: "REAL",
    settlementNote: `European call, strike ${call.o.strike.toString()}, expires ${call.o.expiryUtc}. Max loss is the premium.`,
  });
  if (call.o.expiryCode !== L1_EXPIRY_PREFERENCE[0]) {
    assumptions.push(`11DEC26 not listed; L1 uses ${call.o.expiryCode} (decision 2026-11-17).`);
  }

  // ---- L2: Deribit perp, sized so a -15% move takes it to its stop ----
  const perpAsk = requireAsk(perpQ);
  const perpQty = floorTo(budget.stop.div(perpAsk.mul(PERP_STOP_MOVE)), DERIBIT_PERP_STEP);
  if (perpQty.lt(DERIBIT_PERP_STEP)) throw new PlanError("PERP_TOO_SMALL", "perp stop budget below minimum size");
  legs.push({
    legId: "L2",
    venue: "DERIBIT",
    account: "perp",
    instrumentId: perpQ.instrumentId,
    type: "PERP",
    side: "BUY",
    quantity: perpQty.toString(),
    quantityUnit: "BTC",
    limitPrice: usd(perpAsk),
    expiryUtc: null,
    maxCostUsd: usd(budget.stop),
    definedRisk: false,
    executionMode: "REAL",
    settlementNote: `Closed at its ${usd(budget.stop)} stop (about -15%); not held to the Fed decision. A gap move can lose more.`,
  });

  // ---- L3a: Fed >25bps hike YES, live mainnet price, SIMULATED position ----
  if (intent.eventConcern === "FED_HIKE_GT25") {
    const fq = quotes.find((q) => q.venue === "GEMINI" && q.instrumentId === FED_HEDGE_SYMBOL);
    if (!fq) throw new PlanError("NO_FED_QUOTE", `need a ${FED_HEDGE_SYMBOL} quote`);
    const unit = requireAsk(fq).add(fq.feeEstimateUsd);
    const qty = floorTo(budget.L3a.div(unit), GEMINI_STEP);
    if (qty.lt(1)) throw new PlanError("L3A_TOO_SMALL", "Fed hedge budget below one contract");
    legs.push({
      legId: "L3a",
      venue: "GEMINI",
      account: "none",
      instrumentId: FED_HEDGE_SYMBOL,
      type: "EVENT_YES",
      side: "BUY",
      quantity: qty.toString(),
      quantityUnit: "contracts",
      limitPrice: usd(requireAsk(fq)),
      expiryUtc: "2026-12-11T05:00:00.000Z",
      maxCostUsd: usd(unit.mul(qty)),
      definedRisk: true,
      executionMode: "SIMULATED",
      settlementNote: "Pays $1 per contract if the Fed hikes more than 25bps at the Dec 8-9 meeting. Position is SIMULATED at a live mainnet price.",
    });
  }

  // ---- L3b: Gemini sandbox NO on the highest "or above" strike at or below BTC ----
  const l3b = pickL3b(quotes, ref);
  const noCost = new Decimal(1).sub(requireBid(l3b.q)); // NO = 1 - YES bid
  const noUnit = noCost.add(l3b.q.feeEstimateUsd);
  const noQty = floorTo(budget.L3b.div(noUnit), GEMINI_STEP);
  if (noQty.lt(1)) throw new PlanError("L3B_TOO_SMALL", "L3b budget below one contract");
  legs.push({
    legId: "L3b",
    venue: "GEMINI",
    account: "sandbox",
    instrumentId: l3b.q.instrumentId,
    type: "EVENT_NO",
    side: "BUY",
    quantity: noQty.toString(),
    quantityUnit: "contracts",
    limitPrice: usd(noCost),
    expiryUtc: "2026-11-30T22:00:00.000Z",
    maxCostUsd: usd(noUnit.mul(noQty)),
    definedRisk: true,
    executionMode: "REAL",
    settlementNote: `Pays $1 per contract if BTC finishes below ${l3b.s.strike.toString()} on Nov 30. A binary, not an option.`,
  });

  const premium = legs.filter((l) => l.legId !== "L2").reduce((s, l) => s.add(l.maxCostUsd), new Decimal(0));
  const modeledMaxLoss = premium.add(budget.stop).add(budget.fee);
  if (modeledMaxLoss.gt(maxRisk)) {
    throw new PlanError("OVER_BUDGET", `modeled max loss ${usd(modeledMaxLoss)} exceeds ${usd(maxRisk)}`);
  }
  assumptions.push(
    "Modeled max loss = option and event premiums + perp stop + fee reserve. Not a guarantee: a gap through the stop can lose more.",
  );

  const body = {
    intent,
    legs,
    premiumBudgetUsd: usd(premium),
    perpStopLossUsd: usd(budget.stop),
    feeReserveUsd: usd(budget.fee),
    modeledMaxLossUsd: usd(modeledMaxLoss),
    assumptions,
  };
  const versionHash = stableHash({ ...body, revision });
  return {
    strategyId: `strat_${stableHash(intent).slice(0, 12)}`,
    revision,
    ...body,
    versionHash,
  };
}
