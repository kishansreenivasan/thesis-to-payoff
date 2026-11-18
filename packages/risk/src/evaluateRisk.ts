// @ttp/risk core logic, owned by Lane A. See docs/agents/lane-a.md and
// DESIGN.md Section 8 (thresholds, rescue sequence, budget).
//
// Pure, no network calls. Identical under RISK_MODE=mock and =real: there
// is nothing external to mock here, only the deterministic decision table.
import { Decimal } from "decimal.js";
import type { RiskDecision, RiskInput, RiskState } from "@ttp/shared";

const TARGET_RATIO = new Decimal(2);
const WARN_RATIO = new Decimal("1.5");
const FUNDING_RATIO = new Decimal("1.2");

const PENDING_REQUEST_STATES = new Set(["REQUESTED", "OWNER_APPROVAL_NEEDED"]);
const BAD_TERMINAL_REQUEST_STATES = new Set(["REJECTED", "EXPIRED", "FAILED"]);

function usd(d: Decimal): string {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function btc(d: Decimal): string {
  return d.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

/** USD decimal to an integer USDC-6 string, rounded up so the target is actually reached. */
function usdToUsdc6(usdAmount: Decimal): string {
  if (usdAmount.lte(0)) return "0";
  return usdAmount.times(1_000_000).ceil().toFixed(0);
}

function deleverage(
  projectedRatio: Decimal,
  perpSize: Decimal,
  projectedEquity: Decimal,
  maintenanceMargin: Decimal,
  reasonCode: string,
  explanation: string,
): RiskDecision {
  // Demo heuristic, not a safety guarantee (DESIGN.md Section 8): assumes
  // maintenance margin scales linearly with position size, and that
  // reducing size realizes the mark-to-market PnL without changing equity.
  const mmPerBtc = perpSize.isZero() ? new Decimal(0) : maintenanceMargin.dividedBy(perpSize);
  let reduceQty = new Decimal(0);
  if (mmPerBtc.gt(0)) {
    const targetSize = projectedEquity.dividedBy(TARGET_RATIO.times(mmPerBtc));
    reduceQty = Decimal.max(0, perpSize.minus(targetSize));
  }
  reduceQty = Decimal.min(reduceQty, perpSize);

  return {
    projectedRatio: projectedRatio.toFixed(4),
    projectedSource: "SIMULATED",
    nextState: "DELEVERAGE_REQUIRED",
    action: "REDUCE_PERP",
    topUpUsdc6: null,
    reduceQtyBtc: btc(reduceQty),
    reasonCode,
    explanation,
  };
}

export function evaluateRisk(input: RiskInput): RiskDecision {
  const { margin, shockPct, perpUnrealizedPnlUsd, perpStopLossUsd, treasury, openRequest, currentState } = input;

  const maintenanceMargin = new Decimal(margin.maintenanceMarginUsd);
  if (maintenanceMargin.lte(0)) {
    return {
      projectedRatio: "0",
      projectedSource: "SIMULATED",
      nextState: "FAILED_SAFE",
      action: "NONE",
      topUpUsdc6: null,
      reduceQtyBtc: null,
      reasonCode: "InvalidMarginData",
      explanation:
        "Maintenance margin reported as zero or negative; the risk engine cannot project a ratio, so it is failing safe and taking no action.",
    };
  }

  const equity = new Decimal(margin.equityUsd);
  const indexPrice = new Decimal(margin.indexPriceUsd);
  const perpSize = new Decimal(margin.perpSizeBtc);
  const shock = new Decimal(shockPct);

  const priceDelta = indexPrice.times(shock).dividedBy(100);
  const additionalPnl = perpSize.times(priceDelta);
  const projectedEquity = equity.plus(additionalPnl);
  const projectedPerpPnl = new Decimal(perpUnrealizedPnlUsd).plus(additionalPnl);
  const projectedRatio = projectedEquity.dividedBy(maintenanceMargin);

  const stopLoss = new Decimal(perpStopLossUsd);
  if (projectedPerpPnl.negated().gte(stopLoss)) {
    return {
      projectedRatio: projectedRatio.toFixed(4),
      projectedSource: "SIMULATED",
      nextState: "CLOSING",
      action: "CLOSE_PERP",
      topUpUsdc6: null,
      reduceQtyBtc: btc(perpSize),
      reasonCode: "PerpStopLossHit",
      explanation: `Projected perp loss of $${usd(projectedPerpPnl.negated())} has reached the $${usd(stopLoss)} stop; closing the full perp position rather than holding it to expiry.`,
    };
  }

  if (openRequest) {
    if (PENDING_REQUEST_STATES.has(openRequest.state)) {
      return {
        projectedRatio: projectedRatio.toFixed(4),
        projectedSource: "SIMULATED",
        nextState: "APPROVAL_PENDING",
        action: "NONE",
        topUpUsdc6: null,
        reduceQtyBtc: null,
        reasonCode: "AwaitingOwnerApproval",
        explanation: `A release request for the top-up is awaiting the owner's decision (expires ${openRequest.expiresAtUtc}); waiting rather than opening a second request.`,
      };
    }
    if (BAD_TERMINAL_REQUEST_STATES.has(openRequest.state)) {
      return deleverage(
        projectedRatio,
        perpSize,
        projectedEquity,
        maintenanceMargin,
        "RequestDeclinedOrExpired",
        `The prior release request ended in state ${openRequest.state}; reducing the perp instead of waiting any longer.`,
      );
    }
    // OWNER_APPROVED / SUBMITTED / ARC_FINALIZED / VENUE_CREDIT_SIMULATED: resolved, fall through.
    // Simulated venue credit never changes real margin (DESIGN.md Section 8 step 7), so the
    // ratio bands below will still route to REDUCE_PERP if the real margin never improved.
  }

  if (projectedRatio.gte(TARGET_RATIO)) {
    const nextState: RiskState = currentState === "NORMAL" ? "NORMAL" : "RECOVERED";
    return {
      projectedRatio: projectedRatio.toFixed(4),
      projectedSource: "SIMULATED",
      nextState,
      action: "NONE",
      topUpUsdc6: null,
      reduceQtyBtc: null,
      reasonCode: "RatioHealthy",
      explanation: `Projected margin ratio ${projectedRatio.toFixed(2)} is at or above the 2.0 target; no action needed.`,
    };
  }

  if (projectedRatio.gte(WARN_RATIO)) {
    return {
      projectedRatio: projectedRatio.toFixed(4),
      projectedSource: "SIMULATED",
      nextState: "WARN",
      action: "ALERT",
      topUpUsdc6: null,
      reduceQtyBtc: null,
      reasonCode: "RatioWarn",
      explanation: `Projected margin ratio ${projectedRatio.toFixed(2)} has dropped below the 2.0 target; alerting while it is still at or above 1.5.`,
    };
  }

  if (projectedRatio.gte(FUNDING_RATIO)) {
    const topUpUsd = TARGET_RATIO.times(maintenanceMargin).minus(projectedEquity);
    const topUpUsdc6 = usdToUsdc6(topUpUsd);
    const withinLimits =
      new Decimal(topUpUsdc6).lte(new Decimal(treasury.perTxCapUsdc6)) &&
      new Decimal(topUpUsdc6).lte(new Decimal(treasury.remainingDailyUsdc6)) &&
      new Decimal(topUpUsdc6).lte(new Decimal(treasury.balanceUsdc6));
    return {
      projectedRatio: projectedRatio.toFixed(4),
      projectedSource: "SIMULATED",
      nextState: "FUNDING_ELIGIBLE",
      action: withinLimits ? "RELEASE_WITHIN_LIMITS" : "REQUEST_APPROVAL",
      topUpUsdc6,
      reduceQtyBtc: null,
      reasonCode: withinLimits ? "TopUpWithinLimits" : "TopUpExceedsLimits",
      explanation: withinLimits
        ? `Projected margin ratio ${projectedRatio.toFixed(2)} is below 1.5; releasing $${usd(topUpUsd)} from the vault to restore the 2.0 target.`
        : `Projected margin ratio ${projectedRatio.toFixed(2)} is below 1.5 and the $${usd(topUpUsd)} top-up exceeds the vault's per-transaction or daily limit; requesting owner approval.`,
    };
  }

  return deleverage(
    projectedRatio,
    perpSize,
    projectedEquity,
    maintenanceMargin,
    "RatioCritical",
    `Projected margin ratio ${projectedRatio.toFixed(2)} is below 1.2; reducing the perp to restore the 2.0 target.`,
  );
}
