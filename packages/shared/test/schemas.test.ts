import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ActivityEvent, Dec, Source, ThesisIntent } from "../src/index";

const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("shared schemas", () => {
  it("schemas.ts is verbatim DESIGN.md Section 5", () => {
    const design = readFileSync(root + "DESIGN.md", "utf8");
    const start = design.indexOf("// packages/shared/src/schemas.ts");
    const end = design.indexOf("\n```", start);
    const block = design.slice(start, end + 1);
    const file = readFileSync(root + "packages/shared/src/schemas.ts", "utf8");
    expect(file).toBe(block);
  });

  it("parses the demo thesis intent", () => {
    const intent: ThesisIntent = ThesisIntent.parse({
      underlying: "BTC",
      direction: "BULLISH",
      horizonUtc: "2026-12-11T08:00:00Z",
      maxRiskUsd: "500",
      eventConcern: "FED_HIKE_GT25",
      rawText: "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.",
    });
    expect(intent.maxRiskUsd).toBe("500");
  });

  it("Dec rejects non-decimal strings", () => {
    expect(Dec.safeParse("12.50").success).toBe(true);
    expect(Dec.safeParse("1e5").success).toBe(false);
  });

  it("ActivityEvent requires a source label", () => {
    const base = { seq: 1, timestamp: "2026-11-18T00:00:00Z", positionId: null, type: "X", reasonCode: null, details: {} };
    expect(ActivityEvent.safeParse(base).success).toBe(false);
    expect(ActivityEvent.safeParse({ ...base, source: Source.enum.SIMULATED }).success).toBe(true);
  });
});
