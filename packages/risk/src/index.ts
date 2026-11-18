// @ttp/risk, owned by Lane A. See docs/agents/lane-a.md.
//
// Import only from @ttp/shared. Never import another lane's package.
import type { RiskApi } from "@ttp/shared";
import { mock } from "./mock";
import { real } from "./real";

export type { RiskApi };
export { evaluateRisk } from "./evaluateRisk";
export { mock, real };

export const MODE: "mock" | "real" = process.env.RISK_MODE === "real" ? "real" : "mock";
export const risk: RiskApi = MODE === "real" ? real : mock;
