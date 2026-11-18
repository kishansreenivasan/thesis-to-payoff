// Deribit testnet adapter (Lane B). Built from docs.deribit.com on 2026-11-18; NOT yet run with keys.
// Unconfirmed by docs, to check in the smoke test (CHANGES.md):
//   - BTC_USDC-PERPETUAL `amount`, `filled_amount` and position `size_currency` are in BTC.
//   - `advanced: "usd"` lets us send option limit prices in USD.
//   - a linear perp position shows up under get_positions(currency="USDC").
import Decimal from "decimal.js";
import type { MarginSnapshot, Order, OrderRequest, OrderState, VenuePosition } from "@ttp/shared";

export const DERIBIT_TESTNET_BASE = "https://test.deribit.com/api/v2";

export type DeribitAccount = "main" | "perp";
export type FetchFn = typeof fetch;

export interface DeribitCreds {
  clientId: string;
  clientSecret: string;
}

export class DeribitError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: number | null,
    message: string,
  ) {
    super(`Deribit ${method}${code != null ? ` [${code}]` : ""}: ${message}`);
    this.name = "DeribitError";
  }
}

export function deribitCredsFromEnv(account: DeribitAccount, env = process.env): DeribitCreds {
  const [id, secret] =
    account === "main"
      ? [env.DERIBIT_CLIENT_ID, env.DERIBIT_CLIENT_SECRET]
      : [env.DERIBIT_PERP_CLIENT_ID, env.DERIBIT_PERP_CLIENT_SECRET];
  if (!id || !secret) {
    const names = account === "main" ? "DERIBIT_CLIENT_ID/SECRET" : "DERIBIT_PERP_CLIENT_ID/SECRET";
    throw new Error(`Deribit ${account} account: ${names} not set (DESIGN.md Section 13, items 2-3).`);
  }
  return { clientId: id, clientSecret: secret };
}

/** JSON-RPC over HTTP GET with a cached bearer token per account. */
export class DeribitClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly creds: () => DeribitCreds,
    private readonly fetchFn: FetchFn = fetch,
    private readonly base = DERIBIT_TESTNET_BASE,
    private readonly now: () => number = Date.now,
  ) {}

  private async raw<T>(method: string, params: Record<string, unknown>, bearer?: string): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
    const res = await this.fetchFn(`${this.base}/${method}?${qs.toString()}`, {
      headers: { accept: "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as
      | { result?: T; error?: { code: number; message: string } }
      | null;
    if (!body) throw new DeribitError(method, null, `HTTP ${res.status}, non-JSON body`);
    if (body.error) throw new DeribitError(method, body.error.code, body.error.message);
    if (!res.ok || body.result === undefined) throw new DeribitError(method, null, `HTTP ${res.status}`);
    return body.result;
  }

  async publicCall<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.raw<T>(method, params);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 30_000) return this.token.value;
    const { clientId, clientSecret } = this.creds();
    const r = await this.raw<{ access_token: string; expires_in: number }>("public/auth", {
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    this.token = { value: r.access_token, expiresAt: this.now() + r.expires_in * 1000 };
    return r.access_token;
  }

  async privateCall<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    try {
      return await this.raw<T>(method, params, await this.accessToken());
    } catch (e) {
      // 13009 unauthorized / invalid_token: drop the cached token and retry once.
      if (e instanceof DeribitError && e.code === 13009) {
        this.token = null;
        return this.raw<T>(method, params, await this.accessToken());
      }
      throw e;
    }
  }
}

// ---------- Deribit response shapes (docs) ----------

export interface DeribitOrder {
  order_id: string;
  order_state: "open" | "filled" | "rejected" | "cancelled" | "untriggered" | "triggered";
  instrument_name: string;
  direction: "buy" | "sell";
  amount: number;
  filled_amount: number;
  average_price: number;
  price: number | string;
  label: string;
  reduce_only: boolean;
  last_update_timestamp: number;
}

interface DeribitPosition {
  instrument_name: string;
  kind: string;
  direction: "buy" | "sell" | "zero";
  size: number;
  size_currency?: number;
  average_price: number;
  mark_price: number;
  index_price: number;
  floating_profit_loss: number;
}

interface DeribitSummary {
  currency: string;
  equity: number;
  maintenance_margin: number;
  initial_margin: number;
}

// ---------- helpers ----------

export const isOption = (id: string) => /^BTC-\d{1,2}[A-Z]{3}\d{2}-\d+-[CP]$/.test(id);
export const isInverse = (id: string) => id === "BTC-PERPETUAL";
/** Settlement currency used for label lookups and positions. */
export const currencyOf = (id: string) => (id.startsWith("BTC_USDC-") ? "USDC" : "BTC");

function mapState(o: DeribitOrder, filledBtc: Decimal): OrderState {
  switch (o.order_state) {
    case "filled":
      return "FILLED";
    case "cancelled":
      return "CANCELED";
    case "rejected":
      return "REJECTED";
    case "open":
    case "untriggered":
    case "triggered":
      return filledBtc.gt(0) ? "PARTIAL" : "ACKNOWLEDGED";
    default:
      return "UNKNOWN";
  }
}

