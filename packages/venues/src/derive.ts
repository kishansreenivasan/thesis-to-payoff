// Derive testnet adapter (Lane B). Replaces Deribit (decision 2026-11-18, BLOCKED.md).
// Built from docs.derive.xyz; signing constants verified locally against the documented
// typehash and testnet DOMAIN_SEPARATOR. NOT yet run with a funded account.
// Unconfirmed by docs, to check in the smoke test (CHANGES.md):
//   - get_subaccount `maintenance_margin` is NET (value minus requirement; liquidation below 0).
//   - `subaccount_value` is the account equity.
//   - an account made in the web app is owned by the EOA (else a session key is needed).
import Decimal from "decimal.js";
import { encodeAbiParameters, keccak256, concat, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { MarginSnapshot, Order, OrderRequest, OrderState, Quote, VenuePosition } from "@ttp/shared";

export const DERIVE_TESTNET_API = "https://testnet.api.derive.xyz/v3";

/** Signing constants for Derive testnet (docs.derive.xyz, action-signing). */
export const DERIVE_TESTNET = {
  chainId: 11155111,
  domainSeparator: "0x24d674cd5f2b9d564691c51e9d88f649b99246a2244dd74ce27b96578d773e85" as Hex,
  actionTypehash: "0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17" as Hex,
  tradeModule: "0xB8D20c2B7a1Ad2EE33Bc50eF10876eD3035b5e7b" as Hex,
};

export type DeriveAccount = "main" | "perp";
export type FetchFn = typeof fetch;

export class DeriveError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: number | null,
    message: string,
  ) {
    super(`Derive ${method}${code != null ? ` [${code}]` : ""}: ${message}`);
    this.name = "DeriveError";
  }
}

export const isDeriveOption = (id: string) => /^BTC-\d{8}-\d+(_\d+)?-[CP]$/.test(id);
export const isDerivePerp = (id: string) => id === "BTC-PERP";

// ---------- HTTP ----------

