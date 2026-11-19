import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { COMPILE_THESIS_INPUT_SCHEMA, intentFromGrok } from "@ttp/strategy";
import { z } from "zod/v4";

export interface McpActions {
  discoverEvents(search?: string): Promise<unknown>;
  quotePayoff(text: string): Promise<unknown>;
  approveStrategy(strategyId: string, versionHash: string): Promise<unknown>;
  executeStrategy(strategyId: string): Promise<unknown>;
  positionStatus(id: string): Promise<unknown>;
  transferRequestStatus(requestId: string): Promise<unknown>;
}

const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const failed = (error: unknown) => ({
  ...result({ error: error instanceof Error ? error.message : "Tool request failed" }),
  isError: true,
});
const call = async (fn: () => unknown | Promise<unknown>) => {
  try { return result(await fn()); }
  catch (error) { return failed(error); }
};

export function createMcpServer(actions: McpActions) {
  const server = new McpServer({ name: "thesis-to-payoff", version: "1.0.0" });
  server.registerTool("compile_thesis", {
    description: "Validate the thesis fields supplied by Grok. Never invent a risk limit.",
    inputSchema: fromJsonSchema(COMPILE_THESIS_INPUT_SCHEMA),
  }, (args) => result(intentFromGrok(args)));
  server.registerTool("discover_events", {
    description: "Find Gemini sandbox events matching a ticker or phrase.",
    inputSchema: z.object({ search: z.string().max(120).optional() }),
  }, ({ search }) => call(() => actions.discoverEvents(search)));
  server.registerTool("quote_payoff", {
    description: "Build a supported strategy plan, current quotes and payoff grid from thesis text.",
    inputSchema: z.object({ text: z.string().min(1).max(2000) }),
  }, ({ text }) => call(() => actions.quotePayoff(text)));
  server.registerTool("approve_strategy", {
    description: "Record approval for the exact quoted strategy version.",
    inputSchema: z.object({ strategyId: z.string().min(1), versionHash: z.string().min(1) }),
  }, ({ strategyId, versionHash }) => call(() => actions.approveStrategy(strategyId, versionHash)));
  server.registerTool("execute_strategy", {
    description: "Execute an approved strategy on configured testnet and sandbox venues.",
    inputSchema: z.object({ strategyId: z.string().min(1) }),
  }, ({ strategyId }) => call(() => actions.executeStrategy(strategyId)));
  server.registerTool("position_status", {
    description: "Read the current position and margin snapshot.",
    inputSchema: z.object({ id: z.string().min(1) }),
  }, ({ id }) => call(() => actions.positionStatus(id)));
  server.registerTool("transfer_request_status", {
    description: "Read an Arc release request. This tool cannot approve transfers.",
    inputSchema: z.object({ requestId: z.string().min(1) }),
  }, ({ requestId }) => call(() => actions.transferRequestStatus(requestId)));
  return server;
}
