import { describe, expect, it } from "vitest";
import { decodeFunctionData, toFunctionSelector } from "viem";
import { ARC_TESTNET_VAULT_ADDRESS, arcTestnet, arcTxUrl, buildApproveRequestCall, vaultAbi } from "../src/owner";
import * as root from "../src/index";

const id = `0x${"ab".repeat(32)}`;

describe("owner approval helpers", () => {
  it("arcTestnet matches DESIGN.md Section 7", () => {
    expect(arcTestnet.id).toBe(5042002);
    expect(arcTestnet.rpcUrls.default.http[0]).toBe("https://rpc.testnet.arc.io");
    expect(arcTestnet.blockExplorers.default.url).toBe("https://explorer.testnet.arc.io");
    expect(arcTxUrl("0x1")).toBe("https://explorer.testnet.arc.io/tx/0x1");
  });

  it("builds approveRequest(bytes32) calldata that decodes back", () => {
    const call = buildApproveRequestCall(id);
    expect(call.to).toBe(ARC_TESTNET_VAULT_ADDRESS);
    expect(call.chainId).toBe(5042002);
    expect(call.data.slice(0, 10)).toBe(toFunctionSelector("approveRequest(bytes32)"));
    const decoded = decodeFunctionData({ abi: vaultAbi, data: call.data });
    expect(decoded.functionName).toBe("approveRequest");
    expect(decoded.args).toEqual([id]);
    expect(call.args).toEqual([id]);
  });

  it("accepts a vault address override and rejects malformed input", () => {
    const other = `0x${"11".repeat(20)}`;
    expect(buildApproveRequestCall(id, other).to).toBe(other);
    expect(() => buildApproveRequestCall("0x1234")).toThrow(/32-byte/);
    expect(() => buildApproveRequestCall(id, "nope")).toThrow(/address/);
  });

  it("is re-exported from the package root, and the ABI is the deployed one", () => {
    expect(root.buildApproveRequestCall).toBe(buildApproveRequestCall);
    expect(root.arcTestnet).toBe(arcTestnet);
    expect(root.vaultAbi).toBe(vaultAbi);
  });

  it("builds a call only; no owner-key handling exists in the module", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/owner.ts", import.meta.url), "utf8"));
    expect(src).not.toMatch(/privateKeyToAccount|process\.env|PRIVATE_KEY/);
  });
});
