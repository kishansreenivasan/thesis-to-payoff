"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { SourceBadge } from "../badge";
import { demo } from "./evidence";
import styles from "./replay.module.css";

const steps = ["Your thesis", "The strategy", "Execution", "Stress test", "Owner control", "The rescue"];
const titles = ["A market view. A plan for being wrong.", "Four legs. One coordinated strategy.", "Approval becomes confirmed fills.", "What happens if BTC drops 15%?", "The agent has limits. You have control.", "Decline the top-up. Reduce the exposure."];
const descriptions = [
  "Start with a bullish Bitcoin thesis, a Fed concern, and an explicit risk budget.",
  "Grok structures the intent. Deterministic code selects instruments, quantities, prices and spending limits.",
  "The exact plan version is approved before execution. Each executable leg is confirmed by its venue.",
  "The shock changes the projection, while the actual Derive account read stays separate.",
  "The Arc vault rejects an over-cap release onchain. The agent files a request that only the owner's wallet can approve.",
  "The owner declined. The agent canceled the request and filled a reduce-only sell on Derive testnet.",
];
const reasons = { L1: "Defined-risk bullish upside", L2: "Leveraged BTC exposure with a stop", L3a: "Fed-hike scenario hedge", L3b: "BTC downside event hedge" };
const evidenceRoot = "https://github.com/kishansreenivasan/thesis-to-payoff/blob/main/evidence/";

