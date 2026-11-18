import { describe, expect, it } from "vitest";
import { ThesisIntent, UnsupportedThesis } from "@ttp/shared";
import { parseThesisOffline, toIntent, type ThesisExtraction } from "../src/thesis";

const base: ThesisExtraction = {
  underlying: "BTC",
  direction: "BULLISH",
  horizonDate: "2026-12-11",
  maxRiskUsd: 500,
  fedHikeConcern: true,
  otherConcerns: [],
};
const text = "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.";

describe("toIntent (deterministic gate after the LLM)", () => {
  it("accepts the demo thesis", () => {
    const r = ThesisIntent.parse(toIntent(base, text));
    expect(r).toMatchObject({ maxRiskUsd: "500", eventConcern: "FED_HIKE_GT25", horizonUtc: "2026-12-11T08:00:00.000Z" });
  });

  it.each([
    ["other asset", { underlying: "OTHER" as const }],
    ["bearish", { direction: "BEARISH" as const }],
    ["no max risk", { maxRiskUsd: null }],
    ["extra hedges", { otherConcerns: ["ETH crash"] }],
  ])("rejects %s with examples", (_, patch) => {
    const r = UnsupportedThesis.parse(toIntent({ ...base, ...patch }, text));
    expect(r.supportedExamples).toHaveLength(2);
  });

  it("rejects a max risk that is not in the user's text", () => {
    expect(toIntent({ ...base, maxRiskUsd: 5000 }, text)).toMatchObject({ supported: false });
  });

  it("reads comma amounts", () => {
    expect(toIntent({ ...base, maxRiskUsd: 1500 }, "Bullish BTC, max risk $1,500")).toMatchObject({ maxRiskUsd: "1500" });
  });

  it("uses the default horizon for a missing or bad date", () => {
    expect(toIntent({ ...base, horizonDate: "soon" }, text)).toMatchObject({ horizonUtc: "2026-12-11T08:00:00.000Z" });
  });
});

describe("parseThesisOffline (mock)", () => {
  it("parses the demo thesis", () => {
    expect(parseThesisOffline(text)).toMatchObject({ maxRiskUsd: "500", eventConcern: "FED_HIKE_GT25" });
  });
  it("rejects ETH and bearish theses", () => {
    expect(parseThesisOffline("Bullish ETH, max risk $500")).toMatchObject({ supported: false });
    expect(parseThesisOffline("Bearish BTC, max risk $500")).toMatchObject({ supported: false });
  });
  it("NONE event concern without the Fed", () => {
    expect(parseThesisOffline("Bullish BTC through mid-December. Max risk $500.")).toMatchObject({ eventConcern: "NONE" });
  });
});
