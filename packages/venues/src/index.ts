// @ttp/venues, owned by Lane B. See docs/agents/lane-b.md.
// Import only from @ttp/shared. Never import another lane's package.
import type { VenuesApi } from "@ttp/shared";
import { listCallsMock, mock } from "./mock";
import { listCalls as listCallsReal, real } from "./real";

export type { VenuesApi };
export { mock, createMockVenues, MOCK_INDEX_USD } from "./mock";
export { real } from "./real";
export * from "./conventions";

export const MODE: "mock" | "real" = process.env.VENUES_MODE === "real" ? "real" : "mock";

/** The implementation selected by VENUES_MODE (default mock). */
export const venues: VenuesApi = MODE === "real" ? real : mock;

/** Active BTC call names on Derive for the given expiries ("20261211"), so the orchestrator knows which L1 strikes to quote. */
export const listCalls = (expiries: string[]) => (MODE === "real" ? listCallsReal(expiries) : listCallsMock(expiries));
/** @deprecated the L1/L2 venue is Derive now; use listCalls. */
export const listDeribitCalls = listCalls;
export { isDeriveVenue } from "./real";
export { createDeriveAdapter, createDerivePublic, toDeriveExpiry, tradeActionDigest, DERIVE_TESTNET } from "./derive";
