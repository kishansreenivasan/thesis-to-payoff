// Gemini sandbox prediction-market adapter (Lane B). Built from developer.gemini.com on 2026-11-18;
// NOT yet run with keys. Unconfirmed by docs, to check in the smoke test (CHANGES.md):
//   - Signing: the auth page says payload goes Base64 in X-GEMINI-PAYLOAD with an empty body; the
//     prediction-market pages show a JSON body. We follow the auth page.
//   - Price for a NO order: we send the NO price (e.g. 0.68 when YES bids 0.32).
//   - There is no client-order-id field on requests and no order lookup by id, so we keep a
//     clientOrderId -> orderId map and look orders up in active orders, then order history.
import { createHmac } from "node:crypto";
import Decimal from "decimal.js";
import type { Order, OrderRequest, OrderState, VenuePosition } from "@ttp/shared";
import { parseGeminiOrderInstrument, type EventOutcome } from "./conventions";

export const GEMINI_SANDBOX_BASE = "https://api.sandbox.gemini.com";
export type FetchFn = typeof fetch;

export class GeminiError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly reason: string,
    message: string,
  ) {
    super(`Gemini ${path} [${status} ${reason}]: ${message}`);
    this.name = "GeminiError";
  }
}

export interface GeminiCreds {
  key: string;
  secret: string;
}

export function geminiCredsFromEnv(env = process.env): GeminiCreds {
  if (!env.GEMINI_SANDBOX_KEY || !env.GEMINI_SANDBOX_SECRET) {
    throw new Error("Gemini sandbox: GEMINI_SANDBOX_KEY/SECRET not set (DESIGN.md Section 13, item 1).");
  }
  return { key: env.GEMINI_SANDBOX_KEY, secret: env.GEMINI_SANDBOX_SECRET };
}

/** Gemini private REST signing: hex(HMAC_SHA384(base64(JSON payload), secret)). */
export function signGeminiPayload(payload: Record<string, unknown>, secret: string) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const signature = createHmac("sha384", secret).update(b64).digest("hex");
  return { b64, signature };
}

export interface GemOrder {
  orderId: number | string;
  status: "open" | "filled" | "cancelled";
  symbol: string;
  side: "buy" | "sell";
  outcome: "yes" | "no";
  quantity: string;
  filledQuantity: string;
  price: string;
  avgExecutionPrice: string | null;
  updatedAt?: string;
  createdAt?: string;
}

interface GemPosition {
  symbol: string;
  totalQuantity: string;
  avgPrice: string;
  outcome: "yes" | "no";
  prices?: { sell?: { yes?: string; no?: string } };
  unrealizedPnl?: string;
}

export function toGeminiOrder(o: GemOrder, req: OrderRequest): Order {
  const filled = new Decimal(o.filledQuantity || 0);
  const state: OrderState =
    o.status === "filled"
      ? "FILLED"
      : o.status === "cancelled"
        ? "CANCELED"
        : filled.gt(0)
          ? "PARTIAL"
          : "ACKNOWLEDGED";
  return {
    ...req,
    venueOrderId: String(o.orderId),
    filledQuantity: filled.toString(),
    avgPrice: o.avgExecutionPrice ?? null,
    state,
    source: "SANDBOX",
    updatedAt: new Date(o.updatedAt ?? o.createdAt ?? Date.now()).toISOString(),
  };
}

export interface GeminiAdapterOptions {
  fetchFn?: FetchFn;
  env?: NodeJS.ProcessEnv;
  base?: string;
  nowSec?: () => number;
}

