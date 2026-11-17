// @ttp/venues, owned by Lane B. See docs/agents/lane-b.md.
//
// TODO(Lane B):
//   1. Create src/mock.ts:  export const mock = { ... } satisfies VenuesApi;
//   2. Create src/real.ts:  export const real = { ... } satisfies VenuesApi;
//   3. Replace the placeholder below with:
//        export const venues: VenuesApi = MODE === "real" ? real : mock;
//
// Import only from @ttp/shared. Never import another lane's package.
import type { VenuesApi } from "@ttp/shared";

export type { VenuesApi };

export const MODE: "mock" | "real" = process.env.VENUES_MODE === "real" ? "real" : "mock";
