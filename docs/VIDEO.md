# Convex video: easiest recording path

Use `/replay` on the Convex web app. It displays the original November 19 execution evidence with its dates, receipt IDs and source labels. Next/Back only move between screens; this page makes no API calls, submits no transactions, and needs no token or wallet. No fresh Gemini liquidity or Arc funding is needed to record this walkthrough.

Local: `pnpm dev:web`, then open http://localhost:3000/replay. Hosted after deployment: https://ttp-production-7410ea00.up.railway.app/replay.

Record the browser at 1440×900 or 1920×1080, with notifications hidden. Keep the date and source labels visible. Start on “Your thesis” and click Next at the cue. Aim for 2 minutes 30 seconds. Read naturally; leave a short pause between screens.

| Time | Screen | Narration |
|---|---|---|
| 0:00–0:25 | Your thesis | “Have a market view, but no plan for being wrong? This is Convex. Give it a supported Bitcoin thesis, your Fed concern and a risk budget. Grok structures the intent; deterministic code chooses the instruments, prices, sizes and limits. We’ll walk through our November 19 testnet run.” |
| 0:25–0:50 | The strategy | “Convex coordinates a call and a perpetual on Derive testnet, a BTC downside event contract on Gemini sandbox, and a simulated Fed-hike hedge priced from read-only Gemini mainnet data. The source labels show exactly which parts are real and which are modeled. The loss budget is a model, not a guarantee.” |
| 0:50–1:10 | Execution | “Execution requires approval of the exact plan version. Here are the venue-confirmed fills: Gemini first, then the Derive call and perp. Each has a real venue order ID. The simulated Fed position has no order receipt.” |
| 1:10–1:35 | Stress test | “Now we apply a simulated fifteen-percent BTC shock. The actual margin read is separate from the projection. The projected ratio drops to about 1.32, inside the funding band, and the risk engine calculates a top-up of about 36 USDC.” |
| 1:35–2:00 | Owner control | “The Arc vault enforces spending authority onchain. This request exceeds the 25-USDC transaction cap, so the release reverts. The agent then files an owner approval request. These links lead to the real Arc transactions. Only the owner’s wallet can approve. Arc releases go to a settlement wallet, not into exchange margin.” |
| 2:00–2:30 | The rescue | “In this run the owner declined. The agent canceled the request and filled a real reduce-only sell on Derive testnet. The later account check shows the smaller position and greater margin headroom. Grok gives users the interface; deterministic execution and onchain controls enforce the boundaries. One thesis. Event-aware execution. Onchain spending discipline.” |

For a Grok opening shot, click **Create with Grok**, enable the **Convex connector** in that Grok account, and prompt: “Use Convex to compile this thesis: Bullish BTC into December, worried the Fed hikes more than expected on Dec 11. Max risk $500.” Ask for compilation only while current sandbox pricing is blocked by liquidity, then return to the demo walkthrough. This is a real Grok tool call; the `/replay` controls advance through the saved execution evidence.

You can also use the actual Grok acceptance chat, which invoked `compile_thesis` and `position_status`. That chat returned no open position. The pending-request status in the rescue evidence was an MCP response from the rehearsal, not a pending request shown inside that Grok chat. Do not splice those into a claim that Grok showed a pending approval.

## Recording and upload

1. Open `/replay` and verify all six screens; leave it at the first screen.
2. Start the computer's screen recorder with microphone enabled. Record the browser window and follow the table.
3. Stop after the closing line. Trim the beginning/end; keep the date/source labels visible.
4. Upload the video and check that it plays while signed out. Add its URL to the Devpost form and `docs/DEVPOST.md`.

The video is still to be recorded and uploaded. This page prepares a dependable capture path; it does not create a video file. A fresh live opening remains conditional on Gemini liquidity and vault funding.
