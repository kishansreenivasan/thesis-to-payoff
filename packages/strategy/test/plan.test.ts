import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { StrategyPlan } from "@ttp/shared";
import { buildPlan, PlanError } from "../src/plan";
import { demoIntent, demoQuotes } from "./helpers";

const leg = (p: StrategyPlan, id: string) => p.legs.find((l) => l.legId === id)!;

function expectPlanError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PlanError);
    expect((e as PlanError).code).toBe(code);
    return;
  }
  throw new Error(`expected PlanError ${code}`);
}

describe("buildPlan, demo thesis", () => {
  const plan = buildPlan(demoIntent, demoQuotes());

  it("is a valid StrategyPlan with four legs in L1, L2, L3a, L3b order", () => {
    expect(() => StrategyPlan.parse(plan)).not.toThrow();
    expect(plan.legs.map((l) => l.legId)).toEqual(["L1", "L2", "L3a", "L3b"]);
  });

  it("L1 buys the Dec 11 Derive call nearest the reference price, at the ask, in 0.01 BTC lots", () => {
    const l1 = leg(plan, "L1");
    expect(l1.venue).toBe("DERIVE");
    expect(l1.instrumentId).toBe("BTC-20261211-65000-C");
    expect(l1.quantity).toBe("0.1"); // $230 / ($2,180 + $19.46 fee) = 0.1045 BTC, floored to 0.01
    expect(l1.limitPrice).toBe("2180.00");
    expect(l1.expiryUtc).toBe("2026-12-11T08:00:00.000Z");
    expect(new Decimal(l1.maxCostUsd).lte(230)).toBe(true);
  });

  it("L2 perp is sized so a -15% move reaches the $160 stop", () => {
    const l2 = leg(plan, "L2");
    expect(l2.venue).toBe("DERIVE");
    expect(l2.instrumentId).toBe("BTC-PERP");
    expect(l2.quantity).toBe("0.0164");
    const lossAt15 = new Decimal(l2.quantity).mul(l2.limitPrice).mul("0.15");
    expect(lossAt15.lte(160)).toBe(true);
    expect(lossAt15.gt(155)).toBe(true);
    expect(plan.perpStopLossUsd).toBe("160.00");
  });

  it("L3a is SIMULATED, L3b buys NO on the highest strike at or below BTC", () => {
    const l3a = leg(plan, "L3a");
    expect(l3a.executionMode).toBe("SIMULATED");
    expect(l3a.quantity).toBe("571");
    const l3b = leg(plan, "L3b");
    expect(l3b.instrumentId).toBe("GEMI-BTC2611302200-HI62500");
    expect(l3b.type).toBe("EVENT_NO");
    expect(l3b.limitPrice).toBe("0.38");
    expect(l3b.quantity).toBe("105");
    expect(l3b.executionMode).toBe("REAL");
  });

  it("modeled max loss stays within $500 and matches the budget table", () => {
    expect(plan.feeReserveUsd).toBe("30.00");
    expect(new Decimal(plan.modeledMaxLossUsd).lte(500)).toBe(true);
    const premium = ["L1", "L3a", "L3b"].reduce((s, id) => s.add(leg(plan, id).maxCostUsd), new Decimal(0));
    expect(plan.modeledMaxLossUsd).toBe(premium.add(160).add(30).toFixed(2));
  });

  it("is deterministic: same inputs give the same versionHash", () => {
    expect(buildPlan(demoIntent, demoQuotes()).versionHash).toBe(plan.versionHash);
    expect(buildPlan({ ...demoIntent, maxRiskUsd: "600" }, demoQuotes()).versionHash).not.toBe(plan.versionHash);
  });
});

