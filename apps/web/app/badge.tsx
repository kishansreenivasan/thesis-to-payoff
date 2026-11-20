// Source badges (DESIGN.md Section 11): green REAL, blue LIVE DATA, orange SIMULATED, gray UNVERIFIED.
const styles: Record<string, { label: string; background: string; color: string }> = {
  SANDBOX: { label: "REAL · GEMINI SANDBOX", background: "#123a30", color: "#7de3bc" },
  TESTNET: { label: "REAL · DERIVE TESTNET", background: "#123a30", color: "#7de3bc" },
  ONCHAIN_TESTNET: { label: "REAL · ARC TESTNET", background: "#123a30", color: "#7de3bc" },
  LIVE_MAINNET_READONLY: { label: "LIVE DATA · READ ONLY", background: "#162e48", color: "#8bc5ff" },
  SIMULATED: { label: "SIMULATED", background: "#3b2c1d", color: "#ffd18b" },
  UNVERIFIED: { label: "UNVERIFIED", background: "#29343d", color: "#becbd4" },
};

export function SourceBadge({ source }: { source: string }) {
  const item = styles[source] ?? styles.UNVERIFIED!;
  return <span style={{ background: item.background, color: item.color, borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{item.label}</span>;
}
