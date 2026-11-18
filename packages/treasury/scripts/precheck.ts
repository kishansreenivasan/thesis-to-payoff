// `pnpm --filter @ttp/treasury precheck -- --strategy strat_xxxxxxxxxxxx`
// Run before every rehearsal. READ ONLY: prints remaining daily cap, remaining strategy cap,
// vault balance vs reserve floor and agent gas, then the exact owner `cast send` commands
// (no keys) if headroom is short. The human owner runs those with their own wallet.
import { planRehearsal, readVaultSnapshot } from "../src/rehearsal";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const strategyId = arg("strategy") ?? process.env.DEMO_STRATEGY_ID;
  if (!strategyId) {
    throw new Error("Pass --strategy <strategyId> (or set DEMO_STRATEGY_ID). The id is in the compile/quote response, e.g. strat_63491dbeab91.");
  }
  const snap = await readVaultSnapshot(strategyId);
  const report = planRehearsal(snap, { rpcUrl: process.env.ARC_RPC_URL });
  console.log(`Pre-rehearsal check, vault ${snap.vaultAddress} (READ ONLY)`);
  for (const c of report.checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
  if (report.ownerCommands.length) {
    console.log("\nOwner commands (run yourself with your own wallet; nothing here holds your key):");
    for (const cmd of report.ownerCommands) console.log(`  ${cmd}`);
  }
  console.log(report.ok ? "\nREADY" : "\nNOT READY");
  process.exit(report.ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
