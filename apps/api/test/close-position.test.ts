import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock as strategy } from "@ttp/strategy";
import { createMockVenues } from "@ttp/venues";
import { mock as treasury, resetMock } from "@ttp/treasury";
import type { PositionSnapshot } from "@ttp/shared";
import { buildApp } from "../src/app";
import { createOrderStore } from "../src/order-store";

const thesis = "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.";
type Exit = { position: PositionSnapshot; results: Array<{ legId: string; state: string; error: string | null }>; requestError: string | null };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function setup(databasePath = ":memory:") {
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("VENUES_MODE", "mock");
  vi.stubEnv("STRATEGY_MODE", "mock");
  const venues = createMockVenues();
  const app = buildApp({ venues, strategy });
  const post = async (url: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });
  const quote = await post("/api/strategies/quote", { text: thesis });
  const { plan } = quote.json();
  await post(`/api/strategies/${plan.strategyId}/approve`, { versionHash: plan.versionHash });
  const opened = await post(`/api/strategies/${plan.strategyId}/execute`);
  expect(opened.json().state).toBe("OPEN");
  return { app, venues, post, plan, opened: opened.json() as PositionSnapshot, url: `/api/positions/${plan.strategyId}/close` };
}

describe("closing strategy positions", () => {
  it("closes the perp first, then only the strategy's attributed holdings; repeat close is a no-op", async () => {
    const { app, venues, post, opened, url } = await setup();
    try {
      // Same instruments also contain holdings that this strategy did not open.
      for (const order of opened.orders) await venues.placeOrder({ ...order, clientOrderId: `unrelated-${order.legId}`, strategyId: "unrelated", quantity: order.venue === "GEMINI" ? "7" : "0.01" });
      const place = vi.spyOn(venues, "placeOrder");
      const response = await post(url);
      expect(response.statusCode).toBe(200);
      const result = response.json<Exit>();
      expect(result.position.state).toBe("CLOSED");
      expect(result.results.map((leg) => leg.legId)).toEqual(["L2", "L1", "L3b"]);
      expect(place.mock.calls.map(([req]) => [req.legId, req.side, req.reduceOnly])).toEqual([["CLOSE_L2", "SELL", true], ["CLOSE_L1", "SELL", true], ["CLOSE_L3b", "SELL", false]]);
      expect((await venues.getPositions("DERIVE", "perp"))[0]?.quantity).toBe("0.01");
      expect((await venues.getPositions("GEMINI", "main"))[0]?.quantity).toBe("7");
      expect((await post(url)).json<Exit>().position.state).toBe("CLOSED");
      expect(place).toHaveBeenCalledTimes(3);
      expect((await app.inject({ method: "GET", url: "/api/positions" })).json()[0].state).toBe("CLOSED");
    } finally { await app.close(); }
  });

  it("keeps an illiquid Gemini leg open and retries it without reselling the closed Derive legs", async () => {
    const { app, venues, post, url } = await setup();
    const getQuote = venues.getQuote.bind(venues);
    const quote = vi.spyOn(venues, "getQuote").mockImplementation(async (...args) => {
      const value = await getQuote(...args);
      return args[0] === "GEMINI" ? { ...value, ask: null, askSize: null } : value;
    });
    const place = vi.spyOn(venues, "placeOrder");
    try {
      const first = (await post(url)).json<Exit>();
      expect(first.position.state).toBe("REDUCING");
      expect(first.results.find((leg) => leg.legId === "L3b")).toMatchObject({ state: "PENDING", error: expect.stringContaining("liquidity") });
      expect(place).toHaveBeenCalledTimes(2);
      quote.mockRestore();
      const second = (await post(url)).json<Exit>();
      expect(second.position.state).toBe("CLOSED");
      expect(place).toHaveBeenCalledTimes(3);
      expect(await venues.getPositions("GEMINI", "main")).toEqual([]);
    } finally { await app.close(); }
  });

  it("accounts for a canceled partial exit and sells only the remaining quantity on retry", async () => {
    const { app, venues, post, opened, url } = await setup();
    const submit = venues.placeOrder.bind(venues);
    let partial = true;
    vi.spyOn(venues, "placeOrder").mockImplementation(async (req) => {
      if (req.legId === "CLOSE_L2" && partial) {
        partial = false;
        const filled = await submit({ ...req, quantity: "0.005" });
        return { ...filled, quantity: req.quantity, state: "CANCELED" };
      }
      return submit(req);
    });
    try {
      expect((await post(url)).json<Exit>().position.state).toBe("REDUCING");
      const second = (await post(url)).json<Exit>();
      expect(second.position.state).toBe("CLOSED");
      const exits = second.position.orders.filter((order) => order.legId === "CLOSE_L2");
      expect(exits).toHaveLength(2);
      expect(exits.reduce((sum, order) => sum + Number(order.filledQuantity), 0)).toBeCloseTo(Number(opened.orders.find((order) => order.legId === "L2")!.filledQuantity));
      expect(await venues.getPositions("DERIVE", "perp")).toEqual([]);
    } finally { await app.close(); }
  });

  it("never duplicates an uncertain exit after a timeout, then recovers its confirmed fill", async () => {
    const { app, venues, post, url } = await setup();
    const submit = venues.placeOrder.bind(venues);
    const lookup = venues.getOrder.bind(venues);
    let timeout = true;
    let unknown = true;
    const place = vi.spyOn(venues, "placeOrder").mockImplementation(async (req) => {
      const order = await submit(req);
      if (req.legId === "CLOSE_L2" && timeout) { timeout = false; throw new Error("response timeout after submission"); }
      return order;
    });
    vi.spyOn(venues, "getOrder").mockImplementation(async (venue, id) => unknown && id.includes("close-L2") ? null : lookup(venue, id));
    try {
      expect((await post(url)).json<Exit>().position.state).toBe("REDUCING");
      const second = (await post(url)).json<Exit>();
      expect(second.results[0]?.error).toContain("uncertain");
      expect(place.mock.calls.filter(([req]) => req.legId === "CLOSE_L2")).toHaveLength(1);
      unknown = false;
      expect((await post(url)).json<Exit>().position.state).toBe("CLOSED");
      expect(place.mock.calls.filter(([req]) => req.legId === "CLOSE_L2")).toHaveLength(1);
    } finally { await app.close(); }
  });

  it("requires bearer authentication whenever venues are real, including mixed strategy modes", async () => {
    const { app, venues, post, url } = await setup();
    const place = vi.spyOn(venues, "placeOrder");
    vi.stubEnv("VENUES_MODE", "real");
    vi.stubEnv("MCP_BEARER_TOKEN", "close-test-token");
    try { expect((await post(url)).statusCode).toBe(401); expect(place).not.toHaveBeenCalled(); }
    finally { await app.close(); }
  });

  it("rejects an impossible fill and leaves the submission uncertain instead of claiming a closed leg", async () => {
    const { app, venues, post, url } = await setup();
    const submit = venues.placeOrder.bind(venues);
    vi.spyOn(venues, "placeOrder").mockImplementation(async (req) => req.legId === "CLOSE_L2"
      ? { ...req, venueOrderId: "invalid-fill", filledQuantity: "999", avgPrice: req.limitPrice, state: "FILLED", source: "SIMULATED", updatedAt: new Date().toISOString() }
      : submit(req));
    try {
      const result = (await post(url)).json<Exit>();
      expect(result.position.state).toBe("REDUCING");
      expect(result.results[0]?.error).toContain("Unexpected venue fill");
      expect((await venues.getPositions("DERIVE", "perp"))[0]?.quantity).not.toBe("0");
    } finally { await app.close(); }
  });

  it("restores and cancels a funding request from the event journal after restart", async () => {
    resetMock();
    const folder = mkdtempSync(join(tmpdir(), "convex-close-funding-"));
    const filename = join(folder, "orders.sqlite");
    const { app, venues, plan, url, opened } = await setup(filename);
    await app.close();
    const request = await treasury.requestRelease(plan.strategyId, "DERIVE", "80000000", 120);
    const journal = createOrderStore(filename);
    journal.appendEvent({ timestamp: new Date().toISOString(), positionId: opened.positionId, type: "TRANSFER_REQUEST_UPDATED", reasonCode: request.state, details: request, source: request.source });
    journal.close();
    const restarted = buildApp({ venues, strategy, treasury });
    try {
      const result = (await restarted.inject({ method: "POST", url, payload: {} })).json<Exit>();
      expect(result).toMatchObject({ position: { state: "CLOSED" }, requestError: null });
      expect((await treasury.getReleaseStatus(request.requestId)).state).toBe("REJECTED");
    } finally { await restarted.close(); resetMock(); rmSync(folder, { recursive: true, force: true }); }
  });

  it("retains uncertain exit submissions across an API restart", async () => {
    const folder = mkdtempSync(join(tmpdir(), "convex-close-"));
    const { app, venues, post, url } = await setup(join(folder, "orders.sqlite"));
    const submit = venues.placeOrder.bind(venues);
    const place = vi.spyOn(venues, "placeOrder").mockImplementation(async (req) => {
      if (req.legId === "CLOSE_L3b") throw new Error("submission timed out");
      return submit(req);
    });
    try { expect((await post(url)).json<Exit>().position.state).toBe("REDUCING"); }
    finally { await app.close(); }
    const restarted = buildApp({ venues, strategy });
    try {
      const result = (await restarted.inject({ method: "POST", url, payload: {} })).json<Exit>();
      expect(result.position.state).toBe("REDUCING");
      expect(result.results.find((leg) => leg.legId === "L3b")?.error).toContain("uncertain");
      expect(place.mock.calls.filter(([req]) => req.legId === "CLOSE_L3b")).toHaveLength(1);
    } finally { await restarted.close(); rmSync(folder, { recursive: true, force: true }); }
  });

  it("blocks concurrent closes and reset, and prevents monitoring a position after a user exit", async () => {
    const { app, venues, post, plan, url } = await setup();
    const getPositions = venues.getPositions.bind(venues);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(venues, "getPositions").mockImplementation(async (...args) => { entered(); await gate; return getPositions(...args); });
    const first = post(url).then((value) => value);
    try {
      await waiting;
      expect((await post(url)).statusCode).toBe(409);
      expect((await post("/api/demo/reset")).statusCode).toBe(409);
      release();
      expect((await first).json<Exit>().position.state).toBe("CLOSED");
      expect((await post(`/api/positions/${plan.strategyId}/monitor`)).statusCode).toBe(503);
      expect((await post("/api/strategies/quote", { text: thesis })).statusCode).toBe(409);
    } finally { release(); await first; await app.close(); }
  });
});
