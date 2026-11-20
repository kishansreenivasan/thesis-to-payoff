import Decimal from "decimal.js";
import type { OrderRequest, Quote } from "@ttp/shared";

export function validateEntryQuote(order: OrderRequest, quote: Quote, now = Date.now()) {
  const age = now - Date.parse(quote.timestamp);
  if (quote.instrumentId !== order.instrumentId.replace(/:(YES|NO)$/, "")) throw new Error("The venue returned a quote for a different instrument.");
  if (age > 10_000 || age < -1000) throw new Error("Quotes expired. Build the strategy again before executing.");
  const no = order.venue === "GEMINI" && order.instrumentId.endsWith(":NO");
  const rawPrice = no ? quote.bid : order.side === "BUY" ? quote.ask : quote.bid;
  const size = no ? quote.bidSize : order.side === "BUY" ? quote.askSize : quote.bidSize;
  if (rawPrice === null || size === null) throw new Error(`No executable liquidity for ${order.legId}. Refresh the plan.`);
  const price = no ? new Decimal(1).minus(rawPrice) : new Decimal(rawPrice);
  if (price.lte(0) || (order.venue === "GEMINI" && price.gte(1)) || new Decimal(size).lt(order.quantity)) throw new Error(`Insufficient executable liquidity for ${order.legId}. Refresh the plan.`);
  if (order.side === "BUY" ? price.gt(order.limitPrice) : price.lt(order.limitPrice)) throw new Error(`The price for ${order.legId} moved beyond the approved limit. Refresh and approve the updated plan.`);
}
