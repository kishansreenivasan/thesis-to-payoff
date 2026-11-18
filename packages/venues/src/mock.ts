// Venues mock (Lane B). Realistic fixed data, every value labeled SIMULATED.
// Orders fill instantly at their limit price. Margin is derived from the mock perp position so a
// reduce-only sell visibly lowers maintenance margin. Numbers are tuned so that, with the plan's
// perp size (~0.0164 BTC), a -15% shock lands the projected ratio in the 1.2-1.5 band.
import Decimal from "decimal.js";
import type {
  GeminiEvent,
  MarginSnapshot,
  Order,
  OrderRequest,
  Quote,
  VenuePosition,
  VenuesApi,
} from "@ttp/shared";
import { DERIVE_TAKER_FEE_RATE } from "./conventions";
import { toDeriveExpiry } from "./derive";

const SRC = "SIMULATED" as const;
export const MOCK_INDEX_USD = "64880.00";
const now = () => new Date().toISOString();

/** Mock perp subaccount: fixed collateral, maintenance margin as a share of notional. */
const PERP_COLLATERAL_USD = new Decimal(260);
const PERP_MM_RATE = new Decimal("0.075");
const PERP_IM_RATE = new Decimal("0.11");

type Book = { bid: string | null; ask: string | null; size: string | null; fee: string };

const idx = new Decimal(MOCK_INDEX_USD);
const takerFee = idx.mul(DERIVE_TAKER_FEE_RATE).toFixed(2);

const BOOKS: Record<string, Book> = {
  // Derive options, USD per 1 BTC
  "BTC-20261211-60000-C": { bid: "5390.00", ask: "5440.00", size: "5", fee: takerFee },
  "BTC-20261211-65000-C": { bid: "2150.00", ask: "2180.00", size: "5", fee: takerFee },
  "BTC-20261211-70000-C": { bid: "720.00", ask: "750.00", size: "5", fee: takerFee },
  // Derive perp, USD per 1 BTC
  "BTC-PERP": { bid: "64875.00", ask: "64885.00", size: "5", fee: takerFee },
  // Gemini, YES book per contract
  "GEMI-FED261211-HIKEGT25": { bid: "0.02", ask: "0.07", size: "500", fee: "0" },
  "GEMI-FED261211-HIKE25": { bid: "0.88", ask: "0.93", size: "500", fee: "0" },
  "GEMI-FED261211-MAINTAIN": { bid: "0.05", ask: "0.07", size: "500", fee: "0" },
  "GEMI-BTC2611302200-HI60000": { bid: "0.80", ask: "0.84", size: "300", fee: "0" },
  "GEMI-BTC2611302200-HI62500": { bid: "0.62", ask: "0.66", size: "300", fee: "0" },
  "GEMI-BTC2611302200-HI65000": { bid: "0.45", ask: "0.50", size: "300", fee: "0" },
  "GEMI-BTC2611302200-HI67500": { bid: "0.30", ask: "0.34", size: "300", fee: "0" },
};

const EVENTS: GeminiEvent[] = [
  {
    eventTicker: "FED261211",
    title: "Fed decision in December?",
    expiryUtc: "2026-12-11T05:00:00.000Z",
    contracts: [
      { instrumentSymbol: "GEMI-FED261211-HIKE25", label: "Hike 25bps", bestBid: "0.88", bestAsk: "0.93" },
      { instrumentSymbol: "GEMI-FED261211-HIKEGT25", label: "Hike >25bps", bestBid: "0.02", bestAsk: "0.07" },
      { instrumentSymbol: "GEMI-FED261211-MAINTAIN", label: "Fed maintains rate", bestBid: "0.05", bestAsk: "0.07" },
    ],
    termsUrl: null,
    source: SRC,
  },
  {
    eventTicker: "BTC2611302200",
    title: "BTC price on November 30",
    expiryUtc: "2026-11-30T22:00:00.000Z",
    contracts: ["60000", "62500", "65000", "67500"].map((k) => {
      const sym = `GEMI-BTC2611302200-HI${k}`;
      return {
        instrumentSymbol: sym,
        label: `$${Number(k).toLocaleString("en-US")} or above`,
        bestBid: BOOKS[sym]!.bid,
        bestAsk: BOOKS[sym]!.ask,
      };
    }),
    termsUrl: null,
    source: SRC,
  },
];

/** "DERIBIT" is a compatibility alias for "DERIVE" (venue switch 2026-11-18). */
const norm = <V extends string>(v: V) => (v === "DERIBIT" ? "DERIVE" : v) as V;

