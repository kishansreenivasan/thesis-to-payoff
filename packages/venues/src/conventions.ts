// Conventions shared by the venues mock and real adapters (Lane B).
// Recorded in CHANGES.md so Lane C knows how to read quotes and build Gemini orders.
//
// Quote prices:
//   - Deribit options: bid/ask in USD per 1 BTC of option (converted from BTC with the index at quote time).
//   - Deribit perps:   bid/ask in USD per 1 BTC.
//   - Gemini events:   bid/ask are the YES book in USD per contract (0..1). Buying NO costs 1 - YES bid.
//   - feeEstimateUsd:  estimated fee for ONE unit of quantity (1 BTC on Deribit, 1 contract on Gemini).
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

/** Deribit testnet fee estimates (verify against docs before relying on them for P&L). */
export const DERIBIT_OPTION_FEE_BTC_PER_CONTRACT = 0.0003; // capped at 12.5% of option price
export const DERIBIT_PERP_TAKER_FEE_RATE = 0.0005;
