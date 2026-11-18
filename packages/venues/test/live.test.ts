// Live keyless reads against public endpoints. Off by default; run with VENUES_LIVE=1 pnpm test.
import { describe, expect, it } from "vitest";
import { GeminiEvent, Quote } from "@ttp/shared";
import { real } from "../src/real";

describe.skipIf(!process.env.VENUES_LIVE)("venues real, public endpoints (live)", () => {
  it("Deribit testnet index and perp quote", async () => {
    const idx = await real.getIndexPrice();
    expect(Number(idx.priceUsd)).toBeGreaterThan(1000);
    const q = Quote.parse(await real.getQuote("DERIBIT", "BTC_USDC-PERPETUAL", "testnet"));
    expect(q.source).toBe("TESTNET");
  });

  it("Gemini mainnet FED261211 and HIKEGT25 quote", async () => {
    const [ev] = (await real.discoverGeminiEvents("mainnet", "FED261211")).map((e) => GeminiEvent.parse(e));
    expect(ev!.contracts.some((c) => c.instrumentSymbol === "GEMI-FED261211-HIKEGT25")).toBe(true);
    const q = Quote.parse(await real.getQuote("GEMINI", "GEMI-FED261211-HIKEGT25", "mainnet"));
    expect(q.source).toBe("LIVE_MAINNET_READONLY");
  });

  it("Gemini sandbox lists BTC2611302200", async () => {
    const events = await real.discoverGeminiEvents("sandbox", "BTC2611302200");
    expect(events[0]!.source).toBe("SANDBOX");
  });
}, 30_000);
