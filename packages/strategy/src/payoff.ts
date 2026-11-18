// payoffGrid (Lane B): modeled P&L at the Fed settlement date across BTC prices, split by Fed outcome.
// Every value here is SIMULATED; the dashboard labels it as such.
import Decimal from "decimal.js";
import type { PayoffGrid, Quote, StrategyPlan } from "@ttp/shared";
import { parseOption, parseGeminiStrike } from "./instruments";
import { PERP_STOP_MOVE } from "./plan";

/** Grid spans -30%..+30% around the reference price in 5% steps. */
const GRID_PCTS = Array.from({ length: 13 }, (_, i) => -30 + i * 5);

function referencePrice(plan: StrategyPlan, quotes: Quote[]): Decimal {
  const perpLeg = plan.legs.find((l) => l.legId === "L2");
  const q = quotes.find((x) => x.instrumentId === perpLeg?.instrumentId && x.bid && x.ask);
  if (q) return new Decimal(q.bid!).add(q.ask!).div(2);
  if (perpLeg) return new Decimal(perpLeg.limitPrice);
  throw new Error("payoffGrid: need the L2 perp leg or its quote for a reference price");
}

export function payoffGrid(plan: StrategyPlan, quotes: Quote[]): PayoffGrid {
  const ref = referencePrice(plan, quotes);
  const fee = new Decimal(plan.feeReserveUsd);
  const prices = GRID_PCTS.map((p) => ref.mul(1 + p / 100).toDecimalPlaces(0));

  const common = prices.map((P) => {
    let pnl = fee.neg();
    for (const leg of plan.legs) {
      const qty = new Decimal(leg.quantity);
      const cost = new Decimal(leg.maxCostUsd);
      if (leg.type === "CALL") {
        const o = parseOption(leg.instrumentId);
        const k = o ? o.strike : new Decimal(0);
        pnl = pnl.add(Decimal.max(P.sub(k), 0).mul(qty)).sub(cost);
      } else if (leg.type === "PERP") {
        const entry = new Decimal(leg.limitPrice);
        const stop = new Decimal(plan.perpStopLossUsd);
        // Stopped out at about -15%; otherwise marked at P. Path dependence ignored.
        const raw = P.sub(entry).mul(qty);
        pnl = pnl.add(P.lte(entry.mul(new Decimal(1).sub(PERP_STOP_MOVE))) ? stop.neg() : Decimal.max(raw, stop.neg()));
      } else if (leg.type === "EVENT_NO") {
        const s = parseGeminiStrike(leg.instrumentId);
        const pays = s ? P.lt(s.strike) : false; // proxy: Nov 30 price = grid price
        pnl = pnl.add(pays ? qty : 0).sub(cost);
      }
    }
    return pnl;
  });

  const fed = plan.legs.find((l) => l.legId === "L3a");
  const fedQty = fed ? new Decimal(fed.quantity) : new Decimal(0);
  const fedCost = fed ? new Decimal(fed.maxCostUsd) : new Decimal(0);

  const notes = [
    `Perp exits at its $${plan.perpStopLossUsd} stop (about -${PERP_STOP_MOVE.mul(100).toString()}%) and is not held to Dec 11. A gap move can lose more than the modeled max loss.`,
    "L3b settles Nov 30; the grid uses the same BTC price for Nov 30 and the option expiry.",
    "Option P&L is intrinsic value at expiry (no time value).",
  ];
  if (fed) notes.push("Fed hedge (L3a) is a SIMULATED position priced from live Gemini mainnet data.");
  const l1 = plan.legs.find((l) => l.legId === "L1");
  if (l1?.expiryUtc && !l1.expiryUtc.startsWith("2026-12-11")) {
    notes.push(`L1 expires ${l1.expiryUtc.slice(0, 10)}, after the Fed decision; shown at intrinsic value.`);
  }

  return {
    btcPrices: prices.map((p) => p.toFixed(0)),
    pnlIfBigHike: common.map((c) => c.add(fedQty).sub(fedCost).toFixed(2)),
    pnlIfNoBigHike: common.map((c) => c.sub(fedCost).toFixed(2)),
    maxLossLineUsd: new Decimal(plan.modeledMaxLossUsd).neg().toFixed(2),
    notes,
  };
}
