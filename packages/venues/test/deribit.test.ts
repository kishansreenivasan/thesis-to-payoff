import { describe, expect, it } from "vitest";
import { MarginSnapshot, Order, VenuePosition } from "@ttp/shared";
import { createDeribitAdapter, type DeribitOrder } from "../src/deribit";

const env = {
  DERIBIT_CLIENT_ID: "main-id",
  DERIBIT_CLIENT_SECRET: "main-secret",
  DERIBIT_PERP_CLIENT_ID: "perp-id",
  DERIBIT_PERP_CLIENT_SECRET: "perp-secret",
} as NodeJS.ProcessEnv;

type Call = { method: string; params: Record<string, string>; auth: string | null };

/** Fake Deribit JSON-RPC over GET. `handlers` return `result`, or throw {code,message} for an error. */
function fakeDeribit(handlers: Record<string, (p: Record<string, string>, n: number) => unknown>) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = u.pathname.replace("/api/v2/", "");
    const params = Object.fromEntries(u.searchParams);
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? null;
    calls.push({ method, params, auth });
    counts[method] = (counts[method] ?? 0) + 1;
    const h = handlers[method];
    if (!h) return new Response(JSON.stringify({ error: { code: -32601, message: `no handler ${method}` } }), { status: 400 });
    try {
      return new Response(JSON.stringify({ jsonrpc: "2.0", result: h(params, counts[method]!) }));
    } catch (e) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: e }), { status: 400 });
    }
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const base = {
  "public/auth": () => ({ access_token: "tok", expires_in: 900, token_type: "bearer" }),
  "public/get_index_price": () => ({ index_price: 64000 }),
  "private/get_order_state_by_label": () => [],
};

const order = (over: Partial<DeribitOrder>): DeribitOrder => ({
  order_id: "ETH-1",
  order_state: "open",
  instrument_name: "BTC-25DEC26-68000-C",
  direction: "buy",
  amount: 0.1,
  filled_amount: 0,
  average_price: 0,
  price: 0.033,
  label: "c1",
  reduce_only: false,
  last_update_timestamp: 1_794_960_000_000,
  ...over,
});

const callReq = {
  clientOrderId: "c1",
  strategyId: "s",
  legId: "L1",
  venue: "DERIBIT" as const,
  account: "main" as const,
  instrumentId: "BTC-25DEC26-68000-C",
  side: "BUY" as const,
  quantity: "0.1",
  limitPrice: "2103.65",
  reduceOnly: false,
};

const noSleep = async () => {};

