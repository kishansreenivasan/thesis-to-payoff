// buildPlan (Lane B): deterministic instrument selection, sizing and budget checks.
// No model output touches anything in this file (DESIGN.md Section 2, rule 7).
import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { Leg, Quote, StrategyPlan, ThesisIntent } from "@ttp/shared";
import { isPerp, isPreferredPerp, parseOption, parseGeminiStrike } from "./instruments";

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

/** L1 expiry preference (decision 2026-11-17, BLOCKED.md): Dec 11 if listed and active, else Dec 25. Derive codes. */
export const L1_EXPIRY_PREFERENCE = ["20261211", "20261225"];

/** The L1/L2 venue (Derive testnet since 2026-11-18). Quotes tagged "DERIBIT" are accepted as an alias. */
export const L1L2_VENUE = "DERIVE" as const;
const isL1L2Venue = (v: string) => v === "DERIVE" || v === "DERIBIT";

export const FED_HEDGE_SYMBOL = "GEMI-FED261211-HIKEGT25";
export const L3B_EVENT = "BTC2611302200";

// Derive testnet (public/get_instrument, 2026-11-18): options min 0.01 BTC; BTC-PERP min 0.01, step 0.0001.
const OPTION_STEP = new Decimal("0.01"); // min and the increment we size in, BTC
const PERP_MIN = new Decimal("0.01");
const PERP_STEP = new Decimal("0.0001");
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
  const perps = quotes.filter((q) => isL1L2Venue(q.venue) && isPerp(q.instrumentId));
  const p = perps.find((q) => isPreferredPerp(q.instrumentId)) ?? perps[0];
  if (!p) throw new PlanError("NO_PERP_QUOTE", "need a Derive BTC-PERP quote");
  return p;
}

/** Cost of the minimum option lot (0.01 BTC on Derive) including fees, or null without an ask. */
const minLotCost = (q: Quote) => (q.ask ? new Decimal(q.ask).add(q.feeEstimateUsd).mul(OPTION_STEP) : null);

/**
 * L1 selection (decision 2026-11-18, BLOCKED.md): within the preferred expiry, take the call
 * nearest the reference price if the minimum lot fits the L1 budget; otherwise the lowest
 * out-of-the-money strike whose minimum lot fits.
 */
function pickCall(quotes: Quote[], ref: Decimal, budget: Decimal) {
  const calls = quotes
    .filter((q) => isL1L2Venue(q.venue))
    .map((q) => ({ q, o: parseOption(q.instrumentId) }))
    .filter((x): x is { q: Quote; o: NonNullable<typeof x.o> } => x.o?.kind === "C");
  for (const code of L1_EXPIRY_PREFERENCE) {
    const at = calls.filter((c) => c.o.expiryCode === code);
    if (at.length === 0) continue;
    const byDistance = [...at].sort(
      (a, b) => a.o.strike.sub(ref).abs().cmp(b.o.strike.sub(ref).abs()) || a.o.strike.cmp(b.o.strike),
    );
    const atm = byDistance[0]!;
    const fits = (c: (typeof at)[number]) => {
      const cost = minLotCost(c.q);
      return cost !== null && cost.lte(budget);
    };
    if (fits(atm)) return { ...atm, otm: false as const };
    const otm = at
      .filter((c) => c.o.strike.gt(ref) && fits(c))
      .sort((a, b) => a.o.strike.cmp(b.o.strike))[0];
    if (otm) return { ...otm, otm: true as const, atm };
    throw new PlanError(
      "L1_BUDGET_BELOW_MIN_SIZE",
      `no ${code} call costs at most ${usd(budget)} for the ${OPTION_STEP.toString()} BTC minimum (at-the-money ${atm.q.instrumentId}: ${
        minLotCost(atm.q) ? usd(minLotCost(atm.q)!) : "no ask"
      })`,
    );
  }
  throw new PlanError("NO_L1_EXPIRY", `need Derive call quotes for one of ${L1_EXPIRY_PREFERENCE.join(", ")}`);
}

