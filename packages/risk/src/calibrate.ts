// Rescue-band calibration (docs/agents/lane-a.md task 7). Pure, no network.
//
// Answers: "how much USDC should sit in the Derive perp subaccount so that a
// -15% shock projects a margin ratio inside the rescue band [1.2, 1.5)?"
// It mirrors evaluateRisk's projection exactly (same formula, same current
// maintenance requirement), so a number that lands in band here lands in band
// there. It never moves funds; a human deposits or withdraws.
import { Decimal } from "decimal.js";

export const BAND_LOW = new Decimal("1.2"); // inclusive: below this -> DELEVERAGE_REQUIRED
export const BAND_HIGH = new Decimal("1.5"); // exclusive: at or above this -> WARN
export const BAND_TARGET = new Decimal("1.35");

export interface CalibrationInput {
  /** Gross account equity in USD (Derive `subaccount_value`). */
  equityUsd: string;
  /** Gross maintenance requirement in USD (`subaccount_value - net maintenance_margin`). */
  maintenanceMarginUsd: string;
  perpSizeBtc: string;
  indexPriceUsd: string;
  /** Default "-15". */
  shockPct?: string;
  /** Default 1.35. */
  targetRatio?: string;
}

export interface Calibration {
  currentRatio: string;
  projectedRatio: string;
  projectedEquityUsd: string;
  shockLossUsd: string;
  inBand: boolean;
  /** Equity needed for the projected ratio to equal the target. */
  targetEquityUsd: string;
  /** Equity range that lands in [1.2, 1.5). Upper bound is exclusive. */
  bandEquityUsd: { min: string; maxExclusive: string };
  /** Test USDC to deposit (+) or withdraw (-) so the projection hits the target. */
  adjustUsd: string;
  action: "DEPOSIT" | "WITHDRAW" | "NONE";
}

const d2 = (x: Decimal) => x.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

export function calibrateRescueBand(input: CalibrationInput): Calibration {
  const equity = new Decimal(input.equityUsd);
  const mm = new Decimal(input.maintenanceMarginUsd);
  if (mm.lte(0)) throw new Error("Maintenance requirement is zero: there is no open perp to calibrate against.");
  const size = new Decimal(input.perpSizeBtc);
  const index = new Decimal(input.indexPriceUsd);
  const shock = new Decimal(input.shockPct ?? "-15");
  const target = new Decimal(input.targetRatio ?? BAND_TARGET);

  const shockPnl = size.times(index).times(shock).dividedBy(100); // same as evaluateRisk's additionalPnl
  const projectedEquity = equity.plus(shockPnl);
  const projected = projectedEquity.dividedBy(mm);
  const targetEquity = target.times(mm).minus(shockPnl);
  const adjust = targetEquity.minus(equity);

  return {
    currentRatio: equity.dividedBy(mm).toFixed(4),
    projectedRatio: projected.toFixed(4),
    projectedEquityUsd: d2(projectedEquity),
    shockLossUsd: d2(shockPnl.negated()),
    inBand: projected.gte(BAND_LOW) && projected.lt(BAND_HIGH),
    targetEquityUsd: d2(targetEquity),
    bandEquityUsd: {
      min: d2(BAND_LOW.times(mm).minus(shockPnl)),
      maxExclusive: d2(BAND_HIGH.times(mm).minus(shockPnl)),
    },
    adjustUsd: d2(adjust.abs()),
    action: adjust.abs().lt("0.01") ? "NONE" : adjust.gt(0) ? "DEPOSIT" : "WITHDRAW",
  };
}