describe("Deribit adapter", () => {
  it("buys an option with a USD limit price, labels it with clientOrderId, waits for the fill", async () => {
    const { fetchFn, calls } = fakeDeribit({
      ...base,
      "private/buy": () => ({ order: order({}), trades: [] }),
      "private/get_order_state": () => order({ order_state: "filled", filled_amount: 0.1, average_price: 0.0329 }),
    });
    const d = createDeribitAdapter({ fetchFn, env, sleep: noSleep, pollMs: 0 });
    const o = Order.parse(await d.placeOrder(callReq));
    expect(o.state).toBe("FILLED");
    expect(o.filledQuantity).toBe("0.1");
    expect(o.avgPrice).toBe((0.0329 * 64000).toFixed(2)); // BTC price -> USD
    expect(o.source).toBe("TESTNET");
    const buy = calls.find((c) => c.method === "private/buy")!;
    expect(buy.params).toMatchObject({ instrument_name: "BTC-25DEC26-68000-C", amount: "0.1", price: "2103.65", advanced: "usd", label: "c1", type: "limit" });
    expect(buy.auth).toBe("Bearer tok");
    expect(calls.filter((c) => c.method === "public/auth")).toHaveLength(1);
  });

  it("cancels after the fill timeout and reports REJECTED (NO_FILL)", async () => {
    const { fetchFn, calls } = fakeDeribit({
      ...base,
      "private/buy": () => ({ order: order({}), trades: [] }),
      "private/cancel": () => order({ order_state: "cancelled" }),
    });
    const d = createDeribitAdapter({ fetchFn, env, sleep: noSleep, fillTimeoutMs: 0 });
    const o = await d.placeOrder(callReq);
    expect(o.state).toBe("REJECTED");
    expect(calls.some((c) => c.method === "private/cancel")).toBe(true);
  });

  it("never resends: an existing label is returned as-is", async () => {
    const { fetchFn, calls } = fakeDeribit({
      ...base,
      "private/get_order_state_by_label": () => [order({ order_state: "filled", filled_amount: 0.1, average_price: 0.0329 })],
    });
    const d = createDeribitAdapter({ fetchFn, env, sleep: noSleep });
    expect((await d.placeOrder(callReq)).state).toBe("FILLED");
    expect(calls.some((c) => c.method === "private/buy")).toBe(false);
  });

  it("reduce-only perp sell goes to the perp account with a BTC amount", async () => {
    const perpOrder = order({ instrument_name: "BTC_USDC-PERPETUAL", direction: "sell", amount: 0.0082, price: 64000 });
    const { fetchFn, calls } = fakeDeribit({
      ...base,
      "public/auth": (p) => ({ access_token: `tok-${p.client_id}`, expires_in: 900 }),
      "private/sell": () => ({ order: { ...perpOrder, order_state: "filled", filled_amount: 0.0082, average_price: 63990 }, trades: [] }),
    });
    const d = createDeribitAdapter({ fetchFn, env, sleep: noSleep });
    const o = await d.placeOrder({ ...callReq, clientOrderId: "r1", legId: "L2", account: "perp", instrumentId: "BTC_USDC-PERPETUAL", side: "SELL", quantity: "0.0082", limitPrice: "63990", reduceOnly: true });
    expect(o.state).toBe("FILLED");
    const sell = calls.find((c) => c.method === "private/sell")!;
    expect(sell.params).toMatchObject({ amount: "0.0082", reduce_only: "true", price: "63990" });
    expect(sell.params.advanced).toBeUndefined();
    expect(sell.auth).toBe("Bearer tok-perp-id");
    expect(calls.find((c) => c.method === "private/get_order_state_by_label")!.params.currency).toBe("USDC");
  });

  it("refreshes the token once on 13009 unauthorized", async () => {
    const { fetchFn, calls } = fakeDeribit({
      ...base,
      "private/get_order_state_by_label": (_p, n) => {
        if (n === 1) throw { code: 13009, message: "unauthorized" };
        return [];
      },
      "private/buy": () => ({ order: order({ order_state: "filled", filled_amount: 0.1, average_price: 0.033 }), trades: [] }),
    });
    const d = createDeribitAdapter({ fetchFn, env, sleep: noSleep });
    expect((await d.placeOrder(callReq)).state).toBe("FILLED");
    expect(calls.filter((c) => c.method === "public/auth")).toHaveLength(2);
  });

  it("margin snapshot: USDC perp account, ratio = equity / maintenance, perp size in BTC", async () => {
    const { fetchFn } = fakeDeribit({
      ...base,
      "private/get_account_summary": (p) => {
        expect(p.currency).toBe("USDC");
        return { currency: "USDC", equity: 260, maintenance_margin: 80, initial_margin: 120 };
      },
      "private/get_positions": (p) =>
        p.currency === "USDC"
          ? [{ instrument_name: "BTC_USDC-PERPETUAL", kind: "future", direction: "buy", size: 1049.6, size_currency: 0.0164, average_price: 64000, mark_price: 64100, index_price: 64000, floating_profit_loss: 1.64 }]
          : [],
    });
    const d = createDeribitAdapter({ fetchFn, env });
    const m = MarginSnapshot.parse(await d.getMargin("perp"));
    expect(m).toMatchObject({ equityUsd: "260.00", maintenanceMarginUsd: "80.00", marginRatio: "3.2500", perpSizeBtc: "0.0164", source: "TESTNET" });
    const [pos] = (await d.getPositions("perp")).map((p) => VenuePosition.parse(p));
    expect(pos).toMatchObject({ quantity: "0.0164", avgPrice: "64000.00", unrealizedPnlUsd: "1.64" });
  });

  it("option positions convert BTC prices and BTC P&L to USD", async () => {
    const { fetchFn } = fakeDeribit({
      ...base,
      "private/get_positions": (p) =>
        p.currency === "BTC"
          ? [{ instrument_name: "BTC-25DEC26-68000-C", kind: "option", direction: "buy", size: 0.1, average_price: 0.033, mark_price: 0.035, index_price: 64000, floating_profit_loss: 0.0002 }]
          : [],
    });
    const d = createDeribitAdapter({ fetchFn, env });
    const [pos] = await d.getPositions("main");
    expect(pos).toMatchObject({ quantity: "0.1", avgPrice: "2112.00", markPrice: "2240.00", unrealizedPnlUsd: "12.80" });
  });

  it("explains missing credentials instead of calling the API", async () => {
    const { fetchFn } = fakeDeribit(base);
    const d = createDeribitAdapter({ fetchFn, env: {} as NodeJS.ProcessEnv, sleep: noSleep });
    await expect(d.placeOrder(callReq)).rejects.toThrow(/DERIBIT_CLIENT_ID/);
  });
});
