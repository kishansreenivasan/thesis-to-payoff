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
