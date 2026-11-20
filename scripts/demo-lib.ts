// Shared helpers for demo:open / demo:reset (DESIGN.md Sections 9 and 17). They drive a running
// API (local or hosted) over HTTP with the operator bearer token; no financial logic here.
export const DEMO_THESIS = "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.";

export const baseUrl = () => (process.env.DEMO_BASE_URL || process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, "");

export async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = process.env.MCP_BEARER_TOKEN;
  const response = await fetch(`${baseUrl()}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = (text ? JSON.parse(text) : {}) as T & { error?: string };
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${parsed.error ?? text}`);
  return parsed;
}

export const log = (message: string) => console.log(`[demo] ${message}`);
