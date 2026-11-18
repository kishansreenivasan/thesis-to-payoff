import { beforeEach, describe, expect, it } from "vitest";
import type { ActivityEvent } from "@ttp/shared";
import { mock, resetMock, setPaused, simulateOwnerDecision } from "../src/mock";

// Note: with the demo defaults (per-tx 25 / daily 50 / reserve floor 10 / strategy cap 150,
// starting balance 150), the daily cap is always hit before the strategy cap or reserve floor
// when going through releaseWithinLimits in a single day. Strategy-cap and reserve-floor cases
// below go through simulateOwnerDecision (DESIGN.md Section 7 executeApproved), which checks
// those two but not the per-tx/daily caps, so it can actually reach them.

beforeEach(() => {
  resetMock();
});

describe("treasury mock: releaseWithinLimits", () => {
  it("succeeds within the per-tx cap and deducts the balance", async () => {
    const before = await mock.getTreasuryStatus();
    const res = await mock.releaseWithinLimits("strat-1", "DERIBIT", "20000000");
    expect(res.state).toBe("ARC_FINALIZED");
    expect(res.reasonCode).toBeNull();
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const after = await mock.getTreasuryStatus();
    expect(BigInt(after.balanceUsdc6)).toBe(BigInt(before.balanceUsdc6) - 20_000_000n);
    expect(after.spentTodayUsdc6).toBe("20000000");
  });

  it("reverts with ExceedsPerTxCap above the 25 USDC cap, with a tx hash", async () => {
    const res = await mock.releaseWithinLimits("strat-1", "DERIBIT", "80000000");
    expect(res.state).toBe("REJECTED");
    expect(res.reasonCode).toBe("ExceedsPerTxCap");
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const status = await mock.getTreasuryStatus();
    expect(status.balanceUsdc6).toBe("150000000"); // unchanged
  });

  it("reverts with ExceedsDailyCap once cumulative releases exceed the daily cap", async () => {
    await mock.releaseWithinLimits("strat-1", "DERIBIT", "25000000");
    await mock.releaseWithinLimits("strat-1", "DERIBIT", "25000000");
    const res = await mock.releaseWithinLimits("strat-1", "DERIBIT", "1000000");
    expect(res.state).toBe("REJECTED");
    expect(res.reasonCode).toBe("ExceedsDailyCap");
  });

  it("reverts with Paused while the vault is paused", async () => {
    setPaused(true);
    const res = await mock.releaseWithinLimits("strat-1", "DERIBIT", "1000000");
    expect(res.reasonCode).toBe("Paused");
  });
});

describe("treasury mock: requestRelease / getReleaseStatus / cancelRequest", () => {
  it("creates an OWNER_APPROVAL_NEEDED request with the settlement wallet as destination", async () => {
    const req = await mock.requestRelease("strat-1", "DERIBIT", "80000000", 120);
    expect(req.state).toBe("OWNER_APPROVAL_NEEDED");
    expect(req.destination).toMatch(/^0x[0-9a-f]{40}$/i);

    const fetched = await mock.getReleaseStatus(req.requestId);
    expect(fetched.requestId).toBe(req.requestId);
  });

  it("cancelRequest moves a pending request to REJECTED/Canceled", async () => {
    const req = await mock.requestRelease("strat-1", "DERIBIT", "80000000", 120);
    const canceled = await mock.cancelRequest(req.requestId);
    expect(canceled.state).toBe("REJECTED");
    expect(canceled.reasonCode).toBe("Canceled");
  });

  it("cancelRequest is idempotent on an already-terminal request", async () => {
    const req = await mock.requestRelease("strat-1", "DERIBIT", "80000000", 120);
    await mock.cancelRequest(req.requestId);
    const again = await mock.cancelRequest(req.requestId);
    expect(again.state).toBe("REJECTED");
    expect(again.reasonCode).toBe("Canceled");
  });

  it("getReleaseStatus reports EXPIRED once the ttl has passed", async () => {
    const req = await mock.requestRelease("strat-1", "DERIBIT", "80000000", -1);
    const fetched = await mock.getReleaseStatus(req.requestId);
    expect(fetched.state).toBe("EXPIRED");
  });

  it("throws for an unknown requestId", async () => {
    await expect(mock.getReleaseStatus("0xdoesnotexist")).rejects.toThrow();
  });
});

describe("treasury mock: simulateOwnerDecision (mock-only rescue hook)", () => {
  it("approval finalizes the release and deducts the balance, bypassing the per-tx cap", async () => {
    const req = await mock.requestRelease("strat-1", "DERIBIT", "80000000", 120);
    const before = await mock.getTreasuryStatus();
    const finalized = simulateOwnerDecision(req.requestId, true);
    expect(finalized.state).toBe("ARC_FINALIZED");
    const after = await mock.getTreasuryStatus();
    expect(BigInt(after.balanceUsdc6)).toBe(BigInt(before.balanceUsdc6) - 80_000_000n);
  });

  it("decline rejects the request with OwnerDeclined", async () => {
    const req = await mock.requestRelease("strat-1", "DERIBIT", "80000000", 120);
    const declined = simulateOwnerDecision(req.requestId, false);
    expect(declined.state).toBe("REJECTED");
    expect(declined.reasonCode).toBe("OwnerDeclined");
  });

  it("approval still checks the reserve floor, bypassing only the per-tx/daily caps (Section 7 executeApproved)", async () => {
    // Starting balance 150, reserve floor 10: 145 would leave only 5, below the floor.
    const req = await mock.requestRelease("strat-1", "DERIBIT", "145000000", 120);
    const res = simulateOwnerDecision(req.requestId, true);
    expect(res.state).toBe("REJECTED");
    expect(res.reasonCode).toBe("BelowReserveFloor");
  });

  it("approval still checks the strategy cap, bypassing only the per-tx/daily caps", async () => {
    const req = await mock.requestRelease("strat-1", "DERIBIT", "160000000", 120); // > 150 strategy cap
    const res = simulateOwnerDecision(req.requestId, true);
    expect(res.state).toBe("REJECTED");
    expect(res.reasonCode).toBe("ExceedsStrategyCap");
  });
});

describe("treasury mock: watchVaultEvents", () => {
  it("emits an ActivityEvent for a finalized release and supports unsubscribe", async () => {
    const seen: ActivityEvent[] = [];
    const unsubscribe = mock.watchVaultEvents((e) => seen.push(e));

    await mock.releaseWithinLimits("strat-1", "DERIBIT", "5000000");
    expect(seen.some((e) => e.type === "RELEASE_FINALIZED")).toBe(true);

    unsubscribe();
    await mock.releaseWithinLimits("strat-1", "DERIBIT", "5000000");
    expect(seen.filter((e) => e.type === "RELEASE_FINALIZED")).toHaveLength(1);
  });
});
