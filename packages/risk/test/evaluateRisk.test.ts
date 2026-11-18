import { describe, expect, it } from "vitest";
import type { MarginSnapshot, RiskInput } from "@ttp/shared";
import { evaluateRisk } from "../src/evaluateRisk";

const baseMargin: MarginSnapshot = {
  account: "perp",
  equityUsd: "1000",
  maintenanceMarginUsd: "500",
  initialMarginUsd: "750",
  marginRatio: "2",
  perpSizeBtc: "1",
  indexPriceUsd: "60000",
  source: "TESTNET",
  timestamp: "2026-11-18T00:00:00.000Z",
};

const baseTreasury = { perTxCapUsdc6: "25000000", remainingDailyUsdc6: "50000000", balanceUsdc6: "150000000" };

function input(overrides: Omit<Partial<RiskInput>, "margin"> & { margin?: Partial<MarginSnapshot> }): RiskInput {
  const { margin, ...rest } = overrides;
  return {
    margin: { ...baseMargin, ...margin },
    shockPct: "0",
    perpUnrealizedPnlUsd: "0",
    perpStopLossUsd: "160",
    treasury: baseTreasury,
    openRequest: null,
    currentState: "NORMAL",
    ...rest,
  };
}

describe("evaluateRisk: Section 8 threshold table", () => {
  it("row 1: projected >= 2.0 -> NORMAL, NONE", () => {
    const d = evaluateRisk(input({ margin: { equityUsd: "1000", maintenanceMarginUsd: "500" } }));
    expect(d.projectedRatio).toBe("2.0000");
    expect(d.nextState).toBe("NORMAL");
    expect(d.action).toBe("NONE");
  });

  it("row 1: projected >= 2.0 from a degraded state -> RECOVERED", () => {
    const d = evaluateRisk(
      input({ margin: { equityUsd: "1000", maintenanceMarginUsd: "500" }, currentState: "DELEVERAGE_REQUIRED" }),
    );
    expect(d.nextState).toBe("RECOVERED");
    expect(d.action).toBe("NONE");
  });

  it("row 2: 1.5 <= projected < 2.0 -> WARN, ALERT", () => {
    const d = evaluateRisk(input({ margin: { equityUsd: "800", maintenanceMarginUsd: "500" } }));
    expect(d.projectedRatio).toBe("1.6000");
    expect(d.nextState).toBe("WARN");
    expect(d.action).toBe("ALERT");
  });

  it("row 3: 1.2 <= projected < 1.5, no open request, top-up within caps -> FUNDING_ELIGIBLE, RELEASE_WITHIN_LIMITS", () => {
    const d = evaluateRisk(input({ margin: { equityUsd: "27", maintenanceMarginUsd: "20" } }));
    expect(d.projectedRatio).toBe("1.3500");
    expect(d.nextState).toBe("FUNDING_ELIGIBLE");
    expect(d.action).toBe("RELEASE_WITHIN_LIMITS");
    expect(d.topUpUsdc6).toBe("13000000");
  });

  it("row 3: 1.2 <= projected < 1.5, top-up exceeds caps -> FUNDING_ELIGIBLE, REQUEST_APPROVAL", () => {
    const d = evaluateRisk(input({ margin: { equityUsd: "135", maintenanceMarginUsd: "100" } }));
    expect(d.projectedRatio).toBe("1.3500");
    expect(d.nextState).toBe("FUNDING_ELIGIBLE");
    expect(d.action).toBe("REQUEST_APPROVAL");
    expect(d.topUpUsdc6).toBe("65000000");
  });

  it("row 4: open request pending (OWNER_APPROVAL_NEEDED), not expired -> APPROVAL_PENDING, NONE, overriding the ratio band", () => {
    const d = evaluateRisk(
      input({
        margin: { equityUsd: "135", maintenanceMarginUsd: "100" },
        openRequest: { requestId: "0xabc", state: "OWNER_APPROVAL_NEEDED", expiresAtUtc: "2099-01-01T00:00:00.000Z" },
      }),
    );
    expect(d.nextState).toBe("APPROVAL_PENDING");
    expect(d.action).toBe("NONE");
  });

  it("row 4: open request pending (REQUESTED), not expired -> APPROVAL_PENDING, NONE", () => {
    const d = evaluateRisk(
      input({
        margin: { equityUsd: "135", maintenanceMarginUsd: "100" },
        openRequest: { requestId: "0xabc", state: "REQUESTED", expiresAtUtc: "2099-01-01T00:00:00.000Z" },
      }),
    );
    expect(d.nextState).toBe("APPROVAL_PENDING");
    expect(d.action).toBe("NONE");
  });

  it("row 5: projected < 1.2, no open request -> DELEVERAGE_REQUIRED, REDUCE_PERP", () => {
    const d = evaluateRisk(input({ margin: { equityUsd: "110", maintenanceMarginUsd: "100", perpSizeBtc: "1" } }));
    expect(d.projectedRatio).toBe("1.1000");
    expect(d.nextState).toBe("DELEVERAGE_REQUIRED");
    expect(d.action).toBe("REDUCE_PERP");
    expect(d.reduceQtyBtc).toBe("0.450000");
  });

  it("row 5: request declined (REJECTED) overrides a healthy ratio -> DELEVERAGE_REQUIRED, REDUCE_PERP", () => {
    const d = evaluateRisk(
      input({
        margin: { equityUsd: "900", maintenanceMarginUsd: "500", perpSizeBtc: "1" },
        openRequest: { requestId: "0xabc", state: "REJECTED", expiresAtUtc: "2026-01-01T00:00:00.000Z" },
      }),
    );
    expect(d.nextState).toBe("DELEVERAGE_REQUIRED");
    expect(d.action).toBe("REDUCE_PERP");
    expect(d.reasonCode).toBe("RequestDeclinedOrExpired");
    expect(d.reduceQtyBtc).toBe("0.100000");
  });

  it("row 5: request EXPIRED overrides a healthy ratio -> DELEVERAGE_REQUIRED, REDUCE_PERP", () => {
    const d = evaluateRisk(
      input({
        margin: { equityUsd: "900", maintenanceMarginUsd: "500" },
        openRequest: { requestId: "0xabc", state: "EXPIRED", expiresAtUtc: "2026-01-01T00:00:00.000Z" },
      }),
    );
    expect(d.nextState).toBe("DELEVERAGE_REQUIRED");
    expect(d.reasonCode).toBe("RequestDeclinedOrExpired");
  });

  it("row 6: perp loss >= perp stop -> CLOSING, CLOSE_PERP, overriding even a healthy ratio", () => {
    const d = evaluateRisk(
      input({
        margin: { equityUsd: "1000", maintenanceMarginUsd: "500", perpSizeBtc: "1" },
        perpUnrealizedPnlUsd: "-200",
        perpStopLossUsd: "160",
      }),
    );
    expect(d.nextState).toBe("CLOSING");
    expect(d.action).toBe("CLOSE_PERP");
    expect(d.reduceQtyBtc).toBe("1.000000");
  });

  it("row 6: perp stop overrides even a pending approval request", () => {
    const d = evaluateRisk(
      input({
        margin: { equityUsd: "1000", maintenanceMarginUsd: "500" },
        perpUnrealizedPnlUsd: "-200",
        perpStopLossUsd: "160",
        openRequest: { requestId: "0xabc", state: "OWNER_APPROVAL_NEEDED", expiresAtUtc: "2099-01-01T00:00:00.000Z" },
      }),
    );
    expect(d.nextState).toBe("CLOSING");
    expect(d.action).toBe("CLOSE_PERP");
  });
});

