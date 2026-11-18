// Pre-rehearsal check and owner limit reset (docs/agents/lane-a.md task 8). READ ONLY.
//
// WHY THIS IS AN OWNER SCRIPT, NOT A PER-RUN STRATEGY KEY ("option b"):
//  - strategyCap6[key] has no default: an unseen strategyId has cap 0, and only the owner
//    can call setStrategyCap. Keying vault calls by strategyId + run id would revert every
//    rehearsal's first release with ExceedsStrategyCap until the owner provisions that key.
//  - strategySpent6 and dailySpent6 can never be lowered, and setStrategyCap/setLimits take
//    absolute values. So "resetting" means raising the cap to (spent + headroom).
//  - The owner key stays off the server, so this module only READS and PRINTS the exact
//    `cast send` commands for the human owner to run with their own wallet.
// Arc test USDC is also native gas (CHANGES.md), hence the agent gas line.
import { createPublicClient, http, keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { vaultAbi } from "./vaultAbi";

/** What one demo rehearsal consumes. Demo step 4: a 20 USDC allowed release. Rescue: an approved request up to ~80. */
export const DEMO_DAILY_USDC6 = 20_000_000n; // the allowed release; approved requests skip the daily cap
export const DEMO_STRATEGY_USDC6 = 100_000_000n; // 20 allowed release + up to 80 approved request
export const DEFAULT_STRATEGY_CAP6 = 150_000_000n;
export const DEFAULT_DAILY_CAP6 = 50_000_000n;
/** Below this the agent may not afford a few txs (each costs a fraction of a cent). */
export const MIN_AGENT_GAS_USDC6 = 1_000_000n;

export interface VaultSnapshot {
  vaultAddress: string;
  balanceUsdc6: bigint;
  perTxCap6: bigint;
  dailyCap6: bigint;
  /** Spent today as the contract would count it at the next call (0 if the UTC day has rolled over). */
  effectiveDailySpent6: bigint;
  reserveFloor6: bigint;
  strategyId: string;
  strategyCap6: bigint;
  strategySpent6: bigint;
  agentAddress: string;
  /** Agent native balance in 18 decimals (= its Arc "USDC"). */
  agentNativeWei: bigint;
  paused: boolean;
}

export interface RehearsalReport {
  remainingDailyUsdc6: bigint;
  remainingStrategyUsdc6: bigint;
  releasableAboveFloorUsdc6: bigint;
  agentGasUsdc6: bigint;
  checks: { name: string; ok: boolean; detail: string }[];
  ok: boolean;
  /** Exact commands for the human owner, empty when no reset is needed. Contains no keys. */
  ownerCommands: string[];
}

const usdc = (v: bigint) => `${(Number(v) / 1e6).toFixed(2)} USDC`;
const nonNeg = (v: bigint) => (v < 0n ? 0n : v);

export function planRehearsal(
  s: VaultSnapshot,
  opts: { strategyHeadroomUsdc6?: bigint; dailyHeadroomUsdc6?: bigint; rpcUrl?: string } = {},
): RehearsalReport {
  const stratHeadroom = opts.strategyHeadroomUsdc6 ?? DEFAULT_STRATEGY_CAP6;
  const dailyHeadroom = opts.dailyHeadroomUsdc6 ?? DEFAULT_DAILY_CAP6;
  const remainingDaily = nonNeg(s.dailyCap6 - s.effectiveDailySpent6);
  const remainingStrategy = nonNeg(s.strategyCap6 - s.strategySpent6);
  const aboveFloor = nonNeg(s.balanceUsdc6 - s.reserveFloor6);
  const agentGas = s.agentNativeWei / 1_000_000_000_000n;

  const checks = [
    { name: "vault not paused", ok: !s.paused, detail: s.paused ? "PAUSED: every release path reverts; owner must unpause" : "running" },
    {
      name: "daily cap room",
      ok: remainingDaily >= DEMO_DAILY_USDC6,
      detail: `${usdc(remainingDaily)} left of ${usdc(s.dailyCap6)} (${usdc(s.effectiveDailySpent6)} spent today, resets 00:00 UTC); demo needs ${usdc(DEMO_DAILY_USDC6)}`,
    },
    {
      name: "strategy cap room",
      ok: s.strategyCap6 > 0n && remainingStrategy >= DEMO_STRATEGY_USDC6,
      detail:
        s.strategyCap6 === 0n
          ? `cap is 0: ${s.strategyId} was never provisioned, so every release reverts ExceedsStrategyCap`
          : `${usdc(remainingStrategy)} left of ${usdc(s.strategyCap6)} for ${s.strategyId}; demo needs ${usdc(DEMO_STRATEGY_USDC6)}`,
    },
    {
      name: "vault balance vs reserve floor",
      ok: aboveFloor >= DEMO_STRATEGY_USDC6,
      detail: `${usdc(s.balanceUsdc6)} in vault, ${usdc(s.reserveFloor6)} floor, ${usdc(aboveFloor)} releasable; demo needs up to ${usdc(DEMO_STRATEGY_USDC6)}`,
    },
    {
      name: "agent gas (Arc USDC is gas)",
      ok: agentGas >= MIN_AGENT_GAS_USDC6,
      detail: `${usdc(agentGas)} at ${s.agentAddress}; want at least ${usdc(MIN_AGENT_GAS_USDC6)}`,
    },
  ];

  const rpc = opts.rpcUrl ?? "https://rpc.testnet.arc.io";
  const base = `cast send ${s.vaultAddress} --rpc-url ${rpc} --private-key <YOUR_OWNER_PRIVATE_KEY>`;
  const ownerCommands: string[] = [];
  if (remainingStrategy < DEMO_STRATEGY_USDC6 || s.strategyCap6 === 0n) {
    ownerCommands.push(
      `${base} "setStrategyCap(string,uint256)" "${s.strategyId}" ${s.strategySpent6 + stratHeadroom}   # fresh ${usdc(stratHeadroom)} of room`,
    );
  }
  if (remainingDaily < DEMO_DAILY_USDC6) {
    ownerCommands.push(
      `${base} "setLimits(uint256,uint256,uint256)" ${s.perTxCap6} ${s.effectiveDailySpent6 + dailyHeadroom} ${s.reserveFloor6}   # daily room of ${usdc(dailyHeadroom)}; per-tx cap and floor unchanged`,
    );
  }

  return {
    remainingDailyUsdc6: remainingDaily,
    remainingStrategyUsdc6: remainingStrategy,
    releasableAboveFloorUsdc6: aboveFloor,
    agentGasUsdc6: agentGas,
    checks,
    ok: checks.every((c) => c.ok),
    ownerCommands,
  };
}

/** Read the live vault with plain reads. Uses the agent key only to derive its address; never signs. */
export async function readVaultSnapshot(strategyId: string): Promise<VaultSnapshot> {
  const need = (n: string) => {
    const v = process.env[n];
    if (!v) throw new Error(`${n} is required`);
    return v;
  };
  const vault = need("VAULT_ADDRESS") as Address;
  const usdcAddr = need("ARC_USDC_ADDRESS") as Address;
  const agent = privateKeyToAccount(need("ARC_AGENT_PRIVATE_KEY") as Hex).address;
  const client = createPublicClient({ transport: http(need("ARC_RPC_URL")) });
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ address: vault, abi: vaultAbi, functionName, args } as never) as Promise<T>;
  const key = keccak256(toBytes(strategyId));

  const [perTx, dailyCap, dailySpent, currentDay, floor, paused, cap, spent, balance, agentWei, block] = await Promise.all([
    read<bigint>("perTxCap6"),
    read<bigint>("dailyCap6"),
    read<bigint>("dailySpent6"),
    read<bigint>("currentDay"),
    read<bigint>("reserveFloor6"),
    read<boolean>("paused"),
    read<bigint>("strategyCap6", [key]),
    read<bigint>("strategySpent6", [key]),
    client.readContract({
      address: usdcAddr,
      abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [vault],
    }),
    client.getBalance({ address: agent }),
    client.getBlock(),
  ]);
  const today = block.timestamp / 86_400n;
  return {
    vaultAddress: vault,
    balanceUsdc6: balance,
    perTxCap6: perTx,
    dailyCap6: dailyCap,
    effectiveDailySpent6: today === currentDay ? dailySpent : 0n,
    reserveFloor6: floor,
    strategyId,
    strategyCap6: cap,
    strategySpent6: spent,
    agentAddress: agent,
    agentNativeWei: agentWei,
    paused,
  };
}