export function createGeminiAdapter(opts: GeminiAdapterOptions = {}) {
  const fetchFn = opts.fetchFn ?? fetch;
  const env = opts.env ?? process.env;
  const base = opts.base ?? GEMINI_SANDBOX_BASE;
  // Time-based nonce (seconds, within 30 s of server time). Strictly increasing within this process.
  let lastNonce = 0;
  const nonce = () => {
    const n = Math.max((opts.nowSec ?? (() => Math.floor(Date.now() / 1000)))(), lastNonce + 1);
    lastNonce = n;
    return n;
  };

  async function call<T>(path: string, params: Record<string, unknown> = {}, method: "POST" | "GET" = "POST"): Promise<T> {
    const { key, secret } = geminiCredsFromEnv(env);
    const { b64, signature } = signGeminiPayload({ request: path, nonce: nonce(), ...params }, secret);
    const res = await fetchFn(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": "0",
        "Cache-Control": "no-cache",
        "X-GEMINI-APIKEY": key,
        "X-GEMINI-PAYLOAD": b64,
        "X-GEMINI-SIGNATURE": signature,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as (T & { result?: string; reason?: string; message?: string }) | null;
    if (!res.ok || !body || body.result === "error") {
      throw new GeminiError(path, res.status, body?.reason ?? "Error", body?.message ?? "request failed");
    }
    return body;
  }

  const sent = new Map<string, { req: OrderRequest; orderId: string }>();
  let queue: Promise<unknown> = Promise.resolve();
  /** DESIGN.md Section 6.1: one Gemini order at a time. */
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  let termsOk = false;
  async function requireTerms() {
    if (termsOk) return;
    const s = await call<{ hasAcceptedLatest: boolean }>("/v1/prediction-markets/terms/status", {}, "GET");
    if (!s.hasAcceptedLatest) {
      // Agents never accept terms on the user's behalf (DESIGN.md Section 6.1).
      throw new GeminiError("/v1/prediction-markets/terms/status", 200, "TermsNotAccepted",
        "accept the prediction-market terms in the Gemini sandbox website first (human item 1)");
    }
    termsOk = true;
  }

  async function findOrder(orderId: string): Promise<GemOrder | null> {
    for (const path of ["/v1/prediction-markets/orders/active", "/v1/prediction-markets/orders/history"]) {
      for (let offset = 0; offset < 500; offset += 100) {
        const page = await call<{ orders: GemOrder[] }>(path, { limit: 100, offset });
        const hit = page.orders.find((o) => String(o.orderId) === orderId);
        if (hit) return hit;
        if (page.orders.length < 100) break;
      }
    }
    return null;
  }

  function placeOrder(req: OrderRequest): Promise<Order> {
    return serial(async () => {
      const known = sent.get(req.clientOrderId);
      if (known) {
        // Idempotency: never resend a clientOrderId we already sent.
        const o = await findOrder(known.orderId);
        if (o) return toGeminiOrder(o, req);
        throw new Error(`Gemini: ${req.clientOrderId} was sent as ${known.orderId} but is not found; not resending`);
      }
      await requireTerms();
      const { symbol, outcome } = parseGeminiOrderInstrument(req.instrumentId);
      const o = await call<GemOrder>("/v1/prediction-markets/order", {
        symbol,
        orderType: "limit",
        side: req.side === "BUY" ? "buy" : "sell",
        quantity: req.quantity,
        price: req.limitPrice,
        outcome: outcome.toLowerCase() as Lowercase<EventOutcome>,
        timeInForce: "good-til-cancel",
      });
      sent.set(req.clientOrderId, { req, orderId: String(o.orderId) });
      return toGeminiOrder(o, req);
    });
  }

  async function getOrder(clientOrderId: string): Promise<Order | null> {
    const known = sent.get(clientOrderId);
    if (!known) return null; // Gemini has no client-order-id lookup; see header note.
    const o = await findOrder(known.orderId);
    return o ? toGeminiOrder(o, known.req) : null;
  }

  function cancelOrder(clientOrderId: string): Promise<Order> {
    return serial(async () => {
      const known = sent.get(clientOrderId);
      if (!known) throw new Error(`Gemini: unknown clientOrderId ${clientOrderId}`);
      const before = await findOrder(known.orderId);
      if (before && before.status !== "open") return toGeminiOrder(before, known.req);
      await call("/v1/prediction-markets/order/cancel", { orderId: Number(known.orderId) });
      const after = await findOrder(known.orderId);
      if (!after) throw new Error(`Gemini: order ${known.orderId} not found after cancel`);
      return toGeminiOrder(after, known.req);
    });
  }

  async function getPositions(): Promise<VenuePosition[]> {
    const r = await call<{ positions: GemPosition[] }>("/v1/prediction-markets/positions", { limit: 1000 });
    return r.positions
      .filter((p) => !new Decimal(p.totalQuantity || 0).isZero())
      .map((p) => {
        const outcome = p.outcome === "no" ? "NO" : "YES";
        const exit = p.prices?.sell?.[p.outcome]; // executable exit price for this side
        return {
          venue: "GEMINI" as const,
          account: "sandbox",
          instrumentId: `${p.symbol}:${outcome}`,
          quantity: p.totalQuantity,
          avgPrice: p.avgPrice ?? null,
          markPrice: exit ?? null,
          unrealizedPnlUsd: exit ? p.unrealizedPnl ?? new Decimal(exit).sub(p.avgPrice).mul(p.totalQuantity).toFixed(2) : null,
          source: "SANDBOX" as const,
          timestamp: new Date().toISOString(),
        };
      });
  }

  return { placeOrder, getOrder, cancelOrder, getPositions };
}
