// Owner-approval support for Lane C's /approve/:requestId page (docs/agents/lane-a.md task 9).
//
// Browser-safe: imports only viem and the ABI, no Node APIs, no env, no keys. Everything here
// BUILDS a call; the owner's own wallet signs and sends it (wagmi `writeContract` or
// `sendTransaction`). Nothing in this package holds or asks for the owner's private key.
// Import via `@ttp/treasury/owner` to keep the server-side mock/real modules out of the web bundle.
import { defineChain, encodeFunctionData, type Address, type Hex } from "viem";
import { vaultAbi } from "./vaultAbi";

export { vaultAbi };

/** Arc testnet (DESIGN.md Section 7). Native currency is USDC with 18 decimals; the ERC-20 view is 6. */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
});

/** Deployed vault (contracts/deployments/arc-testnet.json). Prefer the server-provided address if it differs. */
export const ARC_TESTNET_VAULT_ADDRESS = "0x1e9B755C7caA3d1D007d70A7cF77E93cc6A65E07" as const;

export const arcTxUrl = (txHash: string) => `${arcTestnet.blockExplorers.default.url}/tx/${txHash}`;
export const arcAddressUrl = (address: string) => `${arcTestnet.blockExplorers.default.url}/address/${address}`;

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export interface ApproveRequestCall {
  chainId: number;
  /** wagmi `writeContract` shape: `writeContract({ abi, address, functionName, args })`. */
  abi: typeof vaultAbi;
  address: Address;
  functionName: "approveRequest";
  args: readonly [Hex];
  /** Raw shape: `sendTransaction({ to, data })` on `chainId`. Same call, pre-encoded. */
  to: Address;
  data: Hex;
}

/**
 * Builds the owner-only `approveRequest(requestId)` call. Throws on a malformed id so the page
 * never sends a transaction for a typo. The contract itself checks that the sender holds
 * OWNER_ROLE; a non-owner wallet's transaction reverts.
 */
export function buildApproveRequestCall(requestId: string, vaultAddress: string = ARC_TESTNET_VAULT_ADDRESS): ApproveRequestCall {
  if (!BYTES32.test(requestId)) throw new Error(`requestId must be a 32-byte hex string (0x + 64 hex chars), got "${requestId}"`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(vaultAddress)) throw new Error(`vaultAddress is not an address: "${vaultAddress}"`);
  const id = requestId as Hex;
  const address = vaultAddress as Address;
  return {
    chainId: arcTestnet.id,
    abi: vaultAbi,
    address,
    functionName: "approveRequest",
    args: [id],
    to: address,
    data: encodeFunctionData({ abi: vaultAbi, functionName: "approveRequest", args: [id] }),
  };
}
