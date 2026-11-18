// Real venue adapters (Lane B).
//   - Derive testnet (L1 call, L2 perp): derive.ts. Replaced Deribit on 2026-11-18 (BLOCKED.md).
//   - Gemini mainnet (read-only) + sandbox (L3a quote, L3b order): public reads here, private in gemini.ts.
// "DERIBIT" is accepted as an alias for "DERIVE" so callers written before the switch keep working.
import type { GeminiEvent, Quote, Source, Venue, VenuesApi } from "@ttp/shared";
import { createDeriveAdapter, createDerivePublic } from "./derive";
import { createGeminiAdapter } from "./gemini";

export const GEMINI_HOSTS = { mainnet: "https://api.gemini.com", sandbox: "https://api.sandbox.gemini.com" } as const;

const TIMEOUT_MS = 10_000;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** L1/L2 venue. "DERIBIT" is a compatibility alias for "DERIVE". */
export const isDeriveVenue = (v: Venue) => v === "DERIVE" || v === "DERIBIT";

const unsupported = (venue: string): never => {
  throw new Error(`venues.real: unsupported venue ${venue}`);
};

// ---------- Gemini (public) ----------

type GemContract = { instrumentSymbol: string; label: string; prices?: { bestBid?: string; bestAsk?: string } };
type GemEvent = { ticker: string; title: string; expiryDate: string; contracts?: GemContract[]; termsLink?: string | null };
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

// ---------- wiring ----------

const derivePublic = createDerivePublic();
const derive = createDeriveAdapter();
const gemini = createGeminiAdapter();

/** Active BTC call names for the given expiries, so the orchestrator knows which L1 strikes to quote. */
export const listCalls = (expiries: string[]) => derivePublic.listCalls(expiries);
/** @deprecated use listCalls (venue is Derive now). */
export const listDeribitCalls = listCalls;

export const real = {
  discoverGeminiEvents: (env, search) => geminiEvents(env, search),

  async getQuote(venue: Venue, instrumentId: string, env?: "mainnet" | "sandbox" | "testnet") {
    if (isDeriveVenue(venue)) return derivePublic.quote(instrumentId);
    if (venue === "GEMINI") return geminiQuote(instrumentId, env === "mainnet" ? "mainnet" : "sandbox");
    return unsupported(venue);
  },

  placeOrder: (req) =>
    isDeriveVenue(req.venue)
      ? derive.placeOrder({ ...req, venue: "DERIVE" })
      : req.venue === "GEMINI"
        ? gemini.placeOrder(req)
        : unsupported(req.venue),
  getOrder: (venue, id) => (isDeriveVenue(venue) ? derive.getOrder(id) : venue === "GEMINI" ? gemini.getOrder(id) : unsupported(venue)),
  cancelOrder: (venue, id) => (isDeriveVenue(venue) ? derive.cancelOrder(id) : venue === "GEMINI" ? gemini.cancelOrder(id) : unsupported(venue)),
  getPositions: (venue, account) =>
    isDeriveVenue(venue) ? derive.getPositions(account) : venue === "GEMINI" ? gemini.getPositions() : unsupported(venue),
  getMargin: (account) => derive.getMargin(account),

  async getIndexPrice() {
    return { priceUsd: (await derivePublic.index()).toFixed(2), source: "TESTNET" as const, timestamp: new Date().toISOString() };
  },
} satisfies VenuesApi;
