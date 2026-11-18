// Orchestrator (Lane C). The only place that composes packages. Routes: DESIGN.md Section 10.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { Quote, ThesisIntent, type StrategyApi } from "@ttp/shared";

export function buildApp(deps: { strategy?: StrategyApi } = {}) {
  const app = Fastify({ logger: true });

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
    if (!deps.strategy) {
      return reply.code(503).send({ error: "Strategy service is not available" });
    }
    return deps.strategy.parseThesis(text);
  });

  app.post<{ Body: { text?: string } }>("/api/strategies/quote", async (request, reply) => {
    const text = request.body?.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return reply.code(400).send({ error: "text must be a non-empty string" });
    }
    if (!deps.strategy) {
      return reply.code(503).send({ error: "Strategy service is not available" });
    }
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
      return { plan, quotes, payoff };
    } catch (error) {
      request.log.warn({ err: error }, "Failed to build strategy quote");
      return reply.code(422).send({ error: error instanceof Error ? error.message : "Unable to build strategy quote" });
    }
  });

  return app;
}
