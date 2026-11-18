// Instrument-name parsing for deterministic selection (Lane B).
import Decimal from "decimal.js";

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

export interface DeribitOption {
  instrumentId: string;
  expiryCode: string; // Derive: "20261211"; Deribit (legacy): "11DEC26"
  expiryUtc: string; // Derive (and Deribit) options expire 08:00 UTC
  strike: Decimal;
  kind: "C" | "P";
}

/** Option on the L1 venue. Derive names are "BTC-20261211-65000-C" (expiry 08:00 UTC). */
export type VenueOption = DeribitOption;

/** Parses Derive "BTC-20261211-65000-C" or legacy Deribit "BTC-11DEC26-65000-C". Returns null otherwise. */
export function parseOption(instrumentId: string): VenueOption | null {
  const d = /^BTC-(\d{4})(\d{2})(\d{2})-(\d+)-([CP])$/.exec(instrumentId);
  if (d) {
    const [, y, mo, day, k, kind] = d as unknown as [string, string, string, string, string, "C" | "P"];
    const expiry = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(day), 8, 0, 0));
    return { instrumentId, expiryCode: `${y}${mo}${day}`, expiryUtc: expiry.toISOString(), strike: new Decimal(k), kind };
  }
  return parseDeribitOption(instrumentId);
}

/** Legacy Deribit format "BTC-11DEC26-65000-C". */
export function parseDeribitOption(instrumentId: string): DeribitOption | null {
  const m = /^BTC-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-([CP])$/.exec(instrumentId);
  if (!m) return null;
  const [, d, mon, yy, k, kind] = m as unknown as [string, string, string, string, string, "C" | "P"];
  const month = MONTHS[mon];
  if (month === undefined) return null;
  const expiry = new Date(Date.UTC(2000 + Number(yy), month, Number(d), 8, 0, 0));
  return { instrumentId, expiryCode: `${d}${mon}${yy}`, expiryUtc: expiry.toISOString(), strike: new Decimal(k), kind };
}

/** BTC perp on the L1/L2 venue: Derive "BTC-PERP" (legacy Deribit "*-PERPETUAL" still recognised). */
export const isPerp = (id: string) => id === "BTC-PERP" || /PERPETUAL$/.test(id);
export const isPreferredPerp = (id: string) => id === "BTC-PERP";
/** @deprecated */
export const isDeribitPerp = isPerp;
/** @deprecated */
export const isLinearPerp = isPreferredPerp;

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
