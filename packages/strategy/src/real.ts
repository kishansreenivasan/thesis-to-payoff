// Strategy real (Lane B). parseThesis calls the Anthropic API (needs LLM_API_KEY).
import type { StrategyApi } from "@ttp/shared";
import { buildPlan } from "./plan";
import { payoffGrid } from "./payoff";
import { parseThesisWithLlm } from "./thesis";

export const real = {
  parseThesis: parseThesisWithLlm,
  buildPlan: (intent, quotes) => buildPlan(intent, quotes),
  payoffGrid,
} satisfies StrategyApi;
