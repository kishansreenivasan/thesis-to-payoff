// Lane A's Arc-side integration tests (DESIGN.md Section 17). Default: mock mode, runs in CI.
// The real-vault variant at the bottom only runs with TREASURY_LIVE=1 and never moves funds
// (an over-cap release reverts, a request is cancelled before anyone approves it).
import { beforeEach, describe, expect, it } from "vitest";
import { MarginSnapshot, RiskInput, type ActivityEvent, type Order } from "@ttp/shared";
import { evaluateRisk } from "../../packages/risk/src/evaluateRisk";
import { createMockVenues } from "../../packages/venues/src/index";
import { mock as treasuryMock, resetMock, simulateOwnerDecision } from "../../packages/treasury/src/index";
import { real as treasuryReal } from "../../packages/treasury/src/real";
import { strategy } from "../../packages/strategy/src/index";
import { buildApp } from "../../apps/api/src/app";

const THESIS = "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.";

type Shock = {
  decision: { action: string; nextState: string; reasonCode: string; topUpUsdc6: string | null };
  transferRequest: { requestId: string; state: string; reasonCode: string | null; txHash: string | null } | null;
  reduceOrder: Order | null;
};

async function openDemoPosition() {
  // Pin the modes this suite exercises so a developer's .env (e.g. TREASURY_MODE=real) cannot change it.
  process.env.DEMO_MODE = "true";
  process.env.TREASURY_MODE = "mock";
  process.env.VENUES_MODE = "mock";
  process.env.STRATEGY_MODE = "mock";
  resetMock();
  const venues = createMockVenues();
  const app = buildApp({ strategy, venues, treasury: treasuryMock, risk: { evaluateRisk }, decideMockRequest: simulateOwnerDecision });
  const post = async <T>(url: string, payload: unknown = {}) => {
    const res = await app.inject({ method: "POST", url, headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });
    if (res.statusCode >= 400) throw new Error(`POST ${url} ${res.statusCode}: ${res.body}`);
    return res.json() as T;
  };
  const quoted = await post<{ plan: { strategyId: string; versionHash: string } }>("/api/strategies/quote", { text: THESIS });
  const id = quoted.plan.strategyId;
  await post(`/api/strategies/${id}/approve`, { versionHash: quoted.plan.versionHash });
  await post(`/api/strategies/${id}/execute`);
  return { app, venues, post, id };
}

describe("Arc rescue, mock mode: revert -> request -> decline -> reduce-only", () => {
  beforeEach(() => {
    process.env.DEMO_MODE = "true";
  });

  it("tries the vault (reverts ExceedsPerTxCap), files a request, and after a decline reduces the perp reduce-only", async () => {
    const { app, venues, post, id } = await openDemoPosition();
    const events: ActivityEvent[] = [];
    const stop = treasuryMock.watchVaultEvents((e) => events.push(e));
    try {
      const marginBefore = await venues.getMargin("perp");

      const first = await post<Shock>(`/api/demo/${id}/shock`, { shockPct: "-15" });
      expect(first.decision.action).toBe("REQUEST_APPROVAL");
      expect(first.transferRequest?.state).toBe("OWNER_APPROVAL_NEEDED");
      // Order of the rescue (Section 8 steps 2-3): the vault attempt reverts first, then the request.
      const types = events.map((e) => e.type);
      expect(types.indexOf("RELEASE_REVERTED")).toBeGreaterThanOrEqual(0);
      expect(types.indexOf("RELEASE_REQUESTED")).toBeGreaterThan(types.indexOf("RELEASE_REVERTED"));
      expect(events.find((e) => e.type === "RELEASE_REVERTED")?.reasonCode).toBe("ExceedsPerTxCap");
      expect(first.reduceOrder).toBeNull();
      // Nothing was sold yet.
      expect((await venues.getMargin("perp")).perpSizeBtc).toBe(marginBefore.perpSizeBtc);

      const declined = await post<{ state: string; reasonCode: string }>(`/api/treasury/requests/${first.transferRequest!.requestId}/decision`, { approved: false });
      expect(declined.state).toBe("REJECTED");

      const second = await post<Shock>(`/api/demo/${id}/shock`, { shockPct: "-15" });
      expect(second.decision.action).toBe("REDUCE_PERP");
      expect(second.decision.nextState).toBe("DELEVERAGE_REQUIRED");
      expect(second.reduceOrder).not.toBeNull();
      expect(second.reduceOrder).toMatchObject({ side: "SELL", reduceOnly: true, account: "perp", state: "FILLED" });
      // The perp really got smaller.
      expect(Number((await venues.getMargin("perp")).perpSizeBtc)).toBeLessThan(Number(marginBefore.perpSizeBtc));
    } finally {
      stop();
      await app.close();
    }
  });
});

