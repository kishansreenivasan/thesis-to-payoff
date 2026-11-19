// Venue smoke tests (DESIGN.md Section 6). Run once keys are in .env:
//   pnpm --filter @ttp/venues smoke            (both venues)
//   pnpm --filter @ttp/venues smoke gemini     (or: derive)
// Places only resting orders far from the market, then cancels them. Testnet and sandbox only.
// Writes redacted responses to evidence/gemini-smoke.json and evidence/derive-smoke.json.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";
import { createDeriveAdapter, DERIVE_TESTNET_API } from "../src/derive";
import { createGeminiAdapter, GEMINI_SANDBOX_BASE } from "../src/gemini";
import { geminiOrderInstrument } from "../src/conventions";
import { listCalls, real } from "../src/real";

const root = fileURLToPath(new URL("../../../", import.meta.url));
if (!DERIVE_TESTNET_API.includes("testnet.api.derive.xyz") || !GEMINI_SANDBOX_BASE.includes("sandbox")) {
  throw new Error("smoke: refusing to run against a non-test host");
}

const REDACT = /(token|secret|key|signature|email|user_?id|username)/i;
function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, REDACT.test(k) ? "[redacted]" : redact(x)]));
  }
  return v;
}

type Step = { step: string; ok: boolean; result?: unknown; error?: string };
async function run(steps: Step[], step: string, fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    steps.push({ step, ok: true, result: redact(result) });
    console.log(`  ok   ${step}`);
    return result;
  } catch (e) {
    steps.push({ step, ok: false, error: (e as Error).message });
    console.log(`  FAIL ${step}: ${(e as Error).message}`);
    return undefined;
  }
}
const save = (file: string, steps: Step[]) => {
  writeFileSync(root + file, JSON.stringify({ ranAtUtc: new Date().toISOString(), steps }, null, 2) + "\n");
  console.log(`  -> ${file} (${steps.filter((s) => !s.ok).length} failures)`);
};

async function gemini() {
  console.log("Gemini sandbox");
  const steps: Step[] = [];
  const g = createGeminiAdapter();
  const [ev] = ((await run(steps, "list sandbox BTC2611302200", () => real.discoverGeminiEvents("sandbox", "BTC2611302200"))) ?? []) as Awaited<ReturnType<typeof real.discoverGeminiEvents>>;
  const symbol = ev?.contracts[0]?.instrumentSymbol ?? "GEMI-BTC2611302200-HI67500";
  await run(steps, `quote ${symbol}`, () => real.getQuote("GEMINI", symbol, "sandbox"));
  const id = `smoke-g-${Date.now()}`;
  // NO at 0.01 rests far below the market, so it can be cancelled.
  await run(steps, "place 1-contract limit buy NO @ 0.01", () =>
    g.placeOrder({ clientOrderId: id, strategyId: "smoke", legId: "L3b", venue: "GEMINI", account: "sandbox", instrumentId: geminiOrderInstrument(symbol, "NO"), side: "BUY", quantity: "1", limitPrice: "0.01", reduceOnly: false }),
  );
  await run(steps, "order status", () => g.getOrder(id));
  await run(steps, "cancel", () => g.cancelOrder(id));
  await run(steps, "positions", () => g.getPositions());
  await run(steps, "mainnet FED261211", () => real.discoverGeminiEvents("mainnet", "FED261211"));
  await run(steps, "mainnet quote HIKEGT25", () => real.getQuote("GEMINI", "GEMI-FED261211-HIKEGT25", "mainnet"));
  save("evidence/gemini-smoke.json", steps);
}

async function derive() {
  console.log("Derive testnet");
  const steps: Step[] = [];
  // fillTimeoutMs 0: the adapter cancels a resting order straight away, exercising place + cancel.
  const d = createDeriveAdapter({ fillTimeoutMs: 0 });
  const calls = ((await run(steps, "list active Dec 11 / Dec 25 calls", () => listCalls(["20261211", "20261225"]))) ?? []) as string[];
  await run(steps, "quote BTC-PERP", () => real.getQuote("DERIVE", "BTC-PERP", "testnet"));
  await run(steps, "margin main subaccount", () => d.getMargin("main"));
  await run(steps, "margin perp subaccount", () => d.getMargin("perp"));
  const idx = new Decimal((await real.getIndexPrice()).priceUsd);
  // Strike nearest the index, like L1. A $5 bid rests far below the ask.
  const strikeOf = (c: string) => new Decimal(c.split("-")[2]!);
  const option = [...calls].sort((a, b) => strikeOf(a).sub(idx).abs().cmp(strikeOf(b).sub(idx).abs()))[0];
  if (option) {
    const id = `smoke-d1-${Date.now()}`;
    await run(steps, `main: place + cancel 0.01 ${option} @ $5`, () =>
      d.placeOrder({ clientOrderId: id, strategyId: "smoke", legId: "L1", venue: "DERIVE", account: "main", instrumentId: option, side: "BUY", quantity: "0.01", limitPrice: "5", reduceOnly: false }),
    );
    await run(steps, "main: order status", () => d.getOrder(id));
  }
  const id2 = `smoke-d2-${Date.now()}`;
  // Perp min is 0.01 BTC; a bid at 80% of index stays inside Derive's price band and rests.
  await run(steps, "perp: place + cancel 0.01 BTC-PERP at 80% of index", () =>
    d.placeOrder({ clientOrderId: id2, strategyId: "smoke", legId: "L2", venue: "DERIVE", account: "perp", instrumentId: "BTC-PERP", side: "BUY", quantity: "0.01", limitPrice: idx.mul("0.8").toDecimalPlaces(0).toString(), reduceOnly: false }),
  );
  await run(steps, "perp: order status", () => d.getOrder(id2));
  await run(steps, "perp: positions", () => d.getPositions("perp"));
  save("evidence/derive-smoke.json", steps);
}

const which = process.argv[2];
const need = {
  gemini: ["GEMINI_SANDBOX_KEY", "GEMINI_SANDBOX_SECRET"],
  derive: ["DERIVE_WALLET", "DERIVE_SIGNER_PRIVATE_KEY", "DERIVE_MAIN_SUBACCOUNT_ID", "DERIVE_PERP_SUBACCOUNT_ID"],
};
for (const venue of ["gemini", "derive"] as const) {
  if (which && which !== venue) continue;
  const missing = need[venue].filter((k) => !process.env[k]);
  if (missing.length) {
    // evidence/ holds real responses only, so nothing is written without keys.
    console.error(`smoke ${venue}: missing ${missing.join(", ")} in .env (DESIGN.md Section 13). Nothing run.`);
    process.exit(1);
  }
}
if (!which || which === "gemini") await gemini();
if (!which || which === "derive") await derive();
