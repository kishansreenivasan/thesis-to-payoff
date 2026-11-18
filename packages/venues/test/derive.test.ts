import { describe, expect, it } from "vitest";
import { recoverAddress, keccak256, encodeAbiParameters, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MarginSnapshot, Order, Quote, VenuePosition } from "@ttp/shared";
import { createDeriveAdapter, createDerivePublic, DERIVE_TESTNET, makeNonce, toDeriveExpiry, tradeActionDigest, type DeriveOrder } from "../src/derive";

// Throwaway test key (never funded). Owner == signer, as when the EOA trades directly.
const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const signer = privateKeyToAccount(PK);
const env = {
  DERIVE_WALLET: signer.address,
  DERIVE_SIGNER_PRIVATE_KEY: PK,
  DERIVE_MAIN_SUBACCOUNT_ID: "101",
  DERIVE_PERP_SUBACCOUNT_ID: "202",
} as NodeJS.ProcessEnv;

type Call = { method: string; params: Record<string, unknown>; headers: Record<string, string> };

function fakeDerive(handlers: Record<string, (p: Record<string, unknown>, n: number) => unknown>) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const method = new URL(url).pathname.replace("/v3/", "");
    const params = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ method, params, headers: init?.headers as Record<string, string> });
    counts[method] = (counts[method] ?? 0) + 1;
    const h = handlers[method];
    if (!h) return new Response(JSON.stringify({ error: { code: -32601, message: `no handler ${method}` } }));
    try {
      return new Response(JSON.stringify({ result: h(params, counts[method]!) }));
    } catch (e) {
      return new Response(JSON.stringify({ error: e }));
    }
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const option = {
  instrument_name: "BTC-20261225-65000-C",
  instrument_type: "option",
  is_active: true,
  minimum_amount: "0.01",
  amount_step: "0.00001",
  tick_size: "1",
  taker_fee_rate: "0.0003",
  base_fee: "0.5",
  base_asset_address: "0xd0711b9eBE84b778483709CDe62BacFDBAE13623",
  base_asset_sub_id: "39614109174419592798570160768",
  option_details: { expiry: 1798185600, strike: "65000", option_type: "C" },
};
const perp = { ...option, instrument_name: "BTC-PERP", instrument_type: "perp", base_fee: "0.01", base_asset_address: "0xDBa83C0C654DB1cd914FA2710bA743e925B53086", base_asset_sub_id: "0", option_details: null };
const instruments: Record<string, unknown> = { [option.instrument_name]: option, "BTC-PERP": perp };

const base = {
  "public/get_instrument": (p: Record<string, unknown>) => instruments[p.instrument_name as string],
  "public/get_ticker": () => ({ b: "63936", a: "63936.1", B: "5", A: "0.0128", I: "63937.5", M: "63924.8", t: 1795009697708 }),
  "private/get_open_orders": () => ({ orders: [] }),
};

const dOrder = (over: Partial<DeriveOrder> = {}): DeriveOrder => ({
  order_id: "o-1",
  order_status: "open",
  instrument_name: option.instrument_name,
  direction: "buy",
  amount: "0.07",
  filled_amount: "0",
  average_price: "0",
  limit_price: "3048",
  label: "c1",
  subaccount_id: 101,
  last_update_timestamp: 1795009697708,
  ...over,
});

const callReq = {
  clientOrderId: "c1",
  strategyId: "s",
  legId: "L1",
  venue: "DERIVE" as const,
  account: "main" as const,
  instrumentId: option.instrument_name,
  side: "BUY" as const,
  quantity: "0.07",
  limitPrice: "3048",
  reduceOnly: false,
};
const noSleep = async () => {};

