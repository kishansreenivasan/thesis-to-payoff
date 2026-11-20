import { describe, expect, it } from "vitest";
import { Order, StrategyPlan, TransferRequest } from "@ttp/shared";
import { demo } from "../../apps/web/app/history/evidence";

describe("video demo evidence", () => {
  it("uses matching real receipts for the complete open, request and reduce-only flow", () => {
    const plan = StrategyPlan.parse(demo.plan);
    const orders = demo.orders.map((order) => Order.parse(order));
    expect(orders.map((order) => order.legId)).toEqual(["L3b", "L1", "L2"]);
    expect(orders.every((order) => order.strategyId === plan.strategyId && order.state === "FILLED" && order.venueOrderId && ["SANDBOX", "TESTNET"].includes(order.source))).toBe(true);
    expect(plan.legs.find((leg) => leg.legId === "L3a")?.executionMode).toBe("SIMULATED");
    expect(demo.shock.projectedSource).toBe("SIMULATED");
    const request = TransferRequest.parse(demo.request);
    expect(request.strategyId).toBe(plan.strategyId);
    expect(request.source).toBe("ONCHAIN_TESTNET");
    expect(request.requestId).toBe(demo.decline.requestId);
    expect(demo.decline.state).toBe("REJECTED");
    expect(demo.reverted.details.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(demo.reverted.reasonCode).toBe("ExceedsPerTxCap");
    expect(Order.parse(demo.reduction)).toMatchObject({ strategyId: plan.strategyId, reduceOnly: true, state: "FILLED", source: "TESTNET" });
    expect(demo.calibration.join("\n")).toContain("0.0072 BTC");
  });
});
