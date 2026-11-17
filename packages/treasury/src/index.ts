// @ttp/treasury, owned by Lane A. See docs/agents/lane-a.md.
//
// TODO(Lane A):
//   1. Create src/mock.ts:  export const mock = { ... } satisfies TreasuryApi;
//   2. Create src/real.ts:  export const real = { ... } satisfies TreasuryApi;
//   3. Replace the placeholder below with:
//        export const treasury: TreasuryApi = MODE === "real" ? real : mock;
//
// Import only from @ttp/shared. Never import another lane's package.
import type { TreasuryApi } from "@ttp/shared";

export type { TreasuryApi };

export const MODE: "mock" | "real" = process.env.TREASURY_MODE === "real" ? "real" : "mock";