function createMockVenues() {
  const orders = new Map<string, Order>();
  // key: `${venue}|${account}|${instrumentId}` -> signed qty and avg price
  const positions = new Map<string, { qty: Decimal; avg: Decimal }>();

  const key = (venue: string, account: string, instrumentId: string) => `${venue}|${account}|${instrumentId}`;

  function applyFill(o: Order) {
    const k = key(o.venue, o.account, o.instrumentId);
    const p = positions.get(k) ?? { qty: new Decimal(0), avg: new Decimal(0) };
    const signed = new Decimal(o.filledQuantity).mul(o.side === "BUY" ? 1 : -1);
    const px = new Decimal(o.avgPrice ?? 0);
    const nextQty = p.qty.add(signed);
    let avg: Decimal;
    if (nextQty.isZero()) avg = new Decimal(0);
    else if (p.qty.isZero() || nextQty.isNeg() !== p.qty.isNeg()) avg = px; // opened or flipped
    else if (signed.isNeg() === p.qty.isNeg()) avg = p.avg.mul(p.qty).add(px.mul(signed)).div(nextQty); // added
    else avg = p.avg; // reduced
    positions.set(k, { qty: nextQty, avg });
  }

  function mark(instrumentId: string): Decimal | null {
    const bare = instrumentId.replace(/:(YES|NO)$/, "");
    const b = BOOKS[bare];
    if (!b?.bid || !b.ask) return null;
    const mid = new Decimal(b.bid).add(b.ask).div(2);
    return instrumentId.endsWith(":NO") ? new Decimal(1).sub(mid) : mid;
  }

  const api = {
    async discoverGeminiEvents(_env, search) {
      const q = search?.toLowerCase();
      return EVENTS.filter((e) => !q || e.eventTicker.toLowerCase().includes(q) || e.title.toLowerCase().includes(q));
    },

    async getQuote(venue, instrumentId) {
      const b = BOOKS[instrumentId];
      if (!b) throw new Error(`mock: no book for ${venue} ${instrumentId}`);
      return {
        venue: norm(venue),
        instrumentId,
        bid: b.bid,
        ask: b.ask,
        bidSize: b.size,
        askSize: b.size,
        feeEstimateUsd: b.fee,
        timestamp: now(),
        source: SRC,
      } satisfies Quote;
    },

    async placeOrder(req: OrderRequest) {
      const existing = orders.get(req.clientOrderId);
      if (existing) return existing; // idempotent on clientOrderId
      const o: Order = {
        ...req,
        venue: norm(req.venue),
        venueOrderId: `mock-${orders.size + 1}`,
        filledQuantity: req.quantity,
        avgPrice: req.limitPrice,
        state: "FILLED",
        source: SRC,
        updatedAt: now(),
      };
      orders.set(req.clientOrderId, o);
      applyFill(o);
      return o;
    },

    async getOrder(_venue, clientOrderId) {
      return orders.get(clientOrderId) ?? null;
    },

    async cancelOrder(venue, clientOrderId) {
      const o = orders.get(clientOrderId);
      if (!o) throw new Error(`mock: unknown order ${venue} ${clientOrderId}`);
      if (o.state === "FILLED") return o; // nothing to cancel
      const c = { ...o, state: "CANCELED" as const, updatedAt: now() };
      orders.set(clientOrderId, c);
      return c;
    },

    async getPositions(venue, account) {
      const out: VenuePosition[] = [];
      for (const [k, p] of positions) {
        const [v, a, instrumentId] = k.split("|") as [string, string, string];
        const ven = norm(venue);
        if (v !== ven || (ven === "DERIVE" && a !== account) || p.qty.isZero()) continue;
        const m = mark(instrumentId);
        out.push({
          venue: ven,
          account: a,
          instrumentId,
          quantity: p.qty.toString(),
          avgPrice: p.avg.toFixed(2),
          markPrice: m ? m.toFixed(2) : null,
          unrealizedPnlUsd: m ? m.sub(p.avg).mul(p.qty).toFixed(2) : null,
          source: SRC,
          timestamp: now(),
        });
      }
      return out;
    },

    async getMargin(account) {
      const perp = positions.get(key("DERIVE", "perp", "BTC-PERP"));
      const size = account === "perp" && perp ? perp.qty : new Decimal(0);
      const pnl = perp && account === "perp" ? idx.sub(perp.avg).mul(perp.qty) : new Decimal(0);
      const notional = size.abs().mul(idx);
      const equity = (account === "perp" ? PERP_COLLATERAL_USD : new Decimal(1000)).add(pnl);
      const mm = notional.mul(PERP_MM_RATE);
      return {
        account,
        equityUsd: equity.toFixed(2),
        maintenanceMarginUsd: mm.toFixed(2),
        initialMarginUsd: notional.mul(PERP_IM_RATE).toFixed(2),
        marginRatio: mm.isZero() ? "999" : equity.div(mm).toFixed(4),
        perpSizeBtc: size.toString(),
        indexPriceUsd: MOCK_INDEX_USD,
        source: SRC,
        timestamp: now(),
      } satisfies MarginSnapshot;
    },

    async getIndexPrice() {
      return { priceUsd: MOCK_INDEX_USD, source: SRC, timestamp: now() };
    },
  } satisfies VenuesApi;

  return api;
}

/** Mock counterpart of real.listCalls. Accepts "20261211" or "11DEC26". */
export async function listCallsMock(expiries: string[]): Promise<string[]> {
  const codes = expiries.map(toDeriveExpiry);
  return Object.keys(BOOKS).filter((id) => id.endsWith("-C") && codes.some((c) => id.startsWith(`BTC-${c}-`)));
}

/** Fresh mock with empty order and position state (use in tests and demo:reset). */
export { createMockVenues };

export const mock: VenuesApi = createMockVenues();
