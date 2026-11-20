// Source badges (DESIGN.md Section 11): green REAL, blue LIVE DATA, orange SIMULATED, gray UNVERIFIED.
const styles: Record<string, { label: string; background: string; color: string }> = {
  SANDBOX: { label: "REAL · GEMINI SANDBOX", background: "#dcf5e3", color: "#14532d" },
  TESTNET: { label: "REAL · DERIVE TESTNET", background: "#dcf5e3", color: "#14532d" },
  ONCHAIN_TESTNET: { label: "REAL · ARC TESTNET", background: "#dcf5e3", color: "#14532d" },
  LIVE_MAINNET_READONLY: { label: "LIVE DATA · READ ONLY", background: "#dbeafe", color: "#1e3a8a" },
  SIMULATED: { label: "SIMULATED", background: "#ffedd5", color: "#9a3412" },
  UNVERIFIED: { label: "UNVERIFIED", background: "#e5e7eb", color: "#374151" },
};

export function SourceBadge({ source }: { source: string }) {
  const item = styles[source] ?? styles.UNVERIFIED!;
  return <span style={{ background: item.background, color: item.color, borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{item.label}</span>;
}
