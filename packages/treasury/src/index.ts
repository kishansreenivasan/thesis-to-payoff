// @ttp/treasury, owned by Lane A. See docs/agents/lane-a.md.
//
// Import only from @ttp/shared. Never import another lane's package.
import type { TreasuryApi } from "@ttp/shared";
import { mock, resetMock, setPaused, simulateOwnerDecision } from "./mock";
import { real } from "./real";

export type { TreasuryApi };
export { mock, resetMock, setPaused, simulateOwnerDecision };
export { real } from "./real";
export {
  vaultAbi,
  arcTestnet,
  ARC_TESTNET_VAULT_ADDRESS,
  arcTxUrl,
  arcAddressUrl,
  buildApproveRequestCall,
  type ApproveRequestCall,
} from "./owner";

export const MODE: "mock" | "real" = process.env.TREASURY_MODE === "real" ? "real" : "mock";

/** The implementation selected by TREASURY_MODE (default mock). */
export const treasury: TreasuryApi = MODE === "real" ? real : mock;
