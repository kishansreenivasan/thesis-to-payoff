// pnpm demo:reset [--flatten] — clear the orchestrator's demo state (plans, orders, events, risk
// state) and start a new run id so the next demo:open sends fresh client order ids. DEMO_MODE only.
// --flatten first closes every Derive testnet position with reduce-only IOC orders, so demo:open
// starts flat and the perp lands in the rescue band. Gemini sandbox contracts are left to settle.
// It never moves vault funds. Run the treasury precheck and calibrate afterwards.
import { call, log } from "./demo-lib";

type Flatten = { results: Array<{ instrumentId: string; account: string; quantity: string; state: string; venueOrderId: string | null; error?: string }> };

async function main() {
  if (process.argv.includes("--flatten")) {
    const { results } = await call<Flatten>("/api/demo/flatten", {});
    if (results.length === 0) log("no Derive positions to close");
    for (const r of results) log(`closed ${r.account} ${r.instrumentId}: ${r.state} ${r.quantity} venueOrderId=${r.venueOrderId ?? "-"}${r.error ? ` (${r.error})` : ""}`);
    if (results.some((r) => r.state !== "FILLED")) log("WARNING: not every position closed; check the Derive testnet app before demo:open");
  }
  const result = await call<{ runId: number }>("/api/demo/reset", {});
  log(`reset done; run ${result.runId}. Next: pnpm demo:open`);
}

main().catch((error) => { console.error(`[demo] ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