/** Converts a Deribit order to our Order. Prices are USD per BTC; quantities are BTC (see conventions.ts). */
export function toOrder(o: DeribitOrder, req: OrderRequest, indexUsd: Decimal): Order {
  let filled = new Decimal(o.filled_amount ?? 0);
  let avg: Decimal | null = o.average_price ? new Decimal(o.average_price) : null;
  if (isOption(o.instrument_name) && avg) avg = avg.mul(indexUsd); // option prices come back in BTC
  if (isInverse(o.instrument_name) && avg && avg.gt(0)) filled = filled.div(avg); // inverse perp amounts are USD
  return {
    ...req,
    venueOrderId: o.order_id,
    filledQuantity: filled.toDecimalPlaces(8).toString(),
    avgPrice: avg && filled.gt(0) ? avg.toFixed(2) : null,
    state: mapState(o, filled),
    source: "TESTNET",
    updatedAt: new Date(o.last_update_timestamp || Date.now()).toISOString(),
  };
}

export interface DeribitAdapterOptions {
  fetchFn?: FetchFn;
  /** How long to wait for a fill before cancelling and reporting REJECTED (DESIGN.md Section 6.2). */
  fillTimeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

export function createDeribitAdapter(opts: DeribitAdapterOptions = {}) {
  const fetchFn = opts.fetchFn ?? fetch;
  const env = opts.env ?? process.env;
  const clients: Record<DeribitAccount, DeribitClient> = {
    main: new DeribitClient(() => deribitCredsFromEnv("main", env), fetchFn),
    perp: new DeribitClient(() => deribitCredsFromEnv("perp", env), fetchFn),
  };
  const fillTimeoutMs = opts.fillTimeoutMs ?? 30_000;
  const pollMs = opts.pollMs ?? 2_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  /** clientOrderId -> what we sent. The orchestrator also persists clientOrderId before sending. */
  const sent = new Map<string, OrderRequest & { account: DeribitAccount }>();

  const index = async () =>
    new Decimal(
      (await clients.main.publicCall<{ index_price: number }>("public/get_index_price", { index_name: "btc_usd" }))
        .index_price,
    );

  async function findByLabel(req: OrderRequest & { account: DeribitAccount }): Promise<DeribitOrder | null> {
    const list = await clients[req.account].privateCall<DeribitOrder[]>("private/get_order_state_by_label", {
      currency: currencyOf(req.instrumentId),
      label: req.clientOrderId,
    });
    return list.sort((a, b) => b.last_update_timestamp - a.last_update_timestamp)[0] ?? null;
  }

  async function placeOrder(req: OrderRequest): Promise<Order> {
    if (req.account === "sandbox") throw new Error("Deribit orders need account main or perp");
    if (req.clientOrderId.length > 64) throw new Error("clientOrderId must be at most 64 chars (Deribit label)");
    const r = { ...req, account: req.account as DeribitAccount };
    const client = clients[r.account];
    const idx = await index();

    // Idempotency: an order with this label already exists -> return it, never resend.
    const prior = await findByLabel(r);
    if (prior) {
      sent.set(r.clientOrderId, r);
      return toOrder(prior, req, idx);
    }

    const qty = new Decimal(req.quantity);
    const params: Record<string, unknown> = {
      instrument_name: req.instrumentId,
      type: "limit",
      label: req.clientOrderId,
      time_in_force: "good_til_cancelled",
      reduce_only: req.reduceOnly,
    };
    if (isOption(req.instrumentId)) {
      params.amount = qty.toString();
      params.price = new Decimal(req.limitPrice).toFixed(2);
      params.advanced = "usd"; // option price in USD
    } else if (isInverse(req.instrumentId)) {
      params.amount = qty.mul(req.limitPrice).div(10).round().mul(10).toString(); // USD, $10 contracts
      params.price = new Decimal(req.limitPrice).toDecimalPlaces(1).toString();
    } else {
      params.amount = qty.toString(); // linear perp: BTC (unconfirmed, see header)
      params.price = new Decimal(req.limitPrice).toDecimalPlaces(1).toString();
    }

    sent.set(r.clientOrderId, r);
    const placed = await client.privateCall<{ order: DeribitOrder }>(
      req.side === "BUY" ? "private/buy" : "private/sell",
      params,
    );
    let o = placed.order;

    // Thin testnet books: wait for the fill, then cancel and report REJECTED (NO_FILL).
    const deadline = Date.now() + fillTimeoutMs;
    while (o.order_state === "open" && Date.now() < deadline) {
      await sleep(pollMs);
      o = await client.privateCall<DeribitOrder>("private/get_order_state", { order_id: o.order_id });
    }
    if (o.order_state === "open") {
      o = await client.privateCall<DeribitOrder>("private/cancel", { order_id: o.order_id });
      const out = toOrder(o, req, idx);
      // Fully unfilled -> REJECTED (reason NO_FILL). Partially filled stays CANCELED with filledQuantity.
      return new Decimal(out.filledQuantity).isZero() ? { ...out, state: "REJECTED" } : out;
    }
    return toOrder(o, req, idx);
  }

  async function getOrder(clientOrderId: string): Promise<Order | null> {
    const r = sent.get(clientOrderId);
    const idx = await index();
    if (r) {
      const o = await findByLabel(r);
      return o ? toOrder(o, r, idx) : null;
    }
    // Unknown here (e.g. after a restart): search both accounts and both currencies by label.
    // Note: Deribit only returns orders closed in the last 30 minutes this way.
    for (const account of ["main", "perp"] as const) {
      for (const currency of ["BTC", "USDC"]) {
        const list = await clients[account].privateCall<DeribitOrder[]>("private/get_order_state_by_label", {
          currency,
          label: clientOrderId,
        });
        const o = list.sort((a, b) => b.last_update_timestamp - a.last_update_timestamp)[0];
        if (o) {
          const amount = new Decimal(o.amount);
          const req: OrderRequest = {
            clientOrderId,
            strategyId: "unknown",
            legId: "unknown",
            venue: "DERIBIT",
            account,
            instrumentId: o.instrument_name,
            side: o.direction === "buy" ? "BUY" : "SELL",
            quantity: (isInverse(o.instrument_name) ? amount.div(o.price) : amount).toString(),
            limitPrice: String(o.price),
            reduceOnly: o.reduce_only,
          };
          return toOrder(o, req, idx);
        }
      }
    }
    return null;
  }

  async function cancelOrder(clientOrderId: string): Promise<Order> {
    const r = sent.get(clientOrderId);
    const current = await getOrder(clientOrderId);
    if (!current || !current.venueOrderId) throw new Error(`Deribit: no order with clientOrderId ${clientOrderId}`);
    if (["FILLED", "CANCELED", "REJECTED"].includes(current.state)) return current;
    const account = (r?.account ?? current.account) as DeribitAccount;
    const o = await clients[account].privateCall<DeribitOrder>("private/cancel", { order_id: current.venueOrderId });
    return toOrder(o, r ?? current, await index());
  }

  async function getPositions(account: DeribitAccount): Promise<VenuePosition[]> {
    const idx = await index();
    const out: VenuePosition[] = [];
    for (const currency of ["BTC", "USDC"]) {
      const list = await clients[account].privateCall<DeribitPosition[]>("private/get_positions", { currency });
      for (const p of list) {
        if (p.direction === "zero" || p.size === 0) continue;
        const option = p.kind === "option";
        // Options: size is BTC. Futures: size is quote currency, size_currency is BTC (docs).
        const qtyBtc = new Decimal(option ? p.size : (p.size_currency ?? p.size));
        const signed = p.direction === "sell" ? qtyBtc.abs().neg() : qtyBtc.abs();
        const px = (v: number) => (option ? new Decimal(v).mul(p.index_price || idx) : new Decimal(v));
        const pnl = currency === "BTC" ? new Decimal(p.floating_profit_loss).mul(idx) : new Decimal(p.floating_profit_loss);
        out.push({
          venue: "DERIBIT",
          account,
          instrumentId: p.instrument_name,
          quantity: signed.toString(),
          avgPrice: px(p.average_price).toFixed(2),
          markPrice: px(p.mark_price).toFixed(2),
          unrealizedPnlUsd: pnl.toFixed(2),
          source: "TESTNET",
          timestamp: new Date().toISOString(),
        });
      }
    }
    return out;
  }

  async function getMargin(account: DeribitAccount): Promise<MarginSnapshot> {
    const idx = await index();
    // Perp subaccount is USDC-margined (linear perp); the main account holds BTC for options.
    const currency = account === "perp" ? "USDC" : "BTC";
    const s = await clients[account].privateCall<DeribitSummary>("private/get_account_summary", { currency });
    const toUsd = (v: number) => (currency === "BTC" ? new Decimal(v).mul(idx) : new Decimal(v));
    const equity = toUsd(s.equity);
    const mm = toUsd(s.maintenance_margin);
    const perps = (await getPositions(account)).filter((p) => /PERPETUAL$/.test(p.instrumentId));
    const perpSize = perps.reduce((sum, p) => sum.add(p.quantity), new Decimal(0));
    return {
      account,
      equityUsd: equity.toFixed(2),
      maintenanceMarginUsd: mm.toFixed(2),
      initialMarginUsd: toUsd(s.initial_margin).toFixed(2),
      marginRatio: mm.isZero() ? "999" : equity.div(mm).toFixed(4),
      perpSizeBtc: perpSize.toString(),
      indexPriceUsd: idx.toFixed(2),
      source: "TESTNET",
      timestamp: new Date().toISOString(),
    };
  }

  return { placeOrder, getOrder, cancelOrder, getPositions, getMargin };
}
