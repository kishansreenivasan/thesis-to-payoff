// pnpm demo:open — quote, approve and execute the demo thesis against the running API, about
// 10 minutes before going on stage (DESIGN.md Section 9). Prints real venue order ids.
// Options: --text "<thesis>", --evidence <file> (writes the responses, which hold no secrets).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baseUrl, call, DEMO_THESIS, log } from "./demo-lib";

type Plan = { strategyId: string; versionHash: string; modeledMaxLossUsd: string; legs: Array<{ legId: string; venue: string; instrumentId: string; side: string; quantity: string; limitPrice: string; executionMode: string }> };
type Quote = { venue: string; instrumentId: string; bid: string | null; ask: string | null; source: string; timestamp: string };
type Order = { legId: string; venue: string; instrumentId: string; side: string; quantity: string; filledQuantity: string; avgPrice: string | null; state: string; venueOrderId: string | null; clientOrderId: string; source: string };
type Position = { positionId: string; strategyId: string; state: string; orders: Order[]; margins: Array<{ marginRatio: string; equityUsd: string; maintenanceMarginUsd: string; source: string }> };

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const text = arg("--text") ?? DEMO_THESIS;
  const health = await call<{ modes: Record<string, string>; demoMode: boolean }>("/api/health");
  log(`API ${baseUrl()} modes ${JSON.stringify(health.modes)} demoMode=${health.demoMode}`);
  const quoted = await call<{ plan?: Plan; quotes?: Quote[]; reason?: string }>("/api/strategies/quote", { text });
  if (!quoted.plan) throw new Error(`Thesis not supported: ${quoted.reason ?? JSON.stringify(quoted)}`);
  const { plan } = quoted;
  log(`plan ${plan.strategyId} (max loss $${plan.modeledMaxLossUsd})`);
  for (const leg of plan.legs) log(`  ${leg.legId} ${leg.executionMode} ${leg.venue} ${leg.side} ${leg.quantity} ${leg.instrumentId} @ ${leg.limitPrice}`);
  await call(`/api/strategies/${plan.strategyId}/approve`, { versionHash: plan.versionHash });
  log(`approved versionHash ${plan.versionHash}`);
  const position = await call<Position>(`/api/strategies/${plan.strategyId}/execute`, {});
  log(`position ${position.positionId}: ${position.state}`);
  for (const o of position.orders) log(`  ${o.legId} ${o.venue} ${o.side} ${o.filledQuantity}/${o.quantity} ${o.instrumentId} avg ${o.avgPrice ?? "-"} ${o.state} venueOrderId=${o.venueOrderId ?? "-"} [${o.source}]`);
  const m = position.margins[0];
  if (m) log(`perp margin ratio ${m.marginRatio} (equity ${m.equityUsd} / maintenance ${m.maintenanceMarginUsd}) [${m.source}]`);
  log(`next: pnpm --filter @ttp/treasury precheck --strategy ${plan.strategyId}`);

  const evidence = arg("--evidence");
  if (evidence) {
    const file = resolve(process.cwd(), evidence);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ capturedAtUtc: new Date().toISOString(), api: baseUrl(), health, plan, quotes: quoted.quotes, position }, null, 2) + "\n");
    log(`evidence written to ${evidence}`);
  }
  if (position.state !== "OPEN") process.exitCode = 2;
}

main().catch((error) => { console.error(`[demo] ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
