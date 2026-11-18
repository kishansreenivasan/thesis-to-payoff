import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { PayoffGrid } from "@ttp/shared";
import { buildPlan } from "../src/plan";
import { payoffGrid } from "../src/payoff";
import { demoIntent, demoQuotes } from "./helpers";

describe("payoffGrid", () => {
  const quotes = demoQuotes();
  const plan = buildPlan(demoIntent, quotes);
  const grid = payoffGrid(plan, quotes);

  it("is a valid PayoffGrid with aligned arrays", () => {
    expect(() => PayoffGrid.parse(grid)).not.toThrow();
    expect(grid.btcPrices).toHaveLength(13);
    expect(grid.pnlIfBigHike).toHaveLength(13);
    expect(grid.pnlIfNoBigHike).toHaveLength(13);
  });

  it("includes the perp stop annotation", () => {
    expect(grid.notes.some((n) => n.includes("stop") && n.includes("not held to Dec 11"))).toBe(true);
  });

  it("big-hike line sits above the no-hike line by the Fed contracts' payout", () => {
    const fedQty = plan.legs.find((l) => l.legId === "L3a")!.quantity;
    grid.btcPrices.forEach((_, i) => {
      expect(new Decimal(grid.pnlIfBigHike[i]!).sub(grid.pnlIfNoBigHike[i]!).toFixed(2)).toBe(new Decimal(fedQty).toFixed(2));
    });
  });

  it("never loses more than the modeled max loss at any grid point", () => {
    expect(grid.maxLossLineUsd).toBe(`-${plan.modeledMaxLossUsd}`);
    for (const v of [...grid.pnlIfBigHike, ...grid.pnlIfNoBigHike]) {
      expect(new Decimal(v).gte(grid.maxLossLineUsd)).toBe(true);
    }
  });

  it("makes money in the bullish case", () => {
    expect(new Decimal(grid.pnlIfNoBigHike.at(-1)!).gt(0)).toBe(true);
  });
});