describe("Derive signing", () => {
  it("documented constants reproduce from their definitions", () => {
    expect(keccak256(stringToHex("Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)"))).toBe(DERIVE_TESTNET.actionTypehash);
    const domType = keccak256(stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
    const sep = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [domType, keccak256(stringToHex("Matching")), keccak256(stringToHex("1.0")), 11155111n, "0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD"],
    ));
    expect(sep).toBe(DERIVE_TESTNET.domainSeparator);
  });

  it("order signatures recover to the signer, and change with any signed field", async () => {
    const a = { subaccountId: 101n, nonce: makeNonce(1795009697708, 123456), expiry: 1795010297n, owner: signer.address, signer: signer.address, asset: option.base_asset_address as Hex, subId: BigInt(option.base_asset_sub_id), limitPrice: "3048", amount: "0.07", maxFee: "38.89", isBid: true };
    const digest = tradeActionDigest(a);
    const sig = await signer.sign({ hash: digest });
    expect(await recoverAddress({ hash: digest, signature: sig })).toBe(signer.address);
    expect(tradeActionDigest({ ...a, amount: "0.08" })).not.toBe(digest);
    expect(tradeActionDigest({ ...a, isBid: false })).not.toBe(digest);
  });

  it("nonce is the ms timestamp followed by 6 digits", () => {
    expect(makeNonce(1795009697708, 42).toString()).toBe("1795009697708000042");
  });

  it("expiry codes convert from the old Deribit style", () => {
    expect(toDeriveExpiry("11DEC26")).toBe("20261211");
    expect(toDeriveExpiry("20261225")).toBe("20261225");
  });
});

describe("Derive public", () => {
  it("quotes in USD with taker fee per BTC, labelled TESTNET", async () => {
    const { fetchFn } = fakeDerive(base);
    const q = Quote.parse(await createDerivePublic(fetchFn).quote("BTC-PERP"));
    expect(q).toMatchObject({ venue: "DERIVE", bid: "63936", ask: "63936.1", askSize: "0.0128", feeEstimateUsd: "19.18", source: "TESTNET" });
  });

  it("lists only active calls for the requested expiries", async () => {
    const { fetchFn } = fakeDerive({
      "public/get_all_instruments": () => ({
        instruments: [
          { ...option, instrument_name: "BTC-20261211-65000-C", is_active: false },
          option,
          { ...option, instrument_name: "BTC-20261225-65000-P" },
        ],
      }),
    });
    expect(await createDerivePublic(fetchFn).listCalls(["11DEC26", "20261225"])).toEqual(["BTC-20261225-65000-C"]);
  });
});