async function post<T>(fetchFn: FetchFn, base: string, method: string, params: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetchFn(`${base}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(params ?? {}),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as { result?: T; error?: { code: number; message: string; data?: unknown } } | null;
  if (!body) throw new DeriveError(method, null, `HTTP ${res.status}, non-JSON body`);
  if (body.error) {
    const extra = body.error.data ? ` (${typeof body.error.data === "string" ? body.error.data : JSON.stringify(body.error.data)})` : "";
    throw new DeriveError(method, body.error.code, body.error.message + extra);
  }
  if (body.result === undefined) throw new DeriveError(method, null, `HTTP ${res.status}, no result`);
  return body.result;
}

// ---------- public market data (no keys) ----------

interface DeriveInstrument {
  instrument_name: string;
  instrument_type: "option" | "perp" | "erc20";
  is_active: boolean;
  minimum_amount: string;
  amount_step: string;
  tick_size: string;
  taker_fee_rate: string;
  base_fee: string;
  base_asset_address: Hex;
  base_asset_sub_id: string;
  scheduled_activation?: number;
  option_details: { expiry: number; strike: string; option_type: "C" | "P" } | null;
}

interface DeriveTicker {
  b: string | null; // best bid
  a: string | null; // best ask
  B: string | null; // bid size
  A: string | null; // ask size
  I: string; // index
  M: string; // mark
  t: number;
}

export function createDerivePublic(fetchFn: FetchFn = fetch, base = DERIVE_TESTNET_API) {
  const instruments = new Map<string, DeriveInstrument>();
  async function instrument(name: string): Promise<DeriveInstrument> {
    const hit = instruments.get(name);
    if (hit) return hit;
    const i = await post<DeriveInstrument>(fetchFn, base, "public/get_instrument", { instrument_name: name });
    instruments.set(name, i);
    return i;
  }

  async function quote(name: string): Promise<Quote> {
    const [t, i] = await Promise.all([post<DeriveTicker>(fetchFn, base, "public/get_ticker", { instrument_name: name }), instrument(name)]);
    const idx = new Decimal(t.I);
    const ask = t.a && Number(t.a) > 0 ? t.a : null;
    // Taker fee per 1 BTC: rate x index; for options capped at 12.5% of the premium.
    // The per-trade base fee is small and covered by the plan's fee reserve.
    let fee = idx.mul(i.taker_fee_rate);
    if (i.instrument_type === "option" && ask) fee = Decimal.min(fee, new Decimal(ask).mul("0.125"));
    return {
      venue: "DERIVE",
      instrumentId: name,
      bid: t.b && Number(t.b) > 0 ? t.b : null,
      ask,
      bidSize: t.B && Number(t.B) > 0 ? t.B : null,
      askSize: t.A && Number(t.A) > 0 ? t.A : null,
      feeEstimateUsd: fee.toFixed(2),
      timestamp: new Date(t.t || Date.now()).toISOString(),
      source: "TESTNET",
    };
  }

  async function index(): Promise<Decimal> {
    const t = await post<DeriveTicker>(fetchFn, base, "public/get_ticker", { instrument_name: "BTC-PERP" });
    return new Decimal(t.I);
  }

  /** Active BTC call names for the given expiries ("20261211" or Deribit-style "11DEC26"). */
  async function listCalls(expiries: string[]): Promise<string[]> {
    const codes = expiries.map(toDeriveExpiry);
    const r = await post<{ instruments: DeriveInstrument[] }>(fetchFn, base, "public/get_all_instruments", {
      instrument_type: "option",
      currency: "BTC",
      expired: false,
      page_size: 1000,
    });
    return r.instruments
      .filter((i) => i.is_active && i.instrument_name.endsWith("-C") && codes.some((c) => i.instrument_name.startsWith(`BTC-${c}-`)))
      .map((i) => i.instrument_name);
  }

  return { instrument, quote, index, listCalls };
}

const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
/** "11DEC26" -> "20261211"; "20261211" unchanged. */
export function toDeriveExpiry(code: string): string {
  if (/^\d{8}$/.test(code)) return code;
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(code);
  if (!m || !MONTHS[m[2]!]) throw new Error(`unknown expiry code ${code}`);
  return `20${m[3]}${MONTHS[m[2]!]}${m[1]!.padStart(2, "0")}`;
}

// ---------- signing ----------

const E18 = new Decimal("1e18");
const toE18 = (v: Decimal.Value) => BigInt(new Decimal(v).mul(E18).toFixed(0));

export interface TradeAction {
  subaccountId: bigint;
  nonce: bigint;
  expiry: bigint;
  owner: Hex;
  signer: Hex;
  asset: Hex;
  subId: bigint;
  limitPrice: Decimal.Value;
  amount: Decimal.Value;
  maxFee: Decimal.Value;
  isBid: boolean;
}

/** keccak256(0x1901 || DOMAIN_SEPARATOR || hashStruct(Action)) for a trade (docs: action-signing). */
export function tradeActionDigest(a: TradeAction, c = DERIVE_TESTNET): Hex {
  const data = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "int256" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "bool" }],
    [a.asset, a.subId, toE18(a.limitPrice), toE18(a.amount), toE18(a.maxFee), a.subaccountId, a.isBid],
  );
  const actionHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }],
      [c.actionTypehash, a.subaccountId, a.nonce, c.tradeModule, keccak256(data), a.expiry, a.owner, a.signer],
    ),
  );
  return keccak256(concat(["0x1901", c.domainSeparator, actionHash]));
}

/** Order nonce: ms timestamp followed by 6 random digits (docs: valid within the server time window). */
export function makeNonce(nowMs = Date.now(), rand = Math.floor(Math.random() * 1e6)): bigint {
  return BigInt(nowMs) * 1_000_000n + BigInt(rand);
}

// ---------- credentials ----------

export interface DeriveCreds {
  wallet: Hex; // owner address (X-DeriveWallet)
  signer: PrivateKeyAccount; // owner EOA key, or a registered session key
  subaccounts: Record<DeriveAccount, bigint>;
}

export function deriveCredsFromEnv(env = process.env): DeriveCreds {
  const missing = ["DERIVE_WALLET", "DERIVE_SIGNER_PRIVATE_KEY", "DERIVE_MAIN_SUBACCOUNT_ID", "DERIVE_PERP_SUBACCOUNT_ID"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Derive: ${missing.join(", ")} not set (see .env.example and DESIGN.md Section 13).`);
  return {
    wallet: env.DERIVE_WALLET as Hex,
    signer: privateKeyToAccount(env.DERIVE_SIGNER_PRIVATE_KEY as Hex),
    subaccounts: { main: BigInt(env.DERIVE_MAIN_SUBACCOUNT_ID!), perp: BigInt(env.DERIVE_PERP_SUBACCOUNT_ID!) },
  };
}

