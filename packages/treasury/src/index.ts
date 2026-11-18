// @ttp/treasury, owned by Lane A. See docs/agents/lane-a.md.
//
// TODO(Lane A, task 5): add src/real.ts (viem against the deployed vault)
// once ARC_AGENT_PRIVATE_KEY / ARC_OWNER_ADDRESS land (human setup item 4),
// then switch the export below to `MODE === "real" ? real : mock`.
//
// Import only from @ttp/shared. Never import another lane's package.
import type { TreasuryApi } from "@ttp/shared";
import { mock, resetMock, setPaused, simulateOwnerDecision } from "./mock";

export type { TreasuryApi };
export { mock, resetMock, setPaused, simulateOwnerDecision };

export const MODE: "mock" | "real" = process.env.TREASURY_MODE === "real" ? "real" : "mock";

if (MODE === "real") {
  throw new Error("TREASURY_MODE=real is not implemented yet (Lane A task 5). Use TREASURY_MODE=mock.");
}

export const treasury: TreasuryApi = mock;