describe("Derive adapter", () => {
  it("places a signed GTC order with label, auth headers and a bounded max fee; waits for the fill", async () => {
    const { fetchFn, calls } = fakeDerive({
      ...base,
      "private/order": () => ({ order: dOrder(), trades: [] }),
      "private/get_order": () => dOrder({ order_status: "filled", filled_amount: "0.07", average_price: "3048" }),
    });
    const d = createDeriveAdapter({ fetchFn, env, sleep: noSleep, pollMs: 0, now: () => 1795009697708 });
    const o = Order.parse(await d.placeOrder(callReq));
    expect(o).toMatchObject({ state: "FILLED", filledQuantity: "0.07", avgPrice: "3048.00", venue: "DERIVE", source: "TESTNET" });
    const c = calls.find((x) => x.method === "private/order")!;
    expect(c.params).toMatchObject({ subaccount_id: 101, instrument_name: option.instrument_name, direction: "buy", time_in_force: "gtc", reduce_only: false, amount: "0.07", limit_price: "3048", label: "c1", signer: signer.address });
    expect(Number(c.params.max_fee)).toBeCloseTo(3048 * 0.0003 * 2 + 0.5, 2);
    expect(c.headers["X-DeriveWallet"]).toBe(signer.address);
    expect(c.headers["X-DeriveTimestamp"]).toBe("1795009697708");
    // the signature in the request recovers to our signer
    const digest = tradeActionDigest({
      subaccountId: 101n, nonce: BigInt(c.params.nonce as string), expiry: BigInt(c.params.signature_expiry_sec as number), owner: signer.address, signer: signer.address,
      asset: option.base_asset_address as Hex, subId: BigInt(option.base_asset_sub_id), limitPrice: "3048", amount: "0.07", maxFee: c.params.max_fee as string, isBid: true,
    });
    expect(await recoverAddress({ hash: digest, signature: c.params.signature as Hex })).toBe(signer.address);
  });

  it("reduce-only perp sells go IOC on the perp subaccount", async () => {
    const { fetchFn, calls } = fakeDerive({
      ...base,
      "private/order": () => ({ order: dOrder({ instrument_name: "BTC-PERP", direction: "sell", order_status: "filled", filled_amount: "0.0083", average_price: "63936", subaccount_id: 202 }), trades: [] }),
    });
    const d = createDeriveAdapter({ fetchFn, env, sleep: noSleep });
    const o = await d.placeOrder({ ...callReq, clientOrderId: "r1", legId: "L2", account: "perp", instrumentId: "BTC-PERP", side: "SELL", quantity: "0.0083", limitPrice: "63936", reduceOnly: true });
    expect(o.state).toBe("FILLED");
    expect(calls.find((x) => x.method === "private/order")!.params).toMatchObject({ subaccount_id: 202, time_in_force: "ioc", reduce_only: true, direction: "sell" });
  });

  it("cancels after the fill timeout and reports REJECTED (NO_FILL)", async () => {
    let cancelled = false;
    const { fetchFn, calls } = fakeDerive({
      ...base,
      "private/order": () => ({ order: dOrder(), trades: [] }),
      "private/cancel": () => ((cancelled = true), dOrder({ order_status: "cancelled" })),
      "private/get_order": () => dOrder({ order_status: cancelled ? "cancelled" : "open" }),
    });
    const d = createDeriveAdapter({ fetchFn, env, sleep: noSleep, fillTimeoutMs: 0 });
    expect((await d.placeOrder(callReq)).state).toBe("REJECTED");
    expect(calls.some((x) => x.method === "private/cancel")).toBe(true);
  });

  it("never resends: an open order with the same label is returned", async () => {
    const { fetchFn, calls } = fakeDerive({ ...base, "private/get_open_orders": () => ({ orders: [dOrder()] }) });
    const d = createDeriveAdapter({ fetchFn, env, sleep: noSleep });
    expect((await d.placeOrder(callReq)).venueOrderId).toBe("o-1");
    expect(calls.some((x) => x.method === "private/order")).toBe(false);
  });

  it("margin: net Derive margins become a gross requirement; ratio = equity / requirement", async () => {
    const { fetchFn } = fakeDerive({
      ...base,
      // value 260, net maintenance 180 -> requirement 80 -> ratio 3.25
      "private/get_subaccount": () => ({
        subaccount_value: "260",
        maintenance_margin: "180",
        initial_margin: "140",
        positions: [{ instrument_name: "BTC-PERP", instrument_type: "perp", amount: "0.0166", average_price: "63900", mark_price: "63924.8", unrealized_pnl: "0.41" }],
      }),
    });
    const d = createDeriveAdapter({ fetchFn, env });
    const m = MarginSnapshot.parse(await d.getMargin("perp"));
    expect(m).toMatchObject({ equityUsd: "260.00", maintenanceMarginUsd: "80.00", initialMarginUsd: "120.00", marginRatio: "3.2500", perpSizeBtc: "0.0166", indexPriceUsd: "63937.50" });
    const [p] = (await d.getPositions("perp")).map((x) => VenuePosition.parse(x));
    expect(p).toMatchObject({ venue: "DERIVE", quantity: "0.0166", unrealizedPnlUsd: "0.41" });
  });

  it("explains missing credentials", async () => {
    const { fetchFn } = fakeDerive(base);
    const d = createDeriveAdapter({ fetchFn, env: {} as NodeJS.ProcessEnv });
    await expect(d.placeOrder(callReq)).rejects.toThrow(/DERIVE_WALLET/);
  });
});
