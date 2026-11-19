// @ttp/mcp, owned by Lane C. Remote MCP server (DESIGN.md Section 10).
// Tool handlers delegate to application services; no financial logic lives here.
import { COMPILE_THESIS_INPUT_SCHEMA, intentFromGrok } from "@ttp/strategy";

export const MCP_TOOLS = [
  "compile_thesis",
  "discover_events",
  "quote_payoff",
  "approve_strategy",
  "execute_strategy",
  "position_status",
  "transfer_request_status",
] as const;

export type McpToolName = (typeof MCP_TOOLS)[number];

export const COMPILE_THESIS_TOOL = {
  name: "compile_thesis",
  description: "Turn the user's stated thesis into a supported BTC intent or explain why it is unsupported. Never invent a risk limit.",
  inputSchema: COMPILE_THESIS_INPUT_SCHEMA,
} as const;

/** Called by the MCP transport after JSON-RPC argument validation. */
export function handleCompileThesis(args: unknown) {
  return intentFromGrok(args);
}
