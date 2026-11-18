// parseThesis (Lane B). The LLM only classifies and extracts; deterministic code below decides
// whether the thesis is supported and builds the ThesisIntent (DESIGN.md Sections 2 and 10).
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4"; // the SDK zod helper needs the v4 API (bundled in zod 3.25)
import { ThesisIntent as ThesisIntentSchema, type ThesisIntent, type UnsupportedThesis } from "@ttp/shared";

export const SUPPORTED_EXAMPLES = [
  "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.",
  "Bullish BTC through mid-December. Max risk $500.",
];

export const DEFAULT_HORIZON_UTC = "2026-12-11T08:00:00.000Z";
export const MODEL = "claude-opus-5-5";

/** What the LLM returns. Nothing here is trusted until `toIntent` checks it. */
export const ThesisExtraction = z.object({
  underlying: z.enum(["BTC", "OTHER", "UNCLEAR"]),
  direction: z.enum(["BULLISH", "BEARISH", "NEUTRAL", "UNCLEAR"]),
  horizonDate: z.string().nullable().describe("YYYY-MM-DD if the user named a date or month, else null"),
  maxRiskUsd: z.number().nullable().describe("The maximum loss in USD the user stated, else null"),
  fedHikeConcern: z.boolean().describe("True only if the user worries the Fed hikes more than expected"),
  otherConcerns: z.array(z.string()).describe("Any other risks or instruments the user asked for"),
});
export type ThesisExtraction = z.infer<typeof ThesisExtraction>;

const unsupported = (reason: string): UnsupportedThesis => ({
  supported: false,
  reason,
  supportedExamples: SUPPORTED_EXAMPLES,
});

/** Digits in the user's own text, e.g. "$1,500" -> "1500". Used to check the LLM did not invent a number. */
function numbersIn(text: string): Set<string> {
  return new Set((text.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => String(Number(n.replace(/,/g, "")))));
}

/** Deterministic gate from LLM extraction to ThesisIntent. */
export function toIntent(x: ThesisExtraction, rawText: string): ThesisIntent | UnsupportedThesis {
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

const SYSTEM = `You extract fields from a short trading thesis. Extract only; never suggest trades, sizes or prices.
- underlying: BTC if the thesis is about bitcoin, OTHER for another asset, UNCLEAR if not stated.
- direction: the user's view on that asset.
- horizonDate: an ISO date (YYYY-MM-DD) for the horizon they named. "Into December" means 2026-12-11. Null if none.
- maxRiskUsd: the dollar maximum loss exactly as the user stated it. Null if they did not state one. Never estimate.
- fedHikeConcern: true only for worry that the Federal Reserve raises rates more than expected.
- otherConcerns: other hedges, assets or events they asked for (empty if none).
Today is ${new Date().toISOString().slice(0, 10)}.`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.LLM_API_KEY) {
    throw new Error("parseThesis: LLM_API_KEY is not set (DESIGN.md Section 13, item 8). Use STRATEGY_MODE=mock until then.");
  }
  client ??= new Anthropic({ apiKey: process.env.LLM_API_KEY });
  return client;
}

export async function parseThesisWithLlm(text: string): Promise<ThesisIntent | UnsupportedThesis> {
  const rawText = text.trim();
  if (!rawText) return unsupported("Please describe your market view.");
  if (rawText.length > 2000) return unsupported("Please keep the thesis under 2,000 characters.");

  // Server-side fallbacks: if Opus 5.5 declines, the API re-runs on a model picked by refusal category.
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(ThesisExtraction) },
    system: SYSTEM,
    messages: [{ role: "user", content: rawText }],
  });

  if (response.stop_reason === "refusal") return unsupported("I can't help with that request.");
  if (!response.parsed_output) return unsupported("I couldn't understand that thesis. Try one of the examples.");
  return toIntent(response.parsed_output, rawText);
}

/** Keyword parser used by the mock: no network, same gate as the real one. */
export function parseThesisOffline(text: string): ThesisIntent | UnsupportedThesis {
  const t = text.toLowerCase();
  const risk = /max(?:imum)?\s*risk[^\d$]*\$?\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  return toIntent(
    {
      underlying: /\b(btc|bitcoin)\b/.test(t) ? "BTC" : /\b(eth|sol|spy|gold|tesla|nvda)\b/.test(t) ? "OTHER" : "UNCLEAR",
      direction: /\b(bear|bearish|short|crash)\b/.test(t) ? "BEARISH" : /\b(bull|bullish|long|up)\b/.test(t) ? "BULLISH" : "UNCLEAR",
      horizonDate: /\bdec(ember)?\b/.test(t) ? "2026-12-11" : null,
      maxRiskUsd: risk ? Number(risk[1]!.replace(/,/g, "")) : null,
      fedHikeConcern: /\bfed\b/.test(t) && /\bhike/.test(t),
      otherConcerns: [],
    },
    text.trim(),
  );
}
