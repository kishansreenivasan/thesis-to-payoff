# Human to-do

Updated after PR #28. Product name: **Convex**. Current facts below supersede the older credential and deployment notes in the lane briefs and historical blocker entries.

## Completed and recorded

- [x] Required Gemini, Derive, Arc and hosting settings are populated in the local root `.env`. Optional Telegram settings remain empty. Values are never committed.
- [x] Railway serves the dashboard, API and authenticated MCP at https://ttp-production-7410ea00.up.railway.app, with a volume at `/app/data` per the deployment handoff.
- [x] Hosted health/dashboard checks and authenticated MCP `tools/list` succeeded; all four services report real mode.
- [x] Testnet/sandbox rehearsal evidence records filled L3b/L1/L2 orders, live margin calibration, an Arc approval request/cancel and a filled reduce-only Derive rescue order. See `evidence/rehearsal-2026-11-19-*`.
- [x] Demo scripts, operator controls, submission draft and video runbook are implemented.

## Remaining, in order

1. **Teammate with Grok access: finish the connector acceptance and export.** Follow [GROK-HANDOFF.md](GROK-HANDOFF.md). Grok calls our server's tools; it does not run on our server. The existing URL and bearer token are sufficient; no Grok/xAI API key or Sid Grok login is needed. Confirm `compile_thesis` and `position_status` from inside Grok and provide a redacted chat export.
2. **Coordinate Gemini sandbox liquidity.** The checked `BTC2611302200` books currently have no YES bids, so a fresh NO leg cannot open. Ask Gemini to replenish liquidity or wait for it to return. Preserve existing demo positions if present; avoid repeat rehearsals that consume the available bids. The Fed market `FED261211` remains unavailable in sandbox; L3a remains simulated with live read-only mainnet pricing.
3. **Fund and precheck the Arc vault before another full rehearsal.** The last read found 22 USDC total and 12 USDC above the 10 USDC reserve; the full release rehearsal can require up to 100 USDC. The existing recommendation is about 150 test USDC of funding. Vault: `0x1e9B755C7caA3d1D007d70A7cF77E93cc6A65E07`, Arc testnet. Keep gas in the sending wallet: Arc test USDC is also gas. Re-run `pnpm --filter @ttp/treasury precheck --strategy <actual-strategy-id>`; the owner handles any printed cap changes with their own wallet.
4. **Prepare the final demo and submission.** The script and Devpost draft exist in [DEMO-SCRIPT.md](DEMO-SCRIPT.md) and [DEVPOST.md](DEVPOST.md). Capture Convex screenshots, record the 2–3 minute video, add its URL, obtain the Grok export and confirm who attends judging on Nov 21. Local branding changes appear on the hosted app after deployment of the updated branch.
5. **Before reopening positions, check state and calibration.** Derive was flattened after the recorded rehearsal. Follow the runbook and inspect the hosted state first. When a perp is open, rerun calibration; the recorded 1.3226 projected ratio is historical, not a current position reading.

## Optional

- Telegram alerts need `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- Request a sandbox Fed listing and more BTC contract liquidity from Gemini.

## Never

- Commit `.env`, paste secrets into chat, or include authentication settings in exported evidence.
- Put the owner's private key on the server.
- Trade or transfer on mainnet, or claim that Arc releases credit the venues' margin accounts.
