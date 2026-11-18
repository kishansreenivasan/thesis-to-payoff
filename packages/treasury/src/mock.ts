// @ttp/treasury mock, owned by Lane A. See docs/agents/lane-a.md.
//
// In-memory simulation of ThesisTreasuryVault's state machine (DESIGN.md
// Section 7): same caps, same check order, same request lifecycle, but no
// chain. Every value carries source: "SIMULATED".
import { randomBytes } from "node:crypto";
import type { ActivityEvent, ReleaseState, TransferRequest, TreasuryStatus, Venue } from "@ttp/shared";
import type { TreasuryApi } from "@ttp/shared";

const VAULT_ADDRESS = `0x${"11".repeat(20)}`;
const SETTLEMENT_ADDRESS = `0x${"22".repeat(20)}`;

// Demo defaults, DESIGN.md Section 7.
const PER_TX_CAP_USDC6 = 25_000_000n;
const DAILY_CAP_USDC6 = 50_000_000n;
const RESERVE_FLOOR_USDC6 = 10_000_000n;
const STRATEGY_CAP_USDC6 = 150_000_000n;
const STARTING_BALANCE_USDC6 = 150_000_000n;

const TERMINAL_STATES: ReleaseState[] = ["ARC_FINALIZED", "VENUE_CREDIT_SIMULATED", "REJECTED", "EXPIRED", "FAILED"];