export default function ReplayPage() {
  const [step, setStep] = useState(0);
  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/" aria-label="Convex dashboard"><Image src="/convex-logo.png" alt="Convex" width={1774} height={887} priority className={styles.logo} /></Link>
      <div className={styles.context}><b>TESTNET DEMO · NOV 19, 2026</b><span>Derive · Gemini · Arc · Grok</span><span><Link href="/">Build a strategy</Link> · <a href="https://grok.com" target="_blank" rel="noreferrer">Create with Grok ↗</a></span></div>
    </header>
    <nav className={styles.steps} aria-label="Demo steps">{steps.map((name, i) => <button key={name} onClick={() => setStep(i)} aria-current={step === i ? "step" : undefined}><span>{i + 1}</span>{name}</button>)}</nav>
    <section className={styles.stage} aria-live="polite">
      <div className={styles.intro}><p className={styles.eyebrow}>{steps[step]}</p><h1>{titles[step]}</h1><p>{descriptions[step]}</p></div>
      {step === 0 && <div className={styles.thesis}>
        <blockquote>“{demo.plan.intent.rawText}”</blockquote>
        <div className={styles.metrics}><Metric label="Risk budget" value={`$${demo.plan.intent.maxRiskUsd}`} source="USER_INPUT" /><Metric label="Supported view" value="Bullish BTC" source="USER_INPUT" /><Metric label="Event concern" value="Fed hike >25 bps" source="USER_INPUT" /></div>
        <p className={styles.note}>No alpha prediction. Supported theses only. The model never sets trade sizes or prices.</p>
        <p><Link href="/">Enter your own thesis →</Link></p>
      </div>}
      {step === 1 && <>
        <div className={styles.legs}>{demo.plan.legs.map((leg) => <article className={styles.card} key={leg.legId}>
          <p className={styles.eyebrow}>{leg.legId} · {leg.venue}</p><h2>{leg.type.replaceAll("_", " ")}</h2><p>{reasons[leg.legId as keyof typeof reasons]}</p><code>{leg.instrumentId}</code>
          <p>{leg.quantity} {leg.quantityUnit} at ${leg.limitPrice}</p><SourceBadge source={leg.executionMode === "SIMULATED" ? "SIMULATED" : leg.venue === "GEMINI" ? "SANDBOX" : "TESTNET"} />
          {leg.legId === "L3a" && <p className={styles.note}>Fed quote captured from read-only mainnet data. No Fed order sent.</p>}
        </article>)}</div>
        <p className={styles.note}>Modeled max loss ${demo.plan.modeledMaxLossUsd} <SourceBadge source="SIMULATED" /> · Perp stop ${demo.plan.perpStopLossUsd}. Gaps can exceed the modeled loss.</p>
      </>}
      {step === 2 && <div className={styles.card}><h2>Three executable legs · all FILLED</h2><div className={styles.tableWrap}><table><thead><tr><th>Leg / instrument</th><th>Filled / average price</th><th>Venue receipt</th></tr></thead><tbody>{demo.orders.map((order) => <tr key={order.clientOrderId}><td><b>{order.legId}</b> · {order.instrumentId}<p><SourceBadge source={order.source} /></p></td><td>{order.filledQuantity} at ${order.avgPrice}<p className={styles.success}>{order.state}</p></td><td><code>{order.venueOrderId}</code><p className={styles.note}>{order.updatedAt}</p></td></tr>)}</tbody></table></div><p className={styles.note}>Saved venue confirmations from this run. Fed leg L3a is simulated and has no order receipt.</p></div>}
      {step === 3 && <>
        <div className={styles.metrics}><Metric label="Reported margin ratio" value={demo.shock.margin.marginRatio} source={demo.shock.margin.source} /><Metric label="Projected ratio · −15% shock" value={demo.shock.projectedRatio} source={demo.shock.projectedSource} /><Metric label="Requested top-up" value={`${(Number(demo.request.amountUsdc6) / 1e6).toFixed(2)} USDC`} source="SIMULATED" /></div>
        <div className={styles.card}><h2>Funding band: 1.2–1.5 <SourceBadge source="SIMULATED" /></h2><p>{demo.shock.decision.explanation}</p><p className={styles.note}>Demo policy: ≥2.0 healthy · 1.5–2.0 warn · 1.2–1.5 funding · below 1.2 reduce exposure. The shock is simulated; it did not move the market.</p></div>
      </>}
      {step === 4 && <div className={styles.twoColumns}>
        <article className={styles.card}><p className={styles.eyebrow}>Arc contract enforces authority</p><h2>Release reverted</h2><SourceBadge source={demo.reverted.source} /><p className={styles.danger}>{demo.reverted.reasonCode}</p><p>Requested {(Number(demo.request.amountUsdc6) / 1e6).toFixed(2)} USDC; vault per-transaction cap 25 USDC.</p><Tx hash={demo.reverted.details.txHash!} label="View reverted transaction" /><p className={styles.note}>One treasury with onchain spending rules. Releases go to the settlement wallet and do not credit either venue's margin.</p></article>
        <article className={styles.card}><p className={styles.eyebrow}>Owner decision</p><h2>Approval requested</h2><SourceBadge source={demo.request.source} /><p>{demo.request.state}</p><code>{demo.request.requestId}</code><p className={styles.note}>Expiry in this run: {demo.request.expiresAtUtc}</p><Tx hash={demo.request.txHash} label="View request transaction" /><p className={styles.note}>Only an owner wallet signature can approve. Grok can report status; it cannot sign.</p></article>
      </div>}
      {step === 5 && <div className={styles.twoColumns}>
        <article className={styles.card}><p className={styles.eyebrow}>Fallback completed</p><h2>{demo.decline.state} → reduce-only FILLED</h2><SourceBadge source={demo.decline.source} /><p>{demo.decline.reasonCode}: the agent canceled the request after the owner's decline.</p><SourceBadge source={demo.reduction.source} /><p>Sold {demo.reduction.filledQuantity} BTC at ${demo.reduction.avgPrice} · reduce-only</p><code>{demo.reduction.venueOrderId}</code><p className={styles.note}>{demo.reduction.updatedAt}</p></article>
        <article className={styles.card}><p className={styles.eyebrow}>Subsequent account check</p><h2>Less exposure. More margin headroom.</h2><SourceBadge source="TESTNET" /><pre>{demo.calibration.slice(1,6).join("\n")}</pre><SourceBadge source="SIMULATED" /><pre>{demo.calibration[6]}</pre><p className={styles.note}>These are the later calibration reads; the immediate order response still contained Derive's delayed margin snapshot.</p></article>
      </div>}
    </section>
    <footer className={styles.footer}>
      <div><b>One thesis. Event-aware execution. Onchain spending discipline.</b><p>Evidence playback · {demo.capturedAtUtc.slice(0,10)} · <a href={`${evidenceRoot}rehearsal-2026-11-19-open.json`} target="_blank" rel="noreferrer">Order evidence</a> · <a href={`${evidenceRoot}rehearsal-2026-11-19-rescue.json`} target="_blank" rel="noreferrer">Rescue evidence</a></p></div>
      <div className={styles.controls}><button disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button><button className={styles.next} onClick={() => setStep(step === steps.length - 1 ? 0 : step + 1)}>{step === steps.length - 1 ? "Restart" : "Next"} →</button></div>
    </footer>
  </main>;
}

function Metric({ label, value, source }: { label: string; value: string; source: string }) {
  return <article className={styles.card}><p>{label}</p><strong className={styles.value}>{value}</strong>{source === "USER_INPUT" ? <small className={styles.eyebrow}>User input</small> : <SourceBadge source={source} />}</article>;
}
function Tx({ hash, label }: { hash: string; label: string }) {
  return <a href={`https://explorer.testnet.arc.io/tx/${hash}`} target="_blank" rel="noreferrer">{label} ↗</a>;
}
