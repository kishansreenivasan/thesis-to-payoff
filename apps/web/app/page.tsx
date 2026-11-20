"use client";

import { FormEvent, useState } from "react";
import { apiBase } from "../lib/client";
import { SourceBadge } from "./badge";
import { LivePanels } from "./live-panels";

type Quote = { venue: string; instrumentId: string; bid: string | null; ask: string | null; source: string };
type Plan = { strategyId: string; versionHash: string; modeledMaxLossUsd: string; legs: Array<{ legId: string; venue: string; instrumentId: string; quantity: string; limitPrice: string; executionMode: string }> };
type Payoff = { btcPrices: string[]; pnlIfBigHike: string[]; pnlIfNoBigHike: string[]; maxLossLineUsd: string; notes: string[] };
type QuoteResult = { plan: Plan; quotes: Quote[]; payoff: Payoff };

export default function Page() {
  const [text, setText] = useState("Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.");
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function quote(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`${apiBase}/api/strategies/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const body = await response.json();
      if (!response.ok || !body.plan) throw new Error(body.error ?? body.reason ?? "Could not build this strategy.");
      setResult(body as QuoteResult);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reach the API."); }
    finally { setBusy(false); }
  }
  const derive = result?.quotes.find((q) => (q.venue === "DERIVE" || q.venue === "DERIBIT") && (q.instrumentId === "BTC-PERP" || q.instrumentId.includes("PERPETUAL")));
  const fed = result?.quotes.find((q) => q.instrumentId === "GEMI-FED261211-HIKEGT25");
  const binary = result?.quotes.find((q) => q.venue === "GEMINI" && q.instrumentId.includes("BTC2611302200"));

  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: "42px 24px 80px" }}>
    <header style={{ marginBottom: 28 }}><p style={{ color: "#496b58", fontWeight: 700, letterSpacing: 1 }}>TESTNET + SANDBOX ONLY</p><h1 style={{ fontSize: 38, margin: "8px 0" }}>Thesis-to-Payoff</h1><p>Turn a supported BTC view into a bounded multi-leg plan and inspect its risk before approval.</p></header>
    <section style={card}><h2>Thesis and plan</h2><form onSubmit={quote}><label htmlFor="thesis">Describe your market view</label><textarea id="thesis" rows={3} value={text} onChange={(e) => setText(e.target.value)} style={{ ...input, display: "block", width: "100%", margin: "10px 0" }} /><button disabled={busy}>{busy ? "Getting quotes…" : "Build plan and payoff"}</button></form>{error && <p role="alert" style={{ color: "#a12622" }}>{error}</p>}
      {result && <><p><b>Strategy</b> {result.plan.strategyId} · modeled max loss ${result.plan.modeledMaxLossUsd}</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>{result.plan.legs.map((leg) => <article key={leg.legId} style={subcard}><b>{leg.legId} · {leg.venue}</b><p>{leg.instrumentId}</p><small>{leg.quantity} at {leg.limitPrice} · {leg.executionMode}</small></article>)}</div></>}
    </section>
    <section style={{ ...card, marginTop: 18 }}><h2>Venue prices and sources</h2><p>These are separate venue feeds and contract types; compare their labels and units.</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12 }}>
      <PriceCard title="Derive BTC-PERP" subtitle="BTC index / USD per BTC" quote={derive} />
      <PriceCard title="Gemini Fed hike contract (L3a)" subtitle="Live mainnet price · position SIMULATED, no order sent" quote={fed} />
      <PriceCard title="Gemini BTC threshold contract (L3b)" subtitle="Real sandbox NO order · USD per contract" quote={binary} />
    </div></section>
    {result && <section style={{ ...card, marginTop: 18 }}><h2>Payoff grid <SourceBadge source="SIMULATED" /></h2><div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr><th style={cell}>BTC at expiry</th><th style={cell}>Big Fed hike</th><th style={cell}>No big hike</th></tr></thead><tbody>{result.payoff.btcPrices.map((price, i) => <tr key={price}><td style={cell}>${price}</td><td style={cell}>${result.payoff.pnlIfBigHike[i]}</td><td style={cell}>${result.payoff.pnlIfNoBigHike[i]}</td></tr>)}</tbody></table></div><p>Modeled max loss line: {result.payoff.maxLossLineUsd} USD</p>{result.payoff.notes.map((note) => <p key={note} style={{ color: "#52606d" }}>{note}</p>)}</section>}
    <LivePanels />
  </main>;
}

function PriceCard({ title, subtitle, quote }: { title: string; subtitle: string; quote?: Quote }) {
  return <article style={subcard}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}><b>{title}</b>{quote && <SourceBadge source={quote.source} />}</div><p style={{ color: "#52606d" }}>{subtitle}</p>{quote ? <p>Bid {quote.bid ?? "—"} · Ask {quote.ask ?? "—"}</p> : <p>Build a plan to load this quote.</p>}<small>{quote?.instrumentId ?? "Quote not loaded"}</small></article>;
}
const card = { background: "white", border: "1px solid #e0e5e9", borderRadius: 16, padding: 22, boxShadow: "0 6px 20px #1020300a" };
const subcard = { background: "#fbfcfd", border: "1px solid #e5eaee", borderRadius: 12, padding: 14 };
const input = { padding: 10, borderRadius: 8, border: "1px solid #c8d0d7", font: "inherit" };
const cell = { borderBottom: "1px solid #e5eaee", padding: 9, textAlign: "right" as const };
