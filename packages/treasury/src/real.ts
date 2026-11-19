// @ttp/treasury real, owned by Lane A. See docs/agents/lane-a.md.
//
// viem against the deployed ThesisTreasuryVault (contracts/deployments/arc-testnet.json).
// Every call here signs with the agent's key only. approveRequest/pause/unpause are owner-only
// on the contract and are never called from this package - the owner key never touches the
// server (DESIGN.md Section 13 item 5); the owner acts through their own wallet.
//
// Env vars are resolved lazily (on first real call), not at module load, so importing this
// file never throws under TREASURY_MODE=mock even without any Arc env vars set (matches
// packages/venues/src/real.ts).
//
// Import only from @ttp/shared. Never import another lane's package.
import {
  type Address,
  type Hex,
  type Log,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ActivityEvent, TransferRequest, TreasuryStatus, Venue } from "@ttp/shared";
import type { TreasuryApi } from "@ttp/shared";
import { vaultAbi } from "./vaultAbi";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for TREASURY_MODE=real`);
  return value;
}

const ZERO_REQUEST_ID = `0x${"0".repeat(64)}` as Hex;

/** Explicit gas: skips the client's own pre-send simulation, so a predicted revert still
 * broadcasts for real (DESIGN.md Section 8: "real onchain revert... the reverted tx hash"). */
const RELEASE_GAS_LIMIT = 300_000n;

type Clients = {
  account: ReturnType<typeof privateKeyToAccount>;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  usdcAddress: Address;
  vaultAddress: Address;
  settlementAddress: Address;
};

let clients: Clients | null = null;

function getClients(): Clients {
  if (clients) return clients;

  const rpcUrl = requireEnv("ARC_RPC_URL");
  const chainId = Number(requireEnv("ARC_CHAIN_ID"));
  const usdcAddress = requireEnv("ARC_USDC_ADDRESS") as Address;
  const vaultAddress = requireEnv("VAULT_ADDRESS") as Address;
  const settlementAddress = requireEnv("ARC_SETTLEMENT_ADDRESS") as Address;
  const agentPrivateKey = requireEnv("ARC_AGENT_PRIVATE_KEY") as Hex;

  const chain = {
    id: chainId,
    name: "arc-testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const;

  const account = privateKeyToAccount(agentPrivateKey);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  clients = { account, publicClient, walletClient, usdcAddress, vaultAddress, settlementAddress };
  return clients;
}

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** DESIGN.md Section 7: one team-controlled settlement wallet for every venue, not a
 * per-venue destination - the contract's allowlist only ever has this one address. */
function destinationFor(_venue: Venue, settlementAddress: Address): Address {
  return settlementAddress;
}

/** Requests created by this process, kept just to answer getReleaseStatus's venue field -
 * the contract itself has no notion of venue. Lost on restart; falls back to "ARC". */
const venueByRequestId = new Map<Hex, Venue>();

function decodeVaultErrorReason(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return null;
  const name = revert.data?.errorName ?? revert.reason ?? null;
  return name === "EnforcedPause" ? "Paused" : name;
}

async function getTreasuryStatus(): Promise<TreasuryStatus> {
  const { publicClient, usdcAddress, vaultAddress, settlementAddress } = getClients();

  const [balanceUsdc6, perTxCap6, dailyCap6, dailySpent6, reserveFloor6, paused, settlementAllowed] =
    await Promise.all([
      publicClient.readContract({ address: usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [vaultAddress] }),
      publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "perTxCap6" }),
      publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "dailyCap6" }),
      publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "dailySpent6" }),
      publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "reserveFloor6" }),
      publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "paused" }),
      publicClient.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "allowlist",
        args: [settlementAddress],
      }),
    ]);

  return {
    vaultAddress,
    balanceUsdc6: balanceUsdc6.toString(),
    perTxCapUsdc6: perTxCap6.toString(),
    dailyCapUsdc6: dailyCap6.toString(),
    spentTodayUsdc6: dailySpent6.toString(),
    reserveFloorUsdc6: reserveFloor6.toString(),
    paused,
    allowlist: settlementAllowed ? [settlementAddress] : [],
    source: "ONCHAIN_TESTNET",
  };
}

async function releaseWithinLimits(strategyId: string, venue: Venue, amountUsdc6: string): Promise<TransferRequest> {
  const { account, publicClient, walletClient, vaultAddress, settlementAddress } = getClients();
  const destination = destinationFor(venue, settlementAddress);
  const amount = BigInt(amountUsdc6);

  let reasonCode: string | null = null;
  try {
    await publicClient.simulateContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "releaseWithinLimits",
      args: [strategyId, destination, amount],
      account,
    });
  } catch (error) {
    reasonCode = decodeVaultErrorReason(error) ?? "Reverted";
  }

  const hash = await walletClient.writeContract({
    chain: walletClient.chain,
    account,
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "releaseWithinLimits",
    args: [strategyId, destination, amount],
    gas: RELEASE_GAS_LIMIT,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const success = receipt.status === "success";

  return {
    requestId: ZERO_REQUEST_ID,
    strategyId,
    venue,
    amountUsdc6,
    destination,
    expiresAtUtc: null,
    state: success ? "ARC_FINALIZED" : "REJECTED",
    reasonCode: success ? null : reasonCode,
    txHash: hash,
    source: "ONCHAIN_TESTNET",
  };
}

function extractRequestId(logs: readonly Log[]): Hex {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: vaultAbi,
        eventName: "ReleaseRequested",
        data: log.data,
        topics: log.topics,
      });
      return decoded.args.requestId;
    } catch {
      continue;
    }
  }
  throw new Error("ReleaseRequested event not found in requestRelease receipt");
}

async function requestRelease(
  strategyId: string,
  venue: Venue,
  amountUsdc6: string,
  ttlSec: number,
): Promise<TransferRequest> {
  const { account, publicClient, walletClient, vaultAddress, settlementAddress } = getClients();
  const destination = destinationFor(venue, settlementAddress);
  const amount = BigInt(amountUsdc6);
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + ttlSec);

  const hash = await walletClient.writeContract({
    chain: walletClient.chain,
    account,
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "requestRelease",
    args: [strategyId, destination, amount, expiresAt],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const requestId = extractRequestId(receipt.logs);
  venueByRequestId.set(requestId, venue);

  return {
    requestId,
    strategyId,
    venue,
    amountUsdc6,
    destination,
    expiresAtUtc: new Date(Number(expiresAt) * 1000).toISOString(),
    state: "OWNER_APPROVAL_NEEDED",
    reasonCode: null,
    txHash: hash,
    source: "ONCHAIN_TESTNET",
  };
}

async function getReleaseStatus(requestId: string): Promise<TransferRequest> {
  const { publicClient, vaultAddress } = getClients();
  const id = requestId as Hex;
  const [strategyId, destination, amount6, expiresAt, ownerApproved, executed, canceled] =
    await publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "requests", args: [id] });

  if (expiresAt === 0n) throw new Error(`Unknown requestId: ${requestId}`);

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  let state: TransferRequest["state"];
  let reasonCode: string | null = null;
  if (canceled) {
    state = "REJECTED";
    reasonCode = "Canceled";
  } else if (executed) {
    state = "ARC_FINALIZED";
  } else if (nowSec >= expiresAt) {
    state = "EXPIRED";
    reasonCode = "Expired";
  } else if (ownerApproved) {
    state = "OWNER_APPROVED";
  } else {
    state = "OWNER_APPROVAL_NEEDED";
  }

  return {
    requestId,
    strategyId,
    venue: venueByRequestId.get(id) ?? "ARC",
    amountUsdc6: amount6.toString(),
    destination,
    expiresAtUtc: new Date(Number(expiresAt) * 1000).toISOString(),
    state,
    reasonCode,
    txHash: null,
    source: "ONCHAIN_TESTNET",
  };
}

async function cancelRequest(requestId: string): Promise<TransferRequest> {
  const { account, publicClient, walletClient, vaultAddress } = getClients();
  const hash = await walletClient.writeContract({
    chain: walletClient.chain,
    account,
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "cancelRequest",
    args: [requestId as Hex],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return getReleaseStatus(requestId);
}

/** One of the vault's non-AccessControl events this product cares about for the activity log. */
const WATCHED_EVENTS = [
  "Released",
  "ReleaseRequested",
  "ReleaseApproved",
  "RequestCanceled",
  "Paused",
  "Unpaused",
  "AgentRevoked",
  "LimitsSet",
  "DestinationSet",
  "StrategyCapSet",
] as const;

/** JSON can't carry a bigint; ActivityEvent.details goes out over SSE. */
function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  }
  return value;
}

function watchVaultEvents(onEvent: (e: ActivityEvent) => void): () => void {
  const { publicClient, vaultAddress } = getClients();
  let seq = 0;

  // One watch per event name rather than a single multi-topic watch: Arc testnet's RPC
  // rejects eth_getLogs once (block range * topic count) crosses some threshold, confirmed
  // against the live node (CHANGES.md). A single-topic filter stays well under it even at
  // a wide poll range, so this is the robust shape rather than a premature optimization.
  const unwatchFns = WATCHED_EVENTS.map((eventName) =>
    publicClient.watchContractEvent({
      address: vaultAddress,
      abi: vaultAbi,
      eventName,
      onLogs: async (logs) => {
        for (const log of logs) {
          const block = log.blockNumber ? await publicClient.getBlock({ blockNumber: log.blockNumber }) : null;
          onEvent({
            seq: ++seq,
            timestamp: block ? new Date(Number(block.timestamp) * 1000).toISOString() : new Date().toISOString(),
            positionId: null,
            type: eventName,
            reasonCode: null,
            details: { ...(jsonSafe(log.args) as Record<string, unknown>), transactionHash: log.transactionHash },
            source: "ONCHAIN_TESTNET",
          });
        }
      },
    }),
  );

  return () => {
    for (const unwatch of unwatchFns) unwatch();
  };
}

export const real = {
  getTreasuryStatus,
  releaseWithinLimits,
  requestRelease,
  getReleaseStatus,
  cancelRequest,
  watchVaultEvents,
} satisfies TreasuryApi;
