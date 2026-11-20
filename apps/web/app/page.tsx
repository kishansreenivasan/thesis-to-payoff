"use client";

import { FormEvent, useEffect, useState } from "react";
import type { PositionSnapshot } from "@ttp/shared";
import Image from "next/image";
import Link from "next/link";
import { api, apiBase, getOperatorToken, setOperatorToken } from "../lib/client";
import { LivePanels } from "./live-panels";
import { card, subcard, input } from "./theme";

type Quote = { venue: string; instrumentId: string; bid: string | null; ask: string | null; source: string };
type Plan = { strategyId: string; versionHash: string; modeledMaxLossUsd: string; legs: Array<{ legId: string; venue: string; instrumentId: string; quantity: string; limitPrice: string; executionMode: string }> };
type Payoff = { btcPrices: string[]; pnlIfBigHike: string[]; pnlIfNoBigHike: string[]; maxLossLineUsd: string; notes: string[] };
type QuoteResult = { plan: Plan; quotes: Quote[]; payoff: Payoff };

export default function Page() {
  const [text, setText] = useState("I am bullish on Bitcoin into December, but I want some downside protection. Max risk $500.");
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState("");
  const [approved, setApproved] = useState(false);
  const [execution, setExecution] = useState<PositionSnapshot | null>(null);
  const [token, setToken] = useState("");
  const [accessSaved, setAccessSaved] = useState(false);
  const [needsAccess, setNeedsAccess] = useState(false);
  const [localAccess, setLocalAccess] = useState(false);
  useEffect(() => {
    const saved = getOperatorToken(); setToken(saved); setAccessSaved(!!saved);
    void api<{ modes: { venues: string; strategy: string }; localOperatorAccess?: boolean }>("/api/health").then((health) => { setLocalAccess(!!health.localOperatorAccess); setNeedsAccess(!health.localOperatorAccess && (health.modes.venues === "real" || health.modes.strategy === "real")); }).catch(() => setNeedsAccess(true));
  }, []);
  async function quote(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setResult(null); setApproved(false); setExecution(null);
    try {
      const response = await fetch(`${apiBase}/api/strategies/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const body = await response.json();
      if (!response.ok || !body.plan) throw new Error(body.error ?? body.reason ?? "Could not build this strategy.");
      setResult(body as QuoteResult);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reach the API."); }
    finally { setBusy(false); }
  }
  async function approve() {
    if (!result) return;
    setAction("Approving"); setError("");
    try {
      await api(`/api/strategies/${result.plan.strategyId}/approve`, { method: "POST", body: { versionHash: result.plan.versionHash } });
      setApproved(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not approve this plan."); }
    finally { setAction(""); }
  }
  async function execute() {
    if (!result || !approved) return;
    setAction("Executing"); setError("");
    try { setExecution(await api<PositionSnapshot>(`/api/strategies/${result.plan.strategyId}/execute`, { method: "POST" })); }
    catch (e) { setError(e instanceof Error ? e.message : "Execution could not complete. Check positions below before retrying."); }
    finally { setAction(""); }
  }
  const derive = result?.quotes.find((q) => (q.venue === "DERIVE" || q.venue === "DERIBIT") && (q.instrumentId === "BTC-PERP" || q.instrumentId.includes("PERPETUAL")));
  const fed = result?.quotes.find((q) => q.instrumentId === "GEMI-FED261211-HIKEGT25");
  const binaryLeg = result?.plan.legs.find((leg) => leg.legId === "L3b");
  const binary = result?.quotes.find((q) => q.venue === "GEMINI" && q.instrumentId === binaryLeg?.instrumentId);

  return <main className="dashboard">
    <header className="topbar">
      <Image src="/convex-logo.png" alt="Convex" width={1774} height={887} priority className="brand-logo" />
      <nav aria-label="Main navigation"><a href="#trading-actions">Trading access</a><Link href="/history">Execution history</Link><a href="https://grok.com" target="_blank" rel="noreferrer">Open Grok ↗</a></nav>
    </header>
    <div className="hero"><p className="eyebrow">THE CONVEX WORKSPACE</p><h1>Your conviction. A considered strategy.</h1><p>Turn a BTC market view into a coordinated position, with a plan for being wrong.</p></div>
    <div className="composer-layout">
    <section className="composer" style={card}><p className="eyebrow">01 / THESIS AND PLAN</p><h2>What’s your market view?</h2><form onSubmit={quote}><label htmlFor="thesis">Describe your BTC thesis, event concern and maximum risk.</label><textarea id="thesis" rows={3} disabled={!!action} value={text} onChange={(e) => { setText(e.target.value); setResult(null); setApproved(false); setExecution(null); }} style={input} /><div className="form-footer"><button disabled={busy || !!action}>{busy ? "Building your strategy…" : "Build strategy →"}</button><span>Deterministic pricing · Exact-version approval</span></div></form>{error && <div role="alert" className="empty-state" style={{ marginTop: 18, color: "#ffb489" }}>{error}<p style={{ marginBottom: 0 }}><Link href="/history">View execution history →</Link></p></div>}
      {result && <><p><b>Strategy</b> {result.plan.strategyId} · modeled max loss ${result.plan.modeledMaxLossUsd}</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>{result.plan.legs.map((leg) => <article key={leg.legId} style={subcard}><b>{leg.legId} · {leg.venue}</b><p>{leg.instrumentId}</p><small>{leg.quantity} at {leg.limitPrice} · {leg.executionMode === "SIMULATED" ? "Modeled hedge" : "Executable leg"}</small></article>)}</div><p><a href="#trading-actions">Next: review and execute this plan →</a></p></>}
    </section>
    <aside className="journey"><p className="eyebrow">FROM VIEW TO POSITION</p><ol><li>Describe your view<small>Use the composer here, or enable the Convex connector in Grok.</small></li><li>Review the structure<small>Options, perps and event hedges. Clear costs and venue receipts.</small></li><li>Approve, then execute<small>Approval of the exact strategy before orders are placed.</small></li><li>Monitor and respond<small>Stress projections, Arc spending rules and a reduce-only fallback.</small></li></ol></aside>
    </div>
    <section style={{ ...card, marginTop: 18 }}><h2>Venue prices and sources</h2><p>These are separate venue feeds and contract types; compare their labels and units.</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12 }}>
      <PriceCard title="Derive BTC-PERP" subtitle="BTC index / USD per BTC" quote={derive} />
      <PriceCard title="Gemini Fed hike contract (L3a)" subtitle="Read-only Fed price · modeled hedge, no order sent" quote={fed} />
      <PriceCard title="Gemini BTC threshold contract (L3b)" subtitle="BTC downside contract · USD per contract" quote={binary} />
    </div></section>
    {result && <section style={{ ...card, marginTop: 18 }}><h2>Payoff grid </h2><div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr><th style={cell}>BTC at expiry</th><th style={cell}>Big Fed hike</th><th style={cell}>No big hike</th></tr></thead><tbody>{result.payoff.btcPrices.map((price, i) => <tr key={price}><td style={cell}>${price}</td><td style={cell}>${result.payoff.pnlIfBigHike[i]}</td><td style={cell}>${result.payoff.pnlIfNoBigHike[i]}</td></tr>)}</tbody></table></div><p>Modeled max loss line: {result.payoff.maxLossLineUsd} USD</p>{result.payoff.notes.map((note) => <p key={note} style={{ color: "#a4b5bd" }}>{note}</p>)}</section>}
    <section id="trading-actions" style={{ ...card, marginTop: 18, scrollMarginTop: 24 }}><p className="eyebrow">02 / APPROVAL AND EXECUTION</p><h2>{execution ? (execution.state === "OPEN" ? "Execution confirmed" : "Execution needs attention") : approved ? "Plan approved. Ready to execute." : "Review, approve, then execute"}</h2>
      {localAccess ? <p style={{ color: "#00d6b4" }}>Connected using your server configuration.</p> : <details open={needsAccess && !accessSaved}><summary>Trading access {accessSaved ? "saved" : "setup"}</summary><p style={{ color: "#a4b5bd", fontSize: 13 }}>Your access token authorizes actions on the connected trading accounts. Save it once in this browser to approve, execute, or close positions.</p><div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><input aria-label="Trading access token" autoComplete="off" type="password" placeholder="Access token" value={token} onChange={(event) => { setToken(event.target.value); setAccessSaved(false); }} style={{ ...input, width: 320, maxWidth: "100%" }} /><button type="button" onClick={() => { setOperatorToken(token); setAccessSaved(!!token); }}>Save access</button></div></details>}
      {!result ? <p style={{ color: "#a4b5bd" }}>Build a strategy above to review and approve its plan.</p> : <><p>Review the legs and payoff before approving this exact plan. Execution submits the executable legs to the connected accounts.</p><div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}><button disabled={!!action || approved || !!execution || (needsAccess && !accessSaved)} onClick={() => void approve()}>{approved ? "Plan approved ✓" : action === "Approving" ? "Approving…" : "Approve plan"}</button><button disabled={!!action || !approved || !!execution || (needsAccess && !accessSaved)} onClick={() => void execute()}>{action === "Executing" ? "Submitting orders…" : "Execute plan"}</button>{needsAccess && !accessSaved && <small>Save trading access above to continue.</small>}</div></>}
      {execution && <div role="status" className="empty-state" style={{ marginTop: 18 }}><b>{execution.state === "OPEN" ? "All executable legs filled." : "Execution needs attention. Review the positions and orders below."}</b><p>{execution.orders.filter((order) => order.state === "FILLED").length} confirmed fills · {execution.positionId}</p><a href="#positions">View positions and manage exits →</a></div>}
    </section>
    <LivePanels refreshKey={execution?.updatedAt} />
    <p className="environment-note">The Fed hedge and stress projections are modeled; Arc releases do not fund exchange margin.</p>
  </main>;
}

function PriceCard({ title, subtitle, quote }: { title: string; subtitle: string; quote?: Quote }) {
  return <article style={subcard}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}><b>{title}</b></div><p style={{ color: "#a4b5bd" }}>{subtitle}</p>{quote ? <p>Bid {quote.bid ?? "—"} · Ask {quote.ask ?? "—"}</p> : <p>Build a plan to load this quote.</p>}<small>{quote?.instrumentId ?? "Quote not loaded"}</small></article>;
}
const cell = { borderBottom: "1px solid #26373f", padding: 9, textAlign: "right" as const };
