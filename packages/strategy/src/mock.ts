// Strategy mock (Lane B). parseThesis uses an offline keyword parser (no LLM call).
// buildPlan and payoffGrid are pure and deterministic, so the mock shares the real ones.
import type { StrategyApi } from "@ttp/shared";
import { buildPlan } from "./plan";
import { payoffGrid } from "./payoff";
import { parseThesisOffline } from "./thesis";

export const mock = {
  parseThesis: async (text: string) => parseThesisOffline(text),
  buildPlan: (intent, quotes) => buildPlan(intent, quotes),
  payoffGrid,
} satisfies StrategyApi;