describe("Simulated venue credit never changes MarginSnapshot", () => {
  it("an approved release leaves the venue margin untouched and the engine still reduces the perp", async () => {
    const { app, venues, post, id } = await openDemoPosition();
    try {
      const before = MarginSnapshot.parse(await venues.getMargin("perp"));
      const first = await post<Shock>(`/api/demo/${id}/shock`, { shockPct: "-15" });
      expect(first.transferRequest?.state).toBe("OWNER_APPROVAL_NEEDED");

      const approved = await post<{ state: string }>(`/api/treasury/requests/${first.transferRequest!.requestId}/decision`, { approved: true });
      // Mock executes the approved release; the real flow then logs VENUE_CREDIT_SIMULATED. Either way, funds went to the
      // Arc settlement wallet, not to Derive.
      expect(["ARC_FINALIZED", "VENUE_CREDIT_SIMULATED"]).toContain(approved.state);

      const after = MarginSnapshot.parse(await venues.getMargin("perp"));
      expect({ ...after, timestamp: "" }).toEqual({ ...before, timestamp: "" });

      // Margin unchanged, so a finished release must not trigger another request: reduce instead (Section 8 step 7).
      const second = await post<Shock>(`/api/demo/${id}/shock`, { shockPct: "-15" });
      expect(second.decision.action).toBe("REDUCE_PERP");
      expect(second.decision.reasonCode).toBe("FundingDidNotImproveMargin");
      expect(second.transferRequest).toBeNull();
      expect(second.reduceOrder).toMatchObject({ side: "SELL", reduceOnly: true });
    } finally {
      await app.close();
    }
  });
});

// ---- Real Arc vault, behind TREASURY_LIVE=1 ----
describe.skipIf(!process.env.TREASURY_LIVE)(
  "Arc rescue against the real vault (live, no funds move)",
  () => {
    it(
      "real revert -> real request -> agent cancel (owner decline) -> reduce-only order on the venue",
      async () => {
        const venues = createMockVenues(); // the venue leg stays on the mock until Derive is funded
        const strategyId = "strat_63491dbeab91";
        const margin = await venues.getMargin("perp");
        const perp = (await venues.getPositions("DERIVE", "perp"))[0];
        const input = (openRequest: RiskInput["openRequest"], state: RiskInput["currentState"]) =>
          RiskInput.parse({
            margin: { ...margin, perpSizeBtc: "0.0164", equityUsd: "230", maintenanceMarginUsd: "53.3", initialMarginUsd: "80" },
            shockPct: "-15",
            perpUnrealizedPnlUsd: perp?.unrealizedPnlUsd ?? "0",
            perpStopLossUsd: "160",
            treasury: { perTxCapUsdc6: "25000000", remainingDailyUsdc6: "50000000", balanceUsdc6: "150000000" },
            openRequest,
            currentState: state,
          });

        const decision = evaluateRisk(input(null, "NORMAL"));
        expect(decision.nextState).toBe("FUNDING_ELIGIBLE");
        // Force the over-cap path whatever the vault balance is: use a fixed over-cap amount; never moves funds.
        const amount = "30000000";

        const reverted = await treasuryReal.releaseWithinLimits(strategyId, "ARC", amount);
        expect(reverted).toMatchObject({ state: "REJECTED", reasonCode: "ExceedsPerTxCap", source: "ONCHAIN_TESTNET" });
        expect(reverted.txHash).toMatch(/^0x[0-9a-f]{64}$/);

        const requested = await treasuryReal.requestRelease(strategyId, "ARC", amount, 120);
        expect(requested.state).toBe("OWNER_APPROVAL_NEEDED");

        const pending = evaluateRisk(
          input({ requestId: requested.requestId, state: requested.state, expiresAtUtc: requested.expiresAtUtc! }, "FUNDING_ELIGIBLE"),
        );
        expect(pending.nextState).toBe("APPROVAL_PENDING");

        const canceled = await treasuryReal.cancelRequest(requested.requestId); // what the agent does after a decline
        expect(canceled.state).toBe("REJECTED");

        const after = evaluateRisk(input({ requestId: canceled.requestId, state: canceled.state, expiresAtUtc: new Date().toISOString() }, "APPROVAL_PENDING"));
        expect(after.action).toBe("REDUCE_PERP");

        const order = await venues.placeOrder({
          clientOrderId: `live-test-${Date.now()}`,
          strategyId,
          legId: "L2",
          venue: "DERIVE",
          account: "perp",
          instrumentId: "BTC-PERP",
          side: "SELL",
          quantity: "0.0001",
          limitPrice: "1",
          reduceOnly: true,
        });
        expect(order.reduceOnly).toBe(true);
      },
      90_000,
    );
  },
);
