// Orchestrator (Lane C). The only place that composes packages. Routes: DESIGN.md Section 10.
import Fastify from "fastify";
import type { StrategyApi } from "@ttp/shared";

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

  return app;
}
