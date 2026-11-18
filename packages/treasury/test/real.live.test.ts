// Live reads/writes against the deployed Arc testnet vault. Off by default: run with
// TREASURY_LIVE=1 pnpm test. Needs ARC_* env vars and VAULT_ADDRESS (see .env.example).
//
// Costs a little real testnet gas (a few cents-equivalent) but never moves funds: the
// release-limit test is a deliberate over-cap revert, and the request/cancel test opens
// then immediately cancels a request without ever needing owner approval.
import { afterEach, describe, expect, it } from "vitest";
import { TransferRequest, TreasuryStatus } from "@ttp/shared";
import { real } from "../src/real";

const STRATEGY_ID = "strat_63491dbeab91"; // the demo thesis's current mock-mode strategyId

describe.skipIf(!process.env.TREASURY_LIVE)(
  "treasury real, Arc testnet (live)",
  () => {
    it("getTreasuryStatus reads the deployed vault's real limits", async () => {
      const status = TreasuryStatus.parse(await real.getTreasuryStatus());
      expect(status.source).toBe("ONCHAIN_TESTNET");
      expect(status.perTxCapUsdc6).toBe("25000000");
      expect(status.dailyCapUsdc6).toBe("50000000");
      expect(status.reserveFloorUsdc6).toBe("10000000");
      expect(status.paused).toBe(false);
    });

    it("releaseWithinLimits over the per-tx cap gets a real onchain revert", async () => {
      const result = TransferRequest.parse(await real.releaseWithinLimits(STRATEGY_ID, "ARC", "30000000"));
      expect(result.state).toBe("REJECTED");
      expect(result.reasonCode).toBe("ExceedsPerTxCap");
      expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(result.source).toBe("ONCHAIN_TESTNET");
    });

    let openRequestId: string | null = null;

    afterEach(async () => {
      if (openRequestId) {
        await real.cancelRequest(openRequestId).catch(() => {});
        openRequestId = null;
      }
    });

    it("requestRelease then cancelRequest round-trips without ever moving funds", async () => {
      const requested = TransferRequest.parse(await real.requestRelease(STRATEGY_ID, "ARC", "30000000", 120));
      expect(requested.state).toBe("OWNER_APPROVAL_NEEDED");
      openRequestId = requested.requestId;

      const fetched = TransferRequest.parse(await real.getReleaseStatus(requested.requestId));
      expect(fetched.state).toBe("OWNER_APPROVAL_NEEDED");
      expect(fetched.amountUsdc6).toBe("30000000");

      const canceled = TransferRequest.parse(await real.cancelRequest(requested.requestId));
      expect(canceled.state).toBe("REJECTED");
      expect(canceled.reasonCode).toBe("Canceled");
      openRequestId = null;
    });

    it(
      "watchVaultEvents observes a live ReleaseRequested + RequestCanceled pair",
      async () => {
        const seen: string[] = [];
        const unwatch = real.watchVaultEvents((e) => seen.push(e.type));

        try {
          const requested = TransferRequest.parse(await real.requestRelease(STRATEGY_ID, "ARC", "1000000", 120));
          openRequestId = requested.requestId;
          await real.cancelRequest(requested.requestId);
          openRequestId = null;

          await expect
            .poll(() => seen, { timeout: 25_000, interval: 1_000 })
            .toEqual(expect.arrayContaining(["ReleaseRequested", "RequestCanceled"]));
        } finally {
          unwatch();
        }
      },
      40_000,
    );
  },
  30_000,
);