// ---------- private ----------

export interface DeriveOrder {
  order_id: string;
  order_status: "open" | "filled" | "rejected" | "cancelled" | "expired" | "untriggered" | "algo_active";
  instrument_name: string;
  direction: "buy" | "sell";
  amount: string;
  filled_amount: string;
  average_price: string;
  limit_price: string;
  label: string;
  nonce?: string | number;
  subaccount_id: number;
  reduce_only?: boolean;
  last_update_timestamp: number;
}

interface DerivePosition {
  instrument_name: string;
  instrument_type: string;
  amount: string;
  average_price: string;
  mark_price: string;
  unrealized_pnl: string;
}

interface DeriveSubaccount {
  subaccount_value: string;
  maintenance_margin: string;
  initial_margin: string;
  positions: DerivePosition[];
}

export function toDeriveOrder(o: DeriveOrder, req: OrderRequest): Order {
  const filled = new Decimal(o.filled_amount || 0);
  const s: OrderState =
    o.order_status === "filled"
      ? "FILLED"
      : o.order_status === "cancelled" || o.order_status === "expired"
        ? "CANCELED"
        : o.order_status === "rejected"
          ? "REJECTED"
          : filled.gt(0)
            ? "PARTIAL"
            : "ACKNOWLEDGED";
  return {
    ...req,
    venue: "DERIVE",
    venueOrderId: o.order_id,
    filledQuantity: filled.toString(),
    avgPrice: filled.gt(0) && o.average_price ? new Decimal(o.average_price).toFixed(2) : null,
    state: s,
    source: "TESTNET",
    updatedAt: new Date(o.last_update_timestamp || Date.now()).toISOString(),
  };
}

