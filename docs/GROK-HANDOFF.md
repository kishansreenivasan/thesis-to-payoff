# Convex: Grok teammate handoff

**Owner:** teammate with Grok access. Sid owns Lane C; he does not need a Grok account to run the hosted API or validate MCP directly.

## Architecture and access

Our Railway server hosts the API, dashboard and MCP tools. Grok runs in the teammate's Grok account and invokes those tools over HTTPS. There is no Grok model running on our server and no Grok/xAI API key is required.

- Connector URL: `https://ttp-production-7410ea00.up.railway.app/mcp` (`PUBLIC_BASE_URL` + `/mcp`).
- Authentication: Bearer, using the existing `MCP_BEARER_TOKEN` from the team's approved secret configuration. If the UI has a token field, enter the token there; for an authorization header use `Bearer <MCP_BEARER_TOKEN>`.
- Never put the token in a URL, commit, screenshot, chat message or export. Configure it only in the connector's authentication field.
- Hosted dashboard and health endpoint have returned HTTP 200 in real mode. Authenticated MCP `tools/list` has returned all seven tools. This establishes endpoint readiness; it does not establish that a Grok conversation has used the connector.

If the teammate already configured this connector, use that existing connection. No new account or API key is needed.

## Acceptance test inside Grok

1. Confirm the custom connector is connected/enabled in the teammate's Grok session.
2. Ask Grok to call `compile_thesis` for: "Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500." Confirm that the reply is based on a tool result rather than a generated trading recommendation.
3. Ask "Use Convex position_status to show the latest position, margin, and any approval request with its owner link." This is a read-only call. If demo state has been cleared, an explicit no-position result is valid; use the recorded rehearsal evidence to show the earlier open/rescue flow.
4. Save a chat export showing the tool invocations and results. Review it for bearer tokens, private keys and account secrets before adding a redacted export under `evidence/grok-chat-<date>.md` (or the original supported export format).
5. Give the Lane C owner the export path and confirm the two tool calls worked, so `STATUS.md` and `docs/DEVPOST.md` can mark Grok acceptance complete.

## Demo limits

- Do not call `approve_strategy`, `execute_strategy`, reset, or flatten as part of this read-only acceptance test.
- Fresh quoting/opening can be blocked by the current Gemini sandbox YES-bid shortage. Do not replace the instrument or present mock output as a live fill.
- The Fed hedge and stress projection remain SIMULATED. Arc releases go to a settlement wallet and do not credit venue margin.
- Use `docs/DEMO-SCRIPT.md` for the staged demonstration. A fuller trading demo needs explicit coordination with the operator and adequate liquidity/funding.

## Deliverables still needed from the teammate

- [ ] Grok `compile_thesis` invocation confirmed.
- [ ] Grok `position_status` invocation confirmed.
- [ ] Redacted Grok chat export committed or supplied to Lane C.

Until that evidence arrives, describe the hosted MCP endpoint as verified and the Grok conversation/export as pending.
