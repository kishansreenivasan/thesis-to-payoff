// @ttp/strategy, owned by Lane B. See docs/agents/lane-b.md.
// Import only from @ttp/shared. Never import another lane's package.
import type { StrategyApi } from "@ttp/shared";
import { mock } from "./mock";
import { real } from "./real";

export type { StrategyApi };
export { mock } from "./mock";
export { real } from "./real";
export { buildPlan, PlanError, BUDGET_SHARES, L1_EXPIRY_PREFERENCE, L1L2_VENUE, FED_HEDGE_SYMBOL, L3B_EVENT } from "./plan";
export { parseOption, isPerp } from "./instruments";
export { payoffGrid } from "./payoff";
export {
  SUPPORTED_EXAMPLES,
  toIntent,
  intentFromGrok,
  parseThesisOffline,
  CompileThesisArgs,
  COMPILE_THESIS_INPUT_SCHEMA,
  ThesisFields,
} from "./thesis";

export const MODE: "mock" | "real" = process.env.STRATEGY_MODE === "real" ? "real" : "mock";

/** The implementation selected by STRATEGY_MODE (default mock). */
export const strategy: StrategyApi = MODE === "real" ? real : mock;