/**
 * L3b selection: the highest "or above" strike at or below BTC (DESIGN.md Section 6.1). If none is
 * listed, the lowest strike above BTC (decision 2026-11-18, BLOCKED.md). NO still pays if BTC
 * finishes below that strike. Only strikes with a YES bid (someone to sell us NO) qualify.
 */
function pickL3b(quotes: Quote[], ref: Decimal) {
  const strikes = quotes
    .filter((q) => q.venue === "GEMINI" && q.bid)
    .map((q) => ({ q, s: parseGeminiStrike(q.instrumentId) }))
    .filter((x): x is { q: Quote; s: NonNullable<typeof x.s> } => x.s?.eventTicker === L3B_EVENT);
  const below = strikes.filter((x) => x.s.strike.lte(ref)).sort((a, b) => b.s.strike.cmp(a.s.strike))[0];
  if (below) return { ...below, aboveIndex: false };
  const above = strikes.filter((x) => x.s.strike.gt(ref)).sort((a, b) => a.s.strike.cmp(b.s.strike))[0];
  if (above) return { ...above, aboveIndex: true };
  throw new PlanError("NO_L3B_STRIKE", `no ${L3B_EVENT} "or above" strike with a YES bid`);
}

/** Cap a quantity at the size shown on the side we trade against, when the venue reports it. */
function capToBook(qty: Decimal, size: string | null, step: Decimal): { qty: Decimal; capped: boolean } {
  if (!size) return { qty, capped: false };
  const avail = floorTo(new Decimal(size), step);
  return avail.lt(qty) ? { qty: avail, capped: true } : { qty, capped: false };
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

  // ---- L1: Derive call, nearest the money that fits the budget ----
  const call = pickCall(quotes, ref, budget.L1);
  const callUnit = requireAsk(call.q).add(call.q.feeEstimateUsd);
  const callFit = capToBook(floorTo(budget.L1.div(callUnit), OPTION_STEP), call.q.askSize, OPTION_STEP);
  const callQty = callFit.qty;
  if (callQty.lt(OPTION_STEP)) throw new PlanError("L1_NO_LIQUIDITY", `${call.q.instrumentId} ask size below the ${OPTION_STEP.toString()} BTC minimum`);
  const callCost = callUnit.mul(callQty);
  if (call.otm) {
    assumptions.push(
      `At-the-money ${call.atm.q.instrumentId} costs more than the ${usd(budget.L1)} L1 budget for the minimum lot; L1 uses the nearest out-of-the-money call that fits, ${call.q.instrumentId} (decision 2026-11-18).`,
    );
  }
  if (callFit.capped) assumptions.push(`L1 size capped at the ${call.q.askSize} BTC shown on the ask.`);
  legs.push({
    legId: "L1",
    venue: L1L2_VENUE,
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
    assumptions.push(`Dec 11 options not active on Derive yet; L1 uses ${call.o.expiryCode} (decision 2026-11-17).`);
  }

  // ---- L2: Derive perp, sized so a -15% move takes it to its stop ----
  const perpAsk = requireAsk(perpQ);
  const perpQty = floorTo(budget.stop.div(perpAsk.mul(PERP_STOP_MOVE)), PERP_STEP);
  if (perpQty.lt(PERP_MIN)) throw new PlanError("PERP_TOO_SMALL", `perp size ${perpQty.toString()} BTC is below the ${PERP_MIN.toString()} BTC minimum`);
  legs.push({
    legId: "L2",
    venue: L1L2_VENUE,
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
  // Buying NO trades against YES bids, so the YES bid size is the NO liquidity.
  const noFit = capToBook(floorTo(budget.L3b.div(noUnit), GEMINI_STEP), l3b.q.bidSize, GEMINI_STEP);
  const noQty = noFit.qty;
  if (noQty.lt(1)) throw new PlanError("L3B_TOO_SMALL", "L3b budget or liquidity below one contract");
  if (l3b.aboveIndex) {
    assumptions.push(
      `No ${L3B_EVENT} strike is at or below BTC ${usd(ref)}; L3b uses the lowest strike above it, ${l3b.s.strike.toString()} (decision 2026-11-18).`,
    );
  }
  if (noFit.capped) assumptions.push(`L3b size capped at the ${l3b.q.bidSize} contracts of NO liquidity on the book.`);
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
