import { describe, expect, it } from "vitest";
import { planRehearsal, type VaultSnapshot } from "../src/rehearsal";

const base: VaultSnapshot = {
  vaultAddress: "0x1e9B755C7caA3d1D007d70A7cF77E93cc6A65E07",
  balanceUsdc6: 150_000_000n,
  perTxCap6: 25_000_000n,
  dailyCap6: 50_000_000n,
  effectiveDailySpent6: 0n,
  reserveFloor6: 10_000_000n,
  strategyId: "strat_63491dbeab91",
  strategyCap6: 150_000_000n,
  strategySpent6: 0n,
  agentAddress: "0x419792c79bC487e0fB4457080413A8973ACdc485",
  agentNativeWei: 20n * 10n ** 18n,
  paused: false,
};

describe("planRehearsal", () => {
  it("fresh vault is READY with no owner commands", () => {
    const r = planRehearsal(base);
    expect(r.ok).toBe(true);
    expect(r.ownerCommands).toEqual([]);
    expect(r.remainingDailyUsdc6).toBe(50_000_000n);
    expect(r.remainingStrategyUsdc6).toBe(150_000_000n);
    expect(r.releasableAboveFloorUsdc6).toBe(140_000_000n);
  });

  it("used-up strategy cap yields a setStrategyCap command sized spent + 150 USDC", () => {
    const r = planRehearsal({ ...base, strategySpent6: 120_000_000n });
    expect(r.ok).toBe(false);
    expect(r.ownerCommands).toHaveLength(1);
    expect(r.ownerCommands[0]).toContain('"setStrategyCap(string,uint256)" "strat_63491dbeab91" 270000000');
    expect(r.ownerCommands[0]).toContain("<YOUR_OWNER_PRIVATE_KEY>");
  });

  it("used-up daily cap yields setLimits keeping per-tx cap and floor", () => {
    const r = planRehearsal({ ...base, effectiveDailySpent6: 45_000_000n });
    expect(r.checks.find((c) => c.name === "daily cap room")?.ok).toBe(false);
    expect(r.ownerCommands[0]).toContain('"setLimits(uint256,uint256,uint256)" 25000000 95000000 10000000');
  });

  it("an unprovisioned strategyId (cap 0) is flagged and gets a setStrategyCap command", () => {
    const r = planRehearsal({ ...base, strategyCap6: 0n, strategyId: "strat_new" });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "strategy cap room")?.detail).toMatch(/never provisioned/);
    expect(r.ownerCommands[0]).toContain('"strat_new" 150000000');
  });

  it("flags low vault balance, low agent gas and pause; owner commands never contain a real key", () => {
    const r = planRehearsal({ ...base, balanceUsdc6: 22_000_000n, agentNativeWei: 5n * 10n ** 17n, paused: true });
    const failed = r.checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(expect.arrayContaining(["vault not paused", "vault balance vs reserve floor", "agent gas (Arc USDC is gas)"]));
    expect(r.releasableAboveFloorUsdc6).toBe(12_000_000n);
    expect(r.agentGasUsdc6).toBe(500_000n);
    for (const cmd of r.ownerCommands) expect(cmd).not.toMatch(/0x[0-9a-fA-F]{64}\b/);
  });
});
