// Dev tool, not runtime code: `pnpm --filter @ttp/risk calibrate [--shock -15] [--target 1.35]
// [--size 0.0166 --mm-rate 0.05]`. Reads the perp subaccount through @ttp/venues
// (VENUES_MODE=mock|real), prints current vs projected ratio and the test USDC to
// deposit or withdraw. READ ONLY: it never moves funds. A human deposits in the Derive app.
// It is not exported from @ttp/risk, so the "packages import only @ttp/shared" rule
// still holds for everything the orchestrator loads.
import { venues, MODE } from "@ttp/venues";
import { calibrateRescueBand, BAND_LOW, BAND_HIGH } from "../src/calibrate";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const shockPct = arg("shock") ?? "-15";
  const targetRatio = arg("target") ?? "1.35";
  const margin = await venues.getMargin("perp");
  const positions = await venues.getPositions("DERIVE", "perp");
  const perp = positions.find((p) => p.instrumentId.includes("PERP"));

  let size = margin.perpSizeBtc;
  let mm = margin.maintenanceMarginUsd;
  let hypothetical = false;
  if (Number(size) === 0) {
    // No open perp yet: size the planned one (Lane B plan: 0.0166 BTC) at the maintenance rate.
    hypothetical = true;
    size = arg("size") ?? "0.0166";
    const rate = arg("mm-rate") ?? "0.05"; // Derive mainnet perp rate; testnet unconfirmed
    mm = (Number(size) * Number(margin.indexPriceUsd) * Number(rate)).toFixed(4);
  }

  const c = calibrateRescueBand({
    equityUsd: margin.equityUsd,
    maintenanceMarginUsd: mm,
    perpSizeBtc: size,
    indexPriceUsd: margin.indexPriceUsd,
    shockPct,
    targetRatio,
  });

  console.log(`Rescue-band calibration  (VENUES_MODE=${MODE}, source ${margin.source}, READ ONLY)`);
  console.log(`  perp position      ${size} BTC${perp ? ` (${perp.instrumentId})` : ""}${hypothetical ? "  [HYPOTHETICAL: no perp open yet, using planned size and --mm-rate]" : ""}`);
  console.log(`  index price        $${margin.indexPriceUsd}`);
  console.log(`  equity (gross)     $${margin.equityUsd}`);
  console.log(`  maintenance req.   $${mm}   (gross = value - Derive's net maintenance_margin)`);
  console.log(`  current ratio      ${c.currentRatio}`);
  console.log(`  after ${shockPct}% shock  loss $${c.shockLossUsd} -> equity $${c.projectedEquityUsd} -> projected ratio ${c.projectedRatio}  ${c.inBand ? "IN rescue band" : "OUTSIDE rescue band"} [${BAND_LOW}, ${BAND_HIGH})`);
  console.log(`  band needs equity  $${c.bandEquityUsd.min} up to (not incl.) $${c.bandEquityUsd.maxExclusive}`);
  console.log(`  target ${targetRatio} equity  $${c.targetEquityUsd}`);
  if (c.action === "NONE") console.log("  -> already at target, nothing to do");
  else console.log(`  -> ${c.action} about $${c.adjustUsd} test USDC in the perp subaccount (a human does this in the Derive testnet app)`);
  if (hypothetical) console.log("  Re-run after the perp is open: a real maintenance requirement replaces the 5% estimate.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
