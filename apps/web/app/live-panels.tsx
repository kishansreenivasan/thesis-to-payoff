"use client";
// Dashboard panels 4-6 (DESIGN.md Section 11): venues and margin gauge, Arc vault, activity log,
// plus the DEMO_MODE controls. Source metadata stays attached to API records.
import { useCallback, useEffect, useState } from "react";
import { arcAddressUrl, arcTxUrl } from "@ttp/treasury/owner";
import { api, apiBase, getOperatorToken, setOperatorToken } from "../lib/client";
import { card, input } from "./theme";

type Order = { clientOrderId: string; legId: string; venue: string; instrumentId: string; side: string; quantity: string; filledQuantity: string; avgPrice: string | null; state: string; venueOrderId: string | null; reduceOnly: boolean; source: string };
type Margin = { account: string; equityUsd: string; maintenanceMarginUsd: string; marginRatio: string; perpSizeBtc: string; indexPriceUsd: string; source: string; timestamp: string };
type Position = { positionId: string; strategyId: string; state: string; riskState: string; orders: Order[]; positions: Array<{ venue: string; account: string; instrumentId: string; quantity: string; avgPrice: string | null; source: string }>; margins: Margin[]; updatedAt: string };
type Request = { requestId: string; amountUsdc6: string; state: string; reasonCode: string | null; txHash: string | null; source: string; approvalUrl?: string };
type Treasury = { status: { vaultAddress: string; balanceUsdc6: string; perTxCapUsdc6: string; dailyCapUsdc6: string; spentTodayUsdc6: string; reserveFloorUsdc6: string; paused: boolean; allowlist: string[]; source: string }; requests?: Request[] };
type Health = { demoMode: boolean; modes: Record<string, string> };
type Event = { seq: number; timestamp: string; type: string; reasonCode: string | null; details: Record<string, unknown>; source: string };
type ShockResult = { projectedRatio: string; projectedSource: string; decision: { action: string; explanation: string; nextState: string } };
type CloseResult = { position: Position; results: Array<{ legId: string; instrumentId: string; state: string; remainingQuantity: string | null; error: string | null }>; requestError: string | null };

const usdc = (v6: string) => (Number(v6) / 1_000_000).toFixed(2);