describe("buildPlan, edge cases", () => {
  it("falls back to Dec 25 when Dec 11 is not quoted", () => {
    const quotes = demoQuotes()
      .filter((q) => !q.instrumentId.includes("20261211"))
      .concat({ ...demoQuotes()[1]!, instrumentId: "BTC-20261225-65000-C", ask: "3048.00" });
    const p = buildPlan(demoIntent, quotes);
    expect(leg(p, "L1").instrumentId).toBe("BTC-20261225-65000-C");
    expect(leg(p, "L1").quantity).toBe("0.07"); // live Dec 25 ATM price fits $230 at 0.07 BTC
    expect(p.assumptions.some((a) => a.includes("20261225"))).toBe(true);
  });

  it("refuses when even the 0.01 BTC minimum of every call costs more than the L1 budget", () => {
    const quotes = demoQuotes().map((q) => (q.instrumentId.includes("-C") ? { ...q, ask: "30000.00" } : q));
    expectPlanError(() => buildPlan(demoIntent, quotes), "L1_BUDGET_BELOW_MIN_SIZE");
  });

  it("refuses when no L3b strike has a YES bid", () => {
    const quotes = demoQuotes().map((q) => (q.instrumentId.includes("BTC2611302200") ? { ...q, bid: null, bidSize: null } : q));
    expectPlanError(() => buildPlan(demoIntent, quotes), "NO_L3B_STRIKE");
  });

  it("accepts quotes still tagged with the old DERIBIT venue", () => {
    const quotes = demoQuotes().map((q) => (q.venue === "DERIVE" ? { ...q, venue: "DERIBIT" as const } : q));
    const p = buildPlan(demoIntent, quotes);
    expect(p.legs.find((l) => l.legId === "L1")!.venue).toBe("DERIVE");
  });

  it("drops L3a when there is no Fed concern", () => {
    const p = buildPlan({ ...demoIntent, eventConcern: "NONE" }, demoQuotes());
    expect(p.legs.map((l) => l.legId)).toEqual(["L1", "L2", "L3b"]);
  });

  it("needs a perp quote", () => {
    expectPlanError(() => buildPlan(demoIntent, demoQuotes().filter((q) => !q.instrumentId.includes("PERP"))), "NO_PERP_QUOTE");
  });
});

describe("buildPlan, decisions of 2026-11-18", () => {
  it("L1 takes the lowest out-of-the-money call whose minimum lot fits when at-the-money is too expensive", () => {
    const quotes = demoQuotes().map((q) =>
      q.instrumentId === "BTC-20261211-65000-C" ? { ...q, ask: "25000.00" } : q,
    );
    const p = buildPlan(demoIntent, quotes);
    const l1 = p.legs.find((l) => l.legId === "L1")!;
    expect(l1.instrumentId).toBe("BTC-20261211-70000-C");
    expect(l1.quantity).toBe("0.29"); // $230 / ($750 + $19.46 fee) = 0.298 BTC, floored to 0.01
    expect(p.assumptions.some((a) => a.includes("out-of-the-money"))).toBe(true);
  });

  it("L1 never picks an in-the-money strike to fit the budget", () => {
    const quotes = demoQuotes().map((q) => (q.instrumentId.includes("-C") && !q.instrumentId.includes("60000") ? { ...q, ask: "30000.00" } : q));
    expectPlanError(() => buildPlan(demoIntent, quotes), "L1_BUDGET_BELOW_MIN_SIZE");
  });

  it("L3b falls back to the lowest strike above BTC when none is at or below", () => {
    const quotes = demoQuotes().filter((q) => !/HI(60000|62500)$/.test(q.instrumentId));
    const p = buildPlan(demoIntent, quotes);
    const l3b = p.legs.find((l) => l.legId === "L3b")!;
    expect(l3b.instrumentId).toBe("GEMI-BTC2611302200-HI65000");
    expect(l3b.limitPrice).toBe("0.55");
    expect(p.assumptions.some((a) => a.includes("lowest strike above"))).toBe(true);
  });

  it("L3b ignores strikes with no YES bid and caps size at NO liquidity", () => {
    const quotes = demoQuotes()
      .filter((q) => !/HI(60000|62500|65000)$/.test(q.instrumentId))
      .map((q) => (q.instrumentId.endsWith("HI67500") ? { ...q, bid: "0.32", bidSize: "1", ask: null, askSize: null } : q))
      .concat({ ...demoQuotes()[5]!, instrumentId: "GEMI-BTC2611302200-HI70000", bid: null, bidSize: null });
    const p = buildPlan(demoIntent, quotes);
    const l3b = p.legs.find((l) => l.legId === "L3b")!;
    expect(l3b.instrumentId).toBe("GEMI-BTC2611302200-HI67500");
    expect(l3b.limitPrice).toBe("0.68");
    expect(l3b.quantity).toBe("1");
    expect(p.assumptions.some((a) => a.includes("capped"))).toBe(true);
  });
});
