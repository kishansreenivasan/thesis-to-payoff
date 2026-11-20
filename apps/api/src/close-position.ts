import Decimal from "decimal.js";
import { Order, OrderRequest, Quote, VenuePosition, type StrategyPlan, type VenuesApi } from "@ttp/shared";
import type { createOrderStore } from "./order-store";

const terminal = (state: string) => ["FILLED", "CANCELED", "REJECTED"].includes(state);
export type CloseLegResult = { legId: string; instrumentId: string; state: "CLOSED" | "PENDING"; remainingQuantity: string | null; order: Order | null; error: string | null };

function checkedOrder(value: unknown, request: OrderRequest): Order {
  const order = Order.parse(value);
  if (order.clientOrderId !== request.clientOrderId || new Decimal(order.filledQuantity).lt(0) || new Decimal(order.filledQuantity).gt(request.quantity)) throw new Error("Unexpected venue fill response; reconcile the submitted order before retrying.");
  return { ...order, ...request };
}

/** Close only this strategy's attributed fills, never the whole shared venue account. */
export async function closePositionLegs(plan: StrategyPlan, venues: VenuesApi, store: ReturnType<typeof createOrderStore>) {
  const results: CloseLegResult[] = [];
  // Remove leveraged exposure first, before selling its hedges.
  const legs = plan.legs.filter((leg) => leg.executionMode === "REAL").sort((a, b) => Number(b.type === "PERP") - Number(a.type === "PERP"));
  for (const leg of legs) {
    const instrumentId = leg.venue === "GEMINI" && !/:(YES|NO)$/.test(leg.instrumentId)
      ? `${leg.instrumentId}:${leg.type === "EVENT_NO" ? "NO" : "YES"}` : leg.instrumentId;
    const matches = (req: OrderRequest) => req.venue === leg.venue && req.account === leg.account && req.instrumentId === instrumentId;
    const net = () => store.listOrders(plan.strategyId).filter((row) => matches(row.request)).reduce((qty, row) => qty.plus(new Decimal(row.order?.filledQuantity ?? "0").times(row.request.side === "BUY" ? 1 : -1)), new Decimal(0));
    let remaining: Decimal | null = null;
    let placed: Order | null = null;
    try {
      // Recover/cancel every live or uncertain entry, rescue or exit before retrying this leg.
      for (const entry of store.listOrders(plan.strategyId).filter((row) => matches(row.request) && !terminal(row.state))) {
        let found = await venues.getOrder(leg.venue, entry.request.clientOrderId);
        if (!found) throw new Error("An earlier order has an uncertain status. No duplicate exit was submitted; reconcile it at the venue.");
        if (!terminal(found.state)) found = await venues.cancelOrder(leg.venue, entry.request.clientOrderId);
        const recovered = checkedOrder(found, entry.request);
        store.saveOrder(recovered);
        if (!terminal(recovered.state)) throw new Error("An earlier order is still active; wait for its cancellation before retrying.");
      }
      const records = store.listOrders(plan.strategyId).filter((row) => matches(row.request));
      remaining = net();
      if (!remaining.isZero()) {
        const account = leg.account === "perp" ? "perp" : "main";
        const held = (await venues.getPositions(leg.venue, account)).map((p) => VenuePosition.parse(p)).find((p) => p.instrumentId === instrumentId && p.account === leg.account);
        const available = new Decimal(held?.quantity ?? "0");
        if (available.isZero() || available.isNegative() !== remaining.isNegative()) throw new Error("Venue holdings do not yet match the execution record. Refresh and reconcile before retrying.");
        const side = remaining.gt(0) ? "SELL" : "BUY";
        if (leg.venue === "GEMINI" && side !== "SELL") throw new Error("Only selling held Gemini contracts is supported for exits.");
        const quote = Quote.parse(await venues.getQuote(leg.venue, leg.instrumentId.replace(/:(YES|NO)$/, ""), leg.venue === "GEMINI" ? "sandbox" : "testnet"));
        const age = Date.now() - Date.parse(quote.timestamp);
        if (age > 10_000 || age < -1000) throw new Error("Exit quote is stale; refresh and retry.");
        const no = leg.venue === "GEMINI" && instrumentId.endsWith(":NO");
        const price = no ? (quote.ask === null ? null : new Decimal(1).minus(quote.ask)) : (side === "SELL" ? quote.bid : quote.ask);
        const size = no ? quote.askSize : side === "SELL" ? quote.bidSize : quote.askSize;
        if (price === null || new Decimal(price).lte(0) || size === null || new Decimal(size).lte(0)) throw new Error("No executable exit liquidity. The leg remains open; retry when liquidity returns.");
        const quantity = Decimal.min(remaining.abs(), available.abs(), size);
        // Round toward the book to keep the limit within 1% of the quoted exit price.
        const tick = leg.instrumentId.includes("PERP") ? "0.1" : "1";
        const limit = leg.venue === "GEMINI" ? new Decimal(price) : new Decimal(price).times(side === "SELL" ? "0.99" : "1.01").div(tick).toDecimalPlaces(0, side === "SELL" ? Decimal.ROUND_UP : Decimal.ROUND_DOWN).times(tick);
        if (limit.lte(0) || (leg.venue === "GEMINI" && limit.gte(1))) throw new Error("No valid exit price on the instrument's price grid.");
        const req = OrderRequest.parse({
          clientOrderId: `${plan.strategyId}-r${store.runId()}-close-${leg.legId}-${records.filter((row) => row.request.legId.startsWith("CLOSE_")).length + 1}`,
          strategyId: plan.strategyId, legId: `CLOSE_${leg.legId}`, venue: leg.venue, account: leg.account, instrumentId,
          side, quantity: quantity.toFixed(), limitPrice: limit.toFixed(), reduceOnly: leg.venue === "DERIVE" || leg.venue === "DERIBIT",
        });
        store.saveSubmitting(req);
        placed = checkedOrder(await venues.placeOrder(req), req);
        store.saveOrder(placed);
        if (!terminal(placed.state)) {
          placed = checkedOrder(await venues.cancelOrder(req.venue, req.clientOrderId), req);
          store.saveOrder(placed);
          if (!terminal(placed.state)) throw new Error("The exit is still active; its status must be reconciled before retrying.");
        }
        remaining = net();
      }
      results.push({ legId: leg.legId, instrumentId, state: remaining.isZero() ? "CLOSED" : "PENDING", remainingQuantity: remaining.abs().toFixed(), order: placed, error: remaining.isZero() ? null : "Only part of the leg filled. Retry close for the remaining quantity." });
    } catch (error) {
      const uncertain = store.listOrders(plan.strategyId).some((row) => matches(row.request) && !terminal(row.state));
      remaining = uncertain ? null : net();
      results.push({ legId: leg.legId, instrumentId, state: "PENDING", remainingQuantity: remaining?.abs().toFixed() ?? null, order: placed, error: error instanceof Error ? error.message : "Exit failed" });
    }
  }
  return results;
}