export function LivePanels() {
  const [health, setHealth] = useState<Health | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [portfolio, setPortfolio] = useState<Position[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState("");
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [shock, setShock] = useState<ShockResult | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [confirmClose, setConfirmClose] = useState("");
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, list] = await Promise.all([api<Health>("/api/health"), api<Position[]>("/api/positions")]);
      setHealth(h);
      setPortfolio(list);
      setPosition(list.find((item) => item.strategyId === selectedStrategy) ?? list[0] ?? null);
      setTreasury(await api<Treasury>("/api/treasury").catch(() => null));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reach the API."); }
  }, [selectedStrategy]);

  useEffect(() => { setToken(getOperatorToken()); void refresh(); const t = setInterval(() => void refresh(), 5000); return () => clearInterval(t); }, [refresh]);

  const positionId = position?.positionId;
  useEffect(() => { setConfirmClose(""); setCloseResult(null); setShock(null); }, [positionId]);
  useEffect(() => {
    if (!positionId) { setEvents([]); return; }
    setEvents([]);
    const source = new EventSource(`${apiBase}/api/positions/${positionId}/events`);
    source.addEventListener("activity", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as Event;
      setEvents((prev) => prev.some((e) => e.seq === event.seq) ? prev : [...prev, event]);
    });
    return () => source.close();
  }, [positionId]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError("");
    try { await fn(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : `${label} failed`); }
    finally { setBusy(""); }
  };
  const doShock = (pct: string) => run(`Shock ${pct}%`, async () => {
    if (!position) throw new Error("Open a position before applying a stress scenario.");
    setShock(await api<ShockResult>(`/api/demo/${position.strategyId}/shock`, { method: "POST", body: { shockPct: pct } }));
  });
  const doReset = () => run("Clearing workspace", async () => { await api("/api/demo/reset", { method: "POST" }); setShock(null); setEvents([]); });
  const doClose = () => run("Closing positions", async () => {
    if (!position || confirmClose !== position.strategyId) throw new Error("The selected position changed. Review it before confirming the exit.");
    const result = await api<CloseResult>(`/api/positions/${confirmClose}/close`, { method: "POST" });
    setCloseResult(result);
    setPosition(result.position);
    setConfirmClose("");
  });

  const margin = position?.margins.find((m) => m.account === "perp") ?? position?.margins[0];
  // The latest risk decision in the log (it may come from a follow-up after the owner declines).
  const lastDecision = [...events].reverse().find((e) => e.type === "RISK_DECISION");
  const latestShock: ShockResult | null = lastDecision && typeof lastDecision.details.projectedRatio === "string"
    ? { projectedRatio: lastDecision.details.projectedRatio, projectedSource: String(lastDecision.details.projectedSource ?? "SIMULATED"), decision: { action: String(lastDecision.details.action ?? ""), explanation: String(lastDecision.details.explanation ?? ""), nextState: String(lastDecision.details.nextState ?? "") } }
    : shock;
  const live = health?.modes.venues === "real";
  const savedExit = [...events].reverse().find((event) => event.type === "POSITION_CLOSE_UPDATED");
  const exit = closeResult ?? (savedExit?.details as Omit<CloseResult, "position"> | undefined);

  return <>
    {health?.demoMode && <section style={{ ...card, marginTop: 18 }}>
      <h2>Risk controls</h2>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button disabled={!!busy || !position} onClick={() => void doShock("-8")}>Shock BTC -8%</button>
        <button disabled={!!busy || !position} onClick={() => void doShock("-15")}>Shock BTC -15%</button>
        <button disabled={!!busy || portfolio.some((item) => item.state !== "CLOSED")} onClick={() => void doReset()} title="Close all positions before clearing workspace history">Clear workspace</button>
        {busy && <span>{busy}…</span>}
      </div>
      <p style={{ color: "#a4b5bd", fontSize: 13 }}>The shock is a hypothetical price move used for a modeled stress projection. It changes the projection, not the reported venue balance.</p>
    </section>}

    <section style={{ ...card, marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}><h2 style={{ marginBottom: 0 }}>Venues and margin</h2><button disabled={!!busy || !position || position.state === "CLOSED"} onClick={() => { if (position) { setSelectedStrategy(position.strategyId); setConfirmClose(position.strategyId); } }} style={{ background: "transparent", borderColor: "#ffb489", color: "#ffb489" }}>{busy === "Closing positions" ? "Closing…" : position?.state === "REDUCING" ? "Retry remaining exits" : "Close positions"}</button></div>
      {portfolio.length > 1 && <label style={{ display: "block", marginTop: 16 }}>Position <select aria-label="Choose position" style={{ ...input, marginLeft: 12 }} value={position?.strategyId ?? ""} onChange={(event) => { setSelectedStrategy(event.target.value); setPosition(portfolio.find((item) => item.strategyId === event.target.value) ?? null); }}>{portfolio.map((item) => <option key={item.strategyId} value={item.strategyId}>{item.strategyId} · {item.state}</option>)}</select></label>}
      {live && <details><summary>Trading access {token ? "(saved in this browser)" : "(required for position actions)"}</summary>
        <input aria-label="Trading access token" type="password" placeholder="Access token" value={token} onChange={(e) => setToken(e.target.value)} style={{ ...input, width: 320, maxWidth: "100%" }} />
        <button onClick={() => setOperatorToken(token)} style={{ marginLeft: 8 }}>Save</button>
      </details>}
      {confirmClose && <div style={{ ...card, marginTop: 16, borderColor: "#ffb489" }}><h3>Close this strategy’s positions?</h3><p>Cancel outstanding strategy orders and sell its remaining held legs, starting with the perpetual. Fills depend on available liquidity; any unfilled legs will stay visible for retry. This does not withdraw funds from your venue accounts.</p><div style={{ display: "flex", gap: 12 }}><button disabled={!!busy} onClick={() => void doClose()}>Confirm close</button><button disabled={!!busy} onClick={() => setConfirmClose("")} style={{ background: "transparent", color: "#a4b5bd", borderColor: "#33464f" }}>Keep positions</button></div></div>}
      {exit && <div role="status" className="empty-state" style={{ marginTop: 16 }}><b>{position?.state === "CLOSED" ? "Positions closed" : "Exit needs attention"}</b><ul>{(exit.results ?? []).map((result) => <li key={result.legId}>{result.legId} · {result.instrumentId} · {result.state}{result.remainingQuantity !== null ? ` · remaining ${result.remainingQuantity}` : ""}{result.error ? ` — ${result.error}` : ""}</li>)}</ul>{exit.requestError && <p>Funding request cancellation needs attention: {exit.requestError}</p>}</div>}
      {error && <p role="alert" style={{ color: "#ffb489" }}>{error}</p>}
      {!position ? <div className="empty-state">No active position. Start with your thesis above, or <a href="/history">view execution history</a>.</div> : <>
        <p><b>{position.positionId}</b> · state {position.state} · risk {position.riskState}</p>
        {margin && position.state !== "CLOSED" && <MarginGauge margin={margin} shock={latestShock} />}
        <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
          <thead><tr>{["Leg", "Venue", "Instrument", "Side", "Qty", "Filled", "Avg price", "State", "Venue order id"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{position.orders.map((o) => <tr key={o.clientOrderId}>
            <td style={td}>{o.legId}{o.reduceOnly ? " (reduce-only)" : ""}</td><td style={td}>{o.venue}</td><td style={td}>{o.instrumentId}</td><td style={td}>{o.side}</td>
            <td style={td}>{o.quantity}</td><td style={td}>{o.filledQuantity}</td><td style={td}>{o.avgPrice ?? "—"}</td><td style={td}>{o.state}</td>
            <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{o.venueOrderId ?? "—"}</td>
          </tr>)}
          <tr><td style={td}>L3a</td><td style={td}>GEMINI</td><td style={td}>GEMI-FED261211-HIKEGT25</td><td style={td} colSpan={6}>Fed hedge: read-only mainnet price, modeled position (no order sent)</td></tr>
          </tbody></table></div>
      </>}
    </section>

    <section style={{ ...card, marginTop: 18 }}>
      <h2>Arc vault </h2>
      {!treasury ? <p className="empty-state">Treasury data is currently unavailable.</p> : <>
        <p style={{ overflowWrap: "anywhere" }}><a href={arcAddressUrl(treasury.status.vaultAddress)} target="_blank" rel="noreferrer">{treasury.status.vaultAddress}</a>{treasury.status.paused && <b style={{ color: "#ffb489" }}> · PAUSED</b>}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          <Stat label="Balance" value={`${usdc(treasury.status.balanceUsdc6)} USDC`} />
          <Stat label="Per-tx cap" value={`${usdc(treasury.status.perTxCapUsdc6)} USDC`} />
          <Stat label="Daily cap" value={`${usdc(treasury.status.dailyCapUsdc6)} USDC`} />
          <Stat label="Spent today" value={`${usdc(treasury.status.spentTodayUsdc6)} USDC`} />
          <Stat label="Reserve floor" value={`${usdc(treasury.status.reserveFloorUsdc6)} USDC`} />
        </div>
        <p style={{ fontSize: 13, color: "#a4b5bd", overflowWrap: "anywhere" }}>Allowlist: {treasury.status.allowlist.join(", ") || "none"}. Arc USDC is a separate treasury; it does not fund Gemini or Derive margin.</p>
        {(treasury.requests ?? []).length > 0 && <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
          <thead><tr>{["Request", "Amount", "State", "Reason", "Tx", "Owner"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{treasury.requests!.map((r) => <tr key={`${r.requestId}-${r.state}`}>
            <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.requestId.slice(0, 10)}…</td><td style={td}>{usdc(r.amountUsdc6)} USDC</td><td style={td}>{r.state}</td><td style={td}>{r.reasonCode ?? "—"}</td>
            <td style={td}>{r.txHash ? <a href={arcTxUrl(r.txHash)} target="_blank" rel="noreferrer">explorer</a> : "—"}</td>
            <td style={td}>{r.approvalUrl && ["REQUESTED", "OWNER_APPROVAL_NEEDED"].includes(r.state) ? <a href={r.approvalUrl}>approve / decline</a> : "—"}</td>

          </tr>)}</tbody></table>}
      </>}
    </section>

    <section style={{ ...card, marginTop: 18 }}>
      <h2>Activity log</h2>
      {events.length === 0 ? <p className="empty-state">Your orders, approvals and risk decisions will appear here.</p> : <ol style={{ paddingLeft: 18, margin: 0 }}>{events.map((e) => <li key={e.seq} style={{ marginBottom: 8 }}>
        <span style={{ color: "#a4b5bd", fontSize: 12 }}>{new Date(e.timestamp).toLocaleTimeString()}</span>{" "}
        <b>{e.type}</b>{e.reasonCode ? ` · ${e.reasonCode}` : ""}
        <div style={{ fontSize: 13 }}>{describe(e)}</div>
      </li>)}</ol>}
    </section>
  </>;
}

function describe(e: Event): React.ReactNode {
  const d = e.details;
  if (typeof d.explanation === "string") return d.explanation;
  if (e.type === "ORDER_UPDATED") return `${String(d.legId)} ${String(d.side)} ${String(d.quantity)} ${String(d.instrumentId)} on ${String(d.venue)}${d.reduceOnly ? " (reduce-only)" : ""}: ${String(d.state)}, venue order ${String(d.venueOrderId ?? "—")}`;
  if (typeof d.txHash === "string" && d.txHash) return <>Arc tx <a href={arcTxUrl(d.txHash)} target="_blank" rel="noreferrer">{d.txHash.slice(0, 12)}…</a>{typeof d.amountUsdc6 === "string" ? ` · ${usdc(d.amountUsdc6)} USDC` : ""}</>;
  if (typeof d.amountUsdc6 === "string") return `${usdc(d.amountUsdc6)} USDC · ${String(d.state ?? "")}`;
  return null;
}

function MarginGauge({ margin, shock }: { margin: Margin; shock: ShockResult | null }) {
  const ratio = Number(margin.marginRatio);
  const projected = shock ? Number(shock.projectedRatio) : null;
  const max = 3;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return <div style={{ margin: "12px 0 18px" }}>
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
      <span>Perp margin ratio <b>{ratio.toFixed(2)}</b> </span>
      {projected !== null && <span>Projected after shock <b>{projected.toFixed(2)}</b> </span>}
      <span style={{ fontSize: 13, color: "#a4b5bd" }}>equity ${Number(margin.equityUsd).toFixed(2)} · maintenance ${Number(margin.maintenanceMarginUsd).toFixed(2)} · index ${Number(margin.indexPriceUsd).toFixed(0)}</span>
    </div>
    <div style={{ position: "relative", height: 16, background: "linear-gradient(90deg,#563136 0%,#563136 40%,#5a4a24 40%,#5a4a24 50%,#164b40 50%)", borderRadius: 8, marginTop: 8 }}>
      {[1.2, 1.5, 2.0].map((t) => <span key={t} style={{ position: "absolute", left: pct(t), top: -2, bottom: -2, width: 1, background: "#334155" }} title={`${t}`} />)}
      <span title="real" style={{ position: "absolute", left: pct(ratio), top: -4, width: 4, height: 24, background: "#00d6b4", borderRadius: 2 }} />
      {projected !== null && <span title="projected" style={{ position: "absolute", left: pct(projected), top: -4, width: 4, height: 24, background: "#ffb489", borderRadius: 2 }} />}
    </div>
    <div style={{ fontSize: 12, color: "#a4b5bd", marginTop: 4 }}>Thresholds: 1.2 reduce · 1.5 funding band · 2.0 target. Green bar = real ratio, orange = projected.</div>
    {shock && <p style={{ fontSize: 14 }}>{shock.decision.action}: {shock.decision.explanation}</p>}
  </div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div style={{ background: "#0c151a", border: "1px solid #26373f", borderRadius: 10, padding: 10 }}><div style={{ fontSize: 12, color: "#a4b5bd" }}>{label}</div><b>{value}</b></div>;
}

const th = { textAlign: "left" as const, borderBottom: "1px solid #26373f", padding: 6, fontSize: 12, color: "#a4b5bd" };
const td = { borderBottom: "1px solid #26373f", padding: 6, verticalAlign: "top" as const };