function fakeHash(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

let balanceUsdc6 = STARTING_BALANCE_USDC6;
let spentTodayUsdc6 = 0n;
let dayKey = utcDayKey(new Date());
let paused = false;
const strategySpentUsdc6 = new Map<string, bigint>();
const requests = new Map<string, TransferRequest>();
const listeners = new Set<(e: ActivityEvent) => void>();
let eventSeq = 0;

function rolloverDailyCapIfNeeded(): void {
  const today = utcDayKey(new Date());
  if (today !== dayKey) {
    dayKey = today;
    spentTodayUsdc6 = 0n;
  }
}

function emit(type: string, reasonCode: string | null, details: Record<string, unknown>): void {
  const event: ActivityEvent = {
    seq: ++eventSeq,
    timestamp: new Date().toISOString(),
    positionId: null,
    type,
    reasonCode,
    details,
    source: "SIMULATED",
  };
  for (const listener of listeners) listener(event);
}

function expireIfPast(req: TransferRequest): TransferRequest {
  const pending: ReleaseState[] = ["REQUESTED", "OWNER_APPROVAL_NEEDED", "OWNER_APPROVED"];
  if (pending.includes(req.state) && req.expiresAtUtc !== null && new Date(req.expiresAtUtc).getTime() < Date.now()) {
    const expired: TransferRequest = { ...req, state: "EXPIRED", reasonCode: "Expired" };
    requests.set(req.requestId, expired);
    emit("RELEASE_EXPIRED", "Expired", { requestId: req.requestId });
    return expired;
  }
  return req;
}

function checkLimits(strategyId: string, amount: bigint, opts: { perTx: boolean; daily: boolean }): string | null {
  if (paused) return "Paused";
  if (opts.perTx && amount > PER_TX_CAP_USDC6) return "ExceedsPerTxCap";
  if (opts.daily && spentTodayUsdc6 + amount > DAILY_CAP_USDC6) return "ExceedsDailyCap";
  const strategySpent = strategySpentUsdc6.get(strategyId) ?? 0n;
  if (strategySpent + amount > STRATEGY_CAP_USDC6) return "ExceedsStrategyCap";
  if (balanceUsdc6 - amount < RESERVE_FLOOR_USDC6) return "BelowReserveFloor";
  return null;
}

function recordSpend(strategyId: string, amount: bigint): void {
  balanceUsdc6 -= amount;
  spentTodayUsdc6 += amount;
  strategySpentUsdc6.set(strategyId, (strategySpentUsdc6.get(strategyId) ?? 0n) + amount);
}

async function getTreasuryStatus(): Promise<TreasuryStatus> {
  rolloverDailyCapIfNeeded();
  return {
    vaultAddress: VAULT_ADDRESS,
    balanceUsdc6: balanceUsdc6.toString(),
    perTxCapUsdc6: PER_TX_CAP_USDC6.toString(),
    dailyCapUsdc6: DAILY_CAP_USDC6.toString(),
    spentTodayUsdc6: spentTodayUsdc6.toString(),
    reserveFloorUsdc6: RESERVE_FLOOR_USDC6.toString(),
    paused,
    allowlist: [SETTLEMENT_ADDRESS],
    source: "SIMULATED",
  };
}

async function releaseWithinLimits(strategyId: string, venue: Venue, amountUsdc6: string): Promise<TransferRequest> {
  rolloverDailyCapIfNeeded();
  const amount = BigInt(amountUsdc6);
  const reasonCode = checkLimits(strategyId, amount, { perTx: true, daily: true });
  const txHash = fakeHash();

  if (reasonCode) {
    emit("RELEASE_REVERTED", reasonCode, { strategyId, venue, amountUsdc6, txHash });
    return {
      requestId: fakeHash(),
      strategyId,
      venue,
      amountUsdc6,
      destination: SETTLEMENT_ADDRESS,
      expiresAtUtc: null,
      state: "REJECTED",
      reasonCode,
      txHash,
      source: "SIMULATED",
    };
  }

  recordSpend(strategyId, amount);
  emit("RELEASE_FINALIZED", null, { strategyId, venue, amountUsdc6, txHash });
  return {
    requestId: fakeHash(),
    strategyId,
    venue,
    amountUsdc6,
    destination: SETTLEMENT_ADDRESS,
    expiresAtUtc: null,
    state: "ARC_FINALIZED",
    reasonCode: null,
    txHash,
    source: "SIMULATED",
  };
}

async function requestRelease(
  strategyId: string,
  venue: Venue,
  amountUsdc6: string,
  ttlSec: number,
): Promise<TransferRequest> {
  rolloverDailyCapIfNeeded();
  const req: TransferRequest = {
    requestId: fakeHash(),
    strategyId,
    venue,
    amountUsdc6,
    destination: SETTLEMENT_ADDRESS,
    expiresAtUtc: new Date(Date.now() + ttlSec * 1000).toISOString(),
    state: "OWNER_APPROVAL_NEEDED",
    reasonCode: null,
    txHash: fakeHash(),
    source: "SIMULATED",
  };
  requests.set(req.requestId, req);
  emit("RELEASE_REQUESTED", null, { requestId: req.requestId, strategyId, venue, amountUsdc6, ttlSec });
  return req;
}

async function getReleaseStatus(requestId: string): Promise<TransferRequest> {
  const req = requests.get(requestId);
  if (!req) throw new Error(`Unknown requestId: ${requestId}`);
  return expireIfPast(req);
}

async function cancelRequest(requestId: string): Promise<TransferRequest> {
  const existing = requests.get(requestId);
  if (!existing) throw new Error(`Unknown requestId: ${requestId}`);
  const current = expireIfPast(existing);
  if (TERMINAL_STATES.includes(current.state)) return current;

  const canceled: TransferRequest = { ...current, state: "REJECTED", reasonCode: "Canceled" };
  requests.set(requestId, canceled);
  emit("RELEASE_CANCELED", "Canceled", { requestId });
  return canceled;
}

function watchVaultEvents(onEvent: (e: ActivityEvent) => void): () => void {
  listeners.add(onEvent);
  return () => listeners.delete(onEvent);
}

export const mock = {
  getTreasuryStatus,
  releaseWithinLimits,
  requestRelease,
  getReleaseStatus,
  cancelRequest,
  watchVaultEvents,
} satisfies TreasuryApi;

/**
 * Mock-only hook, not part of TreasuryApi. Simulates the owner acting on a
 * pending request from the dashboard approval page (DESIGN.md Section 8,
 * rescue sequence steps 4-7) since mock mode has no real wallet or chain.
 * Approval auto-executes (mirrors requestRelease + approveRequest +
 * executeApproved) and is checked against the strategy cap and reserve
 * floor but not the per-tx or daily cap, matching executeApproved in
 * Section 7.
 */
export function simulateOwnerDecision(requestId: string, approved: boolean): TransferRequest {
  const existing = requests.get(requestId);
  if (!existing) throw new Error(`Unknown requestId: ${requestId}`);
  const current = expireIfPast(existing);
  if (current.state !== "OWNER_APPROVAL_NEEDED") return current;

  if (!approved) {
    const declined: TransferRequest = { ...current, state: "REJECTED", reasonCode: "OwnerDeclined" };
    requests.set(requestId, declined);
    emit("RELEASE_DECLINED", "OwnerDeclined", { requestId });
    return declined;
  }

  const amount = BigInt(current.amountUsdc6);
  const reasonCode = checkLimits(current.strategyId, amount, { perTx: false, daily: false });
  if (reasonCode) {
    const failed: TransferRequest = { ...current, state: "REJECTED", reasonCode };
    requests.set(requestId, failed);
    emit("RELEASE_EXECUTE_REVERTED", reasonCode, { requestId });
    return failed;
  }

  recordSpend(current.strategyId, amount);
  const txHash = fakeHash();
  const finalized: TransferRequest = { ...current, state: "ARC_FINALIZED", reasonCode: null, txHash };
  requests.set(requestId, finalized);
  emit("RELEASE_APPROVED_FINALIZED", null, { requestId, txHash });
  return finalized;
}

/** Mock-only hook, not part of TreasuryApi: pause/unpause for demo and tests. */
export function setPaused(value: boolean): void {
  paused = value;
  emit(value ? "VAULT_PAUSED" : "VAULT_UNPAUSED", null, {});
}

/** Mock-only hook, not part of TreasuryApi: reset in-memory state between demo runs. */
export function resetMock(): void {
  balanceUsdc6 = STARTING_BALANCE_USDC6;
  spentTodayUsdc6 = 0n;
  dayKey = utcDayKey(new Date());
  paused = false;
  strategySpentUsdc6.clear();
  requests.clear();
  eventSeq = 0;
}
