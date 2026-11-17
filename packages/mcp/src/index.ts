// @ttp/mcp, owned by Lane C. Remote MCP server (DESIGN.md Section 10).
// Tools call orchestrator functions only. No financial logic here.
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
