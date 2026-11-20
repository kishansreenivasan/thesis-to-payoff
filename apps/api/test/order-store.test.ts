import { describe, expect, it } from "vitest";
import { createOrderStore } from "../src/order-store";

describe("SQLite activity event log", () => {
  it("assigns increasing IDs and reads events after a cursor", () => {
    const store = createOrderStore(":memory:");
    const event = (type: string) => ({
      timestamp: new Date().toISOString(), positionId: "pos_test", type, reasonCode: null,
      details: { sourceNote: "test" }, source: "SIMULATED" as const,
    });
    try {
      const first = store.appendEvent(event("PLAN_QUOTED"));
      const second = store.appendEvent(event("STRATEGY_APPROVED"));
      expect(second.seq).toBeGreaterThan(first.seq);
      expect(store.getEvents("pos_test")).toHaveLength(2);
      expect(store.getEvents("pos_test", first.seq)).toEqual([second]);
    } finally {
      store.close();
    }
  });
});

describe("deriveReduceQty", () => {
  it("rounds up to Derive's step and minimum, capped at the position", async () => {
    const { deriveReduceQty } = await import("../src/app");
    expect(deriveReduceQty("0.006092", "0.0172")).toBe("0.0100");
    expect(deriveReduceQty("0.012345", "0.0172")).toBe("0.0124");
    expect(deriveReduceQty("0.030000", "0.0172")).toBe("0.0172");
    expect(deriveReduceQty("0.0172", "-0.0172")).toBe("0.0172");
  });
});

describe("marketableSellLimit", () => {
  it("prices a rescue sell 1% through the bid on the 0.1 tick", async () => {
    const { marketableSellLimit } = await import("../src/app");
    expect(marketableSellLimit("61846.3")).toBe("61227.8");
  });
});

describe("perpEntryLimit", () => {
  it("allows at most 0.5% through the quote on the 0.1 tick", async () => {
    const { perpEntryLimit } = await import("../src/app");
    expect(perpEntryLimit("BUY", "61847.2")).toBe("62156.5");
    expect(perpEntryLimit("SELL", "61847.2")).toBe("61537.9");
  });
});
