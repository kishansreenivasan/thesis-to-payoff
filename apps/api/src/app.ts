// Orchestrator (Lane C). The only place that composes packages. Routes: DESIGN.md Section 10.
import Fastify from "fastify";

export function buildApp() {
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

  // TODO(Lane C): /api/theses/compile, /api/strategies/*, /api/positions/*, /api/treasury/*, /api/demo/*

  return app;
}
