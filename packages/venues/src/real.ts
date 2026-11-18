// Real venue adapters (Lane B).
// Done: public, keyless reads verified on 2026-11-17 against live endpoints
//   - Deribit testnet: public/get_index_price, public/get_order_book
//   - Gemini mainnet + sandbox: GET /v1/prediction-markets/events, /events/{ticker}, /v1/book/{symbol}
// Not done: authenticated calls (orders, positions, margin). They need human setup items 1-3 and
// must be verified against the docs before coding (DESIGN.md Section 6). They throw until then.
import Decimal from "decimal.js";
import type { GeminiEvent, Quote, Source, Venue, VenuesApi } from "@ttp/shared";
import { DERIBIT_OPTION_FEE_BTC_PER_CONTRACT, DERIBIT_PERP_TAKER_FEE_RATE } from "./conventions";

export const DERIBIT_TESTNET = "https://test.deribit.com/api/v2";
export const GEMINI_HOSTS = { mainnet: "https://api.gemini.com", sandbox: "https://api.sandbox.gemini.com" } as const;

const TIMEOUT_MS = 10_000;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

// ---------- Deribit (public) ----------

type DeribitResp<T> = { result: T; testnet?: boolean };
type DeribitBook = {
  best_bid_price: number | null;
  best_ask_price: number | null;
  best_bid_amount: number;
  best_ask_amount: number;
  index_price: number;
  timestamp: number;
};

const isDeribitOption = (id: string) => /^BTC-\d{1,2}[A-Z]{3}\d{2}-\d+-[CP]$/.test(id);

async function deribitIndex() {
  const r = await getJson<DeribitResp<{ index_price: number }>>(`${DERIBIT_TESTNET}/public/get_index_price?index_name=btc_usd`);
  return new Decimal(r.result.index_price);
}

async function deribitQuote(instrumentId: string): Promise<Quote> {
  const r = await getJson<DeribitResp<DeribitBook>>(
    `${DERIBIT_TESTNET}/public/get_order_book?instrument_name=${encodeURIComponent(instrumentId)}&depth=1`,
  );
  const b = r.result;
  const idx = new Decimal(b.index_price);
  const option = isDeribitOption(instrumentId);
  // Options quote in BTC; convert to USD per 1 BTC of option. Perps already quote in USD.
  const toUsd = (p: number | null) => (p == null || p === 0 ? null : (option ? idx.mul(p) : new Decimal(p)).toFixed(2));
  const ask = toUsd(b.best_ask_price);
  let fee: Decimal;
  if (option) {
    const raw = idx.mul(DERIBIT_OPTION_FEE_BTC_PER_CONTRACT);
    const cap = ask ? new Decimal(ask).mul("0.125") : raw;
    fee = Decimal.min(raw, cap);
  } else {
    fee = idx.mul(DERIBIT_PERP_TAKER_FEE_RATE);
  }
  return {
    venue: "DERIBIT",
    instrumentId,
    bid: toUsd(b.best_bid_price),
    ask,
    bidSize: b.best_bid_amount ? String(b.best_bid_amount) : null,
    askSize: b.best_ask_amount ? String(b.best_ask_amount) : null,
    feeEstimateUsd: fee.toFixed(2),
    timestamp: new Date(b.timestamp).toISOString(),
    source: "TESTNET",
  };
}

/**
 * Listed BTC call instrument names for the given expiry codes (e.g. ["11DEC26", "25DEC26"]).
 * Not part of VenuesApi: the orchestrator uses it to know which strikes to quote for L1.
 */
export async function listDeribitCalls(expiryCodes: string[]): Promise<string[]> {
  const r = await getJson<DeribitResp<{ instrument_name: string; option_type: string }[]>>(
    `${DERIBIT_TESTNET}/public/get_instruments?currency=BTC&kind=option&expired=false`,
  );
  return r.result
    .filter((i) => i.option_type === "call" && expiryCodes.some((c) => i.instrument_name.includes(`-${c}-`)))
    .map((i) => i.instrument_name);
}

// ---------- Gemini (public) ----------

type GemContract = {
  instrumentSymbol: string;
  label: string;
  prices?: { bestBid?: string; bestAsk?: string };
};
type GemEvent = {
  ticker: string;
  title: string;
  expiryDate: string;
  contracts?: GemContract[];
  termsLink?: string | null;
};
type GemBook = { bids: { price: string; amount: string }[]; asks: { price: string; amount: string }[] };

