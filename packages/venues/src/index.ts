// @ttp/venues, owned by Lane B. See docs/agents/lane-b.md.
// Import only from @ttp/shared. Never import another lane's package.
import type { VenuesApi } from "@ttp/shared";
import { listDeribitCallsMock, mock } from "./mock";
import { listDeribitCalls as listDeribitCallsReal, real } from "./real";

export type { VenuesApi };
export { mock, createMockVenues, MOCK_INDEX_USD } from "./mock";
export { real } from "./real";
export * from "./conventions";

export const MODE: "mock" | "real" = process.env.VENUES_MODE === "real" ? "real" : "mock";

/** The implementation selected by VENUES_MODE (default mock). */
export const venues: VenuesApi = MODE === "real" ? real : mock;

/** Listed BTC call names for the given expiry codes, so the orchestrator knows which L1 strikes to quote. */
export const listDeribitCalls = (expiryCodes: string[]) =>
  MODE === "real" ? listDeribitCallsReal(expiryCodes) : listDeribitCallsMock(expiryCodes);
