// Instrument-name parsing for deterministic selection (Lane B).
import Decimal from "decimal.js";

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

export interface DeribitOption {
  instrumentId: string;
  expiryCode: string; // e.g. "11DEC26"
  expiryUtc: string; // Deribit options expire 08:00 UTC
  strike: Decimal;
  kind: "C" | "P";
}

/** Parses "BTC-11DEC26-65000-C". Returns null for anything else. */
export function parseDeribitOption(instrumentId: string): DeribitOption | null {
  const m = /^BTC-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-([CP])$/.exec(instrumentId);
  if (!m) return null;
  const [, d, mon, yy, k, kind] = m as unknown as [string, string, string, string, string, "C" | "P"];
  const month = MONTHS[mon];
  if (month === undefined) return null;
  const expiry = new Date(Date.UTC(2000 + Number(yy), month, Number(d), 8, 0, 0));
  return { instrumentId, expiryCode: `${d}${mon}${yy}`, expiryUtc: expiry.toISOString(), strike: new Decimal(k), kind };
}

export const isDeribitPerp = (id: string) => /PERPETUAL$/.test(id);
export const isLinearPerp = (id: string) => id === "BTC_USDC-PERPETUAL";

export interface GeminiStrike {
  instrumentId: string;
  eventTicker: string;
  strike: Decimal;
}

/** Parses "GEMI-BTC2611302200-HI62500" ("$62,500 or above"). */
export function parseGeminiStrike(instrumentId: string): GeminiStrike | null {
  const m = /^GEMI-([A-Z0-9]+)-HI(\d+)$/.exec(instrumentId);
  if (!m) return null;
  return { instrumentId, eventTicker: m[1]!, strike: new Decimal(m[2]!) };
}
