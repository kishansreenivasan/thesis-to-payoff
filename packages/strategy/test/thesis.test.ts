import { describe, expect, it } from "vitest";
import { ThesisIntent, UnsupportedThesis } from "@ttp/shared";
import { COMPILE_THESIS_INPUT_SCHEMA, CompileThesisArgs, intentFromGrok, parseThesisOffline, toIntent, type ThesisExtraction } from "../src/thesis";

const base: ThesisExtraction = {
  underlying: "BTC",
  direction: "BULLISH",
  horizonDate: "2026-12-11",
  maxRiskUsd: 500,
  fedHikeConcern: true,
  otherConcerns: [],
};
const text = "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.";

describe("toIntent (deterministic gate after Grok or the offline parser)", () => {
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

describe("intentFromGrok (MCP compile_thesis arguments)", () => {
  const args = {
    text,
    underlying: "BTC",
    direction: "BULLISH",
    horizonDate: "2026-12-11",
    maxRiskUsd: 500,
    fedHikeConcern: true,
    otherConcerns: [],
  };

  it("accepts Grok's fields for the demo thesis", () => {
    expect(ThesisIntent.parse(intentFromGrok(args))).toMatchObject({ maxRiskUsd: "500", eventConcern: "FED_HIKE_GT25", rawText: text });
  });

  it("optional fields can be omitted", () => {
    const { horizonDate: _h, otherConcerns: _o, ...minimal } = args;
    expect(intentFromGrok(minimal)).toMatchObject({ horizonUtc: "2026-12-11T08:00:00.000Z" });
  });

  it("malformed arguments become a friendly unsupported reply, never a throw", () => {
    for (const bad of [null, {}, { ...args, maxRiskUsd: "five hundred" }, { ...args, underlying: "DOGE" }, { ...args, text: "" }]) {
      expect(UnsupportedThesis.parse(intentFromGrok(bad)).supportedExamples).toHaveLength(2);
    }
  });

  it("Grok cannot invent a max risk that is not in the user's text", () => {
    expect(intentFromGrok({ ...args, maxRiskUsd: 5000 })).toMatchObject({ supported: false });
  });

  it("the published JSON Schema lists the same required fields the validator needs", () => {
    expect([...COMPILE_THESIS_INPUT_SCHEMA.required].sort()).toEqual(["direction", "fedHikeConcern", "maxRiskUsd", "text", "underlying"]);
    expect(Object.keys(COMPILE_THESIS_INPUT_SCHEMA.properties).sort()).toEqual(Object.keys(CompileThesisArgs.shape).sort());
  });
});

describe("parseThesisOffline phrasings", () => {
  it.each([
    ["Long bitcoin into December, risking up to $500. Scared of a big Fed hike.", "500", "FED_HIKE_GT25"],
    ["Bullish BTC, $750 max loss", "750", "NONE"],
    ["BTC goes higher through December. Maximum risk: $1,000", "1000", "NONE"],
  ])("%s", (t, risk, concern) => {
    expect(parseThesisOffline(t)).toMatchObject({ maxRiskUsd: risk, eventConcern: concern });
  });
});
