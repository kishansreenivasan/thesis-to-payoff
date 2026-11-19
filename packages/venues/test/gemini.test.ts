import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Order, VenuePosition } from "@ttp/shared";
import { createGeminiAdapter, type GemOrder } from "../src/gemini";

const env = { GEMINI_SANDBOX_KEY: "account-test", GEMINI_SANDBOX_SECRET: "shh" } as NodeJS.ProcessEnv;

type Call = { path: string; method: string; headers: Record<string, string>; payload: Record<string, unknown> };

function fakeGemini(handlers: Record<string, (payload: Record<string, unknown>) => unknown>, hooks?: { onCall?: (path: string) => Promise<void> }) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const headers = init?.headers as Record<string, string>;
    const payload = JSON.parse(Buffer.from(headers["X-GEMINI-PAYLOAD"]!, "base64").toString());
    calls.push({ path, method: init?.method ?? "GET", headers, payload });
    await hooks?.onCall?.(path);
    const h = handlers[path];
    if (!h) return new Response(JSON.stringify({ result: "error", reason: "NotFound", message: path }), { status: 404 });
    return new Response(JSON.stringify(h(payload)));
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const gemOrder = (over: Partial<GemOrder> = {}): GemOrder => ({
  orderId: 12345678901,
  status: "open",
  symbol: "GEMI-BTC2611302200-HI67500",
  side: "buy",
  outcome: "no",
  quantity: "1",
  filledQuantity: "0",
  price: "0.68",
  avgExecutionPrice: null,
  updatedAt: "2026-11-18T01:00:00.000Z",
  ...over,
});

const noReq = {
  clientOrderId: "g1",
  strategyId: "s",
  legId: "L3b",
  venue: "GEMINI" as const,
  account: "sandbox" as const,
  instrumentId: "GEMI-BTC2611302200-HI67500:NO",
  side: "BUY" as const,
  quantity: "1",
  limitPrice: "0.68",
  reduceOnly: false,
};

const terms = { "/v1/prediction-markets/terms/status": () => ({ hasAcceptedLatest: true, acceptedVersion: 3, latestVersion: 3 }) };

