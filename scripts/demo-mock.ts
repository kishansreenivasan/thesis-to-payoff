// pnpm demo:mock (Lane C). Must always run on main.
// TODO(Lane C, task 2): run the full DESIGN.md Section 16 script against Lane A/B mocks.
import { ThesisIntent } from "@ttp/shared";

const intent = ThesisIntent.parse({
  underlying: "BTC",
  direction: "BULLISH",
  horizonUtc: "2026-12-11T08:00:00Z",
  maxRiskUsd: "500",
  eventConcern: "FED_HIKE_GT25",
  rawText: "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.",
});

console.log("[demo:mock] skeleton OK. Parsed demo intent:", intent);
console.log("[demo:mock] Full mock demo lands with Lane C task 2.");
