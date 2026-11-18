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

  it("L1 buys 0.1 BTC of the 11DEC26 call nearest the reference price, at the ask", () => {
    const l1 = leg(plan, "L1");
    expect(l1.instrumentId).toBe("BTC-11DEC26-65000-C");
    expect(l1.quantity).toBe("0.1");
    expect(l1.limitPrice).toBe("2180.00");
    expect(l1.expiryUtc).toBe("2026-12-11T08:00:00.000Z");
    expect(new Decimal(l1.maxCostUsd).lte(230)).toBe(true);
  });

  it("L2 perp is sized so a -15% move reaches the $160 stop", () => {
    const l2 = leg(plan, "L2");
    expect(l2.instrumentId).toBe("BTC_USDC-PERPETUAL");
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
  it("falls back to 25DEC26 when 11DEC26 is not quoted", () => {
    const quotes = demoQuotes()
      .filter((q) => !q.instrumentId.includes("11DEC26"))
      .concat({ ...demoQuotes()[1]!, instrumentId: "BTC-25DEC26-65000-C", ask: "2190.00" });
    const p = buildPlan(demoIntent, quotes);
    expect(leg(p, "L1").instrumentId).toBe("BTC-25DEC26-65000-C");
    expect(p.assumptions.some((a) => a.includes("25DEC26"))).toBe(true);
  });

  it("refuses when the 0.1 BTC minimum costs more than the L1 budget", () => {
    const quotes = demoQuotes().map((q) => (q.instrumentId.includes("-C") ? { ...q, ask: "3500.00" } : q));
    expectPlanError(() => buildPlan(demoIntent, quotes), "L1_BUDGET_BELOW_MIN_SIZE");
  });

  it("refuses when no L3b strike is at or below BTC", () => {
    const quotes = demoQuotes().filter((q) => !/HI(60000|62500)$/.test(q.instrumentId));
    expectPlanError(() => buildPlan(demoIntent, quotes), "NO_L3B_STRIKE");
  });

  it("drops L3a when there is no Fed concern", () => {
    const p = buildPlan({ ...demoIntent, eventConcern: "NONE" }, demoQuotes());
    expect(p.legs.map((l) => l.legId)).toEqual(["L1", "L2", "L3b"]);
  });

  it("needs a perp quote", () => {
    expectPlanError(() => buildPlan(demoIntent, demoQuotes().filter((q) => !q.instrumentId.includes("PERP"))), "NO_PERP_QUOTE");
  });
});