describe("Gemini adapter", () => {
  it("signs requests: hex HMAC-SHA384 of the base64 payload, empty body", async () => {
    const { fetchFn, calls } = fakeGemini({ ...terms, "/v1/prediction-markets/order": () => gemOrder() });
    const g = createGeminiAdapter({ fetchFn, env, nowSec: () => 1_794_960_000 });
    await g.placeOrder(noReq);
    const c = calls.find((x) => x.path === "/v1/prediction-markets/order")!;
    expect(c.method).toBe("POST");
    expect(c.headers["X-GEMINI-APIKEY"]).toBe("account-test");
    expect(c.headers["Content-Length"]).toBe("0");
    const expected = createHmac("sha384", "shh").update(c.headers["X-GEMINI-PAYLOAD"]!).digest("hex");
    expect(c.headers["X-GEMINI-SIGNATURE"]).toBe(expected);
    expect(c.payload).toMatchObject({ request: "/v1/prediction-markets/order", symbol: "GEMI-BTC2611302200-HI67500", outcome: "no", side: "buy", price: "0.68", quantity: "1", orderType: "limit" });
  });

  it("master keys name the account on every request; account keys do not", async () => {
    const { fetchFn, calls } = fakeGemini({ "/v1/prediction-markets/positions": () => ({ positions: [] }) });
    await createGeminiAdapter({ fetchFn, env: { ...env, GEMINI_SANDBOX_KEY: "master-abc" } as NodeJS.ProcessEnv }).getPositions();
    await createGeminiAdapter({ fetchFn, env }).getPositions();
    expect(calls[0]!.payload.account).toBe("primary");
    expect(calls[1]!.payload.account).toBeUndefined();
  });

  it("nonces strictly increase within a second", async () => {
    const { fetchFn, calls } = fakeGemini({ ...terms, "/v1/prediction-markets/positions": () => ({ positions: [] }) });
    const g = createGeminiAdapter({ fetchFn, env, nowSec: () => 1_794_960_000 });
    await g.getPositions();
    await g.getPositions();
    const n = calls.map((c) => c.payload.nonce as number);
    expect(n[1]).toBeGreaterThan(n[0]!);
  });

  it("refuses to trade until a human has accepted the terms; never accepts them itself", async () => {
    const { fetchFn, calls } = fakeGemini({ "/v1/prediction-markets/terms/status": () => ({ hasAcceptedLatest: false }) });
    const g = createGeminiAdapter({ fetchFn, env });
    await expect(g.placeOrder(noReq)).rejects.toThrow(/TermsNotAccepted/);
    expect(calls.some((c) => c.path.includes("terms/accept") || c.path.endsWith("/order"))).toBe(false);
  });

  it("tracks clientOrderId, finds the order in history, and does not resend", async () => {
    const { fetchFn, calls } = fakeGemini({
      ...terms,
      "/v1/prediction-markets/order": () => gemOrder(),
      "/v1/prediction-markets/orders/active": () => ({ orders: [] }),
      "/v1/prediction-markets/orders/history": () => ({ orders: [gemOrder({ status: "filled", filledQuantity: "1", avgExecutionPrice: "0.68" })] }),
    });
    const g = createGeminiAdapter({ fetchFn, env });
    expect((await g.placeOrder(noReq)).state).toBe("ACKNOWLEDGED");
    const o = Order.parse(await g.getOrder("g1"));
    expect(o).toMatchObject({ state: "FILLED", filledQuantity: "1", avgPrice: "0.68", venueOrderId: "12345678901", source: "SANDBOX" });
    await g.placeOrder(noReq);
    expect(calls.filter((c) => c.path === "/v1/prediction-markets/order")).toHaveLength(1);
    expect(await g.getOrder("never-sent")).toBeNull();
  });

  it("keeps 18-digit Gemini order ids exact, and cancels by the exact id", async () => {
    const exact = "145853902322404723"; // Number() would round this to ...740
    let cancelled = false;
    const raw = (status: string) => `{"orderId":${exact},"status":"${status}","symbol":"GEMI-BTC2611302200-HI67500","side":"buy","outcome":"no","quantity":"1","filledQuantity":"0","price":"0.01","avgExecutionPrice":null}`;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const payload = JSON.parse(Buffer.from((init!.headers as Record<string, string>)["X-GEMINI-PAYLOAD"]!, "base64").toString());
      if (path.endsWith("/terms/status")) return new Response('{"hasAcceptedLatest":true}');
      if (path.endsWith("/order")) return new Response(raw("open"));
      if (path.endsWith("/order/cancel")) {
        expect(payload.orderId).toBe(exact);
        cancelled = true;
        return new Response('{"result":"ok"}');
      }
      if (path.endsWith("/orders/active")) return new Response(`{"orders":[${cancelled ? "" : raw("open")}]}`);
      return new Response(`{"orders":[${cancelled ? raw("cancelled") : ""}]}`);
    }) as unknown as typeof fetch;
    const g = createGeminiAdapter({ fetchFn, env });
    expect((await g.placeOrder(noReq)).venueOrderId).toBe(exact);
    expect((await g.cancelOrder("g1")).state).toBe("CANCELED");
  });

  it("cancels an open order by orderId", async () => {
    let cancelled = false;
    const { fetchFn, calls } = fakeGemini({
      ...terms,
      "/v1/prediction-markets/order": () => gemOrder(),
      "/v1/prediction-markets/order/cancel": () => ((cancelled = true), { result: "ok", message: "cancelled" }),
      "/v1/prediction-markets/orders/active": () => ({ orders: cancelled ? [] : [gemOrder()] }),
      "/v1/prediction-markets/orders/history": () => ({ orders: cancelled ? [gemOrder({ status: "cancelled" })] : [] }),
    });
    const g = createGeminiAdapter({ fetchFn, env });
    await g.placeOrder(noReq);
    expect((await g.cancelOrder("g1")).state).toBe("CANCELED");
    expect(calls.find((c) => c.path.endsWith("/order/cancel"))!.payload.orderId).toBe("12345678901");
  });

  it("sends one order at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { fetchFn } = fakeGemini(
      { ...terms, "/v1/prediction-markets/order": () => gemOrder({ orderId: Math.floor(Math.random() * 1e9) }) },
      {
        onCall: async (path) => {
          if (!path.endsWith("/order")) return;
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
        },
      },
    );
    const g = createGeminiAdapter({ fetchFn, env });
    await Promise.all([g.placeOrder(noReq), g.placeOrder({ ...noReq, clientOrderId: "g2" })]);
    expect(maxInFlight).toBe(1);
  });

  it("maps positions with the outcome suffix and the executable exit price", async () => {
    const { fetchFn } = fakeGemini({
      "/v1/prediction-markets/positions": () => ({
        positions: [
          { symbol: "GEMI-BTC2611302200-HI67500", totalQuantity: "1", avgPrice: "0.68", outcome: "no", prices: { sell: { yes: "0.30", no: "0.66" } }, unrealizedPnl: "-0.02" },
          { symbol: "GEMI-X-Y", totalQuantity: "0", avgPrice: "0.5", outcome: "yes" },
        ],
        total: 2,
      }),
    });
    const g = createGeminiAdapter({ fetchFn, env });
    const ps = (await g.getPositions()).map((p) => VenuePosition.parse(p));
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ instrumentId: "GEMI-BTC2611302200-HI67500:NO", markPrice: "0.66", unrealizedPnlUsd: "-0.02", source: "SANDBOX" });
  });
});
