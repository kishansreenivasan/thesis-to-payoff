import { afterEach, describe, expect, it, vi } from "vitest";
import { mock as strategy } from "@ttp/strategy";
import { createMockVenues } from "@ttp/venues";
import type { OrderRequest, Quote } from "@ttp/shared";
import { buildApp } from "../src/app";
import { validateEntryQuote } from "../src/entry-quote";
import { apiHost, localOperatorAccess } from "../src/local-access";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const order: OrderRequest = { clientOrderId: "entry", strategyId: "s", legId: "L3b", venue: "GEMINI", account: "sandbox", instrumentId: "BTC:NO", side: "BUY", quantity: "10", limitPrice: "0.7", reduceOnly: false };
const quote: Quote = { venue: "GEMINI", instrumentId: "BTC", bid: "0.3", ask: "0.4", bidSize: "10", askSize: "12", timestamp: "2026-11-20T09:00:00.000Z", source: "SANDBOX", feeEstimateUsd: "0" };

describe("entry quote checks", () => {
  it("prices a NO buy from YES bids and checks approved price, size and freshness", () => {
    const now = Date.parse(quote.timestamp);
    expect(() => validateEntryQuote(order, quote, now)).not.toThrow();
    expect(() => validateEntryQuote(order, { ...quote, bid: "0.2" }, now)).toThrow("approved limit");
    expect(() => validateEntryQuote(order, { ...quote, bidSize: "9" }, now)).toThrow("liquidity");
    expect(() => validateEntryQuote(order, quote, now + 10_001)).toThrow("expired");
  });
});

describe("local owner access", () => {
  it("accepts explicitly configured same-origin loopback access, without exposing the bearer", () => {
    vi.stubEnv("LOCAL_OPERATOR_ACCESS", "true");
    expect(apiHost()).toBe("127.0.0.1");
    expect(localOperatorAccess({ ip: "127.0.0.1", headers: { host: "localhost:3100", origin: "http://localhost:3100" } })).toBe(true);
    for (const request of [
      { ip: "203.0.113.1", headers: { host: "localhost:3100" } },
      { ip: "127.0.0.1", headers: { host: "public.example" } },
      { ip: "127.0.0.1", headers: { host: "localhost:3100", origin: "https://other.example" } },
      { ip: "127.0.0.1", headers: { host: "localhost:3100", "sec-fetch-site": "cross-site" } },
    ]) expect(localOperatorAccess(request)).toBe(false);
    vi.stubEnv("LOCAL_OPERATOR_ACCESS", "false");
    expect(apiHost()).toBe("0.0.0.0");
    expect(localOperatorAccess({ ip: "127.0.0.1", headers: { host: "localhost" } })).toBe(false);
  });

  it("automatically authorizes local position actions but keeps MCP bearer authentication", async () => {
    vi.stubEnv("DATABASE_PATH", ":memory:"); vi.stubEnv("VENUES_MODE", "real"); vi.stubEnv("STRATEGY_MODE", "real");
    vi.stubEnv("LOCAL_OPERATOR_ACCESS", "true"); vi.stubEnv("MCP_BEARER_TOKEN", "test-secret-never-returned");
    const app = buildApp({ venues: createMockVenues() });
    try {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.json().localOperatorAccess).toBe(true);
      expect(health.body).not.toContain("test-secret-never-returned");
      expect((await app.inject({ method: "POST", url: "/api/positions/missing/close" })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: "/api/positions/missing/close", headers: { origin: "https://other.example" } })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/mcp", payload: {} })).statusCode).toBe(401);
    } finally { await app.close(); }
  });
});

async function draft() {
  vi.stubEnv("DATABASE_PATH", ":memory:"); vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("VENUES_MODE", "mock"); vi.stubEnv("STRATEGY_MODE", "mock"); vi.stubEnv("LOCAL_OPERATOR_ACCESS", "false");
  const venues = createMockVenues(); const app = buildApp({ venues, strategy });
  const post = async (url: string, payload = {}) => app.inject({ method: "POST", url, payload });
  const response = await post("/api/strategies/quote", { text: "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500." });
  const { plan } = response.json(); await post(`/api/strategies/${plan.strategyId}/approve`, { versionHash: plan.versionHash });
  return { app, venues, plan, post };
}

describe("execution persistence", () => {
  it("blocks a moved live quote before submitting any leg", async () => {
    const { app, venues, plan, post } = await draft();
    vi.stubEnv("VENUES_MODE", "real"); vi.stubEnv("STRATEGY_MODE", "real"); vi.stubEnv("LOCAL_OPERATOR_ACCESS", "true");
    for (const name of ["DERIVE_WALLET", "DERIVE_SIGNER_PRIVATE_KEY", "DERIVE_MAIN_SUBACCOUNT_ID", "DERIVE_PERP_SUBACCOUNT_ID", "GEMINI_SANDBOX_KEY", "GEMINI_SANDBOX_SECRET"]) vi.stubEnv(name, "fixture-only");
    const getQuote = venues.getQuote.bind(venues);
    vi.spyOn(venues, "getQuote").mockImplementation(async (...args) => { const value = await getQuote(...args); return args[1].endsWith("-C") ? { ...value, ask: "999999" } : value; });
    const place = vi.spyOn(venues, "placeOrder");
    try { expect((await post(`/api/strategies/${plan.strategyId}/execute`)).statusCode).toBe(409); expect(place).not.toHaveBeenCalled(); }
    finally { await app.close(); }
  });

  it("preserves already-filled legs when a later submission fails", async () => {
    const { app, venues, plan, post } = await draft();
    const submit = venues.placeOrder.bind(venues);
    const place = vi.spyOn(venues, "placeOrder").mockImplementation(async (request) => { if (request.legId === "L1") throw new Error("venue timeout"); return submit(request); });
    try {
      const response = await post(`/api/strategies/${plan.strategyId}/execute`);
      expect(response.statusCode).toBe(502);
      const saved = (await app.inject({ method: "GET", url: "/api/positions" })).json()[0];
      expect(saved.state).toBe("PARTIAL"); expect(saved.orders[0]).toMatchObject({ legId: "L3b", state: "FILLED" });
      await post(`/api/strategies/${plan.strategyId}/execute`);
      expect(place).toHaveBeenCalledTimes(2);
    } finally { await app.close(); }
  });

  it("records confirmed fills even when the subsequent margin read fails", async () => {
    const { app, venues, plan, post } = await draft();
    vi.spyOn(venues, "getMargin").mockRejectedValue(new Error("margin read unavailable"));
    try {
      const response = await post(`/api/strategies/${plan.strategyId}/execute`);
      expect(response.json()).toMatchObject({ state: "OPEN", margins: [] });
      expect((await app.inject({ method: "GET", url: "/api/positions" })).json()[0].orders).toHaveLength(3);
    } finally { await app.close(); }
  });
});
