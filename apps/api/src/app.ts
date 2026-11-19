// Orchestrator (Lane C). The only place that composes packages. Routes: DESIGN.md Section 10.
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { createMcpServer } from "@ttp/mcp";
import { createOrderStore } from "./order-store";
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
  const store = createOrderStore();
  const eventBus = new EventEmitter();
  let monitorTimer: ReturnType<typeof setInterval> | undefined;
  const quoted = new Map<string, { plan: StrategyPlan; quotes: ReturnType<typeof Quote.parse>[] }>();
  const approvals = new Map<string, string>();
  const positions = new Map<string, ReturnType<typeof PositionSnapshot.parse>>();
  const rescueRequests = new Map<string, Awaited<ReturnType<TreasuryApi["getReleaseStatus"]>>>();
  const riskStates = new Map<string, "NORMAL" | "WARN" | "FUNDING_ELIGIBLE" | "APPROVAL_PENDING" | "DELEVERAGE_REQUIRED" | "RECOVERED" | "CLOSING" | "FAILED_SAFE">();

  const recordEvent = (event: Omit<import("@ttp/shared").ActivityEvent, "seq">) => {
    const saved = store.appendEvent(event);
    if (saved.positionId) eventBus.emit(saved.positionId, saved);
    return saved;
  };

  // Live = real venue and strategy modes. DEMO_MODE only adds the shock/reset controls; with live
  // venues those controls place real testnet orders, so they need the operator bearer token.
  const liveMode = () => process.env.VENUES_MODE === "real" && process.env.STRATEGY_MODE === "real";
  const demoMode = () => process.env.DEMO_MODE === "true";
  const demoShocks = new Map<string, string>();
  const hasBearer = (authorization?: string) => {
    const token = process.env.MCP_BEARER_TOKEN;
    if (!token || !authorization?.startsWith("Bearer ")) return false;
    const expected = Buffer.from(token);
    const supplied = Buffer.from(authorization.slice(7));
    return expected.length > 0 && supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };

  let stopVaultEvents: () => void = () => {};
  if (deps.treasury) {
    stopVaultEvents = deps.treasury.watchVaultEvents((event) => recordEvent({
      timestamp: event.timestamp,
      positionId: event.positionId ?? (typeof event.details.strategyId === "string" ? `pos_${event.details.strategyId}` : null),
      type: event.type,
      reasonCode: event.reasonCode,
      details: event.details,
      source: event.source,
    }));
  }

  app.addHook("onClose", async () => {
    if (monitorTimer) clearInterval(monitorTimer);
    stopVaultEvents();
    store.close();
  });

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
    const liveMode = (process.env.VENUES_MODE ?? "mock") === "real" && (process.env.STRATEGY_MODE ?? "mock") === "real";
    if (!liveMode && (process.env.DEMO_MODE !== "true" || (process.env.VENUES_MODE ?? "mock") !== "mock" || (process.env.STRATEGY_MODE ?? "mock") !== "mock")) {
      return reply.code(503).send({ error: "Use both real modes for live quotes, or mock demo mode for fixture quotes" });
    }

    const parsed = await deps.strategy.parseThesis(text);
    const intent = ThesisIntent.safeParse(parsed);
    if (!intent.success) return parsed;

    try {
      let quotes: ReturnType<typeof Quote.parse>[];
      if (liveMode) {
        if (!deps.venues) return reply.code(503).send({ error: "Venue service is not available" });
        const { listCalls } = await import("@ttp/venues");
        const { L1_EXPIRY_PREFERENCE, FED_HEDGE_SYMBOL, L3B_EVENT } = await import("@ttp/strategy");
        const venues = deps.venues;
        const callIds = await listCalls(L1_EXPIRY_PREFERENCE);
        const events = await venues.discoverGeminiEvents("sandbox", L3B_EVENT);
        const sandboxIds = events.flatMap((event) => event.contracts.map((contract) => contract.instrumentSymbol));
        const quoteRequests: Array<Promise<unknown>> = [
          ...callIds.map((id) => venues.getQuote("DERIVE", id, "testnet")),
          venues.getQuote("DERIVE", "BTC-PERP", "testnet"),
          venues.getQuote("GEMINI", FED_HEDGE_SYMBOL, "mainnet"),
          ...sandboxIds.map((id) => venues.getQuote("GEMINI", id, "sandbox")),
        ];
        quotes = (await Promise.all(quoteRequests)).map((quote) => Quote.parse(quote));
      } else {
        const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/b/demo-quotes.json");
        const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { quotes?: unknown[] };
        quotes = (fixture.quotes ?? []).map((quote) => Quote.parse(quote));
      }
      const plan = deps.strategy.buildPlan(intent.data, quotes);
      const payoff = deps.strategy.payoffGrid(plan, quotes);
      quoted.set(plan.strategyId, { plan, quotes });
      store.savePlan(plan, quotes);
      recordEvent({ timestamp: new Date().toISOString(), positionId: `pos_${plan.strategyId}`, type: "PLAN_QUOTED", reasonCode: null, details: { strategyId: plan.strategyId, versionHash: plan.versionHash, sources: [...new Set(quotes.map((quote) => quote.source))] }, source: "SIMULATED" });
      return { plan, quotes, payoff };
    } catch (error) {
      request.log.warn({ err: error }, "Failed to build strategy quote");
      return reply.code(422).send({ error: error instanceof Error ? error.message : "Unable to build strategy quote" });
    }
  });

  app.post<{ Params: { id: string }; Body: { versionHash?: string } }>("/api/strategies/:id/approve", async (request, reply) => {
    if (liveMode() && !hasBearer(request.headers.authorization)) return reply.code(401).header("www-authenticate", "Bearer").send({ error: "Unauthorized" });
    const saved = store.getPlan(request.params.id);
    const draft = quoted.get(request.params.id) ?? (saved ? { plan: saved.plan, quotes: saved.quotes } : undefined);
    if (!draft) return reply.code(404).send({ error: "Quoted strategy not found" });
    if (request.body?.versionHash !== draft.plan.versionHash) {
      return reply.code(409).send({ error: "versionHash does not match the quoted plan" });
    }
    approvals.set(draft.plan.strategyId, draft.plan.versionHash);
    store.approve(draft.plan.strategyId);
    recordEvent({ timestamp: new Date().toISOString(), positionId: `pos_${draft.plan.strategyId}`, type: "STRATEGY_APPROVED", reasonCode: null, details: { strategyId: draft.plan.strategyId, versionHash: draft.plan.versionHash }, source: "SIMULATED" });
    return { strategyId: draft.plan.strategyId, versionHash: draft.plan.versionHash, approved: true };
  });

  app.post<{ Params: { id: string } }>("/api/strategies/:id/execute", async (request, reply) => {
    const saved = store.getPlan(request.params.id);
    const draft = quoted.get(request.params.id) ?? (saved ? { plan: saved.plan, quotes: saved.quotes } : undefined);
    if (!draft) return reply.code(404).send({ error: "Quoted strategy not found" });
    if (approvals.get(request.params.id) !== draft.plan.versionHash && !saved?.approved) {
      return reply.code(409).send({ error: "Strategy needs approval for this versionHash" });
    }
    const existing = positions.get(request.params.id) ?? saved?.position ?? undefined;
    if (existing) return existing;
    if (!deps.venues) return reply.code(503).send({ error: "Venue service is not available" });
    const mockExecution = demoMode() && (process.env.VENUES_MODE ?? "mock") === "mock";
    const liveExecution = liveMode();
    if (liveExecution && !hasBearer(request.headers.authorization)) return reply.code(401).header("www-authenticate", "Bearer").send({ error: "Unauthorized" });
    if (!mockExecution && !liveExecution) {
      return reply.code(503).send({ error: "Execution requires mock demo mode or both real venue and strategy modes" });
    }

    if (liveExecution) {
      const required = ["DERIVE_WALLET", "DERIVE_SIGNER_PRIVATE_KEY", "DERIVE_MAIN_SUBACCOUNT_ID", "DERIVE_PERP_SUBACCOUNT_ID", "GEMINI_SANDBOX_KEY", "GEMINI_SANDBOX_SECRET"];
      const missing = required.filter((name) => !process.env[name]);
      if (missing.length) return reply.code(503).send({ error: `Live execution is missing credentials: ${missing.join(", ")}` });
      try {
        await Promise.all([
          deps.venues.getPositions("DERIVE", "main"),
          deps.venues.getPositions("DERIVE", "perp"),
          deps.venues.getMargin("perp"),
          deps.venues.getPositions("GEMINI", "main"),
        ]);
      } catch (error) {
        return reply.code(503).send({ error: `Live venue preflight failed before submitting orders: ${error instanceof Error ? error.message : "unknown venue error"}` });
      }
    }

    const orders: Order[] = [];
    try {
      const executionOrder = ["L3b", "L1", "L2"];
      const realLegs = draft.plan.legs.filter((item) => item.executionMode === "REAL")
        .sort((a, b) => executionOrder.indexOf(a.legId) - executionOrder.indexOf(b.legId));
      for (const leg of realLegs) {
        const order = OrderRequest.parse({
          clientOrderId: `${draft.plan.strategyId}-${draft.plan.revision}-r${store.runId()}-${leg.legId}`,
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
        const prior = store.getOrder(order.clientOrderId);
        if (prior?.order) {
          orders.push(prior.order);
          if (prior.order.state !== "FILLED") break;
          continue;
        }
        if (prior?.state === "SUBMITTING") {
          const recovered = await deps.venues.getOrder(order.venue, order.clientOrderId);
          if (!recovered) throw new Error(`Order ${order.clientOrderId} has an uncertain submission; refusing to duplicate it`);
          store.saveOrder(recovered);
          orders.push(recovered);
          if (recovered.state !== "FILLED") break;
          continue;
        }
        store.saveSubmitting(order);
        const placed = await deps.venues.placeOrder(order);
        store.saveOrder(placed);
        orders.push(placed);
        recordEvent({ timestamp: placed.updatedAt, positionId: `pos_${draft.plan.strategyId}`, type: "ORDER_UPDATED", reasonCode: placed.state, details: placed, source: placed.source });
        if (placed.state !== "FILLED") break;
      }
    } catch (error) {
      for (const order of orders) {
        if (order.state !== "FILLED") await deps.venues.cancelOrder(order.venue, order.clientOrderId).catch(() => undefined);
      }
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Order execution failed", orders });
    }

    const [mainPositions, perpPositions, margin] = await Promise.all([
      deps.venues.getPositions("DERIVE", "main"),
      deps.venues.getPositions("DERIVE", "perp"),
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
    store.savePosition(request.params.id, snapshot);
    recordEvent({ timestamp: snapshot.updatedAt, positionId: snapshot.positionId, type: "POSITION_UPDATED", reasonCode: snapshot.state, details: { strategyId: snapshot.strategyId, state: snapshot.state, orders: snapshot.orders.length }, source: liveExecution ? "TESTNET" : "SIMULATED" });
    return snapshot;
  });

  app.get("/api/positions", async () => store.listPositions()
    .map(({ position }) => position)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));

  app.get<{ Params: { id: string } }>("/api/positions/:id", async (request, reply) => {
    const position = [...positions.values()].find((item) => item.positionId === request.params.id || item.strategyId === request.params.id)
      ?? store.getPlan(request.params.id)?.position
      ?? null;
    if (!position) return reply.code(404).send({ error: "Position not found" });
    return position;
  });

  async function monitorPosition(id: string, shockPct: string) {
    const strategyId = id.startsWith("pos_") ? id.slice(4) : id;
    const saved = store.getPlan(strategyId);
    const snapshot = positions.get(strategyId) ?? saved?.position ?? undefined;
    const draft = quoted.get(strategyId) ?? (saved ? { plan: saved.plan, quotes: saved.quotes } : undefined);
    if (!snapshot || !draft) throw new Error("Open position not found");
    if (!deps.risk || !deps.treasury || !deps.venues) throw new Error("Risk, treasury, and venue services are required");

    const [margin, perpPositions, treasuryStatus] = await Promise.all([
      deps.venues.getMargin("perp"),
      deps.venues.getPositions("DERIVE", "perp"),
      deps.treasury.getTreasuryStatus(),
    ]);
    const perp = perpPositions.find((item) => item.instrumentId.includes("PERP"));
    const priorRequest = rescueRequests.get(strategyId) ?? null;
    const remainingDaily = BigInt(treasuryStatus.dailyCapUsdc6) - BigInt(treasuryStatus.spentTodayUsdc6);
    const decision = deps.risk.evaluateRisk(RiskInput.parse({
      margin,
      shockPct,
      perpUnrealizedPnlUsd: perp?.unrealizedPnlUsd ?? "0",
      perpStopLossUsd: draft.plan.perpStopLossUsd,
      treasury: { perTxCapUsdc6: treasuryStatus.perTxCapUsdc6, remainingDailyUsdc6: remainingDaily.toString(), balanceUsdc6: treasuryStatus.balanceUsdc6 },
      openRequest: priorRequest ? { requestId: priorRequest.requestId, state: priorRequest.state, expiresAtUtc: priorRequest.expiresAtUtc ?? new Date().toISOString() } : null,
      currentState: riskStates.get(strategyId) ?? snapshot.riskState,
    }));
    let transferRequest = null;
    let reduceOrder: Order | null = null;
    if ((decision.action === "RELEASE_WITHIN_LIMITS" || decision.action === "REQUEST_APPROVAL") && decision.topUpUsdc6) {
      transferRequest = await deps.treasury.releaseWithinLimits(draft.plan.strategyId, "DERIVE", decision.topUpUsdc6);
      if (transferRequest.state === "REJECTED") {
        transferRequest = await deps.treasury.requestRelease(draft.plan.strategyId, "DERIVE", decision.topUpUsdc6, 120);
      }
      rescueRequests.set(strategyId, transferRequest);
      recordEvent({ timestamp: new Date().toISOString(), positionId: snapshot.positionId, type: "TRANSFER_REQUEST_UPDATED", reasonCode: transferRequest.state, details: transferRequest, source: transferRequest.source });
    } else if ((decision.action === "REDUCE_PERP" || decision.action === "CLOSE_PERP") && perp && decision.reduceQtyBtc) {
      const quote = await deps.venues.getQuote("DERIVE", perp.instrumentId, "testnet");
      if (quote.bid) {
        const cooldown = Math.floor(Date.now() / 30_000);
        const orderReq = OrderRequest.parse({
          clientOrderId: `${draft.plan.strategyId}-rescue-${cooldown}`, strategyId: draft.plan.strategyId, legId: "L2",
          venue: "DERIVE", account: "perp", instrumentId: perp.instrumentId, side: "SELL", quantity: decision.reduceQtyBtc,
          limitPrice: quote.bid, reduceOnly: true,
        });
        const previous = store.getOrder(orderReq.clientOrderId);
        if (previous?.order) reduceOrder = previous.order;
        else if (previous?.state === "SUBMITTING") {
          reduceOrder = await deps.venues.getOrder(orderReq.venue, orderReq.clientOrderId);
          if (!reduceOrder) throw new Error(`Reduce-only order ${orderReq.clientOrderId} is uncertain; refusing to duplicate it`);
          store.saveOrder(reduceOrder);
        } else {
          store.saveSubmitting(orderReq);
          reduceOrder = await deps.venues.placeOrder(orderReq);
          store.saveOrder(reduceOrder);
        }
        recordEvent({ timestamp: reduceOrder.updatedAt, positionId: snapshot.positionId, type: "ORDER_UPDATED", reasonCode: reduceOrder.state, details: reduceOrder, source: reduceOrder.source });
      }
    }
    riskStates.set(strategyId, decision.nextState);
    // After a reduce-only order, re-read the venue so the gauge shows the recovered margin (Section 16 step 8).
    const latestMargin = reduceOrder ? await deps.venues.getMargin("perp").catch(() => margin) : margin;
    const orders = reduceOrder ? [...snapshot.orders.filter((item) => item.clientOrderId !== reduceOrder!.clientOrderId), reduceOrder] : snapshot.orders;
    const updated = PositionSnapshot.parse({ ...snapshot, riskState: decision.nextState, orders, margins: [latestMargin], updatedAt: new Date().toISOString() });
    positions.set(strategyId, updated);
    store.savePosition(strategyId, updated);
    recordEvent({ timestamp: updated.updatedAt, positionId: updated.positionId, type: "RISK_DECISION", reasonCode: decision.reasonCode, details: { ...decision, explanation: decision.explanation }, source: decision.projectedSource });
    return { margin: latestMargin, projectedRatio: decision.projectedRatio, projectedSource: decision.projectedSource, decision, transferRequest, reduceOrder };
  }

  if (liveMode() && !demoMode() && deps.risk && deps.treasury && deps.venues) {
    monitorTimer = setInterval(() => {
      for (const { strategyId, position } of store.listPositions()) {
        if (position.state === "OPEN" || position.state === "PARTIAL") {
          void monitorPosition(strategyId, "-8").catch((error) => app.log.error({ err: error, strategyId }, "Position monitor failed"));
        }
      }
    }, 10_000);
    monitorTimer.unref();
  }

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>("/api/positions/:id/events", async (request, reply) => {
    const after = Number(request.query.after ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) return reply.code(400).send({ error: "after must be a non-negative integer" });
    const eventName = request.params.id.startsWith("pos_") ? request.params.id : `pos_${request.params.id}`;
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const write = (event: import("@ttp/shared").ActivityEvent) => reply.raw.write(`id: ${event.seq}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`);
    for (const event of store.getEvents(eventName, after)) write(event);
    const onEvent = (event: import("@ttp/shared").ActivityEvent) => write(event);
    eventBus.on(eventName, onEvent);
    reply.raw.on("close", () => eventBus.off(eventName, onEvent));
  });

  app.post<{ Params: { id: string }; Body: { shockPct?: string } }>("/api/positions/:id/monitor", async (request, reply) => {
    if (liveMode() && !hasBearer(request.headers.authorization)) return reply.code(401).header("www-authenticate", "Bearer").send({ error: "Unauthorized" });
    const shockPct = request.body?.shockPct ?? "-8";
    if (!/^-?\d+(\.\d+)?$/.test(shockPct)) return reply.code(400).send({ error: "shockPct must be a decimal string" });
    try { return await monitorPosition(request.params.id, shockPct); }
    catch (error) { return reply.code(503).send({ error: error instanceof Error ? error.message : "Monitoring failed" }); }
  });

  app.post<{ Params: { id: string }; Body: { shockPct?: string } }>("/api/demo/:id/shock", async (request, reply) => {
    if (!demoMode()) return reply.code(403).send({ error: "Shock controls are available only in demo mode" });
    if (liveMode() && !hasBearer(request.headers.authorization)) return reply.code(401).header("www-authenticate", "Bearer").send({ error: "Unauthorized" });
    const shockPct = request.body?.shockPct ?? "-8";
    if (!/^-?\d+(\.\d+)?$/.test(shockPct)) return reply.code(400).send({ error: "shockPct must be a decimal string" });
    demoShocks.set(request.params.id.startsWith("pos_") ? request.params.id.slice(4) : request.params.id, shockPct);
    try { return await monitorPosition(request.params.id, shockPct); }
    catch (error) { return reply.code(503).send({ error: error instanceof Error ? error.message : "Shock evaluation failed" }); }
  });

  // Demo reset (Section 17): clears the orchestrator's plans, orders, events and risk state and
  // starts a new run id, so the next demo:open sends fresh client order ids. It does not touch
  // venue positions or the vault.
  app.post("/api/demo/reset", async (request, reply) => {
    if (!demoMode()) return reply.code(403).send({ error: "Reset is available only in demo mode" });
    if (liveMode() && !hasBearer(request.headers.authorization)) return reply.code(401).header("www-authenticate", "Bearer").send({ error: "Unauthorized" });
    quoted.clear(); approvals.clear(); positions.clear(); rescueRequests.clear(); riskStates.clear(); demoShocks.clear();
    const runId = store.reset();
    return { ok: true, runId };
  });

  // After a decision on a rescue request, run one monitor tick at the shock the demo is holding,
  // so a decline leads straight to the reduce-only order (Section 16 step 8).
  const recordDecision = (item: TransferRequest) => recordEvent({
    timestamp: new Date().toISOString(), positionId: `pos_${item.strategyId}`, type: "TRANSFER_REQUEST_UPDATED",
    reasonCode: item.state, details: item, source: item.source,
  });

  const followUp = async (requestId: string) => {
    for (const [strategyId, item] of rescueRequests) {
      if (item.requestId !== requestId) continue;
      const shock = demoShocks.get(strategyId);
      if (!demoMode() || shock === undefined) return null;
      try { return await monitorPosition(strategyId, shock); }
      catch (error) { app.log.error({ err: error, strategyId }, "Follow-up monitor failed"); return null; }
    }
    return null;
  };

  app.post<{ Params: { id: string }; Body: { approved?: boolean } }>("/api/treasury/requests/:id/decision", async (request, reply) => {
    if (!deps.decideMockRequest || process.env.DEMO_MODE !== "true" || (process.env.TREASURY_MODE ?? "mock") !== "mock") {
      return reply.code(503).send({ error: "Owner decisions are available only with the mock treasury" });
    }
    if (typeof request.body?.approved !== "boolean") return reply.code(400).send({ error: "approved must be a boolean" });
    try {
      const updated = deps.decideMockRequest(request.params.id, request.body.approved);
      for (const [positionId, item] of rescueRequests) if (item.requestId === request.params.id) rescueRequests.set(positionId, updated);
      recordDecision(updated);
      const followUpResult = request.body.approved ? null : await followUp(request.params.id);
      return { ...updated, followUp: followUpResult };
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "Unknown approval request" });
    }
  });

  app.get<{ Params: { id: string } }>("/api/treasury/requests/:id", async (request, reply) => {
    if (!deps.treasury) return reply.code(503).send({ error: "Treasury service is not available" });
    try {
      return await deps.treasury.getReleaseStatus(request.params.id);
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "Unknown release request" });
    }
  });

  app.post<{ Params: { id: string } }>("/api/treasury/requests/:id/decline", async (request, reply) => {
    if (liveMode() && !hasBearer(request.headers.authorization)) return reply.code(401).header("www-authenticate", "Bearer").send({ error: "Unauthorized" });
    if (!deps.treasury) return reply.code(503).send({ error: "Treasury service is not available" });
    try {
      const result = deps.decideMockRequest && process.env.DEMO_MODE === "true" && (process.env.TREASURY_MODE ?? "mock") === "mock"
        ? deps.decideMockRequest(request.params.id, false)
        : await deps.treasury.cancelRequest(request.params.id);
      for (const [positionId, item] of rescueRequests) if (item.requestId === request.params.id) rescueRequests.set(positionId, result);
      recordDecision(result);
      return { ...result, followUp: await followUp(request.params.id) };
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "Unable to decline request" });
    }
  });

  app.get("/api/treasury", async (_request, reply) => {
    if (!deps.treasury) return reply.code(503).send({ error: "Treasury service is not available" });
    const openRequests = [...rescueRequests.values()].filter((item) => ["REQUESTED", "OWNER_APPROVAL_NEEDED", "OWNER_APPROVED"].includes(item.state));
    const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    const requests = [...rescueRequests.values()].map((item) => ({ ...item, approvalUrl: `${base}/approve/${item.requestId}` }));
    return { status: await deps.treasury.getTreasuryStatus(), openRequests, requests };
  });

  app.post("/mcp", async (request, reply) => {
    if (!process.env.MCP_BEARER_TOKEN) return reply.code(503).send({ error: "MCP_BEARER_TOKEN is not configured" });
    if (!hasBearer(request.headers.authorization)) {
      return reply.code(401).header("www-authenticate", "Bearer").send({ error: "Unauthorized" });
    }

    const apiGet = async <T>(url: string): Promise<T> => {
      const response = await app.inject({ method: "GET", url });
      const body = response.json() as T & { error?: string };
      if (response.statusCode >= 400) throw new Error(body?.error ?? `API request failed (${response.statusCode})`);
      return body;
    };
    const apiPost = async <T>(url: string, payload?: unknown): Promise<T> => {
      const response = await app.inject({ method: "POST", url, headers: { "content-type": "application/json", ...(process.env.MCP_BEARER_TOKEN ? { authorization: `Bearer ${process.env.MCP_BEARER_TOKEN}` } : {}) }, payload: JSON.stringify(payload ?? {}) });
      const body = response.json() as T & { error?: string };
      if (response.statusCode >= 400) throw new Error(body?.error ?? `API request failed (${response.statusCode})`);
      return body;
    };
    const mcp = createMcpServer({
      discoverEvents: async (search) => {
        if (!deps.venues) throw new Error("Venue service is not available");
        return deps.venues.discoverGeminiEvents("sandbox", search);
      },
      quotePayoff: (text) => apiPost("/api/strategies/quote", { text }),
      approveStrategy: (strategyId, versionHash) => apiPost(`/api/strategies/${encodeURIComponent(strategyId)}/approve`, { versionHash }),
      executeStrategy: (strategyId) => apiPost(`/api/strategies/${encodeURIComponent(strategyId)}/execute`),
      positionStatus: async (id) => {
        const position = id
          ? await apiGet<{ positionId: string }>(`/api/positions/${encodeURIComponent(id)}`)
          : (await apiGet<Array<{ positionId: string }>>("/api/positions"))[0] ?? null;
        const treasury = deps.treasury ? await apiGet<{ requests: Array<{ strategyId: string; state: string }> }>("/api/treasury").catch(() => null) : null;
        const strategyId = position?.positionId.replace(/^pos_/, "");
        const approvalRequests = (treasury?.requests ?? []).filter((item) => item.strategyId === strategyId);
        return { position, approvalRequests, note: position ? undefined : "No open position yet." };
      },
      transferRequestStatus: (requestId) => apiGet(`/api/treasury/requests/${encodeURIComponent(requestId)}`),
    });
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcp.connect(transport);
    reply.raw.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
  app.get("/mcp", async (_request, reply) => reply.code(405).header("allow", "POST").send({ error: "MCP endpoint accepts POST requests only" }));
  app.delete("/mcp", async (_request, reply) => reply.code(405).header("allow", "POST").send({ error: "MCP endpoint accepts POST requests only" }));

  return app;
}