const geminiSource = (env: "mainnet" | "sandbox"): Source => (env === "mainnet" ? "LIVE_MAINNET_READONLY" : "SANDBOX");

function toGeminiEvent(e: GemEvent, env: "mainnet" | "sandbox"): GeminiEvent {
  return {
    eventTicker: e.ticker,
    title: e.title,
    expiryUtc: new Date(e.expiryDate).toISOString(),
    contracts: (e.contracts ?? []).map((c) => ({
      instrumentSymbol: c.instrumentSymbol,
      label: c.label,
      bestBid: c.prices?.bestBid ?? null,
      bestAsk: c.prices?.bestAsk ?? null,
    })),
    termsUrl: e.termsLink ?? null,
    source: geminiSource(env),
  };
}

async function geminiEvents(env: "mainnet" | "sandbox", search?: string): Promise<GeminiEvent[]> {
  const host = GEMINI_HOSTS[env];
  const q = search?.trim();
  // An exact ticker is cheapest to fetch directly.
  if (q && /^[A-Z0-9]+$/.test(q)) {
    try {
      return [toGeminiEvent(await getJson<GemEvent>(`${host}/v1/prediction-markets/events/${q}`), env)];
    } catch {
      /* not a ticker on this env; fall through to list + filter */
    }
  }
  const out: GeminiEvent[] = [];
  const limit = 100;
  for (let offset = 0; offset < 2000; offset += limit) {
    const page = await getJson<{ data: GemEvent[]; pagination?: { total: number } }>(
      `${host}/v1/prediction-markets/events?limit=${limit}&offset=${offset}`,
    );
    for (const e of page.data) {
      if (!q || e.ticker.toLowerCase().includes(q.toLowerCase()) || e.title.toLowerCase().includes(q.toLowerCase())) {
        out.push(toGeminiEvent(e, env));
      }
    }
    if (page.data.length < limit || (page.pagination && offset + limit >= page.pagination.total)) break;
  }
  return out;
}

async function geminiQuote(symbol: string, env: "mainnet" | "sandbox"): Promise<Quote> {
  const b = await getJson<GemBook>(`${GEMINI_HOSTS[env]}/v1/book/${encodeURIComponent(symbol)}?limit_bids=1&limit_asks=1`);
  const bid = b.bids[0];
  const ask = b.asks[0];
  return {
    venue: "GEMINI",
    instrumentId: symbol,
    bid: bid?.price ?? null,
    ask: ask?.price ?? null,
    bidSize: bid?.amount ?? null,
    askSize: ask?.amount ?? null,
    feeEstimateUsd: "0", // TODO(Lane B): confirm prediction-market fee schedule in docs
    timestamp: new Date().toISOString(),
    source: geminiSource(env),
  };
}

// ---------- Authenticated calls: not implemented yet ----------

function needsKeys(fn: string): never {
  throw new Error(
    `venues.real.${fn}: authenticated venue calls are not implemented yet. ` +
      "They need Gemini sandbox / Deribit testnet keys (DESIGN.md Section 13, items 1-3). Use VENUES_MODE=mock until then.",
  );
}

export const real = {
  discoverGeminiEvents: (env, search) => geminiEvents(env, search),

  async getQuote(venue: Venue, instrumentId: string, env?: "mainnet" | "sandbox" | "testnet") {
    if (venue === "DERIBIT") return deribitQuote(instrumentId);
    if (venue === "GEMINI") return geminiQuote(instrumentId, env === "mainnet" ? "mainnet" : "sandbox");
    throw new Error(`getQuote: unsupported venue ${venue}`);
  },

  placeOrder: async () => needsKeys("placeOrder"),
  getOrder: async () => needsKeys("getOrder"),
  cancelOrder: async () => needsKeys("cancelOrder"),
  getPositions: async () => needsKeys("getPositions"),
  getMargin: async () => needsKeys("getMargin"),

  async getIndexPrice() {
    return { priceUsd: (await deribitIndex()).toFixed(2), source: "TESTNET" as const, timestamp: new Date().toISOString() };
  },
} satisfies VenuesApi;
