import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { GeminiEvent, MarginSnapshot, Order, Quote, VenuePosition } from "@ttp/shared";
import { createMockVenues } from "../src/mock";
import { geminiOrderInstrument, parseGeminiOrderInstrument } from "../src/conventions";

const perpOrder = (side: "BUY" | "SELL", quantity: string, id: string, reduceOnly = false) => ({
  clientOrderId: id,
  strategyId: "s1",
  legId: "L2",
  venue: "DERIBIT" as const,
  account: "perp" as const,
  instrumentId: "BTC_USDC-PERPETUAL",
  side,
  quantity,
  limitPrice: side === "BUY" ? "64885.00" : "64875.00",
  reduceOnly,
});

describe("venues mock", () => {
  it("returns schema-valid SIMULATED data", async () => {
    const v = createMockVenues();
    const q = Quote.parse(await v.getQuote("DERIBIT", "BTC-11DEC26-65000-C"));
    expect(q.source).toBe("SIMULATED");
    const events = (await v.discoverGeminiEvents("mainnet", "FED")).map((e) => GeminiEvent.parse(e));
    expect(events.map((e) => e.eventTicker)).toEqual(["FED261211"]);
    MarginSnapshot.parse(await v.getMargin("perp"));
    expect((await v.getIndexPrice()).source).toBe("SIMULATED");
  });

  it("fills orders, is idempotent on clientOrderId, and tracks positions", async () => {
    const v = createMockVenues();
    const a = Order.parse(await v.placeOrder(perpOrder("BUY", "0.0164", "c1")));
    const b = await v.placeOrder(perpOrder("BUY", "0.0164", "c1"));
    expect(a.state).toBe("FILLED");
    expect(b.venueOrderId).toBe(a.venueOrderId);
    const [pos] = (await v.getPositions("DERIBIT", "perp")).map((p) => VenuePosition.parse(p));
    expect(pos!.quantity).toBe("0.0164");
    expect(await v.getOrder("DERIBIT", "missing")).toBeNull();
  });

  it("a -15% shock on the demo perp projects into the 1.2-1.5 band; reduce-only sell lowers maintenance", async () => {
    const v = createMockVenues();
    await v.placeOrder(perpOrder("BUY", "0.0164", "open"));
    const m = await v.getMargin("perp");
    expect(new Decimal(m.marginRatio).gte(2)).toBe(true);
    const shockPnl = new Decimal(m.perpSizeBtc).mul(m.indexPriceUsd).mul("-0.15");
    const projected = new Decimal(m.equityUsd).add(shockPnl).div(m.maintenanceMarginUsd);
    expect(projected.gte("1.2") && projected.lt("1.5")).toBe(true);

    await v.placeOrder(perpOrder("SELL", "0.0082", "reduce", true));
    const after = await v.getMargin("perp");
    expect(new Decimal(after.maintenanceMarginUsd).lt(m.maintenanceMarginUsd)).toBe(true);
    expect(after.perpSizeBtc).toBe("0.0082");
  });

  it("Gemini order instrument convention round-trips", () => {
    const id = geminiOrderInstrument("GEMI-BTC2611302200-HI62500", "NO");
    expect(parseGeminiOrderInstrument(id)).toEqual({ symbol: "GEMI-BTC2611302200-HI62500", outcome: "NO" });
    expect(() => parseGeminiOrderInstrument("GEMI-X")).toThrow();
  });
});