describe("evaluateRisk: resolved open requests fall through to the ratio bands", () => {
  it("ARC_FINALIZED with a healthy ratio -> NORMAL, NONE (not APPROVAL_PENDING)", () => {
    const d = evaluateRisk(
      input({
        margin: { equityUsd: "1000", maintenanceMarginUsd: "500" },
        openRequest: { requestId: "0xabc", state: "ARC_FINALIZED", expiresAtUtc: null as unknown as string },
      }),
    );
    expect(d.nextState).toBe("NORMAL");
    expect(d.action).toBe("NONE");
  });

  it("VENUE_CREDIT_SIMULATED does not fix a low real ratio -> still DELEVERAGE_REQUIRED", () => {
    const d = evaluateRisk(
      input({
        margin: { equityUsd: "110", maintenanceMarginUsd: "100" },
        openRequest: { requestId: "0xabc", state: "VENUE_CREDIT_SIMULATED", expiresAtUtc: null as unknown as string },
      }),
    );
    expect(d.nextState).toBe("DELEVERAGE_REQUIRED");
    expect(d.action).toBe("REDUCE_PERP");
  });
});

describe("evaluateRisk: shock math and guards", () => {
  it("applies shockPct to the index price, scaled by position size", () => {
    const d = evaluateRisk(
      input({
        margin: { equityUsd: "1000", maintenanceMarginUsd: "500", perpSizeBtc: "1", indexPriceUsd: "60000" },
        shockPct: "-10",
        perpStopLossUsd: "999999",
      }),
    );
    // priceDelta = 60000 * -10% = -6000; additionalPnl = 1 * -6000 = -6000
    // projectedEquity = 1000 - 6000 = -5000; projectedRatio = -5000 / 500 = -10
    expect(d.projectedRatio).toBe("-10.0000");
    expect(d.nextState).toBe("DELEVERAGE_REQUIRED");
    expect(d.reduceQtyBtc).toBe("1.000000"); // clamped: can't reduce more than the position holds
  });

  it("fails safe when maintenance margin is zero or negative", () => {
    const d = evaluateRisk(input({ margin: { maintenanceMarginUsd: "0" } }));
    expect(d.nextState).toBe("FAILED_SAFE");
    expect(d.action).toBe("NONE");
    expect(d.reasonCode).toBe("InvalidMarginData");
  });

  it("always labels the projection SIMULATED", () => {
    const d = evaluateRisk(input({}));
    expect(d.projectedSource).toBe("SIMULATED");
  });
});
