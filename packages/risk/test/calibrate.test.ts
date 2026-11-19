import { describe, expect, it } from "vitest";
import type { MarginSnapshot } from "@ttp/shared";
import { calibrateRescueBand } from "../src/calibrate";
import { evaluateRisk } from "../src/evaluateRisk";

// Planned demo perp from docs/agents/lane-a.md: 0.0166 BTC at ~$63,900 (~$1,061),
// 5% maintenance rate -> ~$53 requirement.
const size = "0.0166";
const index = "63900";
const mm = "53.05";

describe("calibrateRescueBand", () => {
  it("$200 collateral projects too low (below 1.2), as the brief says", () => {
    const c = calibrateRescueBand({ equityUsd: "200", maintenanceMarginUsd: mm, perpSizeBtc: size, indexPriceUsd: index });
    expect(c.inBand).toBe(false);
    expect(Number(c.projectedRatio)).toBeLessThan(1.2);
    expect(c.action).toBe("DEPOSIT");
  });

  it("recommends a deposit that lands on the 1.35 target", () => {
    const c = calibrateRescueBand({ equityUsd: "200", maintenanceMarginUsd: mm, perpSizeBtc: size, indexPriceUsd: index });
    const after = calibrateRescueBand({
      equityUsd: String(200 + Number(c.adjustUsd)),
      maintenanceMarginUsd: mm,
      perpSizeBtc: size,
      indexPriceUsd: index,
    });
    expect(Number(after.projectedRatio)).toBeCloseTo(1.35, 2);
    expect(after.inBand).toBe(true);
    // Brief's rough range: about $225-238, mid-band about $230.
    expect(Number(c.targetEquityUsd)).toBeGreaterThan(225);
    expect(Number(c.targetEquityUsd)).toBeLessThan(238);
  });

  it("suggests a withdrawal when over-collateralised and NONE when already at target", () => {
    const rich = calibrateRescueBand({ equityUsd: "400", maintenanceMarginUsd: mm, perpSizeBtc: size, indexPriceUsd: index });
    expect(rich.action).toBe("WITHDRAW");
    expect(rich.inBand).toBe(false);
    const exact = calibrateRescueBand({ equityUsd: rich.targetEquityUsd, maintenanceMarginUsd: mm, perpSizeBtc: size, indexPriceUsd: index });
    expect(exact.action).toBe("NONE");
  });

  it("band edges: min is inclusive, max is exclusive", () => {
    const c = calibrateRescueBand({ equityUsd: "230", maintenanceMarginUsd: mm, perpSizeBtc: size, indexPriceUsd: index });
    const lo = calibrateRescueBand({ equityUsd: c.bandEquityUsd.min, maintenanceMarginUsd: mm, perpSizeBtc: size, indexPriceUsd: index });
    const hi = calibrateRescueBand({ equityUsd: c.bandEquityUsd.maxExclusive, maintenanceMarginUsd: mm, perpSizeBtc: size, indexPriceUsd: index });
    expect(Number(lo.projectedRatio)).toBeCloseTo(1.2, 1);
    expect(Number(hi.projectedRatio)).toBeCloseTo(1.5, 1);
  });

  it("agrees with evaluateRisk: the calibrated equity takes the vault-then-request path", () => {
    const c = calibrateRescueBand({ equityUsd: "200", maintenanceMarginUsd: mm, perpSizeBtc: size, indexPriceUsd: index });
    const equity = c.targetEquityUsd;
    const margin: MarginSnapshot = {
      account: "perp",
      equityUsd: equity,
      maintenanceMarginUsd: mm,
      initialMarginUsd: "80",
      marginRatio: "4",
      perpSizeBtc: size,
      indexPriceUsd: index,
      source: "TESTNET",
      timestamp: "2026-11-18T00:00:00.000Z",
    };
    const decision = evaluateRisk({
      margin,
      shockPct: "-15",
      perpUnrealizedPnlUsd: "0",
      perpStopLossUsd: "160",
      treasury: { perTxCapUsdc6: "25000000", remainingDailyUsdc6: "50000000", balanceUsdc6: "150000000" },
      openRequest: null,
      currentState: "NORMAL",
    });
    expect(decision.nextState).toBe("FUNDING_ELIGIBLE");
    // Top-up to 2.0 exceeds the 25 USDC per-tx cap, so the vault attempt reverts (demo step 6).
    expect(Number(decision.topUpUsdc6)).toBeGreaterThan(25_000_000);
  });

  it("refuses to calibrate with no open perp", () => {
    expect(() => calibrateRescueBand({ equityUsd: "230", maintenanceMarginUsd: "0", perpSizeBtc: "0", indexPriceUsd: index })).toThrow();
  });
});
