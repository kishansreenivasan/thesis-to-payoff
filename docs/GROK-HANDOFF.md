# Convex: Grok teammate handoff

**Owner: Sid (Lane C).** Initial Grok acceptance is now complete using the signed-in browser account and the user-approved Convex connector. [Conversation transcript](../evidence/grok-chat-2026-11-19.md): both thesis compilation and position status were observed as actual Convex tool activity. The status result was correctly empty. A teammate using another Grok account can follow the setup below; the hosted API itself does not require anyone to log in to Grok.

## Architecture and access

Our Railway server hosts the API, dashboard and MCP tools. Grok runs in the connected user's Grok account and invokes those tools over HTTPS. There is no Grok model running on our server and no Grok/xAI API key is required.

- Connector URL: `https://ttp-production-7410ea00.up.railway.app/mcp` (`PUBLIC_BASE_URL` + `/mcp`).
- Authentication: Bearer, using the existing `MCP_BEARER_TOKEN` from the team's approved secret configuration. If the UI has a token field, enter the token there; for an authorization header use `Bearer <MCP_BEARER_TOKEN>`.
- Never put the token in a URL, commit, screenshot, chat message or export. Configure it only in the connector's authentication field.
- Hosted dashboard and health endpoint have returned HTTP 200 in real mode. Authenticated MCP `tools/list` has returned all seven tools. The subsequent Grok conversation also invoked the connector; its transcript is linked above.

If the teammate already configured this connector, use that existing connection. No new account or API key is needed.

## Recording example

The homepage now starts with the simpler bullish-BTC/downside-protection prompt. Use the original Fed-hike thesis in the actual Grok chat:

> Use Convex to build a strategy for this view: “Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.” Show the legs, costs, and payoff scenarios. Ask for my approval before executing.

The signed-in conversation has this prompt prepared as an unsent draft. The existing acceptance transcript remains a separate completed conversation result; no new tool execution is claimed for the unsent draft.

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

## Initial acceptance deliverables completed

- [x] Grok `compile_thesis` invocation confirmed.
- [x] Grok `position_status` invocation confirmed (no open position).
- [x] Markdown UI transcript captured in `evidence/grok-chat-2026-11-19.md`; no authentication values included.

For the final video, a position and pending owner request inside Grok still need a funded, liquid demo state. The initial read-only chat acceptance is complete; the saved transcript is not a native Grok archive.
