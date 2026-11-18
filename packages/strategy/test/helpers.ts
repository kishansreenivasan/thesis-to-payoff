import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Quote, ThesisIntent } from "@ttp/shared";

const root = fileURLToPath(new URL("../../../", import.meta.url));
export const demoQuotes = (): Quote[] =>
  (JSON.parse(readFileSync(root + "fixtures/b/demo-quotes.json", "utf8")).quotes as unknown[]).map((q) => Quote.parse(q));

export const demoIntent: ThesisIntent = ThesisIntent.parse({
  underlying: "BTC",
  direction: "BULLISH",
  horizonUtc: "2026-12-11T08:00:00.000Z",
  maxRiskUsd: "500",
  eventConcern: "FED_HIKE_GT25",
  rawText: "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.",
});
