// @ttp/risk, owned by Lane A. See docs/agents/lane-a.md.
//
// TODO(Lane A):
//   1. Create src/mock.ts:  export const mock = { ... } satisfies RiskApi;
//   2. Create src/real.ts:  export const real = { ... } satisfies RiskApi;
//   3. Replace the placeholder below with:
//        export const risk: RiskApi = MODE === "real" ? real : mock;
//
// Import only from @ttp/shared. Never import another lane's package.
import type { RiskApi } from "@ttp/shared";

export type { RiskApi };

export const MODE: "mock" | "real" = process.env.RISK_MODE === "real" ? "real" : "mock";
