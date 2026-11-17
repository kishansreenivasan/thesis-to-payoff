// Function contracts each lane exports (DESIGN.md Section 4).
// Implement with `satisfies`, e.g. `export const mock = { ... } satisfies VenuesApi;`
import type { z } from "zod";
import type * as S from "./schemas";

type T<K extends keyof typeof S> = z.infer<(typeof S)[K]>;

// ---------- Lane A ----------

export interface TreasuryApi {
  getTreasuryStatus(): Promise<T<"TreasuryStatus">>;
  /** ARC_FINALIZED on success, or REJECTED with reasonCode and the reverted txHash. */
  releaseWithinLimits(strategyId: string, venue: T<"Venue">, amountUsdc6: string): Promise<T<"TransferRequest">>;
  requestRelease(strategyId: string, venue: T<"Venue">, amountUsdc6: string, ttlSec: number): Promise<T<"TransferRequest">>;
  getReleaseStatus(requestId: string): Promise<T<"TransferRequest">>;
  cancelRequest(requestId: string): Promise<T<"TransferRequest">>;
  /** Returns an unsubscribe function. */
  watchVaultEvents(onEvent: (e: T<"ActivityEvent">) => void): () => void;
}

export interface RiskApi {
  /** Pure. No network calls. */
  evaluateRisk(input: T<"RiskInput">): T<"RiskDecision">;
}

// ---------- Lane B ----------

export type GeminiEnv = "mainnet" | "sandbox";
export type VenueEnv = "mainnet" | "sandbox" | "testnet";
export type DeribitAccount = "main" | "perp";

export interface IndexPrice {
  priceUsd: string;
  source: T<"Source">;
  timestamp: string;
}

export interface VenuesApi {
  discoverGeminiEvents(env: GeminiEnv, search?: string): Promise<T<"GeminiEvent">[]>;
  getQuote(venue: T<"Venue">, instrumentId: string, env?: VenueEnv): Promise<T<"Quote">>;
  placeOrder(req: T<"OrderRequest">): Promise<T<"Order">>;
  getOrder(venue: T<"Venue">, clientOrderId: string): Promise<T<"Order"> | null>;
  cancelOrder(venue: T<"Venue">, clientOrderId: string): Promise<T<"Order">>;
  getPositions(venue: T<"Venue">, account: DeribitAccount): Promise<T<"VenuePosition">[]>;
  /** Deribit. */
  getMargin(account: DeribitAccount): Promise<T<"MarginSnapshot">>;
  getIndexPrice(): Promise<IndexPrice>;
}

export interface StrategyApi {
  parseThesis(text: string): Promise<T<"ThesisIntent"> | T<"UnsupportedThesis">>;
  buildPlan(intent: T<"ThesisIntent">, quotes: T<"Quote">[]): T<"StrategyPlan">;
  payoffGrid(plan: T<"StrategyPlan">, quotes: T<"Quote">[]): T<"PayoffGrid">;
}
