// pnpm demo:mock (Lane C). Runs the complete simulated compile, approve, execute and rescue flow.
import { risk } from "../packages/risk/src/index";
import { createMockVenues } from "../packages/venues/src/index";
import { mock as treasury, resetMock, simulateOwnerDecision } from "../packages/treasury/src/index";
import { strategy } from "../packages/strategy/src/index";
import { buildApp } from "../apps/api/src/app";

process.env.DEMO_MODE = "true";
process.env.VENUES_MODE = "mock";
process.env.STRATEGY_MODE = "mock";
process.env.DATABASE_PATH = ":memory:";
resetMock();
const app = buildApp({ strategy, venues: createMockVenues(), treasury, risk, decideMockRequest: simulateOwnerDecision });
const request = async <T>(url: string, payload?: unknown): Promise<T> => {
  const response = await app.inject({ method: "POST", url, headers: { "content-type": "application/json" }, payload: JSON.stringify(payload ?? {}) });
  const body = response.json() as T;
  if (response.statusCode >= 400) throw new Error(`POST ${url} failed (${response.statusCode}): ${JSON.stringify(body)}`);
  return body;
};

try {
  const rawText = "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.";
  const quoted = await request<{ plan: { strategyId: string; versionHash: string; legs: Array<{ legId: string }> } }>("/api/strategies/quote", { text: rawText });
  const plan = quoted.plan;
  await request(`/api/strategies/${plan.strategyId}/approve`, { versionHash: plan.versionHash });
  const opened = await request<{ state: string; orders: Array<{ legId: string }> }>(`/api/strategies/${plan.strategyId}/execute`);
  const stressed = await request<{ decision: { action: string }; transferRequest: { requestId: string; state: string } | null }>(`/api/demo/${plan.strategyId}/shock`, { shockPct: "-15" });
  const transfer = stressed.transferRequest;
  let declined: { state: string } | null = null;
  let recovery: { decision: { action: string }; reduceOrder: { state: string } | null } | null = null;
  if (transfer?.requestId) {
    declined = await request(`/api/treasury/requests/${transfer.requestId}/decision`, { approved: false });
    recovery = await request(`/api/demo/${plan.strategyId}/shock`, { shockPct: "-15" });
  }

  console.log("[demo:mock] Every value and action below is SIMULATED.");
  console.log(`[demo:mock] Plan: ${plan.strategyId} with legs ${plan.legs.map((leg) => leg.legId).join(", ")}.`);
  console.log(`[demo:mock] Execution: ${opened.state}; orders ${opened.orders.map((order: { legId: string }) => order.legId).join(" → ")}.`);
  console.log(`[demo:mock] -15% shock: ${stressed.decision.action}; treasury request ${transfer?.state ?? "none"}.`);
  console.log(`[demo:mock] Owner declined: ${declined?.state ?? "not requested"}; follow-up: ${recovery?.decision.action ?? "none"}; reduce-only order ${recovery?.reduceOrder?.state ?? "none"}.`);
} finally {
  await app.close();
}
