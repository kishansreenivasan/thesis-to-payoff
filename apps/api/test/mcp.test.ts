import { afterEach, describe, expect, it } from "vitest";
import { mock as risk } from "@ttp/risk";
import { mock as strategy } from "@ttp/strategy";
import { mock as treasury, resetMock, simulateOwnerDecision } from "@ttp/treasury";
import { createMockVenues } from "@ttp/venues";
import { buildApp } from "../src/app";

const oldToken = process.env.MCP_BEARER_TOKEN;
const oldDatabase = process.env.DATABASE_PATH;
const oldDemoMode = process.env.DEMO_MODE;
const oldVenuesMode = process.env.VENUES_MODE;
const oldStrategyMode = process.env.STRATEGY_MODE;
const jsonResponse = <T>(response: { body: string; json(): unknown }): T => {
  if (!response.body.startsWith("event:")) return response.json() as T;
  const data = response.body.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  if (!data) throw new Error(`MCP response has no event data: ${response.body}`);
  return JSON.parse(data) as T;
};
afterEach(() => {
  if (oldToken === undefined) delete process.env.MCP_BEARER_TOKEN;
  else process.env.MCP_BEARER_TOKEN = oldToken;
  if (oldDatabase === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = oldDatabase;
  if (oldDemoMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = oldDemoMode;
  if (oldVenuesMode === undefined) delete process.env.VENUES_MODE;
  else process.env.VENUES_MODE = oldVenuesMode;
  if (oldStrategyMode === undefined) delete process.env.STRATEGY_MODE;
  else process.env.STRATEGY_MODE = oldStrategyMode;
});

describe("stateless Streamable HTTP MCP endpoint", () => {
  it("requires a configured bearer token", async () => {
    process.env.DATABASE_PATH = ":memory:";
    process.env.MCP_BEARER_TOKEN = "mcp-test-token";
    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("keeps live monitoring writes behind the bearer token", async () => {
    process.env.DATABASE_PATH = ":memory:";
    process.env.DEMO_MODE = "false";
    process.env.VENUES_MODE = "real";
    process.env.STRATEGY_MODE = "real";
    process.env.MCP_BEARER_TOKEN = "mcp-test-token";
    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/api/positions/strat_test/monitor" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("lists and calls the registered thesis tools", async () => {
    process.env.DATABASE_PATH = ":memory:";
    process.env.MCP_BEARER_TOKEN = "mcp-test-token";
    const app = buildApp();
    const headers = {
      authorization: "Bearer mcp-test-token",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    const initialize = await app.inject({
      method: "POST", url: "/mcp", headers,
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    });
    expect(initialize.statusCode).toBe(200);
    expect(jsonResponse<{ result: { serverInfo: { name: string } } }>(initialize).result.serverInfo.name).toBe("thesis-to-payoff");

    const list = await app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    expect(list.statusCode).toBe(200);
    expect(jsonResponse<{ result: { tools: Array<{ name: string }> } }>(list).result.tools.map((tool) => tool.name)).toContain("execute_strategy");

    const call = await app.inject({
      method: "POST", url: "/mcp", headers,
      payload: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "compile_thesis", arguments: {
        text: "Bullish BTC. Max risk $500.", underlying: "BTC", direction: "BULLISH", maxRiskUsd: 500, fedHikeConcern: false,
      } } },
    });
    expect(call.statusCode).toBe(200);
    expect(jsonResponse<{ result: { content: Array<{ text: string }> } }>(call).result.content[0]?.text).toContain('"maxRiskUsd":"500"');
    await app.close();
  });

  it("carries a strategy through Lane B, A and C tools", async () => {
    process.env.DATABASE_PATH = ":memory:";
    process.env.MCP_BEARER_TOKEN = "mcp-test-token";
    process.env.DEMO_MODE = "true";
    process.env.VENUES_MODE = "mock";
    process.env.STRATEGY_MODE = "mock";
    process.env.TREASURY_MODE = "mock";
    resetMock();
    const app = buildApp({ strategy, venues: createMockVenues(), treasury, risk, decideMockRequest: simulateOwnerDecision });
    const headers = { authorization: "Bearer mcp-test-token", "content-type": "application/json", accept: "application/json, text/event-stream" };
    const invoke = async <T>(name: string, args: Record<string, unknown>, id: number): Promise<T> => {
      const response = await app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } } });
      const envelope = jsonResponse<{ result: { content: Array<{ text: string }> } }>(response);
      return JSON.parse(envelope.result.content[0]?.text ?? "null") as T;
    };
    try {
      const quoted = await invoke<{ plan: { strategyId: string; versionHash: string } }>("quote_payoff", { text: "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500." }, 4);
      await invoke("approve_strategy", { strategyId: quoted.plan.strategyId, versionHash: quoted.plan.versionHash }, 5);
      const opened = await invoke<{ positionId: string; state: string }>("execute_strategy", { strategyId: quoted.plan.strategyId }, 6);
      expect(opened.state).toBe("OPEN");
      const current = await invoke<{ positionId: string; state: string }>("position_status", { id: quoted.plan.strategyId }, 7);
      expect(current.positionId).toBe(opened.positionId);
    } finally {
      await app.close();
      resetMock();
    }
  });
});
