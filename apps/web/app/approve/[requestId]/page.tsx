"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAccount, useConnect, useSwitchChain, useWriteContract } from "wagmi";
import { arcTestnet, buildApproveRequestCall } from "@ttp/treasury/owner";
import { api, apiBase } from "../../../lib/client";
import { card } from "../../theme";

type ReleaseRequest = {
  requestId: string;
  strategyId: string;
  venue: string;
  amountUsdc6: string;
  destination: string;
  expiresAtUtc: string | null;
  state: string;
  reasonCode: string | null;
  source: string;
};

export default function ApprovePage() {
  const params = useParams<{ requestId: string }>();
  const requestId = params.requestId;
  const [request, setRequest] = useState<ReleaseRequest | null>(null);
  const [message, setMessage] = useState("");
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { writeContract, isPending: approving, data: txHash } = useWriteContract();

  useEffect(() => {
    let alive = true;
    fetch(`${apiBase}/api/treasury/requests/${requestId}`).then(async (r) => {
      if (!r.ok) throw new Error("Approval request not found or expired.");
      return r.json() as Promise<ReleaseRequest>;
    }).then((x) => { if (alive) setRequest(x); }).catch((e: unknown) => { if (alive) setMessage(e instanceof Error ? e.message : "Could not load request."); });
    return () => { alive = false; };
  }, [requestId]);

  const approve = () => {
    try {
      const call = buildApproveRequestCall(requestId);
      writeContract({ address: call.address, abi: call.abi, functionName: call.functionName, args: call.args, chainId: call.chainId });
      setMessage("Confirm the Arc transaction in your wallet.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not prepare approval."); }
  };
  const decline = async () => {
    setMessage("Recording decline…");
    try {
      const body = await api<ReleaseRequest & { followUp?: { decision?: { action: string; explanation: string }; reduceOrder?: { state: string; venueOrderId: string | null; source: string } | null } | null }>(`/api/treasury/requests/${requestId}/decline`, { method: "POST" });
      setRequest(body);
      const order = body.followUp?.reduceOrder;
      setMessage(order
        ? `Request declined. Agent placed a reduce-only order on the Derive perp: ${order.state}, venue order ${order.venueOrderId ?? "pending"}.`
        : `Request declined. ${body.followUp?.decision?.explanation ?? "The agent will follow its reduce-only rescue path if needed."}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not decline request."); }
  };

  return (
    <main style={{ ...card, maxWidth: 680, margin: "48px auto", padding: 28 }}>
      <Link href="/" style={{ color: "#00d6b4", fontWeight: 700 }}>Convex · dashboard</Link>
      <p style={{ color: "#a4b5bd", textTransform: "uppercase", letterSpacing: 1 }}>Arc · owner approval</p>
      <h1>Review treasury request</h1>
      {request ? <dl style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, overflowWrap: "anywhere" }}>
        <dt>Amount</dt><dd>{(Number(request.amountUsdc6) / 1_000_000).toFixed(2)} USDC</dd>
        <dt>Destination</dt><dd>{request.destination}</dd>
        <dt>Strategy</dt><dd>{request.strategyId}</dd>
        <dt>Venue</dt><dd>{request.venue}</dd>
        <dt>Reason / state</dt><dd>{request.reasonCode ?? request.state}</dd>
        <dt>Expires</dt><dd>{request.expiresAtUtc ?? "No expiry reported"}</dd>
        <dt>Source</dt><dd>{request.source}</dd>
      </dl> : <p>Loading request…</p>}
      {!isConnected ? <button disabled={connecting} onClick={() => connectors[0] && connect({ connector: connectors[0] })}>Connect owner wallet</button> : <p>Connected: {address}</p>}
      {isConnected && chainId !== arcTestnet.id && <button disabled={switching} onClick={() => switchChain({ chainId: arcTestnet.id })}>Switch to Arc</button>}
      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <button disabled={!isConnected || chainId !== arcTestnet.id || approving || !request} onClick={approve}>Approve on Arc</button>
        <button disabled={!request || ["ARC_FINALIZED", "REJECTED", "EXPIRED"].includes(request.state)} onClick={decline}>Decline</button>
      </div>
      {txHash && <p>Approval transaction: <a href={`${arcTestnet.blockExplorers.default.url}/tx/${txHash}`} target="_blank" rel="noreferrer">view on explorer</a></p>}
      {message && <p role="status">{message}</p>}
      <p style={{ color: "#a4b5bd", fontSize: 13 }}>Your wallet signs the owner action. The server never receives your private key.</p>
    </main>
  );
}
