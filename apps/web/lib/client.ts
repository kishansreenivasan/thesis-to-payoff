// Browser helpers shared by the dashboard and the approval page.
// Hosted build sets NEXT_PUBLIC_API_BASE_URL="" so calls go to the same origin.
export const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const TOKEN_KEY = "ttp-operator-token";

/** Operator token (the MCP bearer token), kept only in this browser. Live demo controls need it. */
export function getOperatorToken(): string {
  try { return window.localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}
export function setOperatorToken(token: string) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked: token lasts for this page only */ }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getOperatorToken();
  const response = await fetch(`${apiBase}${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined || init.method === "POST" ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.method === "POST" ? JSON.stringify(init.body ?? {}) : undefined,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) as T & { error?: string } : ({} as T & { error?: string });
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}
