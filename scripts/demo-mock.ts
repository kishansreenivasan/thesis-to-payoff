// pnpm demo:mock (Lane C). Runs the strategy slice with deterministic simulated inputs.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PayoffGrid, Quote, ThesisIntent } from "@ttp/shared";
import { strategy } from "../packages/strategy/src/index";

const rawText = "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.";
const parsed = await strategy.parseThesis(rawText);
if (!ThesisIntent.safeParse(parsed).success) {
  console.log("[demo:mock] Thesis is unsupported:", parsed);
  process.exit(0);
}
const intent = ThesisIntent.parse(parsed);

const fixturePath = resolve(process.cwd(), "fixtures/b/demo-quotes.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { quotes: unknown[] };
const quotes = fixture.quotes.map((quote) => Quote.parse(quote));
const plan = strategy.buildPlan(intent, quotes);
const payoff = PayoffGrid.parse(strategy.payoffGrid(plan, quotes));

console.log("[demo:mock] Thesis:", intent.rawText);
console.log("[demo:mock] Source: SIMULATED");
console.log("[demo:mock] Plan:", JSON.stringify(plan, null, 2));
console.log("[demo:mock] Payoff grid:", JSON.stringify(payoff, null, 2));
console.log("[demo:mock] Execution and margin-rescue steps need Lane A treasury/risk mocks.");
