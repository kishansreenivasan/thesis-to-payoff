// Thesis understanding (Lane B). There is no LLM on our server: Grok Bot reads the user's message
// and calls the MCP tool `compile_thesis` with the fields below. Deterministic code here decides
// whether the thesis is supported and builds the ThesisIntent (DESIGN.md Sections 2 and 10).
// Text typed into the dashboard goes through the offline keyword parser instead.
import { z } from "zod";
import { ThesisIntent as ThesisIntentSchema, type ThesisIntent, type UnsupportedThesis } from "@ttp/shared";

export const SUPPORTED_EXAMPLES = [
  "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.",
  "Bullish BTC through mid-December. Max risk $500.",
];

export const DEFAULT_HORIZON_UTC = "2026-12-11T08:00:00.000Z";

/** Fields extracted from the user's message (by Grok, or by the offline parser). Untrusted until `toIntent`. */
export const ThesisFields = z.object({
  underlying: z.enum(["BTC", "OTHER", "UNCLEAR"]),
  direction: z.enum(["BULLISH", "BEARISH", "NEUTRAL", "UNCLEAR"]),
  horizonDate: z.string().nullable().default(null),
  maxRiskUsd: z.number().nullable(),
  fedHikeConcern: z.boolean(),
  otherConcerns: z.array(z.string()).default([]),
});
export type ThesisFields = z.infer<typeof ThesisFields>;
/** @deprecated kept for existing imports; same as ThesisFields. */
export type ThesisExtraction = ThesisFields;

/** Arguments Grok sends to the MCP tool `compile_thesis`. */
export const CompileThesisArgs = ThesisFields.extend({
  text: z.string().min(1).max(2000).describe("The user's thesis, verbatim"),
});
export type CompileThesisArgs = z.infer<typeof CompileThesisArgs>;

/**
 * JSON Schema for the `compile_thesis` MCP tool input (Lane C plugs this into the tool definition).
 * The descriptions are what Grok reads when filling the fields.
 */
export const COMPILE_THESIS_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "underlying", "direction", "maxRiskUsd", "fedHikeConcern"],
  properties: {
    text: { type: "string", description: "The user's thesis, copied verbatim." },
    underlying: { type: "string", enum: ["BTC", "OTHER", "UNCLEAR"], description: "BTC if the thesis is about bitcoin." },
    direction: { type: "string", enum: ["BULLISH", "BEARISH", "NEUTRAL", "UNCLEAR"], description: "The user's view on that asset." },
    horizonDate: {
      type: ["string", "null"],
      description: 'YYYY-MM-DD for the horizon the user named ("into December" = 2026-12-11), or null.',
    },
    maxRiskUsd: {
      type: ["number", "null"],
      description: "The maximum loss in USD exactly as the user stated it. Null if they did not state one. Never estimate.",
    },
    fedHikeConcern: { type: "boolean", description: "True only if the user worries the Fed raises rates more than expected." },
    otherConcerns: {
      type: "array",
      items: { type: "string" },
      description: "Other hedges, assets or events the user asked for. Empty if none.",
    },
  },
} as const;

const unsupported = (reason: string): UnsupportedThesis => ({
  supported: false,
  reason,
  supportedExamples: SUPPORTED_EXAMPLES,
});

/** Numbers in the user's own text, e.g. "$1,500" -> "1500". Used to check no number was invented. */
function numbersIn(text: string): Set<string> {
  return new Set((text.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => String(Number(n.replace(/,/g, "")))));
}

/** Deterministic gate from extracted fields to ThesisIntent. */
export function toIntent(x: ThesisFields, rawText: string): ThesisIntent | UnsupportedThesis {
  if (x.underlying !== "BTC") return unsupported("Only BTC theses are supported right now.");
  if (x.direction !== "BULLISH") return unsupported("Only bullish BTC theses are supported right now.");
  if (x.otherConcerns.length > 0) {
    return unsupported(`This build only hedges a bigger-than-expected Fed hike. Not supported: ${x.otherConcerns.join("; ")}.`);
  }
  if (x.maxRiskUsd == null || !(x.maxRiskUsd > 0)) {
    return unsupported('Please state a maximum risk in dollars, for example "Max risk $500".');
  }
  if (!numbersIn(rawText).has(String(x.maxRiskUsd))) {
    return unsupported("I could not find that max-risk amount in your message. Please state it as a dollar figure.");
  }
  let horizonUtc = DEFAULT_HORIZON_UTC;
  if (x.horizonDate && /^\d{4}-\d{2}-\d{2}$/.test(x.horizonDate)) {
    const d = new Date(`${x.horizonDate}T08:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) horizonUtc = d.toISOString();
  }
  return ThesisIntentSchema.parse({
    underlying: "BTC",
    direction: "BULLISH",
    horizonUtc,
    maxRiskUsd: String(x.maxRiskUsd),
    eventConcern: x.fedHikeConcern ? "FED_HIKE_GT25" : "NONE",
    rawText,
  });
}

/**
 * Entry point for Grok: validates the `compile_thesis` tool arguments, then applies the same gate.
 * Malformed arguments become a friendly UnsupportedThesis, never an exception.
 */
export function intentFromGrok(args: unknown): ThesisIntent | UnsupportedThesis {
  const parsed = CompileThesisArgs.safeParse(args);
  if (!parsed.success) return unsupported("I couldn't read that thesis. Try one of the examples.");
  const { text, ...fields } = parsed.data;
  return toIntent(fields, text.trim());
}

/** Offline keyword parser for text typed into the dashboard (and the mock). Same gate as Grok's path. */
export function parseThesisOffline(text: string): ThesisIntent | UnsupportedThesis {
  const raw = text.trim();
  if (!raw) return unsupported("Please describe your market view.");
  if (raw.length > 2000) return unsupported("Please keep the thesis under 2,000 characters.");
  const t = raw.toLowerCase();
  const risk =
    /max(?:imum)?\s*(?:risk|loss)[^\d$]*\$?\s*([\d,]+(?:\.\d+)?)/i.exec(raw) ??
    /\$\s*([\d,]+(?:\.\d+)?)\s*(?:max(?:imum)?\s*)?(?:risk|loss)/i.exec(raw) ??
    /risk(?:ing)?\s*(?:up\s*to\s*)?\$\s*([\d,]+(?:\.\d+)?)/i.exec(raw);
  return toIntent(
    {
      underlying: /\b(btc|bitcoin)\b/.test(t) ? "BTC" : /\b(eth|ether|sol|spy|gold|tesla|tsla|nvda)\b/.test(t) ? "OTHER" : "UNCLEAR",
      direction: /\b(bear|bearish|short|crash|dump)\b/.test(t) ? "BEARISH" : /\b(bull|bullish|long|up|higher|rally)\b/.test(t) ? "BULLISH" : "UNCLEAR",
      horizonDate: /\bdec(ember)?\b/.test(t) ? "2026-12-11" : null,
      maxRiskUsd: risk ? Number(risk[1]!.replace(/,/g, "")) : null,
      fedHikeConcern: /\b(fed|fomc|powell)\b/.test(t) && /\b(hike|hikes|hiking|raise|raises)\b/.test(t),
      otherConcerns: [],
    },
    raw,
  );
}
