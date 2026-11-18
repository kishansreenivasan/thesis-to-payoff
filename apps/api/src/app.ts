// Orchestrator (Lane C). The only place that composes packages. Routes: DESIGN.md Section 10.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import {
  OrderRequest,
  PositionSnapshot,
  Quote,
  RiskInput,
  StrategyPlan,
  ThesisIntent,
  type Order,
  type RiskApi,
  type StrategyApi,
  type TransferRequest,
  type TreasuryApi,
  type VenuesApi,
} from "@ttp/shared";

interface Dependencies {
  strategy?: StrategyApi;
  venues?: VenuesApi;
  treasury?: TreasuryApi;
  risk?: RiskApi;
  decideMockRequest?: (requestId: string, approved: boolean) => TransferRequest;
}

export function buildApp(deps: Dependencies = {}) {
  const app = Fastify({ logger: true });
  const quoted = new Map<string, { plan: StrategyPlan; quotes: ReturnType<typeof Quote.parse>[] }>();
  const approvals = new Map<string, string>();
  const positions = new Map<string, ReturnType<typeof PositionSnapshot.parse>>();
  const rescueRequests = new Map<string, Awaited<ReturnType<TreasuryApi["getReleaseStatus"]>>>();
  const riskStates = new Map<string, "NORMAL" | "WARN" | "FUNDING_ELIGIBLE" | "APPROVAL_PENDING" | "DELEVERAGE_REQUIRED" | "RECOVERED" | "CLOSING" | "FAILED_SAFE">();

  app.get("/api/health", async () => ({
    ok: true,
    modes: {
      treasury: process.env.TREASURY_MODE ?? "mock",
      risk: process.env.RISK_MODE ?? "mock",
      venues: process.env.VENUES_MODE ?? "mock",
      strategy: process.env.STRATEGY_MODE ?? "mock",
    },
    demoMode: process.env.DEMO_MODE === "true",
  }));

  app.post<{ Body: { text?: string } }>("/api/theses/compile", async (request, reply) => {
    const text = request.body?.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return reply.code(400).send({ error: "text must be a non-empty string" });
    }
    if (!deps.strategy) return reply.code(503).send({ error: "Strategy service is not available" });
    return deps.strategy.parseThesis(text);
  });

  app.post<{ Body: { text?: string } }>("/api/strategies/quote", async (request, reply) => {
    const text = request.body?.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return reply.code(400).send({ error: "text must be a non-empty string" });
    }
    if (!deps.strategy) return reply.code(503).send({ error: "Strategy service is not available" });
    if (
      process.env.DEMO_MODE !== "true" ||
      (process.env.VENUES_MODE ?? "mock") !== "mock" ||
      (process.env.STRATEGY_MODE ?? "mock") !== "mock"
    ) {
      return reply.code(503).send({ error: "Fixture quotes are available only in mock demo mode" });
    }

    const parsed = await deps.strategy.parseThesis(text);
    const intent = ThesisIntent.safeParse(parsed);
    if (!intent.success) return parsed;

    try {
      const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/b/demo-quotes.json");
      const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { quotes?: unknown[] };
      const quotes = (fixture.quotes ?? []).map((quote) => Quote.parse(quote));
      const plan = deps.strategy.buildPlan(intent.data, quotes);
      const payoff = deps.strategy.payoffGrid(plan, quotes);
      quoted.set(plan.strategyId, { plan, quotes });
      return { plan, quotes, payoff };
    } catch (error) {
      request.log.warn({ err: error }, "Failed to build strategy quote");
      return reply.code(422).send({ error: error instanceof Error ? error.message : "Unable to build strategy quote" });
    }
  });

  app.post<{ Params: { id: string }; Body: { versionHash?: string } }>("/api/strategies/:id/approve", async (request, reply) => {
    const draft = quoted.get(request.params.id);
    if (!draft) return reply.code(404).send({ error: "Quoted strategy not found" });
    if (request.body?.versionHash !== draft.plan.versionHash) {
      return reply.code(409).send({ error: "versionHash does not match the quoted plan" });
    }
    approvals.set(draft.plan.strategyId, draft.plan.versionHash);
    return { strategyId: draft.plan.strategyId, versionHash: draft.plan.versionHash, approved: true };
  });

  app.post<{ Params: { id: string } }>("/api/strategies/:id/execute", async (request, reply) => {
    const draft = quoted.get(request.params.id);
    if (!draft) return reply.code(404).send({ error: "Quoted strategy not found" });
    if (approvals.get(request.params.id) !== draft.plan.versionHash) {
      return reply.code(409).send({ error: "Strategy needs approval for this versionHash" });
    }
    const existing = positions.get(request.params.id);
    if (existing) return existing;
    if (!deps.venues) return reply.code(503).send({ error: "Venue service is not available" });
    if (process.env.DEMO_MODE !== "true" || (process.env.VENUES_MODE ?? "mock") !== "mock") {
      return reply.code(503).send({ error: "This execution coordinator is enabled only for mock demo mode" });
    }

    const orders: Order[] = [];
    try {
      const executionOrder = ["L3b", "L1", "L2"];
      const realLegs = draft.plan.legs.filter((item) => item.executionMode === "REAL")
        .sort((a, b) => executionOrder.indexOf(a.legId) - executionOrder.indexOf(b.legId));
      for (const leg of realLegs) {
        const order = OrderRequest.parse({
          clientOrderId: `${draft.plan.strategyId}-${draft.plan.revision}-${leg.legId}`,
          strategyId: draft.plan.strategyId,
          legId: leg.legId,
          venue: leg.venue,
          account: leg.account,
          instrumentId: leg.instrumentId,
          side: leg.side,
          quantity: leg.quantity,
          limitPrice: leg.limitPrice,
          reduceOnly: false,
        });
        const placed = await deps.venues.placeOrder(order);
        orders.push(placed);
        if (placed.state !== "FILLED") break;
      }
    } catch (error) {
      for (const order of orders) {
        if (order.state !== "FILLED") await deps.venues.cancelOrder(order.venue, order.clientOrderId).catch(() => undefined);
      }
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Order execution failed", orders });
    }

    const [mainPositions, perpPositions, margin] = await Promise.all([
      deps.venues.getPositions("DERIBIT", "main"),
      deps.venues.getPositions("DERIBIT", "perp"),
      deps.venues.getMargin("perp"),
    ]);
    const snapshot = PositionSnapshot.parse({
      positionId: `pos_${draft.plan.strategyId}`,
      strategyId: draft.plan.strategyId,
      state: orders.every((order) => order.state === "FILLED") ? "OPEN" : "PARTIAL",
      riskState: "NORMAL",
      orders,
      positions: [...mainPositions, ...perpPositions],
      margins: [margin],
      estimatedPnlUsd: "0",
      updatedAt: new Date().toISOString(),
    });
    positions.set(request.params.id, snapshot);
    return snapshot;
  });

  app.get<{ Params: { id: string } }>("/api/positions/:id", async (request, reply) => {
    const position = [...positions.values()].find((item) => item.positionId === request.params.id || item.strategyId === request.params.id);
    if (!position) return reply.code(404).send({ error: "Position not found" });
    return position;
  });

  app.post<{ Params: { id: string }; Body: { shockPct?: string } }>("/api/demo/:id/shock", async (request, reply) => {
    if (process.env.DEMO_MODE !== "true") return reply.code(403).send({ error: "Shock controls are available only in demo mode" });
    const snapshot = positions.get(request.params.id);
    const draft = quoted.get(request.params.id);
    if (!snapshot || !draft) return reply.code(404).send({ error: "Open demo position not found" });
    if (!deps.risk || !deps.treasury || !deps.venues) return reply.code(503).send({ error: "Risk, treasury, and venue services are required" });

    const shockPct = request.body?.shockPct ?? "-8";
    if (!/^-?\d+(\.\d+)?$/.test(shockPct)) return reply.code(400).send({ error: "shockPct must be a decimal string" });
    const [margin, perpPositions, treasuryStatus] = await Promise.all([
      deps.venues.getMargin("perp"),
      deps.venues.getPositions("DERIBIT", "perp"),
      deps.treasury.getTreasuryStatus(),
    ]);
    // Derive "BTC-PERP"; "PERP" also matches the old Deribit "*-PERPETUAL" names.
    const perp = perpPositions.find((item) => item.instrumentId.includes("PERP"));
    const priorRequest = rescueRequests.get(request.params.id) ?? null;
    const remainingDaily = BigInt(treasuryStatus.dailyCapUsdc6) - BigInt(treasuryStatus.spentTodayUsdc6);
    const decision = deps.risk.evaluateRisk(RiskInput.parse({
      margin,
      shockPct,
      perpUnrealizedPnlUsd: perp?.unrealizedPnlUsd ?? "0",
      perpStopLossUsd: draft.plan.perpStopLossUsd,
      treasury: { perTxCapUsdc6: treasuryStatus.perTxCapUsdc6, remainingDailyUsdc6: remainingDaily.toString(), balanceUsdc6: treasuryStatus.balanceUsdc6 },
      openRequest: priorRequest ? { requestId: priorRequest.requestId, state: priorRequest.state, expiresAtUtc: priorRequest.expiresAtUtc ?? new Date().toISOString() } : null,
      currentState: riskStates.get(request.params.id) ?? "NORMAL",
    }));
    let transferRequest = null;
    let reduceOrder: Order | null = null;
    if ((decision.action === "RELEASE_WITHIN_LIMITS" || decision.action === "REQUEST_APPROVAL") && decision.topUpUsdc6) {
      transferRequest = await deps.treasury.releaseWithinLimits(draft.plan.strategyId, "DERIBIT", decision.topUpUsdc6);
      if (transferRequest.state === "REJECTED") {
        transferRequest = await deps.treasury.requestRelease(draft.plan.strategyId, "DERIBIT", decision.topUpUsdc6, 120);
      }
      rescueRequests.set(request.params.id, transferRequest);
    } else if ((decision.action === "REDUCE_PERP" || decision.action === "CLOSE_PERP") && perp && decision.reduceQtyBtc) {
      const quote = await deps.venues.getQuote("DERIBIT", perp.instrumentId, "testnet");
      if (quote.bid) reduceOrder = await deps.venues.placeOrder(OrderRequest.parse({
        clientOrderId: `${draft.plan.strategyId}-rescue-${Date.now()}`, strategyId: draft.plan.strategyId, legId: "L2",
        venue: "DERIBIT", account: "perp", instrumentId: perp.instrumentId, side: "SELL", quantity: decision.reduceQtyBtc,
        limitPrice: quote.bid, reduceOnly: true,
      }));
    }
    riskStates.set(request.params.id, decision.nextState);
    return { margin, projectedRatio: decision.projectedRatio, projectedSource: decision.projectedSource, decision, transferRequest, reduceOrder };
  });

  app.post<{ Params: { id: string }; Body: { approved?: boolean } }>("/api/treasury/requests/:id/decision", async (request, reply) => {
    if (!deps.decideMockRequest || process.env.DEMO_MODE !== "true" || (process.env.TREASURY_MODE ?? "mock") !== "mock") {
      return reply.code(503).send({ error: "Owner decisions are available only with the mock treasury" });
    }
    if (typeof request.body?.approved !== "boolean") return reply.code(400).send({ error: "approved must be a boolean" });
    try {
      const updated = deps.decideMockRequest(request.params.id, request.body.approved);
      for (const [positionId, item] of rescueRequests) if (item.requestId === request.params.id) rescueRequests.set(positionId, updated);
      return updated;
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "Unknown approval request" });
    }
  });

  app.get("/api/treasury", async (_request, reply) => {
    if (!deps.treasury) return reply.code(503).send({ error: "Treasury service is not available" });
    const openRequests = [...rescueRequests.values()].filter((item) => ["REQUESTED", "OWNER_APPROVAL_NEEDED", "OWNER_APPROVED"].includes(item.state));
    return { status: await deps.treasury.getTreasuryStatus(), openRequests };
  });

  return app;
}
