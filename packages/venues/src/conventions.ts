// Conventions shared by the venues mock and real adapters (Lane B).
// Recorded in CHANGES.md so Lane C knows how to read quotes and build Gemini orders.
//
// Quote prices:
//   - Derive options:  bid/ask in USD (USDC) per 1 BTC of option, as Derive quotes them.
//   - Derive perp:     bid/ask in USD per 1 BTC.
//   - Gemini events:   bid/ask are the YES book in USD per contract (0..1). Buying NO costs 1 - YES bid.
//   - feeEstimateUsd:  estimated taker fee for ONE unit of quantity (1 BTC on Derive, 1 contract on Gemini).
//
// Gemini outcome on orders: OrderRequest has no outcome field yet (proposed in CHANGES.md).
// Until it exists, Gemini order instrumentIds carry a suffix: "<instrumentSymbol>:YES" or ":NO".

export type EventOutcome = "YES" | "NO";

export function geminiOrderInstrument(instrumentSymbol: string, outcome: EventOutcome): string {
  return `${instrumentSymbol}:${outcome}`;
}

export function parseGeminiOrderInstrument(instrumentId: string): { symbol: string; outcome: EventOutcome } {
  const m = /^(.+):(YES|NO)$/.exec(instrumentId);
  if (!m) throw new Error(`Gemini order instrumentId must end with :YES or :NO, got "${instrumentId}"`);
  return { symbol: m[1]!, outcome: m[2] as EventOutcome };
}

/** Derive testnet taker fee rate (public/get_instrument, 2026-11-18). Options: rate x index, capped at 12.5% of premium. */
export const DERIVE_TAKER_FEE_RATE = 0.0003;
