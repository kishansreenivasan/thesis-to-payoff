// Strategy real (Lane B). No LLM on the server: Grok Bot does the language understanding and calls
// `intentFromGrok` via the MCP tool; plain text from the dashboard uses the offline parser.
import type { StrategyApi } from "@ttp/shared";
import { buildPlan } from "./plan";
import { payoffGrid } from "./payoff";
import { parseThesisOffline } from "./thesis";

export const real = {
  parseThesis: async (text: string) => parseThesisOffline(text),
  buildPlan: (intent, quotes) => buildPlan(intent, quotes),
  payoffGrid,
} satisfies StrategyApi;