export interface DeriveAdapterOptions {
  fetchFn?: FetchFn;
  env?: NodeJS.ProcessEnv;
  base?: string;
  fillTimeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function createDeriveAdapter(opts: DeriveAdapterOptions = {}) {
  const fetchFn = opts.fetchFn ?? fetch;
  const env = opts.env ?? process.env;
  const base = opts.base ?? DERIVE_TESTNET_API;
  const now = opts.now ?? Date.now;
  const fillTimeoutMs = opts.fillTimeoutMs ?? 30_000;
  const pollMs = opts.pollMs ?? 2_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pub = createDerivePublic(fetchFn, base);
  let creds: DeriveCreds | null = null;
  const getCreds = () => (creds ??= deriveCredsFromEnv(env));

  async function authHeaders(): Promise<Record<string, string>> {
    const c = getCreds();
    const ts = String(now());
    return {
      "X-DeriveWallet": c.wallet,
      "X-DeriveTimestamp": ts,
      "X-DeriveSignature": await c.signer.signMessage({ message: ts }), // EIP-191 over the timestamp
    };
  }
  const priv = async <T>(method: string, params: unknown) => post<T>(fetchFn, base, method, params, await authHeaders());

  /** clientOrderId -> what we sent and the nonce we signed. Same nonce on retry, so the venue rejects duplicates. */
  const sent = new Map<string, { req: OrderRequest; account: DeriveAccount; nonce: bigint; orderId?: string }>();

  async function findOpenByLabel(account: DeriveAccount, label: string): Promise<DeriveOrder | null> {
    const r = await priv<{ orders: DeriveOrder[] }>("private/get_open_orders", { subaccount_id: Number(getCreds().subaccounts[account]) });
    return r.orders.find((o) => o.label === label) ?? null;
  }

  async function getById(account: DeriveAccount, orderId: string): Promise<DeriveOrder> {
    return priv<DeriveOrder>("private/get_order", { order_id: orderId, subaccount_id: Number(getCreds().subaccounts[account]) });
  }

  async function placeOrder(req: OrderRequest): Promise<Order> {
    if (req.account !== "main" && req.account !== "perp") throw new Error("Derive orders need account main or perp");
    if (req.clientOrderId.length > 64) throw new Error("clientOrderId must be at most 64 chars (Derive label)");
    const account = req.account;
    const c = getCreds();
    const subaccountId = c.subaccounts[account];

    const known = sent.get(req.clientOrderId);
    if (known?.orderId) return toDeriveOrder(await getById(account, known.orderId), req);
    const open = await findOpenByLabel(account, req.clientOrderId);
    if (open) {
      sent.set(req.clientOrderId, { req, account, nonce: BigInt(open.nonce ?? 0), orderId: open.order_id });
      return toDeriveOrder(open, req);
    }

    const inst = await pub.instrument(req.instrumentId);
    const nonce = known?.nonce ?? makeNonce(now());
    const expirySec = BigInt(Math.floor(now() / 1000) + 600);
    // max_fee is per unit of volume in USDC; allow 2x the taker fee at this price, plus the base fee.
    const maxFee = new Decimal(req.limitPrice).mul(inst.taker_fee_rate).mul(2).add(inst.base_fee).toDecimalPlaces(2, Decimal.ROUND_UP);
    const digest = tradeActionDigest({
      subaccountId,
      nonce,
      expiry: expirySec,
      owner: c.wallet,
      signer: c.signer.address,
      asset: inst.base_asset_address,
      subId: BigInt(inst.base_asset_sub_id),
      limitPrice: req.limitPrice,
      amount: req.quantity,
      maxFee,
      isBid: req.side === "BUY",
    });
    const signature = await c.signer.sign({ hash: digest });
    sent.set(req.clientOrderId, { req, account, nonce });

    // Reduce-only works only for non-resting orders on Derive, so those go IOC.
    const placed = await priv<{ order: DeriveOrder }>("private/order", {
      subaccount_id: Number(subaccountId),
      instrument_name: req.instrumentId,
      direction: req.side === "BUY" ? "buy" : "sell",
      order_type: "limit",
      time_in_force: req.reduceOnly ? "ioc" : "gtc",
      reduce_only: req.reduceOnly,
      amount: req.quantity,
      limit_price: req.limitPrice,
      max_fee: maxFee.toString(),
      label: req.clientOrderId,
      nonce: nonce.toString(),
      signer: c.signer.address,
      signature,
      signature_expiry_sec: Number(expirySec),
    });
    let o = placed.order;
    sent.set(req.clientOrderId, { req, account, nonce, orderId: o.order_id });

    // Thin testnet books: wait for the fill, then cancel and report REJECTED (NO_FILL), as on Deribit.
    const deadline = now() + fillTimeoutMs;
    while (o.order_status === "open" && now() < deadline) {
      await sleep(pollMs);
      o = await getById(account, o.order_id);
    }
    if (o.order_status === "open") {
      await priv("private/cancel", { instrument_name: req.instrumentId, order_id: o.order_id, subaccount_id: Number(subaccountId) });
      o = await getById(account, o.order_id);
      const out = toDeriveOrder(o, req);
      return new Decimal(out.filledQuantity).isZero() ? { ...out, state: "REJECTED" } : out;
    }
    return toDeriveOrder(o, req);
  }

  async function getOrder(clientOrderId: string): Promise<Order | null> {
    const known = sent.get(clientOrderId);
    if (known?.orderId) return toDeriveOrder(await getById(known.account, known.orderId), known.req);
    // Unknown here (e.g. after a restart): only open orders can be found by label.
    for (const account of ["main", "perp"] as const) {
      const o = await findOpenByLabel(account, clientOrderId);
      if (o) {
        const req: OrderRequest = {
          clientOrderId,
          strategyId: "unknown",
          legId: "unknown",
          venue: "DERIVE",
          account,
          instrumentId: o.instrument_name,
          side: o.direction === "buy" ? "BUY" : "SELL",
          quantity: o.amount,
          limitPrice: o.limit_price,
          reduceOnly: Boolean(o.reduce_only),
        };
        return toDeriveOrder(o, req);
      }
    }
    return null;
  }

  async function cancelOrder(clientOrderId: string): Promise<Order> {
    const current = await getOrder(clientOrderId);
    if (!current?.venueOrderId) throw new Error(`Derive: no order with clientOrderId ${clientOrderId}`);
    if (["FILLED", "CANCELED", "REJECTED"].includes(current.state)) return current;
    const account = current.account as DeriveAccount;
    await priv("private/cancel", {
      instrument_name: current.instrumentId,
      order_id: current.venueOrderId,
      subaccount_id: Number(getCreds().subaccounts[account]),
    });
    return toDeriveOrder(await getById(account, current.venueOrderId), current);
  }

  async function subaccount(account: DeriveAccount): Promise<DeriveSubaccount> {
    return priv<DeriveSubaccount>("private/get_subaccount", { subaccount_id: Number(getCreds().subaccounts[account]) });
  }

  function toPositions(account: DeriveAccount, ps: DerivePosition[]): VenuePosition[] {
    return ps
      .filter((p) => !new Decimal(p.amount || 0).isZero())
      .map((p) => ({
        venue: "DERIVE" as const,
        account,
        instrumentId: p.instrument_name,
        quantity: new Decimal(p.amount).toString(),
        avgPrice: new Decimal(p.average_price).toFixed(2),
        markPrice: p.mark_price ? new Decimal(p.mark_price).toFixed(2) : null,
        unrealizedPnlUsd: p.unrealized_pnl ? new Decimal(p.unrealized_pnl).toFixed(2) : null,
        source: "TESTNET" as const,
        timestamp: new Date().toISOString(),
      }));
  }

  async function getPositions(account: DeriveAccount): Promise<VenuePosition[]> {
    return toPositions(account, (await subaccount(account)).positions ?? []);
  }

  async function getMargin(account: DeriveAccount): Promise<MarginSnapshot> {
    const [s, idx] = await Promise.all([subaccount(account), pub.index()]);
    const equity = new Decimal(s.subaccount_value);
    // Derive margins are net (value minus requirement). Convert to the gross requirement our
    // MarginSnapshot expects, so marginRatio = equity / maintenance requirement as on Deribit.
    const mmRequirement = Decimal.max(equity.sub(s.maintenance_margin), 0);
    const imRequirement = Decimal.max(equity.sub(s.initial_margin), 0);
    const perpSize = (s.positions ?? [])
      .filter((p) => isDerivePerp(p.instrument_name))
      .reduce((sum, p) => sum.add(p.amount), new Decimal(0));
    return {
      account,
      equityUsd: equity.toFixed(2),
      maintenanceMarginUsd: mmRequirement.toFixed(2),
      initialMarginUsd: imRequirement.toFixed(2),
      marginRatio: mmRequirement.isZero() ? "999" : equity.div(mmRequirement).toFixed(4),
      perpSizeBtc: perpSize.toString(),
      indexPriceUsd: idx.toFixed(2),
      source: "TESTNET",
      timestamp: new Date().toISOString(),
    };
  }

  return { placeOrder, getOrder, cancelOrder, getPositions, getMargin, public: pub };
}
