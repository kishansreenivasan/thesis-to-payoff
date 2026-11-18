// Fund a NEW Derive testnet subaccount (standard margin) with test USDC. Testnet only.
//   pnpm --filter @ttp/venues derive:fund 300          # dry run: shows what it would do
//   pnpm --filter @ttp/venues derive:fund 300 --yes    # sends the USDC, waits for the new subaccount
// How: public/register_deposit_address (wallet, manager_id) returns a deposit address for a new
// subaccount; a plain ERC-20 transfer of Derive's test USDC to it creates and credits the subaccount.
import Decimal from "decimal.js";
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const API = "https://testnet.api.derive.xyz/v3";
const RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const MIN_DEPOSIT_USD = 10;

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
]);

async function api<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(`${API}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) });
  const body = (await res.json()) as { result?: T; error?: { message: string; data?: unknown } };
  if (body.error || body.result === undefined) throw new Error(`${method}: ${body.error?.message ?? "no result"} ${JSON.stringify(body.error?.data ?? "")}`);
  return body.result;
}

const amountArg = process.argv[2];
const send = process.argv.includes("--yes");
if (!amountArg || !/^\d+(\.\d+)?$/.test(amountArg) || Number(amountArg) < MIN_DEPOSIT_USD) {
  console.error(`usage: derive:fund <usdc amount, at least ${MIN_DEPOSIT_USD}> [--yes]`);
  process.exit(1);
}
const wallet = process.env.DERIVE_WALLET as Hex | undefined;
const key = process.env.DERIVE_SIGNER_PRIVATE_KEY as Hex | undefined;
if (!wallet || !key) {
  console.error("Set DERIVE_WALLET and DERIVE_SIGNER_PRIVATE_KEY in .env first.");
  process.exit(1);
}
const account = privateKeyToAccount(key);
if (getAddress(account.address) !== getAddress(wallet)) {
  console.error(`DERIVE_SIGNER_PRIVATE_KEY belongs to ${account.address}, not DERIVE_WALLET ${wallet}. Funding needs the wallet's own key.`);
  process.exit(1);
}

// Standard-margin manager and USDC collateral, read live from Derive (PRIME universe holds BTC options and perps).
type Collateral = { name: string; address: string; erc20?: { decimals: number; underlying_erc20?: Hex } };
type Manager = { manager_id: number; margin_type: string; instruments: string[]; collaterals: Collateral[] };
const ru = await api<{ risk_universes?: { name: string; managers: Manager[] }[] } | { name: string; managers: Manager[] }[]>("public/get_risk_universes", {});
const universes = Array.isArray(ru) ? ru : (ru.risk_universes ?? []);
const manager = universes
  .find((u) => u.name === "PRIME")
  ?.managers.find((m) => m.margin_type === "SM" && m.instruments.includes("BTC-PERP") && m.instruments.includes("BTC-OPTION"));
const usdc = manager?.collaterals.find((c) => c.name === "USDC");
const token = usdc?.erc20?.underlying_erc20;
if (!manager || !token) throw new Error("could not find the PRIME standard-margin manager or its USDC collateral");
const decimals = usdc!.erc20!.decimals;

const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const [ethBal, usdcBal, before] = await Promise.all([
  pub.getBalance({ address: wallet }),
  pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [wallet] }),
  api<{ subaccount_ids: number[] }>("public/get_subaccounts", { wallet }),
]);
const amount = BigInt(new Decimal(amountArg).mul(new Decimal(10).pow(decimals)).toFixed(0));
const dep = await api<{ deposit_address: Hex; subaccount_id: number; manager_id: number }>("public/register_deposit_address", {
  wallet,
  manager_id: manager.manager_id,
});

console.log(`wallet            ${wallet}`);
console.log(`Sepolia ETH       ${formatUnits(ethBal, 18)}`);
console.log(`test USDC         ${formatUnits(usdcBal, decimals)} (${token})`);
console.log(`subaccounts now   ${JSON.stringify(before.subaccount_ids)}`);
console.log(`manager           ${manager.manager_id} (${manager.margin_type}, PRIME)`);
console.log(`deposit address   ${dep.deposit_address} (new subaccount: ${dep.subaccount_id === 0})`);
console.log(`will send         ${amountArg} USDC`);
if (usdcBal < amount) throw new Error("not enough test USDC in the wallet");
if (ethBal === 0n) throw new Error("no Sepolia ETH for gas");
if (dep.subaccount_id !== 0) throw new Error("deposit address is not for a new subaccount; stopping");
if (!send) {
  console.log("\nDry run. Re-run with --yes to send.");
  process.exit(0);
}

const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
const hash = await walletClient.writeContract({ address: token, abi: erc20, functionName: "transfer", args: [dep.deposit_address, amount] });
console.log(`sent: https://sepolia.etherscan.io/tx/${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`transfer reverted: ${hash}`);
console.log("confirmed on Sepolia; waiting for Derive to credit it (usually about 2 minutes)...");

const known = new Set(before.subaccount_ids);
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  const now = await api<{ subaccount_ids: number[] }>("public/get_subaccounts", { wallet });
  const fresh = now.subaccount_ids.filter((id) => !known.has(id));
  if (fresh.length) {
    console.log(`new subaccount id(s): ${fresh.join(", ")}  (all: ${JSON.stringify(now.subaccount_ids)})`);
    process.exit(0);
  }
  process.stdout.write(".");
}
console.log("\nNot credited after 10 minutes. Check public/get_pending_deposits or the Derive app; nothing was lost.");
