// @ttp/strategy, owned by Lane B. See docs/agents/lane-b.md.
//
// TODO(Lane B):
//   1. Create src/mock.ts:  export const mock = { ... } satisfies StrategyApi;
//   2. Create src/real.ts:  export const real = { ... } satisfies StrategyApi;
//   3. Replace the placeholder below with:
//        export const strategy: StrategyApi = MODE === "real" ? real : mock;
//
// Import only from @ttp/shared. Never import another lane's package.
import type { StrategyApi } from "@ttp/shared";

export type { StrategyApi };

export const MODE: "mock" | "real" = process.env.STRATEGY_MODE === "real" ? "real" : "mock";
