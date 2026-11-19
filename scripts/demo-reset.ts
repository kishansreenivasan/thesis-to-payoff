// pnpm demo:reset — clear the orchestrator's demo state (plans, orders, events, risk state) and
// start a new run id so the next demo:open sends fresh client order ids. DEMO_MODE only.
// It does not close venue positions or move vault funds. Run the treasury precheck afterwards.
import { call, log } from "./demo-lib";

call<{ runId: number }>("/api/demo/reset", {})
  .then((result) => { log(`reset done; run ${result.runId}. Next: pnpm demo:open`); })
  .catch((error) => { console.error(`[demo] ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
